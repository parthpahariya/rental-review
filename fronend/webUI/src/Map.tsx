import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet.markercluster";
import type { Location } from "./api";
import { formatCount, formatShort, formatShortAtLeast } from "./format";

export type Point = { latitude: number; longitude: number };
export type Bounds = {
  west: number;
  south: number;
  east: number;
  north: number;
};
export type MapView = { center: Point; bounds: Bounds; zoom: number };
/** A place to move the map to; change `key` to move there again. */
export type Focus = {
  key: number;
  center: Point;
  bounds?: Bounds;
  zoom?: number;
};

export default function PropertyMap({
  locations,
  selected,
  onSelect,
  draft = null,
  onPick,
  onViewChange,
  zoomOut = 0,
  insetLeft = 0,
  highlighted = null,
  onHover,
  focus = null,
  partial = false,
}: {
  locations: Location[];
  selected: string | null;
  onSelect: (location: Location) => void;
  draft?: Point | null;
  onPick?: (point: Point) => void;
  onViewChange?: (view: MapView) => void;
  /** Increment to zoom the map out a couple of levels. */
  zoomOut?: number;
  /** Width in px of a panel floating over the map's left edge. */
  insetLeft?: number;
  /** Location to emphasise, e.g. while its list card is hovered. */
  highlighted?: string | null;
  onHover?: (id: string | null) => void;
  focus?: Focus | null;
  /**
   * True when only some of the places in view are loaded (the per-view cap).
   * Bubble counts are then lower bounds and show as round numbers with "+".
   */
  partial?: boolean;
}) {
  const element = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const markers = useRef<L.MarkerClusterGroup | null>(null);
  const byId = useRef(new Map<string, L.Marker>());
  /** What each pin was last drawn with, so unchanged pins are left alone. */
  const pinKeys = useRef(new Map<string, string>());
  const byIdLocation = useRef(new Map<string, Location>());
  const highlight = useRef<string | null>(null);
  const draftMarker = useRef<L.Marker | null>(null);
  const select = useRef(onSelect);
  const pick = useRef(onPick);
  const viewChange = useRef(onViewChange);
  const inset = useRef(insetLeft);
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
      zoomControl: false,
      scrollWheelZoom: true,
    }).setView([12.955, 77.63], 12);
    L.control.zoom({ position: "bottomright" }).addTo(instance);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: MAX_ZOOM,
    }).addTo(instance);
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
        bounds: validBounds(b),
        zoom: instance.getZoom(),
      });
    };
    instance.on("moveend", reportView);
    reportView();
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
      const rating = location.summary.average_rating;
      const label = rating == null ? "New" : `★ ${rating.toFixed(1)}`;
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
    // Only the places in view are loaded, so "show more" means widening the view.
    if (zoomOut && map.current) map.current.zoomOut(2);
  }, [zoomOut]);
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
  return (
    <div
      ref={element}
      className="property-map"
      role="region"
      aria-label="Interactive rental location map. Select a pin to read reviews, or select an empty spot to add a new place. The property list provides the same results."
    />
  );
}

/** Leaflet keeps counting past ±180° when the world repeats; the API won't. */
function wrapLongitude(lng: number) {
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

/** The visible area as valid WGS84 bounds (west > east crosses the antimeridian). */
export function validBounds(b: L.LatLngBounds): Bounds {
  const south = Math.max(-90, b.getSouth());
  const north = Math.min(90, b.getNorth());
  if (b.getEast() - b.getWest() >= 360)
    return { west: -180, south, east: 180, north };
  return {
    west: wrapLongitude(b.getWest()),
    south,
    east: wrapLongitude(b.getEast()),
    north,
  };
}

/**
 * How far (px) pins reach to merge into one bubble. Wide when zoomed out so the
 * city reads as a few well-spaced bubbles; tighter close up so single buildings
 * show as their own pins.
 */
/** OpenStreetMap's closest tile level; pins are never grouped here. */
const MAX_ZOOM = 19;

export function clusterRadius(zoom: number) {
  if (zoom <= 13) return 160;
  if (zoom <= 15) return 130;
  if (zoom <= 16) return 100;
  return 60;
}

/** Whether the PropertyMap on screen has only some of the places in view. */
const isPartial = { current: false };

function clusterIcon(cluster: L.MarkerCluster) {
  const count = cluster.getChildCount();
  const size = count < 10 ? 44 : count < 100 ? 52 : count < 1000 ? 60 : 68;
  const label = isPartial.current
    ? formatShortAtLeast(count)
    : formatShort(count);
  const spoken = `${isPartial.current ? "At least " : ""}${formatCount(count)} places`;
  return L.divIcon({
    className: "",
    html: `<span class="map-cluster" style="width:${size}px;height:${size}px" aria-label="${spoken}">${label}</span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}
