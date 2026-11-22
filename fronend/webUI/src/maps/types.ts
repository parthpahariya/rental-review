/**
 * The contract between the app and a map provider (Ola Maps, OpenStreetMap).
 * App code only uses these types; each provider implements them in its own
 * folder, so switching providers never touches the screens.
 */
import type { ComponentType } from "react";
import type { Location } from "../api";

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

/** What every provider's map component accepts. */
export type MapProps = {
  locations: Location[];
  selected: string | null;
  onSelect: (location: Location) => void;
  draft?: Point | null;
  onPick?: (point: Point) => void;
  onViewChange?: (view: MapView) => void;
  /** Width in px of a panel floating over the map's left edge. */
  insetLeft?: number;
  /** Location to emphasise, e.g. while its list card is hovered. */
  highlighted?: string | null;
  onHover?: (id: string | null) => void;
  focus?: Focus | null;
  /**
   * A place the visitor searched for, marked so they can see which building
   * it is. Only a marker: it is not a stored place and can't be clicked.
   */
  searched?: Point | null;
  /**
   * True when only some of the places in view are loaded (the per-view cap).
   * Bubble counts are then lower bounds and show as round numbers with "+".
   */
  partial?: boolean;
};

/** Where the map should open: a locality, a single place, or everything. */
export type Area = {
  name: string;
  detail?: string;
  center: Point;
  bounds?: Bounds;
  zoom?: number;
  /** A single building rather than an area: the map marks its spot. */
  exact?: boolean;
};

/** One line in the suggestion list; its place is looked up only when chosen. */
export type Suggestion = {
  name: string;
  detail?: string;
  /** "listed": a building already on Rental Review, found without a provider. */
  kind: "area" | "building" | "listed";
  resolve: () => Promise<Area>;
};

/** A provider's place search, one per search box. */
export interface PlaceSearch {
  /** Places matching `text`, favouring those near `near`. */
  search(text: string, near?: Point): Promise<Suggestion[]>;
  /** Called after a pick; ends any billing session the provider keeps. */
  finish(): void;
}

export type MapProviderName = "ola" | "osm";

/** The server's map settings (GET /map/config). */
export type MapConfig = {
  provider: MapProviderName;
  /** The chosen provider's browser key (public by design); none for OSM. */
  api_key: string | null;
};

export type MapProvider = {
  name: MapProviderName;
  Map: ComponentType<MapProps>;
  createSearch(): PlaceSearch;
  /** Credit the provider's terms require under its search results. */
  searchAttribution: string;
};

/** Each provider module exports one of these; it gets the server's settings. */
export type CreateMapProvider = (config: MapConfig) => MapProvider;
