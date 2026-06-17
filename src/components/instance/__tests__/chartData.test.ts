import { describe, expect, it } from "vitest";
import {
  cutPeakValues,
  fillMissingMetricPoints,
  insertMetricGapSentinels,
  type TimedMetricPoint,
} from "@/components/instance/chartData";

describe("fillMissingMetricPoints", () => {
  it("keeps the newest sample's own timestamp instead of snapping it to the grid", () => {
    // Last sample (t=35) is off the 10ms grid; it must not be pulled back to t=30.
    const points: TimedMetricPoint[] = [
      { time: 0, v: 1 },
      { time: 10, v: 2 },
      { time: 20, v: 3 },
      { time: 35, v: 9 },
    ];
    const filled = fillMissingMetricPoints(points, { intervalMs: 10, matchToleranceMs: 5 });
    const last = filled[filled.length - 1];
    expect(last.time).toBe(35);
    expect(last.v).toBe(9);
  });

  it("leaves on-grid series untouched at the trailing edge", () => {
    const points: TimedMetricPoint[] = [
      { time: 0, v: 1 },
      { time: 10, v: 2 },
      { time: 20, v: 3 },
    ];
    const filled = fillMissingMetricPoints(points, { intervalMs: 10, matchToleranceMs: 5 });
    expect(filled.map((p) => p.time)).toEqual([0, 10, 20]);
    expect(filled[filled.length - 1].v).toBe(3);
  });
});

describe("cutPeakValues", () => {
  it("preserves genuine loss gaps instead of backfilling them (regression)", () => {
    const points = [
      { time: 1, t1: 50 },
      { time: 2, t1: 52 },
      { time: 3, t1: null }, // packet loss — must stay a gap
      { time: 4, t1: 51 },
      { time: 5, t1: 50 },
    ];

    const out = cutPeakValues(points, ["t1"]);

    expect(out[2].t1).toBeNull();
    // Surrounding samples remain real numbers (EWMA-smoothed), not nulled.
    expect(typeof out[0].t1).toBe("number");
    expect(typeof out[4].t1).toBe("number");
  });

  it("does not invent values across a multi-point outage", () => {
    const points = [
      { time: 1, t1: 40 },
      { time: 2, t1: null },
      { time: 3, t1: null },
      { time: 4, t1: null },
      { time: 5, t1: 42 },
    ];

    const out = cutPeakValues(points, ["t1"]);

    expect(out[1].t1).toBeNull();
    expect(out[2].t1).toBeNull();
    expect(out[3].t1).toBeNull();
  });
});

describe("insertMetricGapSentinels — three-state ping semantics", () => {
  const opts = (intervals: Record<string, number>) => ({
    intervals: new Map(Object.entries(intervals)),
    matchToleranceRatio: 0.25,
  });
  const at = (points: TimedMetricPoint[], time: number) =>
    points.find((point) => point.time === time);

  it("keeps an off-phase anchor as undefined (spannable), not null", () => {
    // A and B sample every 60s but staggered by 30s, so each creates anchors the
    // other never sampled. Those off-phase cells must stay undefined so uPlot spans
    // them instead of cutting every line — the original blank-chart bug.
    const points: TimedMetricPoint[] = [
      { time: 0, A: 10 },
      { time: 30, B: 20 },
      { time: 60, A: 11 },
      { time: 90, B: 21 },
      { time: 120, A: 12 },
      { time: 150, B: 22 },
    ];

    const out = insertMetricGapSentinels(points, opts({ A: 60, B: 60 }));

    const p0 = at(out, 0)!;
    expect(p0.A).toBe(10);
    expect(p0.B).toBeUndefined();
    const p30 = at(out, 30)!;
    expect(p30.B).toBe(20);
    expect(p30.A).toBeUndefined();
  });

  it("preserves real loss (null) as a break", () => {
    const points: TimedMetricPoint[] = [
      { time: 0, A: 10 },
      { time: 60, A: null }, // value <= 0 already encoded as null by the bucketer
      { time: 120, A: 12 },
    ];

    const out = insertMetricGapSentinels(points, opts({ A: 60 }));

    expect(at(out, 60)!.A).toBeNull();
  });

  it("tolerates a single missed sample (gap <= 2x interval)", () => {
    const points: TimedMetricPoint[] = [
      { time: 0, A: 10 },
      { time: 120, A: 12 }, // one missed sample at 60 → gap is exactly 2x interval
      { time: 180, A: 13 },
    ];

    const out = insertMetricGapSentinels(points, opts({ A: 60 }));

    expect(out.every((point) => point.A !== null)).toBe(true);
  });

  it("breaks only the gapped task on a long outage, sparing co-located anchors", () => {
    // A goes dark 60..300 while B keeps sampling. A's break must land on B's anchors
    // (merged, not skipped) without clobbering B's real values.
    const points: TimedMetricPoint[] = [
      { time: 0, A: 10, B: 100 },
      { time: 60, A: 11, B: 101 },
      { time: 120, B: 102 },
      { time: 180, B: 103 },
      { time: 240, B: 104 },
      { time: 300, A: 15, B: 105 },
    ];

    const out = insertMetricGapSentinels(points, opts({ A: 60, B: 60 }));

    const p120 = at(out, 120)!;
    expect(p120.A).toBeNull(); // A broken, merged onto B's existing anchor
    expect(p120.B).toBe(102); // B untouched
  });

  it("merges sentinels when multiple tasks gap at the same time", () => {
    // A and B both go dark 60..300 with no anchors in between, so each seeds its own
    // sentinel at the same expected times — the second must merge, not overwrite.
    const points: TimedMetricPoint[] = [
      { time: 0, A: 10, B: 100 },
      { time: 60, A: 11, B: 101 },
      { time: 300, A: 15, B: 105 },
    ];

    const out = insertMetricGapSentinels(points, opts({ A: 60, B: 60 }));

    const p120 = at(out, 120)!;
    expect(p120).toBeDefined();
    expect(p120!.A).toBeNull();
    expect(p120!.B).toBeNull();
  });
});
