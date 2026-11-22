// Search covers India. The map still opens on Bengaluru by default, where the
// demo properties are.
export const REGION = {
  name: "India",
  /** ISO 3166-1 alpha-2, as most providers take it. */
  countryCode: "IN",
  /** west,south,east,north; used by providers that take a bounding box. */
  bbox: "68.1,6.5,97.5,35.7",
};
export const DEFAULT_CENTER = {
  name: "Bengaluru",
  center: { latitude: 12.955, longitude: 77.63 },
};
