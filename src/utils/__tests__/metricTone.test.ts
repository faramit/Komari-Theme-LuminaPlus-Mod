import { describe, expect, it } from "vitest";
import {
  latencyHeatColor,
  lossHeatColor,
  speedRateColor,
  speedRateColorFromBytes,
  trafficQuotaSegmentColor,
  trafficUsageColor,
} from "@/utils/metricTone";

function parseHexHue(hex: string): number {
  const value = hex.replace("#", "");
  const r = parseInt(value.substring(0, 2), 16) / 255;
  const g = parseInt(value.substring(2, 4), 16) / 255;
  const b = parseInt(value.substring(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  if (delta === 0) return 0;

  let h: number;
  if (max === r) {
    h = ((g - b) / delta) % 6;
  } else if (max === g) {
    h = (b - r) / delta + 2;
  } else {
    h = (r - g) / delta + 4;
  }

  h = Math.round(h * 60);
  if (h < 0) h += 360;
  return h;
}

function hue(color: string): number {
  const varMatch = /var\(--[^,]+,\s*(#[0-9a-fA-F]{6})\)/.exec(color);
  if (varMatch) return parseHexHue(varMatch[1]);

  const hslMatch = /^hsl\(([\d.]+)/.exec(color);
  if (hslMatch) return Number(hslMatch[1]);

  throw new Error(`cannot parse hue from: ${color}`);
}

function colorMixPct(color: string): number {
  const match = /var\(--quota-high[^)]+\)\s+([\d.]+)%/.exec(color);
  if (!match) throw new Error(`cannot parse color-mix pct from: ${color}`);
  return Number(match[1]);
}


describe("latencyHeatColor", () => {
  it("treats 0ms (sub-millisecond success) as the greenest latency, not neutral", () => {
    const color = latencyHeatColor(0);
    expect(color).not.toBe("var(--text-tertiary)");
    expect(color).toMatch(/var\(--latency-0/);
  });

  it("returns neutral only for no data (null/undefined) or loss (negative / non-finite)", () => {
    expect(latencyHeatColor(null)).toBe("var(--text-tertiary)");
    expect(latencyHeatColor(undefined)).toBe("var(--text-tertiary)");
    expect(latencyHeatColor(-1)).toBe("var(--text-tertiary)");
    expect(latencyHeatColor(Number.NaN)).toBe("var(--text-tertiary)");
  });

  it("rotates hue green→red as latency grows", () => {
    expect(hue(latencyHeatColor(0))).toBeGreaterThan(hue(latencyHeatColor(120)));
    expect(hue(latencyHeatColor(120))).toBeGreaterThan(hue(latencyHeatColor(500)));
  });
});

describe("lossHeatColor", () => {
  it("treats 0% loss as the greenest, neutral only for negative / no data", () => {
    expect(lossHeatColor(0)).toMatch(/var\(--loss-0/);
    expect(lossHeatColor(null)).toBe("var(--text-tertiary)");
    expect(lossHeatColor(-1)).toBe("var(--text-tertiary)");
  });
});

describe("trafficUsageColor", () => {
  it("returns the success token for no usage / unlimited / invalid", () => {
    expect(trafficUsageColor(0)).toBe("var(--status-success)");
    expect(trafficUsageColor(null)).toBe("var(--status-success)");
    expect(trafficUsageColor(Number.NaN)).toBe("var(--status-success)");
  });

  it("stays green while at least half the quota remains", () => {
    expect(hue(trafficUsageColor(0.1))).toBeGreaterThan(140);
    expect(hue(trafficUsageColor(0.5))).toBeGreaterThan(140);
  });

  it("actually reaches red near the limit — the regression it fixes", () => {
    expect(hue(trafficUsageColor(0.95))).toBeLessThan(20);
    expect(hue(trafficUsageColor(1))).toBeLessThan(12);
  });

  it("warms monotonically (hue never increases) as usage climbs", () => {
    let prev = Number.POSITIVE_INFINITY;
    for (let f = 0.05; f <= 1.0001; f += 0.05) {
      const h = hue(trafficUsageColor(Math.min(f, 1)));
      expect(h).toBeLessThanOrEqual(prev + 1e-6);
      prev = h;
    }
  });
});

describe("trafficQuotaSegmentColor", () => {
  it("returns color-mix expression referencing both CSS vars", () => {
    const color = trafficQuotaSegmentColor(0);
    expect(color).toMatch(/^color-mix\(in oklch,/);
    expect(color).toContain("var(--quota-high");
    expect(color).toContain("var(--quota-low");
  });

  it("interpolates the mix percentage from 100% down to 0%", () => {
    expect(colorMixPct(trafficQuotaSegmentColor(0))).toBe(100);
    expect(colorMixPct(trafficQuotaSegmentColor(0.5))).toBe(50);
    expect(colorMixPct(trafficQuotaSegmentColor(1))).toBe(0);
  });

  it("warms monotonically — quota-high share never increases with position", () => {
    let prev = 101;
    for (let p = 0; p <= 1.0001; p += 0.05) {
      const pct = colorMixPct(trafficQuotaSegmentColor(Math.min(p, 1)));
      expect(pct).toBeLessThanOrEqual(prev + 1e-6);
      prev = pct;
    }
  });

  it("clamps positions outside 0..1", () => {
    expect(trafficQuotaSegmentColor(-1)).toBe(trafficQuotaSegmentColor(0));
    expect(trafficQuotaSegmentColor(2)).toBe(trafficQuotaSegmentColor(1));
  });
});

describe("speedRateColor", () => {
  it("maps each rate-unit tier to its own heat token (B→KB→MB→GB+)", () => {
    expect(speedRateColor("KB/s")).toBe("var(--speed-low)");
    expect(speedRateColor("MB/s")).toBe("var(--speed-high)");
    expect(speedRateColor("GB/s")).toBe("var(--speed-max)");
    expect(speedRateColor("TB/s")).toBe("var(--speed-max)");
    expect(speedRateColor("PB/s")).toBe("var(--speed-max)");
  });

  it("maps idle (B/s) to its own 超低速 tier, only unknown units go neutral", () => {
    expect(speedRateColor("B/s")).toBe("var(--speed-idle)");
    expect(speedRateColor("")).toBe("var(--text-tertiary)");
  });

  it("speedRateColorFromBytes routes raw bytes/sec through the unit tier", () => {
    expect(speedRateColorFromBytes(0)).toBe("var(--speed-idle)");
    expect(speedRateColorFromBytes(5 * 1024 * 1024)).toBe("var(--speed-high)");
  });
});
