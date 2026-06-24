import { describe, expect, it } from "vitest";
import {
  calculateCostSummary,
  formatCnyMoney,
  isCostRateApiUrlValid,
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
    // 10 USD(=70 CNY)每 30 天一个周期,付到约 1 年后 → 还剩约 12 个周期的预付价值。
    // price 是每周期价格(后端 Client model + 自动续费逻辑已确认),所以剩余价值要按周期数放大
    const summary = calculateCostSummary(
      [node({ price: 10, currency: "USD", billing_cycle: 30, expired_at: inDays(360) })],
      [],
      RATES,
    );
    expect(summary.paidCount).toBe(1);
    // 70 CNY/周期 × (360 天 / 30 天) ≈ 840 CNY
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
    // 防回归:永不过期的节点(Go 零值时间 / 0 / -1 / 未设置)以前会被当成已过期,
    // 导致其预付价值被完全从剩余价值里漏掉
    for (const sentinel of ["0001-01-01T00:00:00Z", "0", "-1", ""]) {
      const summary = calculateCostSummary(
        [node({ price: 10, currency: "USD", billing_cycle: 30, expired_at: sentinel })],
        [],
        RATES,
      );
      expect(summary.paidCount).toBe(1);
      // 10 USD × 7 = 70 CNY = 一个周期的价值(和 >100 年的长期节点一致)
      expect(summary.remainingCny).toBeCloseTo(70, 5);
    }
  });

  it("treats an unset currency as the target currency (CNY), not USD", () => {
    // 防回归:空 currency 以前默认按 USD 算,会把 CNY 定价的节点放大约 7 倍
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
    // 月付:70/月;年付:840/年 = 70/月 → 合计 140/月 → 1680/年
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

  it("normalizeCostRateApiUrl rejects non-http(s) values", () => {
    expect(normalizeCostRateApiUrl("ftp://example.com")).toBe(DEFAULT_COST_RATE_API_URL);
    expect(normalizeCostRateApiUrl("not a url")).toBe(DEFAULT_COST_RATE_API_URL);
    expect(normalizeCostRateApiUrl("javascript:alert(1)")).toBe(DEFAULT_COST_RATE_API_URL);
  });

  it("isCostRateApiUrlValid accepts only http(s)", () => {
    expect(isCostRateApiUrlValid("https://api.example.com/rates")).toBe(true);
    expect(isCostRateApiUrlValid("http://localhost:8080")).toBe(true);
    expect(isCostRateApiUrlValid("ftp://example.com")).toBe(false);
    expect(isCostRateApiUrlValid("garbage")).toBe(false);
  });

  it("formatCnyMoney guards NaN and formats two decimals", () => {
    expect(formatCnyMoney(1234.5)).toBe("¥ 1,234.50");
    expect(formatCnyMoney(Number.NaN)).toBe("¥ 0.00");
  });
});
