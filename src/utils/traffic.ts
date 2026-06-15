// Mirrors the Komari backend's computeUsedByType (utils/notifier/traffic.go):
// the configured traffic-limit threshold is checked against one of these
// reductions of a node's cumulative up/down totals. The backend lower-cases the
// type and falls through to "max" for empty/unknown values (gorm default 'max').
export interface TrafficDisplay {
  /** Used / limit, clamped to 0..1 (0 when unlimited). */
  fraction: number;
  /** Heat color for the bar (green → red as usage climbs). */
  color: string;
  /** "12.4 GB" or "∞" — shown inline next to the label on the large card. */
  remainingLabel: string;
  /** "64.3 GB / 4.00 TB" or "2.73 GB / ∞" — the used/limit line. */
  detail: string;
  /** Human label of the limit type, e.g. "上下取大" — for tooltips. */
  typeLabel: string;
}

function nonNegative(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Compute used traffic from the cumulative up/down totals per the node's
 * `traffic_limit_type`. Default (empty/unknown) is "max", matching the backend.
 */
export function computeTrafficUsed(
  type: string | null | undefined,
  up: number,
  down: number,
): number {
  const safeUp = nonNegative(up);
  const safeDown = nonNegative(down);
  switch ((type ?? "").trim().toLowerCase()) {
    case "up":
      return safeUp;
    case "down":
      return safeDown;
    case "sum":
      return safeUp + safeDown;
    case "min":
      return Math.min(safeUp, safeDown);
    case "max":
    default:
      return Math.max(safeUp, safeDown);
  }
}

export interface TrafficUsage {
  /** Cumulative "used" reduced per traffic_limit_type. */
  used: number;
  limit: number;
  /** True when no positive limit is configured (limit ≤ 0). */
  unlimited: boolean;
  /** max(0, limit − used); 0 when unlimited. */
  remaining: number;
  /** used / limit clamped to 0..1; 0 when unlimited. */
  fraction: number;
}

// Shared traffic model — the single source for used/remaining/fraction consumed by
// both the home cards (useNodeCardModel) and the instance detail page, so the
// traffic_limit_type semantics stay consistent everywhere.
export function resolveTrafficUsage(
  type: string | null | undefined,
  up: number,
  down: number,
  limit: number,
): TrafficUsage {
  const used = computeTrafficUsed(type, up, down);
  const unlimited = !(limit > 0);
  const remaining = unlimited ? 0 : Math.max(0, limit - used);
  const fraction = unlimited ? 0 : Math.max(0, Math.min(1, used / limit));
  return { used, limit, unlimited, remaining, fraction };
}

export function trafficTypeLabel(type: string | null | undefined): string {
  switch ((type ?? "").trim().toLowerCase()) {
    case "up":
      return "仅上行";
    case "down":
      return "仅下行";
    case "sum":
      return "上行+下行";
    case "min":
      return "上下取小";
    case "max":
    default:
      return "上下取大";
  }
}
