import type { Appearance } from "@/utils/themeSettings";

export type ResolvedAppearance = Exclude<Appearance, "system">;

export const DEFAULT_BACKGROUND_ALIGNMENT = "cover,center";
export const DEFAULT_SURFACE_OPACITY = 100;

// Above this card opacity we treat the surfaces as effectively solid: no
// backdrop-filter is emitted and no readability scrim is drawn, so the default
// (100) experience carries zero extra paint cost. Glass kicks in only below it.
export const SURFACE_GLASS_THRESHOLD = 95;

const BACKGROUND_SIZE_VALUES = ["cover", "contain", "auto"] as const;
const BACKGROUND_POSITION_VALUES = ["top", "center", "bottom"] as const;

export type BackgroundSize = (typeof BACKGROUND_SIZE_VALUES)[number];
export type BackgroundPosition = (typeof BACKGROUND_POSITION_VALUES)[number];

const MAX_URL_LENGTH = 2048;

// Strip everything that could break out of a CSS url("…") context or smuggle in
// extra declarations: control chars (incl. DEL), whitespace (URLs encode spaces
// as %20), quotes, backtick, parens, angle brackets and backslash. Values are
// also fed through element.style, which already forbids cross-property
// injection, so this is defense in depth rather than the sole guard.
const UNSAFE_URL_CHARS = new RegExp("[\\x00-\\x1f\\x7f\"'`()<>\\\\\\s]", "g");

function sanitizeUrlPart(part: string): string {
  return part.replace(UNSAFE_URL_CHARS, "").slice(0, MAX_URL_LENGTH);
}

/**
 * Normalizes a background image setting. The value may encode an appearance pair
 * as `lightUrl|darkUrl` (purcarte convention); we keep at most those two parts,
 * sanitize each, and collapse to a single url when light and dark match. An empty
 * light side (`|darkUrl`) is preserved so a dark-only background round-trips.
 */
export function normalizeBackgroundUrl(value: unknown): string {
  if (typeof value !== "string") return "";
  const parts = value.split("|").map((part) => sanitizeUrlPart(part.trim()));
  const light = parts[0] ?? "";
  const dark = parts[1] ?? "";
  if (dark && dark !== light) return `${light}|${dark}`;
  return light;
}

/**
 * Picks the appearance-appropriate url from a normalized background value. A
 * single url applies to both appearances; a `light|dark` pair selects by the
 * resolved appearance.
 */
export function resolveBackgroundUrl(
  raw: string,
  appearance: ResolvedAppearance,
): string {
  if (!raw) return "";
  const parts = raw.split("|").map((part) => part.trim());
  if (parts.length >= 2) {
    return (appearance === "dark" ? parts[1] : parts[0]) ?? "";
  }
  return parts[0] ?? "";
}

export function parseBackgroundAlignment(value: unknown): {
  size: BackgroundSize;
  position: BackgroundPosition;
} {
  const fallback = { size: "cover" as BackgroundSize, position: "center" as BackgroundPosition };
  if (typeof value !== "string") return fallback;
  const [rawSize, rawPosition] = value.split(",").map((part) => part.trim().toLowerCase());
  const size = (BACKGROUND_SIZE_VALUES as readonly string[]).includes(rawSize)
    ? (rawSize as BackgroundSize)
    : fallback.size;
  const position = (BACKGROUND_POSITION_VALUES as readonly string[]).includes(rawPosition)
    ? (rawPosition as BackgroundPosition)
    : fallback.position;
  return { size, position };
}

export function normalizeBackgroundAlignment(value: unknown): string {
  const { size, position } = parseBackgroundAlignment(value);
  return `${size},${position}`;
}

export function normalizeSurfaceOpacity(value: unknown): number {
  const num =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseFloat(value)
        : Number.NaN;
  if (!Number.isFinite(num)) return DEFAULT_SURFACE_OPACITY;
  return Math.min(100, Math.max(0, Math.round(num)));
}

export interface BackgroundGlass {
  /** Whether translucent-glass treatment (backdrop blur + scrim) should apply. */
  active: boolean;
  /** backdrop-filter blur radius in px. */
  blurPx: number;
  /** Readability scrim strength as a 0–100 mix of --bg-0 over the image. */
  scrimPct: number;
}

/**
 * Derives the blur + scrim from the single card-opacity knob. At/above the glass
 * threshold nothing is applied (solid surfaces, zero cost); below it, blur and
 * scrim ramp up proportionally so a more transparent card stays legible without
 * exposing extra sliders. Both are capped to stay tasteful and cheap.
 */
export function computeBackgroundGlass(opacity: unknown): BackgroundGlass {
  const resolved = normalizeSurfaceOpacity(opacity);
  if (resolved >= SURFACE_GLASS_THRESHOLD) {
    return { active: false, blurPx: 0, scrimPct: 0 };
  }
  const t = (SURFACE_GLASS_THRESHOLD - resolved) / SURFACE_GLASS_THRESHOLD; // 0–1
  return {
    active: true,
    blurPx: Math.min(20, Math.round(t * 28)),
    scrimPct: Math.round(t * 32),
  };
}

export const BACKGROUND_CACHE_KEY = "komaritheme:bg";

interface BackgroundSettingsInput {
  backgroundImage: string;
  backgroundImageMobile: string;
  backgroundAlignment: string;
  surfaceOpacity: number;
}

/**
 * Pre-resolved, CSS-ready background values cached in localStorage so the
 * index.html inline script can paint the background + surface transparency on
 * the very first frame (no opaque→glass flash). Both appearances are stored
 * because the inline script knows the resolved appearance but can't run React.
 */
export interface BackgroundCache {
  v: 1;
  size: string;
  position: string;
  /** Card opacity 0–100 as a string, ready for the --surface-alpha var. */
  alpha: string;
  /** "" (no glass) or e.g. "13px" for --surface-blur. */
  blur: string;
  /** "" or a color-mix(...) string for --bg-scrim. */
  scrim: string;
  lightDesktop: string;
  lightMobile: string;
  darkDesktop: string;
  darkMobile: string;
}

function toCssUrl(url: string): string {
  return url ? `url("${url}")` : "none";
}

export function buildBackgroundCache(settings: BackgroundSettingsInput): BackgroundCache | null {
  const lightDesktop = resolveBackgroundUrl(settings.backgroundImage, "light");
  const darkDesktop = resolveBackgroundUrl(settings.backgroundImage, "dark");
  const lightMobile = resolveBackgroundUrl(settings.backgroundImageMobile, "light") || lightDesktop;
  const darkMobile = resolveBackgroundUrl(settings.backgroundImageMobile, "dark") || darkDesktop;
  if (!lightDesktop && !darkDesktop && !lightMobile && !darkMobile) return null;

  const { size, position } = parseBackgroundAlignment(settings.backgroundAlignment);
  const glass = computeBackgroundGlass(settings.surfaceOpacity);
  return {
    v: 1,
    size,
    position,
    alpha: String(normalizeSurfaceOpacity(settings.surfaceOpacity)),
    blur: glass.active && glass.blurPx > 0 ? `${glass.blurPx}px` : "",
    scrim:
      glass.active && glass.scrimPct > 0
        ? `color-mix(in srgb, var(--bg-0) ${glass.scrimPct}%, transparent)`
        : "",
    lightDesktop: toCssUrl(lightDesktop),
    lightMobile: toCssUrl(lightMobile),
    darkDesktop: toCssUrl(darkDesktop),
    darkMobile: toCssUrl(darkMobile),
  };
}

const BACKGROUND_VAR_NAMES = [
  "--bg-image-desktop",
  "--bg-image-mobile",
  "--bg-size",
  "--bg-position",
  "--surface-alpha",
  "--surface-blur",
  "--bg-scrim",
] as const;

/**
 * Writes (or clears) the background CSS variables + glass gate on <html> for the
 * given appearance. Mirrors the index.html inline script so React and the
 * pre-paint bootstrap converge on identical values.
 */
export function applyBackgroundCache(
  cache: BackgroundCache | null,
  appearance: ResolvedAppearance,
): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (!cache) {
    for (const name of BACKGROUND_VAR_NAMES) root.style.removeProperty(name);
    delete root.dataset.bgGlass;
    return;
  }
  const dark = appearance === "dark";
  const desktop = dark ? cache.darkDesktop : cache.lightDesktop;
  const mobile = (dark ? cache.darkMobile : cache.lightMobile) || desktop;
  root.style.setProperty("--bg-image-desktop", desktop);
  root.style.setProperty("--bg-image-mobile", mobile);
  root.style.setProperty("--bg-size", cache.size);
  root.style.setProperty("--bg-position", cache.position);
  root.style.setProperty("--surface-alpha", cache.alpha);
  if (cache.blur) {
    root.style.setProperty("--surface-blur", cache.blur);
    root.dataset.bgGlass = "true";
  } else {
    root.style.removeProperty("--surface-blur");
    delete root.dataset.bgGlass;
  }
  if (cache.scrim) root.style.setProperty("--bg-scrim", cache.scrim);
  else root.style.removeProperty("--bg-scrim");
}

export function persistBackgroundCache(cache: BackgroundCache | null): void {
  if (typeof localStorage === "undefined") return;
  try {
    if (cache) localStorage.setItem(BACKGROUND_CACHE_KEY, JSON.stringify(cache));
    else localStorage.removeItem(BACKGROUND_CACHE_KEY);
  } catch {
    // Background just won't be cached for the next first paint; non-fatal.
  }
}
