export type ContentRatingId = "safe" | "suggestive" | "erotica" | "pornographic";

export interface LatestChapterRef {
  id?: number;
  label?: string | null;
  n?: number | null;
  at?: number | null;
}

export interface Series {
  id: number;
  hid?: string | null;
  slug?: string | null;
  title: string;
  titles?: { english?: string | null; romaji?: string | null; native?: string | null } | null;
  alt?: string[] | null;
  description?: string | null;
  year?: number | null;
  type?: string | null;
  tags?: string[] | null;
  spoilerTags?: string[] | null;
  status?: string | null;
  cover?: string | null;
  banner?: string | null;
  hero?: string | null;
  /** Out of 100. */
  score?: number | null;
  latest?: LatestChapterRef | null;
  chapters?: number | null;
  authors?: string[] | null;
  adult?: boolean | null;
  /** Chapter opens, on reading rankings. */
  count?: number | null;
}

export interface ChapterGroup {
  slug?: string | null;
  name?: string | null;
}

export interface ChapterRelease {
  id: number;
  label?: string | null;
  at?: number | null;
  src?: string | null;
  group?: ChapterGroup | null;
}

export interface ChapterEntry extends ChapterRelease {
  n?: number | null;
  vol?: string | number | null;
  alts?: ChapterRelease[] | null;
}

export interface SeriesListResponse {
  items: Series[];
  page?: number;
  limit?: number;
  total?: number;
  hasNextPage?: boolean;
}

export interface LatestResponse {
  items: { chapter: ChapterEntry; series: Series }[];
  page?: number;
  hasNextPage?: boolean;
}

export interface SeriesResponse {
  series: Series;
  chapters: ChapterEntry[];
}

export interface Facet {
  name: string;
  category?: string | null;
  isAdult?: boolean | null;
}

export interface FacetsResponse {
  genres?: Facet[];
}

export interface ReaderKeyResponse {
  key: string;
  build: string;
  now: number;
}

/** The body of a refused reader request, e.g. a 429 reading limit. */
export interface ReaderLimit {
  code?: string;
  error?: string;
  reason?: string;
  resign?: boolean;
  transient?: boolean;
  retryAfterSec?: number;
}
