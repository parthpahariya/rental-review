import { useEffect, useRef } from "react";
import L from "leaflet";
import type { Location } from "./api";

export default function PropertyMap({
  locations,
  selected,
  onSelect,
}: {
  locations: Location[];
  selected: string | null;
  onSelect: (location: Location) => void;
}) {
  const element = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const markers = useRef<L.LayerGroup | null>(null);
  const select = useRef(onSelect);
  select.current = onSelect;
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
    map.current = instance;
    markers.current = L.layerGroup().addTo(instance);
    const observer = new ResizeObserver(() => instance.invalidateSize());
    observer.observe(element.current);
    return () => {
      observer.disconnect();
      instance.remove();
      map.current = null;
    };
  }, []);
  useEffect(() => {
    if (!map.current || !markers.current) return;
    markers.current.clearLayers();
    locations.forEach((location) => {
      const active = location.id === selected;
      const rating = location.summary.average_rating;
      const icon = L.divIcon({
        className: "",
        html: `<span class="map-pin ${active ? "active" : ""}">${rating == null ? "↗" : `★ ${rating.toFixed(1)}`}</span>`,
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
      marker.addTo(markers.current!);
    });
    if (locations.length && !selected)
      map.current.fitBounds(
        L.latLngBounds(locations.map((l) => [l.latitude, l.longitude])),
        { padding: [70, 70], maxZoom: 14 },
      );
    const location = locations.find((l) => l.id === selected);
    if (location) map.current.panTo([location.latitude, location.longitude]);
  }, [locations, selected]);
  return (
    <div
      ref={element}
      className="property-map"
      role="region"
      aria-label="Interactive rental location map. The property list provides the same results."
    />
  );
}
