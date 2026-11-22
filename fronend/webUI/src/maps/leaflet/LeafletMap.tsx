/**
 * The Leaflet map engine: pins, rating bubbles, draft and searched-place pins,
 * view reporting. It draws no map itself; each provider (OpenStreetMap, HERE,
 * Mapbox, Ola) hands it the base layer with that provider's map.
 */
import { useEffect, useRef, useState, type ComponentType } from "react";
import L from "leaflet";
import "leaflet.markercluster";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import type { Location } from "../../api";
import {
  MAP_LABEL,
  MAX_ZOOM,
  START,
  clusterLabel,
  clusterRadius,
  pinLabel,
  searchedElement,
  validBounds,
  wrapLongitude,
} from "../shared";
import type { MapProps } from "../types";

/**
 * Makes the provider's map layer (raster tiles or a vector style). It calls
 * `onFail` when the provider refuses it, e.g. a rejected or inactive key.
 */
export type BaseLayer = (onFail: () => void) => L.Layer;

/**
 * Raster tiles that report failure when none load: a few failed tiles are
 * normal on a slow network, but every tile failing means the provider said no.
 */
export function rasterTiles(
  url: string,
  options: L.TileLayerOptions,
): BaseLayer {
  return (onFail) => {
    let loaded = false;
    let failed = 0;
    return L.tileLayer(url, options)
      .on("tileload", () => {
        loaded = true;
      })
      .on("tileerror", () => {
        if (!loaded && ++failed === 4) onFail();
      });
  };
}

/** A map component for the provider whose map `baseLayer` draws. */
export function leafletMap(baseLayer: BaseLayer): ComponentType<MapProps> {
  return function ProviderMap(props: MapProps) {
    return <LeafletMap {...props} baseLayer={baseLayer} />;
  };
}

function LeafletMap({
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
  searched = null,
  partial = false,
  baseLayer,
}: MapProps & { baseLayer: BaseLayer }) {
  const element = useRef<HTMLDivElement>(null);
  // The provider refused the map background; pins and the list still work.
  const [backgroundFailed, setBackgroundFailed] = useState(false);
  const map = useRef<L.Map | null>(null);
  const markers = useRef<L.MarkerClusterGroup | null>(null);
  const byId = useRef(new Map<string, L.Marker>());
  /** What each pin was last drawn with, so unchanged pins are left alone. */
  const pinKeys = useRef(new Map<string, string>());
  const byIdLocation = useRef(new Map<string, Location>());
  const highlight = useRef<string | null>(null);
  const draftMarker = useRef<L.Marker | null>(null);
  const searchedMarker = useRef<L.Marker | null>(null);
  const select = useRef(onSelect);
  const pick = useRef(onPick);
  const viewChange = useRef(onViewChange);
  const inset = useRef(insetLeft);
  const report = useRef<(() => void) | null>(null);
  // Read by clusterIcon when bubbles are drawn; set before effects run.
  isPartial.current = partial;
  inset.current = insetLeft;
  const hover = useRef(onHover);
  hover.current = onHover;
  select.current = onSelect;
  pick.current = onPick;
  viewChange.current = onViewChange;
  useEffect(() => {
    if (!element.current) return;
    const instance = L.map(element.current, {
      // Set on the map itself, not only on tile layers: the cluster plugin
      // requires it, and vector base layers (Ola) don't provide one.
      maxZoom: MAX_ZOOM,
      zoomControl: false,
      scrollWheelZoom: true,
    }).setView([START.latitude, START.longitude], START.zoom);
    L.control.zoom({ position: "bottomright" }).addTo(instance);
    baseLayer(() => setBackgroundFailed(true)).addTo(instance);
    // Marker clicks don't bubble to the map, so this only fires on empty space.
    instance.on("click", (e: L.LeafletMouseEvent) =>
      pick.current?.({ latitude: e.latlng.lat, longitude: e.latlng.lng }),
    );
    const reportView = () => {
      // Report only the part of the map not covered by the floating panel.
      const size = instance.getSize();
      const left = Math.min(inset.current, size.x - 1);
      const b = L.latLngBounds(
        instance.containerPointToLatLng([left, size.y]),
        instance.containerPointToLatLng([size.x, 0]),
      );
      const c = b.getCenter();
      viewChange.current?.({
        center: { latitude: c.lat, longitude: wrapLongitude(c.lng) },
        bounds: validBounds({
          west: b.getWest(),
          south: b.getSouth(),
          east: b.getEast(),
          north: b.getNorth(),
        }),
        zoom: instance.getZoom(),
      });
    };
    instance.on("moveend", reportView);
    reportView();
    report.current = reportView;
    map.current = instance;
    // Nearby pins merge into a counted bubble; clicking one zooms in. At the
    // closest zoom every building gets its own pin, so pins never fan out.
    markers.current = L.markerClusterGroup({
      maxClusterRadius: clusterRadius,
      disableClusteringAtZoom: MAX_ZOOM,
      showCoverageOnHover: false,
      spiderfyOnMaxZoom: false,
      zoomToBoundsOnClick: true,
      iconCreateFunction: clusterIcon,
    }).addTo(instance);
    markers.current.on("animationend", () => applyHighlight(highlight.current));
    instance.on("zoomend", () => applyHighlight(highlight.current));
    const observer = new ResizeObserver(() => instance.invalidateSize());
    observer.observe(element.current);
    return () => {
      observer.disconnect();
      instance.remove();
      map.current = null;
      byId.current.clear();
      pinKeys.current.clear();
      draftMarker.current = null;
      searchedMarker.current = null;
    };
  }, []);
  // Pins are updated in place rather than cleared and rebuilt on every response:
  // rebuilding mid-zoom left markercluster holding detached markers, which threw
  // on every later move and stopped clustering and view updates.
  useEffect(() => {
    const group = markers.current;
    if (!map.current || !group) return;
    const wanted = new Map(locations.map((l) => [l.id, l]));
    const stale: L.Marker[] = [];
    for (const [id, marker] of byId.current)
      if (!wanted.has(id)) {
        stale.push(marker);
        byId.current.delete(id);
        pinKeys.current.delete(id);
      }
    if (stale.length) group.removeLayers(stale);
    const added: L.Marker[] = [];
    for (const location of locations) {
      const active = location.id === selected;
      const label = pinLabel(location.summary.average_rating);
      const key = `${active}|${label}|${location.latitude},${location.longitude}`;
      const existing = byId.current.get(location.id);
      if (existing && pinKeys.current.get(location.id) === key) continue;
      const icon = L.divIcon({
        className: "",
        html: `<span class="map-pin ${active ? "active" : ""}">${label}</span>`,
        iconSize: [68, 38],
        iconAnchor: [34, 38],
      });
      pinKeys.current.set(location.id, key);
      if (existing) {
        existing.setIcon(icon);
        existing.setLatLng([location.latitude, location.longitude]);
        continue;
      }
      const marker = L.marker([location.latitude, location.longitude], {
        icon,
        keyboard: true,
        // Pins of buildings a few metres apart can overlap at full zoom; the
        // hovered one comes to the front so it can be clicked.
        riseOnHover: true,
        title: location.building_name || location.address,
        alt: `Read reviews of ${location.building_name || location.address}`,
      });
      marker.on("click", () =>
        select.current(byIdLocation.current.get(location.id) ?? location),
      );
      marker.on("mouseover", () => hover.current?.(location.id));
      marker.on("mouseout", () => hover.current?.(null));
      byId.current.set(location.id, marker);
      added.push(marker);
    }
    byIdLocation.current = wanted;
    if (added.length) group.addLayers(added);
    applyHighlight(highlight.current);
  }, [locations, selected]);
  // Bring a newly selected pin into view once, not on every data refresh
  // (that used to yank the map back while the visitor was zooming out).
  useEffect(() => {
    const marker = selected ? byId.current.get(selected) : undefined;
    if (marker) reveal(marker);
  }, [selected]);
  function reveal(marker: L.Marker, attempts = 3) {
    const instance = map.current;
    const group = markers.current;
    if (!instance || !group || !group.hasLayer(marker) || attempts === 0)
      return;
    const shown = group.getVisibleParent(marker) as
      L.Marker | L.MarkerCluster | null;
    if (shown === marker) {
      // Nudge the map if the pin ended up under the floating panel.
      const p = instance.latLngToContainerPoint(marker.getLatLng());
      const edge = inset.current + 48;
      if (p.x < edge) instance.panBy([p.x - edge - 80, 0]);
      return;
    }
    // Zoom to where the pin's smallest cluster splits apart, then check again.
    const parent = (marker as L.Marker & { __parent?: { _zoom: number } })
      .__parent;
    const zoom = Math.min(
      instance.getMaxZoom(),
      Math.max(instance.getZoom(), (parent?._zoom ?? instance.getZoom()) + 1),
    );
    instance.once("moveend", () => reveal(marker, attempts - 1));
    instance.setView(marker.getLatLng(), zoom);
  }
  useEffect(() => {
    if (!focus || !map.current) return;
    const b = focus.bounds;
    // Tiny OpenStreetMap extents (a single block) would zoom in too far.
    if (b && b.north - b.south > 0.004)
      map.current.fitBounds(
        [
          [b.south, b.west],
          [b.north, b.east],
        ],
        {
          paddingTopLeft: [30 + inset.current, 30],
          paddingBottomRight: [30, 30],
          maxZoom: 16,
        },
      );
    else {
      // Centre the place in the visible part of the map, beside the panel.
      const zoom = focus.zoom ?? 15;
      const point = map.current
        .project([focus.center.latitude, focus.center.longitude], zoom)
        .subtract([inset.current / 2, 0]);
      map.current.setView(map.current.unproject(point, zoom), zoom);
    }
  }, [focus?.key]);
  useEffect(() => {
    // Showing or hiding the side panel changes how much of the map is visible.
    report.current?.();
  }, [insetLeft]);
  useEffect(() => {
    // Redraw bubbles with or without "+" when the view becomes (in)complete.
    markers.current?.refreshClusters();
    applyHighlight(highlight.current);
  }, [partial]);
  useEffect(() => {
    highlight.current = highlighted;
    applyHighlight(highlighted);
  }, [highlighted]);
  function applyHighlight(id: string | null) {
    element.current
      ?.querySelectorAll(".map-highlight")
      .forEach((el) => el.classList.remove("map-highlight"));
    const marker = id ? byId.current.get(id) : undefined;
    if (!marker || !markers.current) return;
    // Light up the pin, or the cluster bubble currently hiding it.
    const shown = markers.current.getVisibleParent(marker) as L.Marker | null;
    shown
      ?.getElement()
      ?.querySelector(".map-pin, .map-cluster")
      ?.classList.add("map-highlight");
  }
  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    if (!draft) {
      draftMarker.current?.remove();
      draftMarker.current = null;
      return;
    }
    const at: L.LatLngExpression = [draft.latitude, draft.longitude];
    if (draftMarker.current) {
      draftMarker.current.setLatLng(at);
    } else {
      const marker = L.marker(at, {
        draggable: true,
        keyboard: true,
        zIndexOffset: 1000,
        title: "New place. Drag to adjust.",
        alt: "New place pin",
        icon: L.divIcon({
          className: "",
          html: `<span class="map-pin draft">+ New</span>`,
          iconSize: [68, 38],
          iconAnchor: [34, 38],
        }),
      });
      marker.on("dragend", () => {
        const p = marker.getLatLng();
        pick.current?.({ latitude: p.lat, longitude: p.lng });
      });
      marker.addTo(instance);
      draftMarker.current = marker;
    }
    if (!instance.getBounds().contains(at)) instance.panTo(at);
  }, [draft]);
  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    if (!searched) {
      searchedMarker.current?.remove();
      searchedMarker.current = null;
      return;
    }
    const at: L.LatLngExpression = [searched.latitude, searched.longitude];
    if (searchedMarker.current) searchedMarker.current.setLatLng(at);
    else
      searchedMarker.current = L.marker(at, {
        // Only marks the spot: taps go through to the map underneath.
        interactive: false,
        keyboard: false,
        zIndexOffset: 900,
        title: "Searched place",
        icon: L.divIcon({
          className: "",
          html: searchedElement().outerHTML,
          iconSize: [26, 26],
          iconAnchor: [13, 30],
        }),
      }).addTo(instance);
  }, [searched?.latitude, searched?.longitude]);
  return (
    <>
      <div
        ref={element}
        className="property-map"
        role="region"
        aria-label={MAP_LABEL}
      />
      {backgroundFailed && (
        <p className="map-notice" role="status">
          The map background couldn’t load. Pins and the list still work.
        </p>
      )}
    </>
  );
}

/** Whether the map on screen has only some of the places in view. */
const isPartial = { current: false };

function clusterIcon(cluster: L.MarkerCluster) {
  const { size, text, spoken } = clusterLabel(
    cluster.getChildCount(),
    isPartial.current,
  );
  return L.divIcon({
    className: "",
    html: `<span class="map-cluster" style="width:${size}px;height:${size}px" aria-label="${spoken}">${text}</span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}
