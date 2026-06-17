import { describe, expect, it } from "vitest";
import {
  calculateCostSummary,
  formatCnyMoney,
  normalizeCostIgnoredNodes,
  normalizeCostRateApiUrl,
  DEFAULT_COST_RATE_API_URL,
} from "@/utils/cost";
import type { NodeInfo } from "@/types/komari";

const RATES = { USD: 1, CNY: 7 };
const RATES_X = { USD: 1, EUR: 0.9, CNY: 7 };

function node(overrides: Record<string, unknown>): NodeInfo {
  return {
    uuid: "u1",
    name: "node",
    weight: 0,
    price: 0,
    currency: "USD",
    billing_cycle: 30,
    expired_at: "",
    ...overrides,
  } as unknown as NodeInfo;
}

function inDays(days: number) {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

describe("calculateCostSummary", () => {
  it("scales remaining value by prepaid cycles (price is per-cycle)", () => {
    // 10 USD (=70 CNY) per 30-day cycle, paid through ~1 year out → ~12 cycles
    // of prepaid value remaining. `price` is the per-cycle cost (confirmed by the
    // backend Client model + auto-renewal logic), so remaining must scale up.
    const summary = calculateCostSummary(
      [node({ price: 10, currency: "USD", billing_cycle: 30, expired_at: inDays(360) })],
      [],
      RATES,
    );
    expect(summary.paidCount).toBe(1);
    // 70 CNY/cycle × (360 days / 30 days) = ~840 CNY.
    expect(summary.remainingCny).toBeGreaterThan(70 * 11);
    expect(summary.remainingCny).toBeLessThan(70 * 13);
  });

  it("reports one cycle of value for long-term (>100y) nodes", () => {
    const summary = calculateCostSummary(
      [node({ price: 10, currency: "USD", billing_cycle: 30, expired_at: inDays(365 * 200) })],
      [],
      RATES,
    );
    expect(summary.remainingCny).toBeCloseTo(70, 5);
  });

  it("counts a no-expiry node as one cycle of remaining value, not zero", () => {
    // Regression: never-expiring nodes (Go zero-time / 0 / -1 / unset) used to be
    // read as 已过期 and drop their prepaid value from 剩余价值 entirely.
    for (const sentinel of ["0001-01-01T00:00:00Z", "0", "-1", ""]) {
      const summary = calculateCostSummary(
        [node({ price: 10, currency: "USD", billing_cycle: 30, expired_at: sentinel })],
        [],
        RATES,
      );
      expect(summary.paidCount).toBe(1);
      // 10 USD × 7 = 70 CNY = one cycle's worth (matches the >100y lifetime case).
      expect(summary.remainingCny).toBeCloseTo(70, 5);
    }
  });

  it("treats an unset currency as the target currency (CNY), not USD", () => {
    // Regression: blank currency defaulted to USD, inflating a CNY-priced node ~7×.
    const summary = calculateCostSummary(
      [node({ price: 100, currency: "", billing_cycle: "monthly" })],
      [],
      RATES,
    );
    expect(summary.skippedCount).toBe(0);
    expect(summary.monthlyCny).toBeCloseTo(100, 6);
  });

  it("counts free nodes separately and excludes them from totals", () => {
    const summary = calculateCostSummary(
      [node({ uuid: "free", price: 0 })],
      [],
      RATES,
    );
    expect(summary.freeCount).toBe(1);
    expect(summary.paidCount).toBe(0);
    expect(summary.totalCny).toBe(0);
  });

  it("honours the ignored-node list", () => {
    const summary = calculateCostSummary(
      [node({ uuid: "skip", name: "ignored-box", price: 10, expired_at: inDays(10) })],
      ["ignored-box"],
      RATES,
    );
    expect(summary.ignoredCount).toBe(1);
    expect(summary.paidCount).toBe(0);
  });

  it("converts currency into CNY for the total", () => {
    const summary = calculateCostSummary(
      [node({ price: 10, currency: "USD", billing_cycle: 365, expired_at: inDays(200) })],
      [],
      RATES,
    );
    expect(summary.totalCny).toBeCloseTo(70, 5);
  });
});

describe("calculateCostSummary — annualized total & cycle validation", () => {
  it("annualizes totalCny so total === sum(monthly) * 12 across mixed cycles", () => {
    const summary = calculateCostSummary(
      [
        node({ uuid: "m", price: 10, currency: "USD", billing_cycle: "monthly" }),
        node({ uuid: "y", name: "yearly", price: 120, currency: "$", billing_cycle: "annual" }),
      ],
      [],
      RATES,
    );
    // monthly: 70/mo ; yearly: 840/yr = 70/mo → 140/mo total → 1680/yr
    expect(summary.monthlyCny).toBeCloseTo(140, 6);
    expect(summary.totalCny).toBeCloseTo(1680, 6);
    expect(summary.totalCny).toBeCloseTo(summary.monthlyCny * 12, 6);
  });

  it("converts via cross rates (EUR -> CNY)", () => {
    const summary = calculateCostSummary(
      [node({ uuid: "e", price: 10, currency: "€", billing_cycle: "monthly" })],
      [],
      RATES_X,
    );
    expect(summary.monthlyCny).toBeCloseTo((10 / 0.9) * 7, 6);
    expect(summary.totalCny).toBeCloseTo((10 / 0.9) * 7 * 12, 6);
  });

  it("skips nodes whose currency has no rate", () => {
    const summary = calculateCostSummary(
      [node({ uuid: "jpy", price: 1000, currency: "JPY", billing_cycle: "monthly" })],
      [],
      RATES,
    );
    expect(summary.skippedCount).toBe(1);
    expect(summary.paidCount).toBe(0);
    expect(summary.totalCny).toBe(0);
  });

  it("falls back to a yearly cycle for invalid billing_cycle numerics", () => {
    const summary = calculateCostSummary(
      [
        node({ uuid: "zero", price: 120, currency: "USD", billing_cycle: 0 }),
        node({ uuid: "neg", name: "neg", price: 120, currency: "USD", billing_cycle: -7 }),
      ],
      [],
      RATES,
    );
    for (const detail of summary.details) {
      expect(detail.billingCycleDays).toBe(365);
    }
    expect(summary.monthlyCny).toBeCloseTo(140, 6);
  });

  it("keeps lifetime (-1) purchases out of recurring totals", () => {
    const summary = calculateCostSummary(
      [node({ uuid: "life", price: 99, currency: "USD", billing_cycle: "lifetime" })],
      [],
      RATES,
    );
    expect(summary.details[0]?.billingCycleDays).toBe(-1);
    expect(summary.monthlyCny).toBe(0);
    expect(summary.totalCny).toBe(0);
  });
});

describe("cost helpers", () => {
  it("normalizeCostIgnoredNodes splits, trims and dedupes", () => {
    expect(normalizeCostIgnoredNodes("a, b；b\nc")).toEqual(["a", "b", "c"]);
    expect(normalizeCostIgnoredNodes(["x", "", " y "])).toEqual(["x", "y"]);
  });

  it("normalizeCostRateApiUrl falls back to the default", () => {
    expect(normalizeCostRateApiUrl("")).toBe(DEFAULT_COST_RATE_API_URL);
    expect(normalizeCostRateApiUrl("  https://x  ")).toBe("https://x");
  });

  it("formatCnyMoney guards NaN and formats two decimals", () => {
    expect(formatCnyMoney(1234.5)).toBe("¥ 1,234.50");
    expect(formatCnyMoney(Number.NaN)).toBe("¥ 0.00");
  });
});
