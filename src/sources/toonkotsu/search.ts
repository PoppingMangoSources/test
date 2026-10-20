import {
  PickerFilter,
  SearchFilter,
  SearchRequest,
  SelectFilter,
  TagSection,
  TextFilter,
} from "@suwatte/toolchain";

import {
  CatalogueParams,
  CONTENT_RATING_OPTIONS,
  DEMOGRAPHIC_OPTIONS,
  MATCH_MODE_OPTIONS,
  ORIGINAL_LANGUAGE_OPTIONS,
  PAGE_SIZE,
  SORT_LATEST,
  SORT_RELEVANCE,
  STATUS_OPTIONS,
  TYPE_OPTIONS,
} from "./constants";
import { Preferences } from "./settings";
import { SeriesListResponse } from "./types";

/** Every catalogue request is narrowed by the preferred types and hidden tags. */
export function catalogueParams(
  prefs: Preferences,
  ratings: string[],
  extraExcluded: string[] = []
): CatalogueParams {
  const languages =
    prefs.types.length < TYPE_OPTIONS.length
      ? TYPE_OPTIONS.filter(({ id }) => prefs.types.includes(id)).flatMap(
          ({ languages }) => languages
        )
      : [];
  const exclude = [...new Set([...prefs.hiddenTags, ...extraExcluded])];
  return {
    sfw: !ratings.includes("pornographic"),
    originalLanguage: languages.join(",") || undefined,
    exclude: exclude.join(",") || undefined,
  };
}

/** The site skips empty and false parameters and reads true as "1". */
export function toQueryParams(params: CatalogueParams): Record<string, string | number> {
  const query: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "" || value === false) continue;
    query[key] = value === true ? "1" : value;
  }
  return query;
}

export function hasNextPage(data: SeriesListResponse, page: number): boolean {
  return (
    data.hasNextPage ??
    (typeof data.total === "number"
      ? page * (data.limit ?? PAGE_SIZE) < data.total
      : data.items.length >= PAGE_SIZE)
  );
}

export function buildSearchFilters(tagGroups: TagSection[]): SearchFilter[] {
  return [
    ...tagGroups.map((group) =>
      SearchFilter(group.id, group.title, SelectFilter(group.tags, true))
    ),
    SearchFilter("genre_mode", "Included Tags Must Match", PickerFilter(MATCH_MODE_OPTIONS)),
    SearchFilter("exclude_mode", "Excluded Tags Must Match", PickerFilter(MATCH_MODE_OPTIONS)),
    SearchFilter("demographics", "Demographic", SelectFilter(DEMOGRAPHIC_OPTIONS)),
    SearchFilter("statuses", "Publication Status", SelectFilter(STATUS_OPTIONS)),
    SearchFilter("languages", "Original Language", SelectFilter(ORIGINAL_LANGUAGE_OPTIONS)),
    SearchFilter("ratings", "Content Rating", SelectFilter(CONTENT_RATING_OPTIONS)),
    SearchFilter("author", "Author", TextFilter()),
    SearchFilter("year_from", "Year From", TextFilter()),
    SearchFilter("year_to", "Year To", TextFilter()),
    SearchFilter("chapters_min", "Minimum Chapters", TextFilter()),
    SearchFilter("chapters_max", "Maximum Chapters", TextFilter()),
  ];
}

type SelectValue = { include?: string[]; exclude?: string[] } | undefined;

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

/** Content ratings chosen in the search, or the preferred ones. */
export function searchRatings(request: SearchRequest, prefs: Preferences): string[] {
  const chosen = (request.filters?.ratings as SelectValue)?.include ?? [];
  return chosen.length > 0 ? chosen : prefs.contentRatings;
}

/** Builds `/cdn/v1/browse` parameters. Filters chosen in the search override preferences. */
export function buildBrowseParams(
  request: SearchRequest,
  page: number,
  prefs: Preferences,
  tagGroups: TagSection[]
): CatalogueParams {
  const filters = (request.filters ?? {}) as Record<string, unknown>;
  const title = request.query?.trim() ?? "";
  const included: string[] = [];
  const excluded: string[] = [];
  for (const { id } of tagGroups) {
    const value = filters[id] as SelectValue;
    included.push(...(value?.include ?? []));
    excluded.push(...(value?.exclude ?? []));
  }
  const selected = (id: string) => (filters[id] as SelectValue)?.include ?? [];

  // Best Match ranks by the text query, so without one the site's default order applies.
  let sort = request.sort?.key ?? (title ? SORT_RELEVANCE : SORT_LATEST);
  if (sort === SORT_RELEVANCE && !title) sort = SORT_LATEST;

  const params = catalogueParams(prefs, searchRatings(request, prefs), excluded);
  return {
    ...params,
    limit: PAGE_SIZE,
    q: title || undefined,
    originalLanguage: selected("languages").join(",") || params.originalLanguage,
    genres: included.join(",") || undefined,
    genreMode: text(filters.genre_mode),
    excludeMode: text(filters.exclude_mode),
    demographic: selected("demographics").join(",") || undefined,
    status:
      selected("statuses")
        .map((id) => STATUS_OPTIONS.find((option) => option.id === id)?.value ?? id)
        .join(",") || undefined,
    author: text(filters.author),
    yearFrom: text(filters.year_from),
    yearTo: text(filters.year_to),
    chaptersMin: text(filters.chapters_min),
    chaptersMax: text(filters.chapters_max),
    sort,
    order: request.sort?.ascending ? "asc" : "desc",
    page,
  };
}
