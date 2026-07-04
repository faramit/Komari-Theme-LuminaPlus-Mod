import type { Appearance } from "@/utils/themeSettings";

export type ResolvedAppearance = Exclude<Appearance, "system">;

export const DEFAULT_BACKGROUND_ALIGNMENT = "cover,center";
export const DEFAULT_SURFACE_OPACITY = 100;

// 卡片不透明度高于此值就当作完全不透明:不输出 backdrop-filter、不画可读性 scrim,所以默认值
// (100) 没有任何额外绘制开销。低于此值才启用 glass 效果。
export const SURFACE_GLASS_THRESHOLD = 95;

const BACKGROUND_SIZE_VALUES = ["cover", "contain", "auto"] as const;
const BACKGROUND_POSITION_VALUES = ["top", "center", "bottom"] as const;

export type BackgroundSize = (typeof BACKGROUND_SIZE_VALUES)[number];
export type BackgroundPosition = (typeof BACKGROUND_POSITION_VALUES)[number];

const MAX_URL_LENGTH = 2048;

// 去掉所有可能逃出 CSS url("…") 上下文或夹带额外声明的字符:控制字符(含 DEL)、空白(URL 里空格
// 用 %20)、引号、反引号、括号、尖括号、反斜杠。这些值还会经过 element.style(本身就禁止跨属性注入),
// 所以这只是纵深防御,不是唯一防线。
const UNSAFE_URL_CHARS = new RegExp("[\\x00-\\x1f\\x7f\"'`()<>\\\\\\s]", "g");

function sanitizeUrlPart(part: string): string {
  return part.replace(UNSAFE_URL_CHARS, "").slice(0, MAX_URL_LENGTH);
}

/**
 * 规范化背景图设置。值可能用 `lightUrl|darkUrl` 编码明暗两套;最多保留这两段,
 * 各自 sanitize,light 和 dark 相同时塌缩成单个 url。空的 light 段(`|darkUrl`)会保留,这样
 * 只有 dark 背景也能原样往返。
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
 * 从规范化后的背景值里挑出对应外观的 url。单个 url 对明暗都生效;`light|dark` 一对则按解析出的
 * 外观选取。
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
  /** 是否启用半透明玻璃效果(backdrop blur + scrim)。 */
  active: boolean;
  /** backdrop-filter 的 blur 半径,单位 px。 */
  blurPx: number;
  /** 可读性 scrim 强度,即 --bg-0 覆盖在图片上的 0–100 混合比例。 */
  scrimPct: number;
}

/**
 * 仅凭卡片不透明度这一个旋钮推导 blur + scrim。达到/超过 glass 阈值什么都不加(不透明表面、零开销);
 * 低于阈值时 blur 和 scrim 按比例增强,这样越透明的卡片也能保持可读,不必再暴露额外滑块。两者都有上限,
 * 既好看又便宜。
 */
export function computeBackgroundGlass(opacity: unknown): BackgroundGlass {
  const resolved = normalizeSurfaceOpacity(opacity);
  if (resolved >= SURFACE_GLASS_THRESHOLD) {
    return { active: false, blurPx: 0, scrimPct: 0 };
  }
  const t = (SURFACE_GLASS_THRESHOLD - resolved) / SURFACE_GLASS_THRESHOLD; // 取值 0–1
  return {
    active: true,
    blurPx: Math.min(20, Math.round(t * 28)),
    scrimPct: Math.round(t * 32),
  };
}

// Legacy key retained so existing users keep their saved background after the rename.
export const BACKGROUND_CACHE_KEY = "luminaplusmod:bg";

interface BackgroundSettingsInput {
  backgroundImage: string;
  backgroundImageMobile: string;
  backgroundAlignment: string;
  surfaceOpacity: number;
}

/**
 * 预解析好、可直接用于 CSS 的背景值,缓存在 localStorage 里,这样 index.html 的内联脚本能在第一帧
 * 就画出背景 + 表面透明度(避免 opaque→glass 的闪烁)。明暗两套都存,因为内联脚本知道解析出的外观
 * 但跑不了 React。
 */
export interface BackgroundCache {
  v: 1;
  size: string;
  position: string;
  /** 卡片不透明度 0–100 的字符串形式,可直接给 --surface-alpha 变量用。 */
  alpha: string;
  /** "" (无 glass) 或形如 "13px",给 --surface-blur 用。 */
  blur: string;
  /** "" 或 color-mix(...) 字符串,给 --bg-scrim 用。 */
  scrim: string;
  lightDesktop: string;
  lightMobile: string;
  darkDesktop: string;
  darkMobile: string;
}

function toCssUrl(url: string): string {
  return url ? `url("${url}")` : "none";
}

export function buildBackgroundCache(settings: BackgroundSettingsInput): BackgroundCache {
  const lightDesktop = resolveBackgroundUrl(settings.backgroundImage, "light");
  const darkDesktop = resolveBackgroundUrl(settings.backgroundImage, "dark");
  const lightMobile = resolveBackgroundUrl(settings.backgroundImageMobile, "light") || lightDesktop;
  const darkMobile = resolveBackgroundUrl(settings.backgroundImageMobile, "dark") || darkDesktop;

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

/**
 * 按给定外观把背景 CSS 变量 + glass 开关写到 <html> 上。与 index.html 内联脚本保持一致,
 * 让 React 和预绘制引导收敛到完全相同的值。
 */
export function applyBackgroundCache(
  cache: BackgroundCache,
  appearance: ResolvedAppearance,
): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
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

export function persistBackgroundCache(cache: BackgroundCache): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(BACKGROUND_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // 非致命。
  }
}
