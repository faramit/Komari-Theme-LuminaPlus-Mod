import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  formatBytes,
  formatByteRate,
  formatByteRateLabel,
  formatExpireDays,
  formatOfflineDuration,
  formatTrafficRate,
  formatTrafficRateLabel,
  getExpireDaysRemaining,
  parseTags,
  resolveExpireTimestamp,
} from "@/utils/format";

const KB = 1024;
const MB = 1024 * 1024;
const GB = 1024 * 1024 * 1024;

describe("formatBytes", () => {
  it("returns '0 B' for empty / non-positive / non-finite input", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(null)).toBe("0 B");
    expect(formatBytes(undefined)).toBe("0 B");
    expect(formatBytes(-5)).toBe("0 B");
    expect(formatBytes(Number.NaN)).toBe("0 B");
    // Regression guard: Infinity must not produce "Infinity PB".
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe("0 B");
  });

  it("rounds raw bytes with no decimals", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1023)).toBe("1023 B");
  });

  it("scales up and adapts precision by magnitude", () => {
    expect(formatBytes(KB)).toBe("1.00 KB");
    expect(formatBytes(1.5 * KB)).toBe("1.50 KB");
    expect(formatBytes(MB)).toBe("1.00 MB");
    expect(formatBytes(100 * MB)).toBe("100 MB");
    expect(formatBytes(2.5 * GB)).toBe("2.50 GB");
  });
});

describe("formatTrafficRate", () => {
  it("returns a zeroed bps display for non-positive / non-finite input", () => {
    expect(formatTrafficRate(0)).toEqual({ value: "0", unit: "bps", bitsPerSec: 0 });
    expect(formatTrafficRate(null)).toEqual({ value: "0", unit: "bps", bitsPerSec: 0 });
    expect(formatTrafficRate(Number.POSITIVE_INFINITY)).toEqual({
      value: "0",
      unit: "bps",
      bitsPerSec: 0,
    });
  });

  it("converts bytes/sec to bit-rate units", () => {
    // 1 MB/s = 8 Mbps
    expect(formatTrafficRateLabel(1_000_000)).toBe("8 Mbps");
    // 125 MB/s = 1 Gbps
    expect(formatTrafficRateLabel(125_000_000)).toBe("1 Gbps");
  });
});

describe("formatByteRate / formatByteRateLabel", () => {
  it("returns a zeroed B/s display for non-positive / non-finite input", () => {
    expect(formatByteRate(0)).toEqual({ value: "0", unit: "B/s" });
    expect(formatByteRate(null)).toEqual({ value: "0", unit: "B/s" });
    expect(formatByteRate(Number.POSITIVE_INFINITY)).toEqual({ value: "0", unit: "B/s" });
  });

  it("uses the byte (1024) ladder suffixed with /s", () => {
    expect(formatByteRate(512)).toEqual({ value: "512", unit: "B/s" });
    expect(formatByteRateLabel(KB)).toBe("1.00 KB/s");
    expect(formatByteRateLabel(MB)).toBe("1.00 MB/s");
    expect(formatByteRateLabel(2.5 * GB)).toBe("2.50 GB/s");
  });
});

describe("getExpireDaysRemaining / formatExpireDays", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-13T12:00:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function inDays(days: number, extraHours = 0) {
    const ts = Date.now() + days * 86_400_000 + extraHours * 3_600_000;
    return new Date(ts).toISOString();
  }

  it("returns null for missing / unparseable input", () => {
    expect(getExpireDaysRemaining(null)).toBeNull();
    expect(getExpireDaysRemaining("not-a-date")).toBeNull();
    expect(formatExpireDays(null)).toEqual({ value: "—", unit: "", tone: "none" });
  });

  it("treats Komari 'no expiry' sentinels as no-expiry, not as 已过期", () => {
    // Regression: the Go zero-time and numeric 0 / -1 sentinels used to parse to
    // year 1 / 2000 / 2001 and render never-expiring nodes "已过期".
    for (const sentinel of ["0001-01-01T00:00:00Z", "0", "-1", ""]) {
      expect(getExpireDaysRemaining(sentinel)).toBeNull();
      expect(formatExpireDays(sentinel)).toEqual({ value: "—", unit: "", tone: "none" });
    }
  });

  it("reads a bare positive number as a unix timestamp (seconds or ms)", () => {
    const secs = Math.floor((Date.now() + 10 * 86_400_000) / 1000);
    expect(getExpireDaysRemaining(String(secs))).toBe(10);
    const ms = Date.now() + 5 * 86_400_000;
    expect(getExpireDaysRemaining(String(ms))).toBe(5);
    // Sentinels resolve to "no timestamp".
    expect(resolveExpireTimestamp("0001-01-01T00:00:00Z")).toBeNull();
    expect(resolveExpireTimestamp(0)).toBeNull();
    expect(resolveExpireTimestamp(-1)).toBeNull();
  });

  it("maps day buckets to tones", () => {
    expect(formatExpireDays(inDays(60))).toEqual({ value: "60", unit: "天", tone: "ok" });
    expect(formatExpireDays(inDays(15))).toEqual({ value: "15", unit: "天", tone: "warn" });
    expect(formatExpireDays(inDays(3))).toEqual({ value: "3", unit: "天", tone: "critical" });
  });

  it("treats >100y as a long-term purchase", () => {
    expect(formatExpireDays(inDays(40_000))).toEqual({ value: "长期", unit: "", tone: "long" });
  });

  it("handles the today / expired boundary", () => {
    // ~1h in the future floors to 0 remaining days.
    expect(formatExpireDays(inDays(0, 1))).toEqual({ value: "今日", unit: "", tone: "critical" });
    // already past
    expect(formatExpireDays(inDays(-2))).toEqual({ value: "已过期", unit: "", tone: "critical" });
  });
});

describe("formatOfflineDuration", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-13T12:00:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns unknown sentinel for invalid timestamps", () => {
    expect(formatOfflineDuration(0)).toEqual({ value: "未知", unit: "", full: "离线时长未知" });
    expect(formatOfflineDuration(null)).toEqual({ value: "未知", unit: "", full: "离线时长未知" });
  });

  it("buckets elapsed time into minutes / hours / days", () => {
    expect(formatOfflineDuration(Date.now() - 30_000).value).toBe("刚刚");
    expect(formatOfflineDuration(Date.now() - 5 * 60_000)).toMatchObject({ value: "5", unit: "分钟" });
    expect(formatOfflineDuration(Date.now() - 3 * 3_600_000)).toMatchObject({ value: "3", unit: "小时" });
    expect(formatOfflineDuration(Date.now() - 2 * 86_400_000)).toMatchObject({ value: "2", unit: "天" });
  });
});

describe("parseTags", () => {
  it("returns [] for empty input", () => {
    expect(parseTags(null)).toEqual([]);
    expect(parseTags("")).toEqual([]);
  });

  it("parses explicit <color> suffixes and lowercases them", () => {
    expect(parseTags("VIP<RED>;Pro<Blue>")).toEqual([
      { label: "VIP", color: "red" },
      { label: "Pro", color: "blue" },
    ]);
  });

  it("infers colors for plain tags by known keywords", () => {
    expect(parseTags("CN2GIA")).toEqual([{ label: "CN2GIA", color: "blue" }]);
    expect(parseTags("4837")).toEqual([{ label: "4837", color: "green" }]);
    expect(parseTags("Random")).toEqual([{ label: "Random", color: "violet" }]);
  });
});
