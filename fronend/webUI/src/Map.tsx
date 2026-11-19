import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet.markercluster";
import type { Location } from "./api";

export type Point = { latitude: number; longitude: number };
export type Bounds = {
  west: number;
  south: number;
  east: number;
  north: number;
};
export type MapView = { center: Point; bounds: Bounds };
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
  fitAll = 0,
  insetLeft = 0,
  highlighted = null,
  onHover,
  focus = null,
}: {
  locations: Location[];
  selected: string | null;
  onSelect: (location: Location) => void;
  draft?: Point | null;
  onPick?: (point: Point) => void;
  onViewChange?: (view: MapView) => void;
  /** Increment to zoom the map out to every location. */
  fitAll?: number;
  /** Width in px of a panel floating over the map's left edge. */
  insetLeft?: number;
  /** Location to emphasise, e.g. while its list card is hovered. */
  highlighted?: string | null;
  onHover?: (id: string | null) => void;
  focus?: Focus | null;
}) {
  const element = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const markers = useRef<L.MarkerClusterGroup | null>(null);
  const byId = useRef(new Map<string, L.Marker>());
  const highlight = useRef<string | null>(null);
  const draftMarker = useRef<L.Marker | null>(null);
  const select = useRef(onSelect);
  const pick = useRef(onPick);
  const viewChange = useRef(onViewChange);
  const inset = useRef(insetLeft);
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
      maxZoom: 19,
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
        center: { latitude: c.lat, longitude: c.lng },
        bounds: {
          west: b.getWest(),
          south: b.getSouth(),
          east: b.getEast(),
          north: b.getNorth(),
        },
      });
    };
    instance.on("moveend", reportView);
    reportView();
    map.current = instance;
    // Nearby pins merge into a counted bubble; clicking it zooms in, and pins
    // that still overlap at full zoom fan out so each one can be chosen.
    markers.current = L.markerClusterGroup({
      maxClusterRadius: 60,
      showCoverageOnHover: false,
      spiderfyOnMaxZoom: true,
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
      draftMarker.current = null;
    };
  }, []);
  useEffect(() => {
    if (!map.current || !markers.current) return;
    markers.current.clearLayers();
    byId.current.clear();
    const layers = locations.map((location) => {
      const active = location.id === selected;
      const rating = location.summary.average_rating;
      const icon = L.divIcon({
        className: "",
        html: `<span class="map-pin ${active ? "active" : ""}">${rating == null ? "New" : `★ ${rating.toFixed(1)}`}</span>`,
        iconSize: [68, 38],
        iconAnchor: [34, 38],
      });
      const marker = L.marker([location.latitude, location.longitude], {
        icon,
        keyboard: true,
        title: location.building_name || location.address,
        alt: `Read reviews of ${location.building_name || location.address}`,
      });
      marker.on("click", () => select.current(location));
      marker.on("mouseover", () => hover.current?.(location.id));
      marker.on("mouseout", () => hover.current?.(null));
      byId.current.set(location.id, marker);
      return marker;
    });
    markers.current.addLayers(layers);
    applyHighlight(highlight.current);
    const marker = selected ? byId.current.get(selected) : undefined;
    // Zooms in far enough to pull the selected pin out of its cluster.
    if (marker)
      markers.current.zoomToShowLayer(marker, () => {
        // Nudge the map if the pin ended up under the floating panel.
        const p = map.current!.latLngToContainerPoint(marker.getLatLng());
        const edge = inset.current + 48;
        if (p.x < edge) map.current!.panBy([p.x - edge - 80, 0]);
      });
  }, [locations, selected]);
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
    if (!fitAll || !map.current || !locations.length) return;
    map.current.fitBounds(
      L.latLngBounds(locations.map((l) => [l.latitude, l.longitude])),
      {
        paddingTopLeft: [70 + inset.current, 70],
        paddingBottomRight: [70, 70],
        maxZoom: 14,
      },
    );
    // Only respond to explicit "show all" requests.
  }, [fitAll]);
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

function clusterIcon(cluster: L.MarkerCluster) {
  const count = cluster.getChildCount();
  const size = count < 10 ? 44 : count < 100 ? 52 : 60;
  return L.divIcon({
    className: "",
    html: `<span class="map-cluster" style="width:${size}px;height:${size}px" aria-label="${count} places">${count}</span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}
