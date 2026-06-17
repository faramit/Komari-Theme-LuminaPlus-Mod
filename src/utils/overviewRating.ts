export type OverviewRatingKind = "traffic" | "bandwidth" | "asset";
export type OverviewRatingStyle = "plain" | "cultivation";

export interface OverviewRating {
  level: 0 | 1 | 2 | 3;
  label: string;
}

const GB = 1024 ** 3;
const MBPS_IN_BYTES_PER_SECOND = 1_000_000 / 8;

export const OVERVIEW_RATING_STYLES: Array<{ value: OverviewRatingStyle; label: string }> = [
  { value: "plain", label: "通用" },
  { value: "cultivation", label: "修仙" },
];

const DEFAULT_LABELS: Record<OverviewRatingKind, Record<OverviewRatingStyle, readonly string[]>> = {
  traffic: {
    plain: ["轻量", "常规", "重度", "海量"],
    cultivation: ["初行", "入道", "御风", "破空"],
  },
  bandwidth: {
    plain: ["闲置", "轻载", "活跃", "爆发"],
    cultivation: ["凝息", "运转", "疾行", "瞬身"],
  },
  asset: {
    plain: ["入门", "标准", "顶级", "富佬"],
    cultivation: ["练气", "筑基", "结丹", "元婴"],
  },
};

export function isOverviewRatingStyle(value: unknown): value is OverviewRatingStyle {
  return value === "plain" || value === "cultivation";
}

export function getDefaultOverviewRatingLabelText(
  kind: OverviewRatingKind,
  style: OverviewRatingStyle,
) {
  return DEFAULT_LABELS[kind][style].join(",");
}

export function normalizeOverviewRatingLabels(
  kind: OverviewRatingKind,
  style: OverviewRatingStyle,
  customLabels: string | null | undefined,
) {
  const fallback = DEFAULT_LABELS[kind][style];
  const custom = String(customLabels ?? "")
    .split(",")
    .map((label) => label.trim())
    .filter(Boolean)
    .slice(0, 4);

  return fallback.map((label, index) => custom[index] ?? label);
}

function levelFromThresholds(value: number, thresholds: readonly [number, number, number]): 0 | 1 | 2 | 3 {
  if (!Number.isFinite(value) || value <= thresholds[0]) return 0;
  if (value <= thresholds[1]) return 1;
  if (value <= thresholds[2]) return 2;
  return 3;
}

export function getOverviewRating({
  kind,
  value,
  style,
  customLabels,
}: {
  kind: OverviewRatingKind;
  value: number;
  style: OverviewRatingStyle;
  customLabels?: string | null;
}): OverviewRating {
  const labels = normalizeOverviewRatingLabels(kind, style, customLabels);
  const level =
    kind === "asset"
      ? levelFromThresholds(value, [500, 1500, 3000])
      : kind === "traffic"
        ? levelFromThresholds(value, [500 * GB, 2000 * GB, 10000 * GB])
        : levelFromThresholds(value, [
            1 * MBPS_IN_BYTES_PER_SECOND,
            10 * MBPS_IN_BYTES_PER_SECOND,
            100 * MBPS_IN_BYTES_PER_SECOND,
          ]);

  return {
    level,
    label: labels[level],
  };
}
