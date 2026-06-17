import { describe, expect, it } from "vitest";
import { trafficUsageColor } from "@/utils/metricTone";

function hue(color: string): number {
  const match = /^hsl\(([\d.]+)/.exec(color);
  if (!match) throw new Error(`not an hsl color: ${color}`);
  return Number(match[1]);
}

describe("trafficUsageColor", () => {
  it("returns the success token for no usage / unlimited / invalid", () => {
    expect(trafficUsageColor(0)).toBe("var(--status-success)");
    expect(trafficUsageColor(null)).toBe("var(--status-success)");
    expect(trafficUsageColor(Number.NaN)).toBe("var(--status-success)");
  });

  it("stays green while at least half the quota remains", () => {
    // Green band (~140–150°) for used ≤ 50%, so a healthy quota never looks like a warning.
    expect(hue(trafficUsageColor(0.1))).toBeGreaterThan(140);
    expect(hue(trafficUsageColor(0.5))).toBeGreaterThan(140);
  });

  it("actually reaches red near the limit — the regression it fixes", () => {
    // Previously red (hue ≲ 15°) was unreachable below 85% used; the bar read as
    // green→light-green across the whole common range.
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
