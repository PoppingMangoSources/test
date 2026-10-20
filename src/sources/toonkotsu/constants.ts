import { LabeledOption } from "@suwatte/toolchain";

export const BASE_URL = "https://toonkotsu.com";
export const PAGE_SIZE = 42;

/**
 * The reader's signing secret and the build it shipped with. The key endpoint
 * reports the live build, so a mismatch names the cause when the site rotates it.
 */
export const READER_SECRET = "NO57DoQRq7oxY3MCO5_SNw4_3vFRsUq7";
export const READER_BUILD = "1738e5282ffc19e6";

export const PREF_CONTENT_RATINGS = "pref_content_ratings";
export const PREF_TYPES = "pref_types";
export const PREF_HIDDEN_TAGS = "pref_hidden_tags";
export const PREF_HIDDEN_FEEDS = "pref_hidden_feeds";

export type CatalogueParams = Record<string, string | number | boolean | undefined>;

export type FeedSource =
  | { kind: "reading"; metric: "views" | "trending" }
  | { kind: "discovery"; metric: string }
  | { kind: "latest" }
  | { kind: "browse"; params: CatalogueParams };

export interface FeedDefinition {
  id: string;
  title: string;
  source: FeedSource;
}

/** Home page feeds, in display order. Unknown feed keys fall back to the first entry. */
export const FEEDS: FeedDefinition[] = [
  { id: "most-read", title: "Most Read", source: { kind: "reading", metric: "views" } },
  { id: "trending", title: "Trending", source: { kind: "reading", metric: "trending" } },
  {
    id: "top-rated",
    title: "Top Rated",
    source: { kind: "browse", params: { sort: "score", order: "desc" } },
  },
  { id: "hidden-gems", title: "Hidden Gems", source: { kind: "discovery", metric: "gems" } },
  { id: "latest", title: "Latest Updates", source: { kind: "latest" } },
  {
    id: "recently-added",
    title: "Recently Added",
    source: { kind: "browse", params: { sort: "new", order: "desc" } },
  },
  {
    id: "this-season",
    title: "This Season",
    source: { kind: "browse", params: { discovery: "seasonal" } },
  },
  {
    id: "completed",
    title: "Completed",
    source: { kind: "browse", params: { discovery: "completed" } },
  },
];

export const FEED_OPTIONS: LabeledOption[] = FEEDS.map(({ id, title }) => ({ id, title }));

export const SORT_RELEVANCE = "relevance";
export const SORT_LATEST = "latest";

/** The site's browse sorts. Each is sent as `sort` with the chosen `order`. */
export const SORT_OPTIONS: LabeledOption[] = [
  { id: SORT_RELEVANCE, title: "Best Match" },
  { id: SORT_LATEST, title: "Latest Upload" },
  { id: "new", title: "Date Added" },
  { id: "score", title: "Rating" },
  { id: "popular", title: "Popularity" },
  { id: "chapters", title: "Chapter Count" },
  { id: "year", title: "Release Year" },
  { id: "title", title: "Title" },
];

export const CONTENT_RATING_OPTIONS: LabeledOption[] = [
  { id: "safe", title: "Safe" },
  { id: "suggestive", title: "Suggestive" },
  { id: "erotica", title: "Erotica" },
  { id: "pornographic", title: "Pornographic" },
];

export const DEFAULT_CONTENT_RATINGS = ["safe", "suggestive", "erotica"];

/** The catalogue files a series by its original language; these are the types that language makes. */
export const TYPE_OPTIONS: (LabeledOption & { languages: string[] })[] = [
  { id: "manga", title: "Manga", languages: ["ja", "ja-ro"] },
  { id: "manhwa", title: "Manhwa", languages: ["ko", "ko-ro"] },
  { id: "manhua", title: "Manhua", languages: ["zh", "zh-hk", "zh-ro"] },
  { id: "oel", title: "OEL", languages: ["en"] },
  { id: "other", title: "Other", languages: ["xx"] },
];

export const ORIGINAL_LANGUAGE_OPTIONS: LabeledOption[] = [
  { id: "en", title: "English" },
  { id: "ja", title: "Japanese" },
  { id: "ja-ro", title: "Japanese (Romanized)" },
  { id: "ko", title: "Korean" },
  { id: "ko-ro", title: "Korean (Romanized)" },
  { id: "zh", title: "Chinese (Simplified)" },
  { id: "zh-hk", title: "Chinese (Traditional)" },
  { id: "zh-ro", title: "Chinese (Romanized)" },
  { id: "xx", title: "Other" },
];

export const DEMOGRAPHIC_OPTIONS: LabeledOption[] = [
  { id: "shounen", title: "Shounen" },
  { id: "shoujo", title: "Shoujo" },
  { id: "seinen", title: "Seinen" },
  { id: "josei", title: "Josei" },
  { id: "none", title: "None" },
];

/** `id` is the filter option; `value` is what the site expects. */
export const STATUS_OPTIONS: (LabeledOption & { value: string })[] = [
  { id: "ongoing", title: "Ongoing", value: "Ongoing" },
  { id: "completed", title: "Completed", value: "Complete" },
  { id: "hiatus", title: "Hiatus", value: "Hiatus" },
  { id: "cancelled", title: "Cancelled", value: "Canceled" },
];

export const MATCH_MODE_OPTIONS: LabeledOption[] = [
  { id: "all", title: "All" },
  { id: "any", title: "Any" },
];

/**
 * Tags the site keeps out of its genre list: demographics have their own
 * filter, and these are never offered for browsing.
 */
export const UNLISTED_TAGS = new Set([
  "Shounen",
  "Shoujo",
  "Seinen",
  "Josei",
  "Lolicon",
  "Shotacon",
  "Other",
  "Doujinshi",
]);
export const PORNOGRAPHIC_TAGS = new Set(["Hentai", "Adult", "Smut"]);
export const DEMOGRAPHICS = new Set(["Shounen", "Shoujo", "Seinen", "Josei"]);

/** The catalogue files each tag under a category; the main genres have none. */
export const TAG_GROUPS: { id: string; title: string; prefix?: string }[] = [
  { id: "genres", title: "Genres" },
  { id: "themes", title: "Themes", prefix: "Theme" },
  { id: "cast", title: "Cast", prefix: "Cast" },
  { id: "setting", title: "Setting", prefix: "Setting" },
  { id: "format", title: "Format", prefix: "Technical" },
];
