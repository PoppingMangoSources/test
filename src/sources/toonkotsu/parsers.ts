import {
  Chapter,
  ChapterPage,
  Content,
  ContentRating,
  ContentStatus,
  ContentType,
  Item,
  ReadingMode,
  TagSection,
} from "@suwatte/toolchain";
import { load } from "cheerio";

import {
  BASE_URL,
  DEMOGRAPHICS,
  PORNOGRAPHIC_TAGS,
  TAG_GROUPS,
  UNLISTED_TAGS,
} from "./constants";
import { decodeBase64Url, ReaderKey, unwrapPageKey } from "./crypto";
import {
  ChapterRelease,
  ContentRatingId,
  FacetsResponse,
  LatestResponse,
  ReaderKeyResponse,
  Series,
  SeriesResponse,
} from "./types";

/** Page context keys read by the image interceptor to decrypt a page. */
export const PAGE_KEY = "tkKey";
export const PAGE_NONCE = "tkNonce";

const HID_REGEX = /^[a-z][0-9a-z]{4}$/;

/** Extracts a title id from a pasted `toonkotsu.com/title/{hid}-{slug}` URL. */
export function parseDeepLinkId(value: string): string | null {
  const hid = value.match(
    /^(?:https?:\/\/)?toonkotsu\.com\/title\/([a-z][0-9a-z]{4})(?:[-/?#]|$)/i
  )?.[1];
  return hid && HID_REGEX.test(hid) ? hid : null;
}

const COVER_SIZE_REGEX = /\/(?:220|460|720)\.webp$/;

const toAbsoluteUrl = (path: string): string =>
  path.startsWith("http") ? path : `${BASE_URL}${path.startsWith("/") ? "" : "/"}${path}`;

const parseCoverUrl = (cover: string | null | undefined, size: 460 | 720 = 460): string =>
  cover
    ? toAbsoluteUrl(cover).replace(COVER_SIZE_REGEX, `/${size}.webp`)
    : `${BASE_URL}/images/cover.webp`;

/**
 * The site's own rating ladder: a series flagged adult or tagged Hentai is
 * pornographic, Smut or Adult is erotica, Ecchi or Mature is suggestive.
 */
export function parseRatingId(series: Series): ContentRatingId {
  const tags = series.tags ?? [];
  if (series.adult || tags.includes("Hentai")) return "pornographic";
  if (tags.some((tag) => tag === "Smut" || tag === "Adult")) return "erotica";
  if (tags.some((tag) => tag === "Ecchi" || tag === "Mature")) return "suggestive";
  return "safe";
}

function toContentRating(rating: ContentRatingId): ContentRating {
  switch (rating) {
    case "safe":
      return ContentRating.EVERYONE;
    case "suggestive":
      return ContentRating.SUGGESTIVE;
    default:
      return ContentRating.MATURE;
  }
}

function cleanText(value: string | null | undefined): string {
  const text = value ?? "";
  const decoded = text.includes("&") ? load(text, null, false).text() : text;
  return decoded.replace(/\s+/g, " ").trim();
}

/** Scores are out of 100; Suwatte shows ratings out of 10. */
const scoreOutOfTen = (score: number | null | undefined): number | undefined =>
  score && score > 0 ? Number((score / 10).toFixed(1)) : undefined;

const formatChapterNumber = (value: number): string => String(Number(value.toFixed(2)));

/** A oneshot is numbered 0 and labelled as such, so its label reads better than "Ch. 0". */
function chapterSubtitle(series: Series): string | undefined {
  const number = series.latest?.n;
  const label = cleanText(series.latest?.label);
  if (number === 0 && label && !/\d/.test(label)) return label;
  if (typeof number === "number") return `Ch. ${formatChapterNumber(number)}`;
  return series.chapters ? `${series.chapters} Chapters` : undefined;
}

const webUrl = (series: Series, hid: string): string =>
  `${BASE_URL}/title/${hid}${series.slug ? `-${series.slug}` : ""}`;

// ================================ Items =================================

/** Series without a usable title id can't be opened, so they are dropped. */
export function toItems(items: Series[], subtitle = chapterSubtitle): Item[] {
  return items.flatMap((series) => {
    const hid = series.hid;
    if (!hid || !HID_REGEX.test(hid)) return [];
    const rating = scoreOutOfTen(series.score);
    const views = series.count || undefined;
    return [
      {
        id: hid,
        title: cleanText(series.title),
        subtitle: subtitle(series),
        coverImage: parseCoverUrl(series.cover),
        webUrl: webUrl(series, hid),
        rating: toContentRating(parseRatingId(series)),
        statistics: rating || views ? { rating, views } : undefined,
      },
    ];
  });
}

/** Latest Updates names the new chapter and its group under each title. */
export function toLatestItems(items: LatestResponse["items"]): Item[] {
  const subtitles = new Map(
    items.map(({ chapter, series }) => {
      const { group } = parseLabel(chapter, chapter.n);
      const number =
        typeof chapter.n === "number" ? `Ch. ${formatChapterNumber(chapter.n)}` : undefined;
      return [series, [number, group].filter(Boolean).join(" • ") || undefined];
    })
  );
  return toItems(
    items.map(({ series }) => series),
    (series) => subtitles.get(series)
  );
}

// ================================ Tags ==================================

function tagGroupId(category: string | null | undefined): string {
  if (!category) return "genres";
  return TAG_GROUPS.find(({ prefix }) => prefix && category.startsWith(prefix))?.id ?? "themes";
}

/**
 * Hentai, Adult and Smut are offered once erotica is allowed, and tags the
 * catalogue flags adult only with pornographic titles, as the site does.
 * Tag ids are the names the browse filters expect.
 */
export function parseTagGroups(facets: FacetsResponse, ratings: string[]): TagSection[] {
  const groups = new Map<string, string[]>();
  for (const facet of facets.genres ?? []) {
    if (UNLISTED_TAGS.has(facet.name) || facet.category === "Demographic") continue;
    if (facet.isAdult && !ratings.includes("pornographic")) continue;
    if (
      PORNOGRAPHIC_TAGS.has(facet.name) &&
      !ratings.includes("erotica") &&
      !ratings.includes("pornographic")
    ) {
      continue;
    }
    const id = tagGroupId(facet.category);
    groups.set(id, [...(groups.get(id) ?? []), facet.name]);
  }
  return TAG_GROUPS.flatMap(({ id, title }) => {
    const names = groups.get(id)?.sort((a, b) => a.localeCompare(b)) ?? [];
    return names.length ? [{ id, title, tags: names.map((name) => ({ id: name, title: name })) }] : [];
  });
}

// =============================== Content ================================

function parseStatus(status?: string | null): ContentStatus {
  switch (status?.toLowerCase().trim()) {
    case "ongoing":
      return ContentStatus.ONGOING;
    case "complete":
    case "completed":
      return ContentStatus.COMPLETED;
    case "hiatus":
      return ContentStatus.HIATUS;
    case "canceled":
    case "cancelled":
      return ContentStatus.CANCELLED;
    default:
      return ContentStatus.UNKNOWN;
  }
}

function parseContentType(type?: string | null): ContentType {
  switch (type?.toLowerCase().trim()) {
    case "manhwa":
      return ContentType.MANHWA;
    case "manhua":
      return ContentType.MANHUA;
    case "oel":
    case "comic":
      return ContentType.COMIC;
    default:
      return ContentType.MANGA;
  }
}

export function toContent(
  { series }: SeriesResponse,
  contentId: string,
  facets: FacetsResponse
): Content {
  const title = cleanText(series.title);
  const additionalTitles = [
    ...new Set(
      [series.titles?.english, series.titles?.romaji, series.titles?.native, ...(series.alt ?? [])]
        .map(cleanText)
        .filter((alt) => alt && alt !== title)
    ),
  ];
  const spoilers = new Set(series.spoilerTags ?? []);
  const categories = new Map((facets.genres ?? []).map((facet) => [facet.name, facet.category]));
  const tags = (series.tags ?? []).filter((tag) => !UNLISTED_TAGS.has(tag) && !spoilers.has(tag));
  const demographic = (series.tags ?? []).find((tag) => DEMOGRAPHICS.has(tag));
  const groups: TagSection[] = TAG_GROUPS.flatMap(({ id, title }) => {
    const groupTags = tags.filter((tag) => tagGroupId(categories.get(tag)) === id);
    return groupTags.length
      ? [{ id, title, tags: groupTags.map((tag) => ({ id: tag, title: tag })) }]
      : [];
  });
  if (demographic) {
    groups.push({
      id: "demographics",
      title: "Demographic",
      tags: [{ id: demographic.toLowerCase(), title: demographic }],
    });
  }
  const genres = groups.find(({ id }) => id === "genres")?.tags;
  const properties = groups.filter(({ id }) => id !== "genres");
  // Most titles have no banner but carry the wide hero image the site shows in its place.
  const banner = series.banner || series.hero;
  const authors = [...new Set((series.authors ?? []).map(cleanText).filter(Boolean))];
  const contentType = parseContentType(series.type);
  const url = webUrl(series, contentId);
  const rating = scoreOutOfTen(series.score);

  return {
    title,
    coverImage: parseCoverUrl(series.cover, 720),
    bannerImage: banner ? toAbsoluteUrl(banner) : undefined,
    webUrl: url,
    rating: toContentRating(parseRatingId(series)),
    status: parseStatus(series.status),
    contentType,
    readingMode:
      contentType === ContentType.MANHWA || contentType === ContentType.MANHUA
        ? ReadingMode.VERTICAL
        : ReadingMode.PAGED_MANGA,
    summary: cleanText(series.description) || undefined,
    additionalTitles: additionalTitles.length ? additionalTitles : undefined,
    credits: authors.length ? authors.map((name) => ({ name, role: "Author" })) : undefined,
    genres,
    properties: properties.length ? properties : undefined,
    additionalDetails: series.year ? { Year: String(series.year) } : undefined,
    statistics: rating ? { rating } : undefined,
    links: [{ title: "Website", url }],
  };
}

// =============================== Chapters ===============================

/**
 * A label reads "Chapter 12: Title [Group]"; the bracketed group and the bare
 * number are not part of the title.
 */
function parseLabel(release: ChapterRelease, number?: number | null) {
  let label = cleanText(release.label);
  const bracket = /\s*\[([^\]]+)\]\s*$/.exec(label);
  const bracketGroup = bracket?.[1]?.trim();
  if (bracket) label = label.slice(0, bracket.index).trim();
  const numbered = /^(?:[A-Za-z]+\.?)?\s*#?\s*[\d.]+\s*(?:[:\-–—.|]\s*(.*))?$/.exec(label);
  const title = (numbered ? numbered[1] : label)?.trim();
  const group = cleanText(release.group?.name) || bracketGroup;
  const bare = title?.replace(/^(?:chapter|ch\.?|episode|ep\.?)\s*#?\s*/i, "");
  const isNumber = number != null && bare !== undefined && bare !== "" && Number(bare) === number;
  return {
    title: title && !isNumber && title.toLowerCase() !== group?.toLowerCase() ? title : undefined,
    group,
  };
}

function parseVolume(value: string | number | null | undefined): number | undefined {
  const volume = typeof value === "number" ? value : parseFloat(value ?? "");
  return Number.isFinite(volume) && volume > 0 ? volume : undefined;
}

/**
 * Chapters arrive newest first. Each lists its main release first and
 * alternate uploads in "alts"; every upload becomes its own chapter, credited
 * to its group. The catalogue is English only.
 */
export function toChapters({ chapters }: SeriesResponse): Chapter[] {
  // Alts can be the same group's release mirrored from other upstreams; keep the first per group.
  const releases = chapters.flatMap((entry) => {
    const groups = new Set<string>();
    return [entry, ...(entry.alts ?? [])]
      .map((release) => ({ entry, release, label: parseLabel(release, entry.n) }))
      .filter(({ label }) => {
        const group = (label.group ?? "").trim().toLowerCase();
        if (groups.has(group)) return false;
        groups.add(group);
        return true;
      });
  });
  return releases.map(({ entry, release, label }, index) => {
    const { title, group } = label;
    const at = release.at ?? entry.at;
    const id = String(release.id);
    return {
      id,
      index,
      number: typeof entry.n === "number" && entry.n >= 0 ? entry.n : -1,
      volume: parseVolume(entry.vol),
      language: "en",
      title,
      date: at ? new Date(at) : undefined,
      webUrl: `${BASE_URL}/chapter/${id}`,
      providers: group
        ? [{ id: release.group?.slug || group, name: group, links: [] }]
        : undefined,
    };
  });
}

// ================================ Reader ================================

export function parseReaderKeyResponse(value: unknown): ReaderKeyResponse {
  const data = value as Partial<ReaderKeyResponse> | null;
  if (
    !data ||
    typeof data.key !== "string" ||
    typeof data.build !== "string" ||
    !data.build.trim() ||
    typeof data.now !== "number" ||
    !Number.isFinite(data.now) ||
    data.now <= 0
  ) {
    throw new Error("Toonkotsu returned invalid reader session data. The source may need an update.");
  }
  try {
    decodeBase64Url(data.key);
  } catch {
    throw new Error("Toonkotsu returned an invalid reader signing key.");
  }
  return { key: data.key, build: data.build, now: data.now };
}

interface ChapterPagesResponse {
  wrap?: string | null;
  chapter?: { pages?: unknown };
}

/**
 * Plain pages are returned as-is. Encrypted pages carry their (unwrapped) key
 * and nonce in the page context for the image interceptor to decrypt. Only a
 * signed answer can mask its page keys, so only that one comes with a reader key.
 */
export function parseChapterPages(response: unknown, readerKey?: ReaderKey): ChapterPage[] {
  const data = response as ChapterPagesResponse | null;
  const pages = data?.chapter?.pages;
  if (!Array.isArray(pages)) {
    throw new Error("Toonkotsu returned invalid chapter page data. The source may need an update.");
  }
  const wrap = data?.wrap;
  if (wrap != null && wrap !== "" && wrap !== "v1") {
    throw new Error("Unsupported Toonkotsu reader encryption version. Please update the source.");
  }
  const unmask = wrap === "v1" ? readerKey : undefined;
  if (wrap === "v1" && !unmask) throw new Error("Toonkotsu masked this chapter's page keys.");
  if (!pages.length) throw new Error("This chapter has no pages.");

  return pages.map((page: { src?: unknown; k?: unknown; n?: unknown }, index) => {
    const label = `Toonkotsu page ${index + 1}`;
    const path = typeof page?.src === "string" ? page.src.trim() : "";
    if (!path) throw new Error(`${label} has no valid image URL.`);
    if (/\s/.test(path) || (/^[a-z][a-z\d+.-]*:/i.test(path) && !/^https?:\/\//i.test(path))) {
      throw new Error(`${label} has an invalid image URL.`);
    }
    const url = path.startsWith("//") ? `https:${path}` : toAbsoluteUrl(path);

    const { k: key, n: nonce } = page;
    if (key == null && nonce == null) return { url };
    if (typeof key !== "string" || typeof nonce !== "string") {
      throw new Error(`${label} has incomplete encryption metadata.`);
    }
    try {
      const keyBytes = decodeBase64Url(key);
      if (![16, 24, 32].includes(keyBytes.length)) {
        throw new Error(`Unsupported AES key length (${keyBytes.length} bytes).`);
      }
      if (decodeBase64Url(nonce).length < 8) throw new Error("The AES-CTR nonce is too short.");
      const pageKey = unmask ? unwrapPageKey(unmask, key, nonce) : key;
      return { url, context: { [PAGE_KEY]: pageKey, [PAGE_NONCE]: nonce } };
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Invalid encryption metadata.";
      throw new Error(`${label}: ${reason} The source may need an update.`);
    }
  });
}
