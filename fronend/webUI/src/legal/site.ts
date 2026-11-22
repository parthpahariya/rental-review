/**
 * Who runs the site and how to reach them, as stated in the Privacy Policy and
 * the data deletion page. Fill these in before publishing: until then the
 * pages show a visible "not set yet" notice.
 */
export const SITE = {
  name: "Rental Review",
  url: "https://rentalreview.boringman.in",
  /** The person or company responsible for the site (the data fiduciary). */
  operator: "",
  /** Where privacy questions, deletion requests and grievances go. */
  contactEmail: "theboringmanapps@gmail.com",
  /** When the policy text last changed. */
  lastUpdated: "22 November 2026",
};

export const PATHS = {
  privacy: "/privacy",
  deleteData: "/delete-data",
};

/** Paths that show a legal page instead of the app. */
export function legalPageFor(pathname: string) {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === PATHS.privacy) return "privacy" as const;
  if (path === PATHS.deleteData) return "delete-data" as const;
  return null;
}
