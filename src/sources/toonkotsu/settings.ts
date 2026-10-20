import { LabeledOption, UIForm, UISelect, UISection, UIWebViewButton } from "@suwatte/toolchain";

import {
  BASE_URL,
  CONTENT_RATING_OPTIONS,
  DEFAULT_CONTENT_RATINGS,
  FEED_OPTIONS,
  PREF_CONTENT_RATINGS,
  PREF_HIDDEN_FEEDS,
  PREF_HIDDEN_TAGS,
  PREF_TYPES,
  TYPE_OPTIONS,
} from "./constants";

export const VERIFY_BUTTON_TITLE = "Verify on Toonkotsu";

export interface Preferences {
  contentRatings: string[];
  types: string[];
  /** Tag names left out of every catalogue request. */
  hiddenTags: string[];
  hiddenFeeds: string[];
}

/** Keeps known ids only; an empty selection falls back to the default. */
function validSelection(
  value: string[] | null,
  options: LabeledOption[],
  fallback: string[]
): string[] {
  const ids = new Set(options.map(({ id }) => id));
  const selected = [...new Set((value ?? []).filter((id) => ids.has(id)))];
  return selected.length > 0 ? selected : fallback;
}

export async function loadPreferences(): Promise<Preferences> {
  const [contentRatings, types, hiddenTags, hiddenFeeds] = await Promise.all([
    ObjectStore.stringArray(PREF_CONTENT_RATINGS),
    ObjectStore.stringArray(PREF_TYPES),
    ObjectStore.stringArray(PREF_HIDDEN_TAGS),
    ObjectStore.stringArray(PREF_HIDDEN_FEEDS),
  ]);

  return {
    contentRatings: validSelection(
      contentRatings,
      CONTENT_RATING_OPTIONS,
      DEFAULT_CONTENT_RATINGS
    ),
    types: validSelection(
      types,
      TYPE_OPTIONS,
      TYPE_OPTIONS.map(({ id }) => id)
    ),
    hiddenTags: hiddenTags ?? [],
    hiddenFeeds: hiddenFeeds ?? [],
  };
}

export function buildSettingsForm(prefs: Preferences, tagOptions: LabeledOption[]): UIForm {
  const browse: UISection = {
    header: "Browse Settings",
    footer:
      "Applies to home feeds and search. Pornographic titles are only requested when that rating is selected.",
    views: [
      UISelect({
        id: PREF_CONTENT_RATINGS,
        title: "Content Ratings",
        options: CONTENT_RATING_OPTIONS,
        exclude: false,
        defaultValue: { include: DEFAULT_CONTENT_RATINGS, exclude: [] },
        currentValue: { include: prefs.contentRatings, exclude: [] },
      }),
      UISelect({
        id: PREF_TYPES,
        title: "Types",
        options: TYPE_OPTIONS.map(({ id, title }) => ({ id, title })),
        exclude: false,
        defaultValue: { include: TYPE_OPTIONS.map(({ id }) => id), exclude: [] },
        currentValue: { include: prefs.types, exclude: [] },
      }),
    ],
  };
  if (tagOptions.length > 0) {
    browse.views.push(
      UISelect({
        id: PREF_HIDDEN_TAGS,
        title: "Hidden Tags",
        options: tagOptions,
        exclude: false,
        defaultValue: { include: [], exclude: [] },
        currentValue: { include: prefs.hiddenTags, exclude: [] },
      })
    );
  }

  return {
    sections: [
      {
        header: "Reading",
        footer:
          "If chapters say Toonkotsu wants you to confirm you're human, open the site here, open any chapter, pass the check, then go back and reopen the chapter.",
        views: [
          UIWebViewButton({
            title: VERIFY_BUTTON_TITLE,
            url: { url: `${BASE_URL}/` },
          }),
        ],
      },
      browse,
      {
        header: "Home Page",
        views: [
          UISelect({
            id: PREF_HIDDEN_FEEDS,
            title: "Hidden Feeds",
            options: FEED_OPTIONS,
            exclude: false,
            defaultValue: { include: [], exclude: [] },
            currentValue: { include: prefs.hiddenFeeds, exclude: [] },
          }),
        ],
      },
    ],
  };
}

/** Saves each submitted select value; others are ignored. */
export async function savePreferences(data: Record<string, unknown>): Promise<void> {
  for (const key of [PREF_CONTENT_RATINGS, PREF_TYPES, PREF_HIDDEN_TAGS, PREF_HIDDEN_FEEDS]) {
    const value = data[key] as { include?: unknown } | undefined;
    if (value && typeof value === "object" && Array.isArray(value.include)) {
      await ObjectStore.set(
        key,
        value.include.filter((id): id is string => typeof id === "string")
      );
    }
  }
}
