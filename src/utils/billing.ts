import { getExpireDaysRemaining, LONG_TERM_EXPIRE_DAYS } from "@/utils/format";

const INT_PRICE_FORMATTER = new Intl.NumberFormat("zh-CN", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});
const DECIMAL_PRICE_FORMATTER = new Intl.NumberFormat("zh-CN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatPriceNumber(value: number) {
  return (Number.isInteger(value) ? INT_PRICE_FORMATTER : DECIMAL_PRICE_FORMATTER).format(value);
}

function isLongTermExpire(value: string | number | null | undefined) {
  if (value == null) return false;
  const days = getExpireDaysRemaining(value);
  return days != null && days > LONG_TERM_EXPIRE_DAYS;
}

export type BillingCycleKind = "month" | "quarter" | "halfYear" | "year" | "lifetime";

/**
 * Classify a free-text billing-cycle keyword (must be pre-lowercased/trimmed)
 * into a canonical cycle, or null when it isn't a recognized word. Shared by the
 * label formatter here and the day-count resolver in utils/cost.ts so the regex
 * set lives in exactly one place.
 */
export function classifyBillingCycleWord(normalized: string): BillingCycleKind | null {
  if (/^(monthly|month|mo|月|每月)$/.test(normalized)) return "month";
  if (/^(quarterly|quarter|季|季度|每季)$/.test(normalized)) return "quarter";
  if (/^(semiannual|semi-annually|halfyear|half-year|半年)$/.test(normalized)) return "halfYear";
  if (/^(annual|annually|yearly|year|yr|年|每年)$/.test(normalized)) return "year";
  if (/^(lifetime|once|one-time|永久|一次性)$/.test(normalized)) return "lifetime";
  return null;
}

export function formatBillingCycle(value: string | number | null | undefined) {
  const raw = String(value ?? "").trim();
  const numeric = Number(raw);
  // Only treat as a day-count when the source is a real, non-empty number.
  // `Number("")` is 0 (finite), which previously rendered "0天" for unset cycles.
  if (raw !== "" && Number.isFinite(numeric)) {
    if (numeric === -1) return "永久";
    if (numeric === 30) return "月";
    if (numeric === 90) return "季";
    if (numeric === 180) return "半年";
    if (numeric === 365 || numeric === 360) return "年";
    if (numeric > 0 && numeric % 365 === 0) return `${numeric / 365}年`;
    if (numeric > 0) return `${numeric}天`;
    // numeric <= 0 (e.g. 0) falls through to the label fallback below.
  }

  switch (classifyBillingCycleWord(raw.toLowerCase())) {
    case "month":
      return "月";
    case "quarter":
      return "季";
    case "halfYear":
      return "半年";
    case "lifetime":
      return "永久";
    case "year":
    default:
      return "年";
  }
}

export function formatRenewalPrice({
  price,
  currency,
  billing_cycle,
  expired_at,
}: {
  price: number;
  currency: string;
  billing_cycle?: string | number | null;
  expired_at?: string | number | null;
}) {
  if (!Number.isFinite(price)) return null;
  if (price === -1) return "免费";
  if (price === 0) return isLongTermExpire(expired_at) ? "免费" : null;
  if (price < 0) return null;

  const symbol = currency?.trim() || "¥";
  const cycle = formatBillingCycle(billing_cycle);
  return `${symbol}${formatPriceNumber(price)}/${cycle}`;
}
