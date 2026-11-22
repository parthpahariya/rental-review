/** Google AdSense: one responsive display ad unit per slot. */
import { useEffect, useRef } from "react";
import type { AdUnitProps } from "./types";

declare global {
  interface Window {
    adsbygoogle?: unknown[];
  }
}

const SCRIPT = "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js";

/** Adds AdSense's script once per page, only when an ad is actually shown. */
function loadScript(client: string) {
  if (document.querySelector(`script[src^="${SCRIPT}"]`)) return;
  const tag = document.createElement("script");
  tag.src = `${SCRIPT}?client=${encodeURIComponent(client)}`;
  tag.async = true;
  tag.crossOrigin = "anonymous";
  document.head.appendChild(tag);
}

export default function AdSenseUnit({ client, unit }: AdUnitProps) {
  const ins = useRef<HTMLModElement>(null);
  useEffect(() => {
    loadScript(client);
    // AdSense fills each <ins> once; asking twice (e.g. React's dev-mode
    // double effects) logs an error, so skip units it already handled.
    if (!ins.current || ins.current.dataset.adsbygoogleStatus) return;
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch {
      // Blocked or failed ads just leave the slot empty.
    }
  }, [client, unit]);
  return (
    <ins
      ref={ins}
      className="adsbygoogle"
      style={{ display: "block" }}
      data-ad-client={client}
      data-ad-slot={unit}
      data-ad-format="auto"
      data-full-width-responsive="true"
    />
  );
}
