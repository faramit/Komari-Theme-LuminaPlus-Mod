import { useCallback, useMemo } from "react";
import { CanvasStrip, fillRoundedRect, safeCanvasColor } from "./CanvasStrip";
import { getBarGeometry, getBarSlot } from "./nodeCardShared";
import { lossHeatColor } from "@/utils/metricTone";
import type { PingOverviewBucket } from "@/types/komari";

const ACTIVE_BAR_HEIGHT = 0.84;

interface QualityBarsProps {
  /** 聚合后的 ping 分桶(始终是定长窗口)。 */
  buckets: PingOverviewBucket[];
  redrawKey?: string;
  onHoverIndex?: (index: number | null) => void;
}

export function QualityBars({ buckets, redrawKey, onHoverIndex }: QualityBarsProps) {
  const bars = useMemo(
    () =>
      buckets.map((bucket) => {
        const hasBucketValue =
          bucket.loss != null && Number.isFinite(bucket.loss) && bucket.total > 0;
        return {
          active: hasBucketValue,
          index: bucket.index,
          // 在这里(按桶、数据变化时)归一化成 canvas 安全色,而不是每次重绘对每根柱子算。
          tone: safeCanvasColor(hasBucketValue ? lossHeatColor(bucket.loss) : "var(--progress-bg)"),
        };
      }),
    [buckets],
  );

  const getHoverIndex = useCallback(
    (offsetX: number, width: number) => {
      const slot = getBarSlot(offsetX, width, bars.length);
      return slot == null ? null : bars[slot]?.index ?? null;
    },
    [bars],
  );

  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, width: number, height: number) => {
      const inactiveColor = safeCanvasColor("var(--progress-bg)");
      const { gap, barWidth } = getBarGeometry(width, bars.length);
      const barHeight = height * ACTIVE_BAR_HEIGHT;
      const y = height - barHeight;

      bars.forEach(({ active, tone }, index) => {
        const x = index * (barWidth + gap);
        ctx.globalAlpha = active ? 0.94 : 0.42;
        ctx.fillStyle = active ? tone : inactiveColor;
        fillRoundedRect(ctx, x, y, barWidth, barHeight, 2);
      });

      ctx.globalAlpha = 1;
    },
    [bars],
  );

  return (
    <CanvasStrip
      className="mini-bar-row"
      ariaHidden
      height={12}
      redrawKey={redrawKey}
      getHoverIndex={getHoverIndex}
      onHoverIndex={onHoverIndex}
      draw={draw}
    />
  );
}
