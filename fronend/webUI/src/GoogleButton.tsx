import { useEffect, useRef, useState } from "react";
import { api } from "./api";

/** The slice of Google Identity Services (accounts.google.com/gsi/client) used here. */
type Gis = {
  accounts: {
    id: {
      initialize(options: {
        client_id: string;
        callback: (response: { credential: string }) => void;
        ux_mode?: "popup" | "redirect";
        context?: "signin" | "signup" | "use";
      }): void;
      renderButton(
        element: HTMLElement,
        options: {
          type?: "standard" | "icon";
          theme?: "outline" | "filled_blue" | "filled_black";
          size?: "large" | "medium" | "small";
          text?: "signin_with" | "signup_with" | "continue_with" | "signin";
          shape?: "rectangular" | "pill" | "circle" | "square";
          logo_alignment?: "left" | "center";
          width?: number;
        },
      ): void;
    };
  };
};
declare global {
  interface Window {
    google?: Gis;
  }
}

let script: Promise<Gis> | null = null;
function loadGis(): Promise<Gis> {
  if (window.google) return Promise.resolve(window.google);
  script ??= new Promise<Gis>((resolve, reject) => {
    const tag = document.createElement("script");
    tag.src = "https://accounts.google.com/gsi/client";
    tag.async = true;
    tag.onload = () =>
      window.google ? resolve(window.google) : reject(new Error("no gis"));
    tag.onerror = () => {
      script = null; // Allow a retry the next time the dialog opens.
      reject(new Error("Google sign-in could not load."));
    };
    document.head.appendChild(tag);
  });
  return script;
}

function googleClientId() {
  return api<{ data: { google_client_id: string | null } }>("/auth/providers")
    .then((r) => r.data.google_client_id)
    .catch(() => null);
}

/**
 * Google's own "Continue with Google" button. Calls `onUnavailable` instead when
 * the server has no Google client id configured or Google's script can't load.
 */
export default function GoogleButton({
  onCredential,
  onUnavailable,
  disabled = false,
}: {
  onCredential: (credential: string) => void;
  onUnavailable?: () => void;
  disabled?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const callback = useRef(onCredential);
  callback.current = onCredential;
  const missing = useRef(onUnavailable);
  missing.current = onUnavailable;
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    googleClientId()
      .then(async (id) => {
        if (!live) return;
        if (!id) throw new Error("Google sign-in is not configured.");
        const gis = await loadGis();
        if (!live || !host.current) return;
        gis.accounts.id.initialize({
          client_id: id,
          callback: (r) => callback.current(r.credential),
          ux_mode: "popup",
          context: "signin",
        });
        gis.accounts.id.renderButton(host.current, {
          type: "standard",
          theme: "outline",
          size: "large",
          text: "continue_with",
          shape: "pill",
          logo_alignment: "center",
          width: Math.min(400, Math.max(200, host.current.clientWidth || 320)),
        });
        setReady(true);
      })
      .catch(() => {
        if (live) missing.current?.();
      });
    return () => {
      live = false;
    };
  }, []);
  return (
    <div
      className={`google-sign-in ${ready ? "" : "loading"} ${disabled ? "disabled" : ""}`}
      aria-busy={disabled}
    >
      <div ref={host} className="google-button" />
    </div>
  );
}
