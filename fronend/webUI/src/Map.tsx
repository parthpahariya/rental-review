/**
 * The app's map. It doesn't draw anything itself: it loads the provider the
 * server is configured for (Google or OpenStreetMap, see src/maps/) and
 * renders that provider's map. App code imports only from here and
 * src/maps/types, never from a provider folder.
 */
import { Component, useEffect, useState, type ReactNode } from "react";
import { loadMapProvider } from "./maps/provider";
import { MAP_LABEL, MapUnavailable } from "./maps/shared";
import type { MapProps, MapProvider } from "./maps/types";

export type { Bounds, Focus, MapView, Point } from "./maps/types";

export default function PropertyMap(props: MapProps) {
  const [provider, setProvider] = useState<MapProvider | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    loadMapProvider()
      .then((p) => {
        if (live) setProvider(p);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, []);
  if (failed) return <MapUnavailable />;
  // Same empty region while the provider loads, so the layout doesn't jump.
  if (!provider)
    return <div className="property-map" role="region" aria-label={MAP_LABEL} />;
  return (
    <MapBoundary>
      <provider.Map {...props} />
    </MapBoundary>
  );
}

/**
 * A failing map (a rejected key, a provider script error) must never take
 * the rest of the page down with it; the list shows the same places.
 */
class MapBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? <MapUnavailable /> : this.props.children;
  }
}
