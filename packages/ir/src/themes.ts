/** Built-in kiosk themes. Renderer maps ids → CSS variables. */

export const THEME_IDS = [
  "hud",
  "terminal",
  "chalkboard",
  "notepad",
  "wood",
  "solarized-light",
  "solarized-dark",
  "nord",
  "dracula",
  "rose",
  "ocean",
  "amber",
  "mono-light",
  "mono-dark",
  "high-contrast",
  "high-contrast-light",
  "high-contrast-yellow",
  "high-contrast-blue",
] as const;

export type ThemeId = (typeof THEME_IDS)[number];

export const DEFAULT_THEME_ID: ThemeId = "hud";

export type ThemeMeta = {
  id: ThemeId;
  name: string;
};

export const THEME_CATALOG: ThemeMeta[] = [
  { id: "hud", name: "HUD" },
  { id: "terminal", name: "Terminal" },
  { id: "chalkboard", name: "Chalkboard" },
  { id: "notepad", name: "Notepad" },
  { id: "wood", name: "Wood" },
  { id: "solarized-light", name: "Solarized Light" },
  { id: "solarized-dark", name: "Solarized Dark" },
  { id: "nord", name: "Nord" },
  { id: "dracula", name: "Dracula" },
  { id: "rose", name: "Rose" },
  { id: "ocean", name: "Ocean" },
  { id: "amber", name: "Amber" },
  { id: "mono-light", name: "Mono Light" },
  { id: "mono-dark", name: "Mono Dark" },
  { id: "high-contrast", name: "High Contrast" },
  { id: "high-contrast-light", name: "High Contrast Light" },
  { id: "high-contrast-yellow", name: "High Contrast Yellow" },
  { id: "high-contrast-blue", name: "High Contrast Blue" },
];

const THEME_SET = new Set<string>(THEME_IDS);

export function isThemeId(value: string): value is ThemeId {
  return THEME_SET.has(value);
}

export function normalizeThemeId(input?: string | null): ThemeId {
  if (input && isThemeId(input)) return input;
  return DEFAULT_THEME_ID;
}

export function nextThemeId(current?: string | null): ThemeId {
  const id = normalizeThemeId(current);
  const idx = THEME_IDS.indexOf(id);
  return THEME_IDS[(idx + 1) % THEME_IDS.length]!;
}

/** Semantic text color tokens (IR + as_screen_style). Legacy names map to these at render time. */
export const TEXT_COLOR_TOKENS = [
  "default",
  "muted",
  "primary",
  "text",
  "accent",
  "positive",
  "negative",
  "neutral",
  "warning",
  /** @deprecated use primary */
  "cyan",
  /** @deprecated use text */
  "white",
  /** @deprecated use negative */
  "red",
  /** @deprecated use positive */
  "green",
  /** @deprecated use warning */
  "yellow",
  /** @deprecated use accent */
  "orange",
  /** @deprecated use accent */
  "magenta",
  /** @deprecated use muted */
  "dimmed",
] as const;

export type TextColorToken = (typeof TEXT_COLOR_TOKENS)[number];

export function resolveTextColorToken(token: string): TextColorToken {
  switch (token) {
    case "dimmed":
      return "muted";
    case "cyan":
      return "primary";
    case "white":
      return "text";
    case "red":
      return "negative";
    case "green":
      return "positive";
    case "yellow":
      return "warning";
    case "orange":
    case "magenta":
      return "accent";
    default:
      return token as TextColorToken;
  }
}
