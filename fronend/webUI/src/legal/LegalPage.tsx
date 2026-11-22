import { useEffect, type ReactNode } from "react";
import { Icon } from "../components";
import { PATHS, SITE } from "./site";

/** Shared layout for the Privacy Policy and data deletion pages. */
export default function LegalPage({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  useEffect(() => {
    document.title = `${title} — ${SITE.name}`;
  }, [title]);
  const missing = [
    !SITE.operator && "site operator",
    !SITE.contactEmail && "contact email",
  ].filter(Boolean);
  return (
    <div className="legal">
      <header className="topbar">
        <a href="/" className="brand" aria-label="Rental Review home">
          <span className="brand-mark" aria-hidden="true">
            <Icon name="home" size={18} />
          </span>
          <span className="brand-name">
            rental<b>review</b>
          </span>
        </a>
      </header>
      <main className="legal-page" id="main">
        <h1>{title}</h1>
        <p className="legal-updated">Last updated: {SITE.lastUpdated}</p>
        {missing.length > 0 && (
          <p className="legal-draft" role="note">
            Draft: the {missing.join(" and ")}{" "}
            {missing.length > 1 ? "are" : "is"} not set yet (src/legal/site.ts).
          </p>
        )}
        {children}
        <nav className="legal-links" aria-label="Legal pages">
          <a href={PATHS.privacy}>Privacy Policy</a>
          <a href={PATHS.deleteData}>Delete your data</a>
          <a href="/">Back to Rental Review</a>
        </nav>
      </main>
    </div>
  );
}

/** The contact email as a link, or a marker while it isn't set. */
export function Contact() {
  return SITE.contactEmail ? (
    <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a>
  ) : (
    <strong>[contact email not set]</strong>
  );
}

export function Operator() {
  return <>{SITE.operator || "[operator not set]"}</>;
}
