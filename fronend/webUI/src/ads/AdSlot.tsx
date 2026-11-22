/**
 * A place on the page that may show an ad. It renders nothing unless the
 * server has an ad network and an ad unit for this placement, so pages can
 * place it freely. Each network is its own chunk, loaded only when used.
 */
import { lazy, Suspense, useEffect, useState } from "react";
import { adConfig } from "./config";
import type { AdConfig, AdPlacement, AdProviderName, AdUnit } from "./types";

const units: Record<AdProviderName, AdUnit> = {
  adsense: lazy(() => import("./adsense")),
};

export default function AdSlot({ placement }: { placement: AdPlacement }) {
  const [config, setConfig] = useState<AdConfig | null>(null);
  useEffect(() => {
    let live = true;
    adConfig().then((c) => {
      if (live) setConfig(c);
    });
    return () => {
      live = false;
    };
  }, []);
  const unit = config?.slots[placement];
  if (!config?.provider || !config.client || !unit) return null;
  const Unit = units[config.provider];
  return (
    <aside className={`ad-slot ad-${placement}`} aria-label="Advertisement">
      <span className="ad-label">Sponsored</span>
      <Suspense fallback={null}>
        <Unit client={config.client} unit={unit} />
      </Suspense>
    </aside>
  );
}
