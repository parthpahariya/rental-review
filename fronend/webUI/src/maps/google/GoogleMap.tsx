/** The map drawn with the Google Maps JavaScript API (Advanced Markers). */
import { useEffect, useRef, useState } from "react";
import {
  MarkerClusterer,
  SuperClusterAlgorithm,
  type Algorithm,
  type AlgorithmInput,
  type AlgorithmOutput,
  type Cluster,
} from "@googlemaps/markerclusterer";
import type { Location } from "../../api";
import {
  MAP_LABEL,
  MAX_ZOOM,
  MapUnavailable,
  START,
  clusterLabel,
  clusterRadius,
  pinLabel,
  validBounds,
  wrapLongitude,
} from "../shared";
import type { MapProps, MapView } from "../types";
import { loadGoogleMaps, onAuthFailure, type GoogleMaps } from "./loader";

type Pin = google.maps.marker.AdvancedMarkerElement;

export default function GoogleMap({
  locations,
  selected,
  onSelect,
  draft = null,
  onPick,
  onViewChange,
  insetLeft = 0,
  highlighted = null,
  onHover,
  focus = null,
  partial = false,
}: MapProps) {
  const element = useRef<HTMLDivElement>(null);
  // Google Maps loads asynchronously; effects re-run once it is ready.
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const lib = useRef<GoogleMaps | null>(null);
  const map = useRef<google.maps.Map | null>(null);
  const clusterer = useRef<MarkerClusterer | null>(null);
  const algorithm = useRef<TieredAlgorithm | null>(null);
  const byId = useRef(new Map<string, Pin>());
  /** What each pin was last drawn with, so unchanged pins are left alone. */
  const pinKeys = useRef(new Map<string, string>());
  const byIdLocation = useRef(new Map<string, Location>());
  /** The bubble currently standing in for each clustered pin. */
  const shownBy = useRef(new Map<Pin, Pin>());
  const highlight = useRef<string | null>(null);
  const lit = useRef<Element | null>(null);
  const draftMarker = useRef<Pin | null>(null);
  const select = useRef(onSelect);
  const pick = useRef(onPick);
  const viewChange = useRef(onViewChange);
  const inset = useRef(insetLeft);
  const report = useRef<(() => void) | null>(null);
  // Read by the cluster renderer when bubbles are drawn; set before effects run.
  isPartial.current = partial;
  inset.current = insetLeft;
  const hover = useRef(onHover);
  hover.current = onHover;
  select.current = onSelect;
  pick.current = onPick;
  viewChange.current = onViewChange;
  useEffect(() => {
    let live = true;
    const stopAuth = onAuthFailure(() => {
      if (live) setFailed(true);
    });
    const listeners: google.maps.MapsEventListener[] = [];
    loadGoogleMaps()
      .then((g) => {
        const div = element.current;
        if (!live || !div) return;
        lib.current = g;
        // Reuse the map made earlier in this visit: each new map is billed.
        const kept = keptMap(g);
        div.appendChild(kept.canvas);
        const instance = kept.map;
        // Marker clicks don't reach the map, so this only fires on empty space.
        listeners.push(
          instance.addListener("click", (e: google.maps.MapMouseEvent) => {
            if (e.latLng)
              pick.current?.({
                latitude: e.latLng.lat(),
                longitude: e.latLng.lng(),
              });
          }),
        );
        const reportView = () => {
          const view = visibleView(instance, div, inset.current);
          if (view) viewChange.current?.(view);
        };
        listeners.push(instance.addListener("idle", reportView));
        report.current = reportView;
        map.current = instance;
        algorithm.current = kept.algorithm;
        clusterer.current = kept.clusterer;
        listeners.push(
          kept.clusterer.addListener("clusteringend", () => {
            shownBy.current.clear();
            for (const cluster of kept.algorithm.clusters)
              if (cluster.markers.length > 1 && cluster.marker)
                for (const pin of cluster.markers)
                  shownBy.current.set(pin as Pin, cluster.marker as Pin);
            applyHighlight(highlight.current);
          }),
        );
        // A re-attached map already has a view; report it straight away.
        reportView();
        setReady(true);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
      stopAuth();
      listeners.forEach((l) => l.remove());
      // The map itself is kept for the next visit to the map screen; only this
      // screen's pins and draft pin go.
      clusterer.current?.clearMarkers();
      if (draftMarker.current) draftMarker.current.map = null;
      kept?.canvas.remove();
      map.current = null;
      clusterer.current = null;
      algorithm.current = null;
      byId.current.clear();
      pinKeys.current.clear();
      shownBy.current.clear();
      draftMarker.current = null;
    };
  }, []);
  // Pins are updated in place rather than cleared and rebuilt on every
  // response, so the clusterer isn't redrawing the whole city on each pan.
  useEffect(() => {
    const group = clusterer.current;
    const g = lib.current;
    if (!group || !g) return;
    const wanted = new Map(locations.map((l) => [l.id, l]));
    const stale: Pin[] = [];
    for (const [id, marker] of byId.current)
      if (!wanted.has(id)) {
        stale.push(marker);
        byId.current.delete(id);
        pinKeys.current.delete(id);
      }
    if (stale.length) group.removeMarkers(stale, true);
    const added: Pin[] = [];
    let moved = false;
    for (const location of locations) {
      const active = location.id === selected;
      const label = pinLabel(location.summary.average_rating);
      const key = `${active}|${label}|${location.latitude},${location.longitude}`;
      const existing = byId.current.get(location.id);
      if (existing && pinKeys.current.get(location.id) === key) continue;
      const content = pinElement(active ? "map-pin active" : "map-pin", label);
      const position = { lat: location.latitude, lng: location.longitude };
      pinKeys.current.set(location.id, key);
      if (existing) {
        existing.content = content;
        existing.position = position;
        moved = true;
        continue;
      }
      const name = location.building_name || location.address;
      const marker = new g.marker.AdvancedMarkerElement({
        position,
        content,
        title: `Read reviews of ${name}`,
        gmpClickable: true,
      });
      marker.addEventListener("gmp-click", () =>
        select.current(byIdLocation.current.get(location.id) ?? location),
      );
      // Pins of buildings a few metres apart can overlap at full zoom; the
      // hovered one comes to the front so it can be clicked.
      marker.addEventListener("pointerenter", () => {
        marker.zIndex = 2000;
        hover.current?.(location.id);
      });
      marker.addEventListener("pointerleave", () => {
        marker.zIndex = null;
        hover.current?.(null);
      });
      byId.current.set(location.id, marker);
      added.push(marker);
    }
    byIdLocation.current = wanted;
    if (added.length) group.addMarkers(added, true);
    if (stale.length || added.length || moved) {
      if (algorithm.current) algorithm.current.force = true;
      group.render();
    }
    applyHighlight(highlight.current);
  }, [locations, selected, ready]);
  // Bring a newly selected pin into view once, not on every data refresh
  // (that used to yank the map back while the visitor was zooming out).
  useEffect(() => {
    const marker = selected ? byId.current.get(selected) : undefined;
    if (marker) reveal(marker);
  }, [selected, ready]);
  function reveal(marker: Pin, attempts = 4) {
    const instance = map.current;
    const group = clusterer.current;
    const div = element.current;
    if (!instance || !group || !div || attempts === 0) return;
    if (![...byId.current.values()].includes(marker)) return;
    const at = latLng(marker.position);
    if (!at) return;
    if (!shownBy.current.has(marker)) {
      // Nudge the map if the pin ended up under the floating panel.
      const x = containerX(instance, div, at.lng);
      const edge = inset.current + 48;
      if (x != null && x < edge) instance.panBy(x - edge - 80, 0);
      return;
    }
    // Zoom in on the pin until its bubble splits apart.
    const zoom = Math.min(MAX_ZOOM, Math.round(instance.getZoom() ?? 12) + 2);
    google.maps.event.addListenerOnce(group, "clusteringend", () =>
      reveal(marker, attempts - 1),
    );
    instance.setCenter(at);
    instance.setZoom(zoom);
  }
  useEffect(() => {
    const instance = map.current;
    const div = element.current;
    if (!focus || !instance || !div) return;
    const b = focus.bounds;
    // Tiny extents (a single block) would zoom in too far.
    if (b && b.north - b.south > 0.004) {
      instance.fitBounds(b, {
        left: 30 + inset.current,
        top: 30,
        right: 30,
        bottom: 30,
      });
      google.maps.event.addListenerOnce(instance, "idle", () => {
        if ((instance.getZoom() ?? 0) > 16) instance.setZoom(16);
      });
    } else {
      // Centre the place in the visible part of the map, beside the panel.
      const zoom = focus.zoom ?? 15;
      instance.setZoom(zoom);
      instance.setCenter({
        lat: focus.center.latitude,
        lng: focus.center.longitude - (inset.current / 2) * degreesPerPixel(zoom),
      });
    }
  }, [focus?.key, ready]);
  useEffect(() => {
    // Showing or hiding the side panel changes how much of the map is visible.
    report.current?.();
  }, [insetLeft]);
  useEffect(() => {
    // Redraw bubbles with or without "+" when the view becomes (in)complete.
    if (algorithm.current) algorithm.current.force = true;
    clusterer.current?.render();
  }, [partial]);
  useEffect(() => {
    highlight.current = highlighted;
    applyHighlight(highlighted);
  }, [highlighted]);
  function applyHighlight(id: string | null) {
    lit.current?.classList.remove("map-highlight");
    lit.current = null;
    const marker = id ? byId.current.get(id) : undefined;
    if (!marker) return;
    // Light up the pin, or the cluster bubble currently hiding it.
    const shown = shownBy.current.get(marker) ?? marker;
    const content = shown.content;
    if (content instanceof Element) {
      content.classList.add("map-highlight");
      lit.current = content;
    }
  }
  useEffect(() => {
    const instance = map.current;
    const g = lib.current;
    if (!instance || !g) return;
    if (!draft) {
      if (draftMarker.current) draftMarker.current.map = null;
      draftMarker.current = null;
      return;
    }
    const at = { lat: draft.latitude, lng: draft.longitude };
    if (draftMarker.current) {
      draftMarker.current.position = at;
    } else {
      const marker = new g.marker.AdvancedMarkerElement({
        map: instance,
        position: at,
        gmpDraggable: true,
        zIndex: 3000,
        title: "New place. Drag to adjust.",
        content: pinElement("map-pin draft", "+ New"),
      });
      marker.addListener("dragend", () => {
        const p = latLng(marker.position);
        if (p) pick.current?.({ latitude: p.lat, longitude: p.lng });
      });
      draftMarker.current = marker;
    }
    if (!instance.getBounds()?.contains(at)) instance.panTo(at);
  }, [draft, ready]);
  // Google draws its own error box into the map element; show ours instead.
  if (failed) return <MapUnavailable />;
  return (
    <div
      ref={element}
      className="property-map"
      role="region"
      aria-label={MAP_LABEL}
    />
  );
}

/**
 * The one Google map of this page visit. Google bills every map that is
 * created, so leaving the map screen (e.g. for the home page) detaches it and
 * coming back re-attaches it instead of creating another.
 */
type KeptMap = {
  canvas: HTMLDivElement;
  map: google.maps.Map;
  clusterer: MarkerClusterer;
  algorithm: TieredAlgorithm;
};
let kept: KeptMap | null = null;

function keptMap(g: GoogleMaps): KeptMap {
  if (kept) return kept;
  const canvas = document.createElement("div");
  canvas.className = "property-map-canvas";
  const map = new g.maps.Map(canvas, {
    center: { lat: START.latitude, lng: START.longitude },
    zoom: START.zoom,
    mapId: g.mapId,
    maxZoom: MAX_ZOOM,
    disableDefaultUI: true,
    zoomControl: true,
    zoomControlOptions: {
      position: google.maps.ControlPosition.RIGHT_BOTTOM,
    },
    gestureHandling: "greedy",
    // Taps on Google's own POIs would otherwise open their info cards.
    clickableIcons: false,
    draggableCursor: "crosshair",
  });
  // Nearby pins merge into a counted bubble; clicking one zooms in. At the
  // closest zoom every building gets its own pin, so pins never fan out.
  const algorithm = new TieredAlgorithm();
  const clusterer = new MarkerClusterer({
    map,
    algorithm,
    renderer: {
      render: (cluster) =>
        new g.marker.AdvancedMarkerElement({
          position: cluster.position,
          content: clusterElement(cluster.count),
          zIndex: 1000 + cluster.count,
        }),
    },
  });
  kept = { canvas, map, clusterer, algorithm };
  return kept;
}

/** Longitude degrees per screen pixel at `zoom` (256 px world tiles). */
function degreesPerPixel(zoom: number) {
  return 360 / (256 * 2 ** zoom);
}


function latLng(
  p: google.maps.marker.AdvancedMarkerElement["position"],
): google.maps.LatLngLiteral | null {
  if (!p) return null;
  if (p instanceof google.maps.LatLng) return { lat: p.lat(), lng: p.lng() };
  return { lat: Number(p.lat), lng: Number(p.lng) };
}

/** Horizontal pixel position of `lng` inside the map's container. */
function containerX(
  instance: google.maps.Map,
  div: HTMLElement,
  lng: number,
): number | null {
  const center = instance.getCenter();
  const zoom = instance.getZoom();
  if (!center || zoom == null) return null;
  const delta = wrapLongitude(lng - center.lng());
  return div.clientWidth / 2 + delta / degreesPerPixel(zoom);
}

/** The map view minus the strip a floating panel covers on the left. */
function visibleView(
  instance: google.maps.Map,
  div: HTMLElement,
  insetLeft: number,
): MapView | null {
  const b = instance.getBounds();
  const center = instance.getCenter();
  const zoom = instance.getZoom();
  if (!b || !center || zoom == null) return null;
  const width = div.clientWidth;
  const left = Math.min(insetLeft, width - 1);
  const dpp = degreesPerPixel(zoom);
  const west = center.lng() - (width / 2 - left) * dpp;
  const east = center.lng() + (width / 2) * dpp;
  const south = b.getSouthWest().lat();
  const north = b.getNorthEast().lat();
  return {
    center: {
      latitude: (south + north) / 2,
      longitude: wrapLongitude((west + east) / 2),
    },
    bounds: validBounds({ west, south, east, north }),
    zoom: Math.min(MAX_ZOOM, Math.round(zoom)),
  };
}

/**
 * Supercluster takes one radius, so keep one per `clusterRadius` tier and use
 * the one for the current zoom. `force` redraws even when nothing moved, e.g.
 * when bubble labels change.
 */
class TieredAlgorithm implements Algorithm {
  private tiers = new Map<number, SuperClusterAlgorithm>();
  private lastRadius = -1;
  force = false;
  clusters: Cluster[] = [];
  calculate(input: AlgorithmInput): AlgorithmOutput {
    const radius = clusterRadius(Math.round(input.map.getZoom() ?? 0));
    let tier = this.tiers.get(radius);
    if (!tier) {
      // extent 256 makes the radius screen pixels on Google's 256 px tiles.
      tier = new SuperClusterAlgorithm({
        radius,
        extent: 256,
        maxZoom: MAX_ZOOM - 1,
      });
      this.tiers.set(radius, tier);
    }
    const output = tier.calculate(input);
    const changed =
      output.changed !== false || radius !== this.lastRadius || this.force;
    this.lastRadius = radius;
    this.force = false;
    this.clusters = output.clusters;
    return { clusters: output.clusters, changed };
  }
}

/** Whether the PropertyMap on screen has only some of the places in view. */
const isPartial = { current: false };

function pinElement(className: string, label: string) {
  const span = document.createElement("span");
  span.className = className;
  span.textContent = label;
  return span;
}

function clusterElement(count: number) {
  const { size, text, spoken } = clusterLabel(count, isPartial.current);
  const span = document.createElement("span");
  span.className = "map-cluster";
  span.style.width = `${size}px`;
  span.style.height = `${size}px`;
  span.setAttribute("aria-label", spoken);
  span.textContent = text;
  return span;
}
