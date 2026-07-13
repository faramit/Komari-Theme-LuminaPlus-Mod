import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import "uplot/dist/uPlot.min.css";
import { InstanceDetails } from "@/components/instance/InstanceDetails";
import { PingChart } from "@/components/instance/PingChart";
import { LoadChart } from "@/components/instance/LoadChart";
import {
  buildLoadTimeRangeOptions,
  buildPingTimeRangeOptions,
} from "@/components/instance/chartShared";
import { usePublicConfig } from "@/hooks/usePublicConfig";
import { useThemeSettings } from "@/hooks/useThemeSettings";

const DEFAULT_PING_HOURS = 4;

function resolveRetentionHours(
  metricRetentionDays: number | null | undefined,
  oldRecordHours: number | undefined,
): number | undefined {
  if (typeof metricRetentionDays === "number" && metricRetentionDays > 0) {
    return metricRetentionDays * 24;
  }
  return oldRecordHours && oldRecordHours > 0 ? oldRecordHours : undefined;
}

export function Instance() {
  const { uuid } = useParams<{ uuid: string }>();
  const { data: config } = usePublicConfig();
  const themeSettings = useThemeSettings();
  const [chartType, setChartType] = useState<"load" | "ping">("load");
  const [loadHours, setLoadHours] = useState(0);
  const [pingHours, setPingHours] = useState(DEFAULT_PING_HOURS);
  const chartControlsRef = useRef<HTMLDivElement | null>(null);

  const retentionHours = useMemo(
    () => resolveRetentionHours(config?.metric_retention_days, config?.record_preserve_time),
    [config?.metric_retention_days, config?.record_preserve_time],
  );
  const pingRetentionHours = useMemo(
    () => resolveRetentionHours(config?.metric_retention_days, config?.ping_record_preserve_time),
    [config?.metric_retention_days, config?.ping_record_preserve_time],
  );

  const loadRanges = useMemo(
    () => buildLoadTimeRangeOptions(retentionHours),
    [retentionHours],
  );
  const pingRanges = useMemo(
    () => buildPingTimeRangeOptions(pingRetentionHours),
    [pingRetentionHours],
  );
  const showPingChart = themeSettings.isReady && themeSettings.showPingChart;

  // 身份稳定:只读 ref,所以空依赖是安全的。它作为 onNodeReady 传给
  // InstanceDetails 的 effect;若身份不稳定,父组件每次重渲染都会取消挂起的 rAF
  // 又不重新调度,导致这次性的 scroll-into-view 丢失。
  const alignCharts = useCallback(() => {
    const frame = window.requestAnimationFrame(() => {
      const element = chartControlsRef.current;
      if (!element) return;
      // 只在图表控件不在视口内时才滚动过去,避免用户已经看着这块区域时,
      // 每次 mount/onNodeReady 都把视口猛地拽走。
      const rect = element.getBoundingClientRect();
      if (rect.top >= 0 && rect.top < window.innerHeight) return;
      element.scrollIntoView({ behavior: "auto", block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    return alignCharts();
  }, [alignCharts, uuid]);

  useEffect(() => {
    if (!loadRanges.some((range) => range.value === loadHours)) {
      setLoadHours(loadRanges[0]?.value ?? 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadRanges]);

  useEffect(() => {
    if (!pingRanges.some((range) => range.value === pingHours)) {
      setPingHours(
        pingRanges.find((range) => range.value === DEFAULT_PING_HOURS)?.value ??
          pingRanges[0]?.value ??
          DEFAULT_PING_HOURS,
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pingRanges]);

  useEffect(() => {
    if (!showPingChart && chartType === "ping") {
      setChartType("load");
    }
  }, [chartType, showPingChart]);

  if (!uuid) return null;

  return (
    <div className="flex flex-col gap-5 py-2">
      <Link
        to="/"
        className="instance-page-back"
      >
        <ChevronLeft size={14} />
        返回
      </Link>
      <InstanceDetails uuid={uuid} onNodeReady={alignCharts} />
      <div ref={chartControlsRef} className="instance-chart-controls">
        <div className="instance-segmented">
          <button
            type="button"
            data-active={chartType === "load" ? "true" : "false"}
            aria-pressed={chartType === "load"}
            onClick={() => {
              startTransition(() => setChartType("load"));
            }}
          >
            负载
          </button>
          {showPingChart && (
            <button
              type="button"
              data-active={chartType === "ping" ? "true" : "false"}
              aria-pressed={chartType === "ping"}
              onClick={() => {
                startTransition(() => setChartType("ping"));
              }}
            >
              Ping
            </button>
          )}
        </div>
        {chartType === "load" && (
          <div
            key={`${chartType}-ranges`}
            className="instance-segmented is-scrollable"
          >
            {loadRanges.map((range) => (
              <button
                key={range.value}
                type="button"
                data-active={loadHours === range.value ? "true" : "false"}
                aria-pressed={loadHours === range.value}
                onClick={() => {
                  startTransition(() => {
                    setLoadHours(range.value);
                  });
                }}
              >
                {range.label}
              </button>
            ))}
          </div>
        )}
        {chartType === "ping" && showPingChart && (
          <div
            key={`${chartType}-ranges`}
            className="instance-segmented is-scrollable"
          >
            {pingRanges.map((range) => (
              <button
                key={range.value}
                type="button"
                data-active={pingHours === range.value ? "true" : "false"}
                aria-pressed={pingHours === range.value}
                onClick={() => {
                  startTransition(() => {
                    setPingHours(range.value);
                  });
                }}
              >
                {range.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="instance-chart-stage">
        <div
          className="instance-chart-view"
          hidden={chartType !== "load"}
          aria-hidden={chartType !== "load"}
        >
          <LoadChart uuid={uuid} hours={loadHours} active={chartType === "load"} />
        </div>
        <div
          className="instance-chart-view"
          hidden={chartType !== "ping"}
          aria-hidden={chartType !== "ping"}
        >
          {showPingChart ? (
            <PingChart
              uuid={uuid}
              hours={pingHours}
              active={chartType === "ping"}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
