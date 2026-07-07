import { useCallback, type ReactNode } from "react";
import { CanvasStrip, fillRoundedRect, safeCanvasColor } from "./CanvasStrip";

const METRIC_SEGMENT_COUNT = 18;

interface MetricBarProps {
  icon: ReactNode;
  label: string;
  valueText: string;
  unit?: string;
  detailText?: string;
  fraction: number; // 0..1
  redrawKey?: string;
  paint: string; // 填充色 (CSS color)
}

export function MetricBar({
  icon,
  label,
  valueText,
  unit,
  detailText,
  fraction,
  redrawKey,
  paint,
}: MetricBarProps) {
  const clamped = Math.max(0, Math.min(1, fraction));
  const activeSegments = clamped * METRIC_SEGMENT_COUNT;

  // 除非填充比例或配色真正变化,否则跨渲染保持稳定,这样 CanvasStrip 的重绘 effect
  // 不会在父组件每个 metrics tick 都触发。
  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, width: number, height: number) => {
      const inactiveColor = safeCanvasColor("var(--progress-bg)");
      const gap = 2;
      const segmentWidth = Math.max(
        1,
        (width - gap * (METRIC_SEGMENT_COUNT - 1)) / METRIC_SEGMENT_COUNT,
      );
      const activePaint = safeCanvasColor(paint);

      for (let index = 0; index < METRIC_SEGMENT_COUNT; index += 1) {
        const x = index * (segmentWidth + gap);
        const fillLevel = Math.max(0, Math.min(1, activeSegments - index));
        const isActive = fillLevel > 0;

        ctx.globalAlpha = 0.58;
        ctx.fillStyle = inactiveColor;
        fillRoundedRect(ctx, x, 0, segmentWidth, height, 2);

        if (isActive) {
          ctx.globalAlpha = 0.42 + fillLevel * 0.56;
          ctx.fillStyle = activePaint;
          fillRoundedRect(ctx, x, 0, segmentWidth, height, 2);
        }
      }

      ctx.globalAlpha = 1;
    },
    [activeSegments, paint],
  );

  return (
    <div className="metric-item">
      <div className="flex justify-between items-center gap-2 min-w-0">
        <div className="flex items-center gap-1 min-w-0 truncate">
          <span className="flex-shrink-0">{icon}</span>
          <span className="flex-shrink-0 text-[11px] font-medium tracking-[0.02em] text-[var(--text-secondary)]">{label}</span>
          {detailText && (
            <span className="text-[9px] text-[var(--text-tertiary)] truncate min-w-0" title={detailText}>
              {detailText}
            </span>
          )}
        </div>
        <div className="flex-shrink-0 tabular text-[13px] text-[var(--text-primary)] whitespace-nowrap">
          <span className="font-semibold">{valueText}</span>
          {unit && (
            <span className="ml-[1px] text-[11px] text-[var(--text-tertiary)]">{unit}</span>
          )}
        </div>
      </div>
      <div className="metric-track">
        <CanvasStrip
          className="metric-track-canvas"
          height={10}
          ariaHidden
          redrawKey={redrawKey}
          draw={draw}
        />
      </div>
    </div>
  );
}
