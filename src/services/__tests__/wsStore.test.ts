import { describe, expect, it } from "vitest";
import { resolveTrafficTotal } from "@/services/wsStore";

// Drive a sequence of raw cumulative readings through the resolver the same way
// resolveTrafficTotals does each tick: thread the previous display value (which
// the store keeps on the node metrics) forward.
function drive(readings: number[]): number[] {
  let previous = 0;
  return readings.map((raw) => {
    previous = resolveTrafficTotal(previous, raw);
    return previous;
  });
}

describe("resolveTrafficTotal", () => {
  it("passes the backend counter through unchanged while it climbs", () => {
    expect(drive([10, 20, 30])).toEqual([10, 20, 30]);
  });

  it("holds the previous value when a tick reports zero (missing/partial sample)", () => {
    // A zero reading is an offline/heartbeat frame or a payload that omitted
    // net_total_up/down — not real traffic. Holding avoids a flicker to 0, and
    // (the regression we are guarding) avoids re-inflating the total when the real
    // reading returns: the overview used to roughly double on every offline flap.
    expect(drive([50, 0, 51])).toEqual([50, 50, 51]);
  });

  it("stays stable across repeated zero readings", () => {
    expect(drive([50, 0, 0, 51, 0, 52])).toEqual([50, 50, 50, 51, 51, 52]);
  });

  it("follows a genuine counter reset down (reboot / billing-cycle rollover)", () => {
    // The backend counter legitimately drops; we surface it so the overview and the
    // traffic-limit bars track the backend instead of staying inflated.
    expect(drive([50, 5, 6])).toEqual([50, 5, 6]);
  });

  it("ignores a zero gap but still follows a later real reset", () => {
    // 50 → offline (0, held) → back after reset with a small real counter.
    expect(drive([50, 0, 2, 3])).toEqual([50, 50, 2, 3]);
  });

  it("does not surface a value until a real reading arrives", () => {
    expect(drive([0, 0, 10])).toEqual([0, 0, 10]);
  });
});
