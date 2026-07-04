import { describe, expect, it } from "vitest";
import {
  buildBackgroundCache,
  computeBackgroundGlass,
  DEFAULT_BACKGROUND_ALIGNMENT,
  DEFAULT_SURFACE_OPACITY,
  normalizeBackgroundAlignment,
  normalizeBackgroundUrl,
  normalizeSurfaceOpacity,
  parseBackgroundAlignment,
  resolveBackgroundUrl,
  SURFACE_GLASS_THRESHOLD,
} from "@/utils/background";

describe("normalizeBackgroundUrl", () => {
  it("trims and keeps a single url", () => {
    expect(normalizeBackgroundUrl("  https://x/a.webp  ")).toBe("https://x/a.webp");
  });

  it("returns empty for non-strings", () => {
    expect(normalizeBackgroundUrl(undefined)).toBe("");
    expect(normalizeBackgroundUrl(42)).toBe("");
  });

  it("keeps a light|dark pair when they differ", () => {
    expect(normalizeBackgroundUrl("/light.webp | /dark.webp")).toBe("/light.webp|/dark.webp");
  });

  it("collapses identical light/dark to a single url", () => {
    expect(normalizeBackgroundUrl("/same.webp|/same.webp")).toBe("/same.webp");
  });

  it("preserves a dark-only pair", () => {
    expect(normalizeBackgroundUrl("|/dark.webp")).toBe("|/dark.webp");
  });

  it("ignores a third segment", () => {
    expect(normalizeBackgroundUrl("/a|/b|/c")).toBe("/a|/b");
  });

  it("strips characters that could break out of url()", () => {
    expect(normalizeBackgroundUrl('/a.webp")body{x')).toBe("/a.webpbody{x");
    expect(normalizeBackgroundUrl("/a b.webp")).toBe("/ab.webp");
    expect(normalizeBackgroundUrl("/a(b).webp")).toBe("/ab.webp");
  });
});

describe("resolveBackgroundUrl", () => {
  it("returns the single url for both appearances", () => {
    expect(resolveBackgroundUrl("/a.webp", "light")).toBe("/a.webp");
    expect(resolveBackgroundUrl("/a.webp", "dark")).toBe("/a.webp");
  });

  it("selects light vs dark from a pair", () => {
    expect(resolveBackgroundUrl("/light.webp|/dark.webp", "light")).toBe("/light.webp");
    expect(resolveBackgroundUrl("/light.webp|/dark.webp", "dark")).toBe("/dark.webp");
  });

  it("returns empty for a missing side of a pair", () => {
    expect(resolveBackgroundUrl("|/dark.webp", "light")).toBe("");
    expect(resolveBackgroundUrl("|/dark.webp", "dark")).toBe("/dark.webp");
  });

  it("returns empty for empty input", () => {
    expect(resolveBackgroundUrl("", "dark")).toBe("");
  });
});

describe("parseBackgroundAlignment / normalizeBackgroundAlignment", () => {
  it("defaults invalid input to cover,center", () => {
    expect(parseBackgroundAlignment("garbage")).toEqual({ size: "cover", position: "center" });
    expect(parseBackgroundAlignment(undefined)).toEqual({ size: "cover", position: "center" });
    expect(normalizeBackgroundAlignment("nonsense")).toBe(DEFAULT_BACKGROUND_ALIGNMENT);
  });

  it("accepts valid size/position pairs", () => {
    expect(parseBackgroundAlignment("contain,top")).toEqual({ size: "contain", position: "top" });
    expect(normalizeBackgroundAlignment(" AUTO , BOTTOM ")).toBe("auto,bottom");
  });

  it("falls back per-field", () => {
    expect(parseBackgroundAlignment("contain,wat")).toEqual({ size: "contain", position: "center" });
    expect(parseBackgroundAlignment("wat,top")).toEqual({ size: "cover", position: "top" });
  });
});

describe("normalizeSurfaceOpacity", () => {
  it("defaults non-numeric to 100", () => {
    expect(normalizeSurfaceOpacity(undefined)).toBe(DEFAULT_SURFACE_OPACITY);
    expect(normalizeSurfaceOpacity("abc")).toBe(100);
  });

  it("clamps to 0–100 and rounds", () => {
    expect(normalizeSurfaceOpacity(150)).toBe(100);
    expect(normalizeSurfaceOpacity(-20)).toBe(0);
    expect(normalizeSurfaceOpacity(72.6)).toBe(73);
    expect(normalizeSurfaceOpacity("60")).toBe(60);
  });
});

describe("computeBackgroundGlass", () => {
  it("is inactive at/above the threshold (zero cost default)", () => {
    expect(computeBackgroundGlass(100)).toEqual({ active: false, blurPx: 0, scrimPct: 0 });
    expect(computeBackgroundGlass(SURFACE_GLASS_THRESHOLD)).toEqual({
      active: false,
      blurPx: 0,
      scrimPct: 0,
    });
  });

  it("ramps blur and scrim up as opacity drops", () => {
    const mid = computeBackgroundGlass(50);
    expect(mid.active).toBe(true);
    expect(mid.blurPx).toBeGreaterThan(0);
    expect(mid.scrimPct).toBeGreaterThan(0);

    const low = computeBackgroundGlass(0);
    expect(low.blurPx).toBeGreaterThanOrEqual(mid.blurPx);
    expect(low.scrimPct).toBeGreaterThanOrEqual(mid.scrimPct);
    expect(low.blurPx).toBeLessThanOrEqual(20);
    expect(low.scrimPct).toBeLessThanOrEqual(32);
  });
});

describe("buildBackgroundCache", () => {
  const base = {
    backgroundImage: "",
    backgroundImageMobile: "",
    backgroundAlignment: DEFAULT_BACKGROUND_ALIGNMENT,
    surfaceOpacity: DEFAULT_SURFACE_OPACITY,
  };

  it("returns cache with none urls when no image is configured", () => {
    const cache = buildBackgroundCache(base);
    expect(cache.alpha).toBe("100");
    expect(cache.lightDesktop).toBe("none");
    expect(cache.darkDesktop).toBe("none");
    expect(cache.lightMobile).toBe("none");
    expect(cache.darkMobile).toBe("none");
  });

  it("resolves both appearances and wraps urls in url()", () => {
    const cache = buildBackgroundCache({
      ...base,
      backgroundImage: "/light.webp|/dark.webp",
    });
    expect(cache.lightDesktop).toBe('url("/light.webp")');
    expect(cache.darkDesktop).toBe('url("/dark.webp")');
    // 没设置移动端图时回退到桌面端
    expect(cache.darkMobile).toBe('url("/dark.webp")');
  });

  it("omits glass at full opacity but includes it when transparent", () => {
    const solid = buildBackgroundCache({ ...base, backgroundImage: "/a.webp" });
    expect(solid.blur).toBe("");
    expect(solid.scrim).toBe("");
    expect(solid.alpha).toBe("100");

    const glassy = buildBackgroundCache({
      ...base,
      backgroundImage: "/a.webp",
      surfaceOpacity: 50,
    });
    expect(glassy.alpha).toBe("50");
    expect(glassy.blur).toMatch(/^\d+px$/);
    expect(glassy.scrim).toContain("color-mix");
  });
});
