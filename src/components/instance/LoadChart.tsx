import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import UplotReact from "uplot-react";
import type uPlot from "uplot";
import { ArrowDown, ArrowUp, Cpu, Gauge, HardDrive, MemoryStick, Network, RefreshCw, Workflow } from "lucide-react";
import { InstancePanel, InstanceChartLoading } from "./InstancePanel";
import {
  buildChartTooltipHooks,
  CHART_PALETTE,
  createTimeAxisFormatter,
  formatChartCoverageTime,
  getAxisColors,
  toChartSeconds,
  useResponsiveChartSize,
  type ChartTooltipState,
} from "./chartShared";
import { ChartTooltip, SwitchToggle } from "./ChartParts";
import { fillMissingTimePoints } from "./chartData";
import { formatBytes, formatTrafficRateLabel } from "@/utils/format";
import { usePreferences } from "@/hooks/usePreferences";
import { getLoadRecords } from "@/services/api";
import { getRpc2Client } from "@/services/rpc2Client";

const REALTIME_POLL_INTERVAL = 3000;
const REALTIME_MAX_RECORDS = 150;

const CPU_KEYS = ["cpu"];
const CPU_COLORS = [CHART_PALETTE.cpu];
const MEMORY_KEYS = ["ram", "swap"];
const MEMORY_COLORS = [CHART_PALETTE.memory, CHART_PALETTE.warning];
const DISK_KEYS = ["disk"];
const DISK_COLORS = [CHART_PALETTE.disk];
const NETWORK_KEYS = ["netIn", "netOut"];
const NETWORK_COLORS = [CHART_PALETTE.success, CHART_PALETTE.cpu];
const CONNECTION_KEYS = ["connections", "udp"];
const CONNECTION_COLORS = [CHART_PALETTE.memory, CHART_PALETTE.cpu];
const PROCESS_KEYS = ["process"];
const PROCESS_COLORS = [CHART_PALETTE.warning];
const SERIES_LABELS: Record<string, string> = {
  cpu: "CPU",
  ram: "内存",
  swap: "Swap",
  disk: "磁盘",
  netIn: "下行",
  netOut: "上行",
  connections: "TCP",
  udp: "UDP",
  process: "进程",
  load: "负载",
};
interface ChartPoint {
  time: number;
  [key: string]: number | null;
}


function metricData(points: ChartPoint[], keys: string[]): uPlot.AlignedData {
  const times = points.map((point) => point.time);
  return [times, ...keys.map((key) => points.map((point) => point[key] ?? null))] as uPlot.AlignedData;
}

function formatRangeSummary(hours: number) {
  if (hours === 0) return "实时";
  if (hours % 24 === 0) return `${hours / 24} 天`;
  return `${hours} 小时`;
}

function getSeriesLabel(key: string) {
  return SERIES_LABELS[key] ?? key;
}

function formatTooltipValue(key: string, value: number | null | undefined, unit: string) {
  if (value == null || !Number.isFinite(value)) return "—";
  if (key === "netIn" || key === "netOut") return formatTrafficRateLabel(value);
  if (unit === "%") return `${value.toFixed(2)}%`;
  if (key === "process" || key === "connections" || key === "udp") return `${Math.round(value)}`;
  return value.toFixed(2);
}

function formatPercentAxisValue(value: number, min: number, max: number) {
  const span = Math.abs(max - min);
  if (span < 0.5) return `${value.toFixed(2)}%`;
  if (span < 5) return `${value.toFixed(1)}%`;
  return `${Math.round(value)}%`;
}

function formatNetworkAxisValue(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "";
  return formatTrafficRateLabel(value);
}

function formatCountAxisValue(value: number, min: number, max: number) {
  const span = Math.abs(max - min);
  if (span < 10) return value.toFixed(1);
  return `${Math.round(value)}`;
}

// 不含尺寸的配置。width/height 由调用方在另一个 memo 里加上，resize 时只改这两个 key，
// uplot-react 就会调 setSize() 而不是重建整个 chart。(用普通函数而非 hook——它不调任何
// hook；之前的 `use` 前缀会触发 rules-of-hooks lint。)
function buildBaseOptions({
  title,
  keys,
  colors,
  unit,
  resolvedAppearance,
  rangeHours,
  spanGaps,
  axisKind = "default",
  axisSize = 52,
}: {
  title: string;
  keys: string[];
  colors: string[];
  unit: string;
  resolvedAppearance: "light" | "dark";
  rangeHours: number;
  spanGaps?: boolean;
  axisKind?: "default" | "percent" | "network" | "count";
  axisSize?: number;
}): Omit<uPlot.Options, "width" | "height"> {
  const isDark = resolvedAppearance === "dark";
  const { grid, text } = getAxisColors(isDark);

  return {
    padding: [8, 12, 10, 2],
    cursor: { drag: { x: true, y: false } },
    legend: { show: false },
    scales: { x: { time: true }, y: { auto: true } },
    axes: [
      {
        stroke: text,
        grid: { stroke: grid, width: 1 },
        ticks: { stroke: grid },
        size: rangeHours >= 72 ? 38 : 34,
        values: createTimeAxisFormatter(rangeHours),
      },
      {
        stroke: text,
        grid: { stroke: grid, width: 1 },
        ticks: { stroke: grid },
        size: axisSize,
        values: (self, splits) => {
          const min = Number(self.scales.y.min ?? 0);
          const max = Number(self.scales.y.max ?? 0);
          return splits.map((value) => {
            if (value === 0 && axisKind !== "percent") return "";
            if (axisKind === "network") return formatNetworkAxisValue(value);
            if (axisKind === "percent") return formatPercentAxisValue(value, min, max);
            if (axisKind === "count") return formatCountAxisValue(value, min, max);
            return value === 0 ? "" : `${Math.round(value)}${unit}`;
          });
        },
      },
    ],
    series: [
      { label: "time" },
      ...keys.map((key, index) => ({
        label: key,
        stroke: colors[index] ?? colors[0],
        fill: index === 0 ? `${colors[index] ?? colors[0]}22` : undefined,
        width: 1.6,
        spanGaps: spanGaps ?? false,
        points: { show: false },
      })),
    ],
    hooks: {
      init: [
        (u) => {
          u.root.setAttribute("aria-label", title);
        },
      ],
    },
  };
}

const ChartCard = memo(function ChartCard({
  icon,
  title,
  value,
  note,
  uuid,
  points,
  keys,
  colors,
  width,
  height,
  resolvedAppearance,
  rangeHours,
  unit = "",
  spanGaps,
  axisKind,
  axisSize,
}: {
  icon: ReactNode;
  title: string;
  value: ReactNode;
  note?: ReactNode;
  uuid: string;
  points: ChartPoint[];
  keys: string[];
  colors: string[];
  width: number;
  height: number;
  resolvedAppearance: "light" | "dark";
  rangeHours: number;
  unit?: string;
  spanGaps?: boolean;
  axisKind?: "default" | "percent" | "network" | "count";
  axisSize?: number;
}) {
  const chartRef = useRef<uPlot | null>(null);
  const dataRef = useRef<uPlot.AlignedData>([[]]);
  const [tooltip, setTooltip] = useState<ChartTooltipState>({
    show: false,
    left: 0,
    top: 0,
    rows: [],
    time: "",
  });
  const data = useMemo(() => metricData(points, keys), [points, keys]);
  useEffect(() => {
    dataRef.current = data;
  }, [data]);
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const times = data[0];
    if (times.length < 2) return;
    chart.setScale("x", { min: times[0], max: times[times.length - 1] });
  }, [data]);
  const baseOptions = useMemo(
    () =>
      buildBaseOptions({
        title,
        keys,
        colors,
        unit,
        resolvedAppearance,
        rangeHours,
        spanGaps,
        axisKind,
        axisSize,
      }),
    [axisKind, axisSize, colors, keys, rangeHours, resolvedAppearance, spanGaps, title, unit],
  );

  // 不含尺寸的增强配置 (base + 交互 hook)。resize 时保持稳定，最终对象上只有 width/height 变。
  const enhancedOptions = useMemo<Omit<uPlot.Options, "width" | "height">>(() => {
    const tooltip = buildChartTooltipHooks({
      dataRef,
      rangeHours,
      estimatedWidth: 176,
      setTooltip,
      buildRows: (idx) =>
        keys.map((key, keyIndex) => ({
          label: getSeriesLabel(key),
          value: formatTooltipValue(
            key,
            dataRef.current[keyIndex + 1]?.[idx] as number | null | undefined,
            unit,
          ),
          color: colors[keyIndex] ?? colors[0],
        })),
    });
    return {
      ...baseOptions,
      hooks: {
        ...baseOptions.hooks,
        init: [...(baseOptions.hooks?.init ?? []), tooltip.onInit],
        setCursor: [tooltip.onSetCursor],
      },
    };
  }, [colors, keys, baseOptions, rangeHours, unit]);

  // resize 时只有这个 memo 变，uplot-react 走 setSize() 而非整个 chart 的拆建重建。
  const chartOptions = useMemo<uPlot.Options>(
    () => ({ ...enhancedOptions, width, height }) as uPlot.Options,
    [enhancedOptions, width, height],
  );

  return (
    <div
      className="instance-chart-card"
      style={{ "--chart-accent": colors[0] } as CSSProperties}
    >
      <header className="instance-chart-card-head">
        <div className="instance-panel-subhead">
          {icon}
          <span>{title}</span>
        </div>
        <div className="instance-series-stats">
          <span className="tabular">{value}</span>
          {note && <span className="tabular text-[var(--text-tertiary)]">{note}</span>}
        </div>
      </header>
      <div className="instance-uplot-wrap">
        <UplotReact
          key={`${uuid}-${rangeHours}`}
          options={chartOptions}
          data={data}
          resetScales={false}
          onCreate={(chart) => { chartRef.current = chart; }}
        />
        <ChartTooltip tooltip={tooltip} />
      </div>
    </div>
  );
});

export function LoadChart({
  uuid,
  hours,
  active = true,
}: {
  uuid: string;
  hours: number;
  active?: boolean;
}) {
  const isRealtime = hours === 0;
  const { resolvedAppearance } = usePreferences();
  const { w, h } = useResponsiveChartSize("grid");
  const [connectNulls, setConnectNulls] = useState(false);

  // Emerald-style data layer
  const [remoteData, setRemoteData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const isInitialLoad = useRef(true);

  useEffect(() => {
    if (!active || !uuid) return;

    setRemoteData([]);
    setError(null);
    isInitialLoad.current = true;

    let cancelled = false;

    const fetchData = async () => {
      if (isRealtime) {
        if (isInitialLoad.current) setLoading(true);
        setError(null);
        try {
          const result = await getRpc2Client().call(
            "common:getNodeRecentStatus",
            { uuid },
          );
          if (cancelled) return;
          const records: any[] = ((result as any)?.records || [])
            .sort((a: any, b: any) => toChartSeconds(a.time) - toChartSeconds(b.time))
            .slice(-REALTIME_MAX_RECORDS);
          setRemoteData(records);
        } catch (err) {
          if (cancelled) return;
          setError(err instanceof Error ? err.message : "获取数据失败");
          setRemoteData([]);
        } finally {
          setLoading(false);
          isInitialLoad.current = false;
        }
      } else {
        setLoading(true);
        setError(null);
        try {
          const result = await getLoadRecords(uuid, hours);
          if (cancelled) return;
          const records: any[] = (result.records || [])
            .sort((a: any, b: any) => toChartSeconds(a.time) - toChartSeconds(b.time));
          setRemoteData(records);
        } catch (err) {
          if (cancelled) return;
          setError(err instanceof Error ? err.message : "获取数据失败");
          setRemoteData([]);
        } finally {
          setLoading(false);
        }
      }
    };

    fetchData();

    if (isRealtime) {
      const timer = setInterval(fetchData, REALTIME_POLL_INTERVAL);
      return () => {
        cancelled = true;
        clearInterval(timer);
      };
    }

    return () => { cancelled = true; };
  }, [uuid, hours, active, isRealtime, refreshKey]);

  const chartData = useMemo<ChartPoint[]>(() => {
    if (!remoteData.length) return [];
    const converted = remoteData
      .filter((r: any) => r.time)
      .map((r: any) => ({
        time: toChartSeconds(r.time),
        cpu: r.cpu ?? null,
        ram: r.ram_total > 0 ? (r.ram / r.ram_total) * 100 : 0,
        swap: r.swap_total > 0 ? (r.swap / r.swap_total) * 100 : 0,
        disk: r.disk_total > 0 ? (r.disk / r.disk_total) * 100 : 0,
        netIn: r.net_in ?? null,
        netOut: r.net_out ?? null,
        connections: r.connections ?? null,
        udp: r.connections_udp ?? null,
        process: r.process ?? null,
        load: r.load ?? null,
      }))
      .sort((a: ChartPoint, b: ChartPoint) => a.time - b.time);
    if (isRealtime) return converted;

    let intervalSec: number;
    let maxGap: number;
    if (hours <= 4) { intervalSec = 60; maxGap = 120; }
    else if (hours > 120) { intervalSec = 3600; maxGap = 7200; }
    else { intervalSec = 900; maxGap = 1800; }

    return fillMissingTimePoints(converted, intervalSec, hours * 3600, maxGap) as ChartPoint[];
  }, [remoteData, isRealtime, hours]);

  const points = chartData;
  const latestRaw = remoteData[remoteData.length - 1] ?? null;

  const rangeSummary = formatRangeSummary(hours);
  const sampleSummary = `${points.length} 个点`;
  const coverageSummary = points.length
    ? `${formatChartCoverageTime(points[0].time)} - ${formatChartCoverageTime(points[points.length - 1].time)}`
    : "—";

  const handleRefresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  if (loading && !isRealtime) {
    return <InstanceChartLoading title="负载图表" />;
  }

  if (error) {
    return (
      <InstancePanel title="负载图表">
        <div className="instance-empty">{error}</div>
      </InstancePanel>
    );
  }

  if (!points.length) {
    return (
      <InstancePanel title="负载图表">
        <div className="instance-empty">{isRealtime ? "等待实时数据..." : "暂无负载历史数据"}</div>
      </InstancePanel>
    );
  }

  return (
    <InstancePanel
      title="负载图表"
      aside={
        <div className="instance-chart-headmeta">
          <div className="instance-chart-meta" aria-label="图表数据范围">
            <span>
              覆盖 <strong>{coverageSummary}</strong>
            </span>
            <span>
              采样 <strong>{sampleSummary}</strong>
            </span>
          </div>
          <SwitchToggle
            label="断点连线"
            active={connectNulls}
            onToggle={() => setConnectNulls((value) => !value)}
          />
          <button type="button" className="instance-toggle-button" onClick={handleRefresh}>
            <RefreshCw size={14} />
            刷新
          </button>
          <span className="instance-chart-range-chip">{rangeSummary}</span>
        </div>
      }
      className="instance-chart-panel"
    >
      <div className="instance-chart-grid">
        <ChartCard
          icon={<Cpu size={13} />}
          title="CPU"
          uuid={uuid}
          value={
            latestRaw?.cpu != null
              ? `${latestRaw.cpu.toFixed(2)}%`
              : "—"
          }
          note="使用率"
          points={points}
          keys={CPU_KEYS}
          colors={CPU_COLORS}
          width={w}
          height={h}
          resolvedAppearance={resolvedAppearance}
          rangeHours={hours}
          unit="%"
          spanGaps={connectNulls}
          axisKind="percent"
        />
        <ChartCard
          icon={<MemoryStick size={13} />}
          title="内存"
          uuid={uuid}
          value={
            latestRaw?.ram != null && latestRaw?.ram_total != null
              ? `${formatBytes(latestRaw.ram)} / ${formatBytes(latestRaw.ram_total)}`
              : "—"
          }
          note={
            latestRaw?.swap_total != null && latestRaw.swap_total > 0
              ? `Swap ${formatBytes(latestRaw.swap)} / ${formatBytes(latestRaw.swap_total)}`
              : "Swap 无"
          }
          points={points}
          keys={MEMORY_KEYS}
          colors={MEMORY_COLORS}
          width={w}
          height={h}
          resolvedAppearance={resolvedAppearance}
          rangeHours={hours}
          unit="%"
          spanGaps={connectNulls}
          axisKind="percent"
        />
        <ChartCard
          icon={<HardDrive size={13} />}
          title="磁盘"
          uuid={uuid}
          value={
            latestRaw?.disk != null && latestRaw?.disk_total != null
              ? `${formatBytes(latestRaw.disk)} / ${formatBytes(latestRaw.disk_total)}`
              : "—"
          }
          note="已用空间"
          points={points}
          keys={DISK_KEYS}
          colors={DISK_COLORS}
          width={w}
          height={h}
          resolvedAppearance={resolvedAppearance}
          rangeHours={hours}
          unit="%"
          spanGaps={connectNulls}
          axisKind="percent"
        />
        <ChartCard
          icon={<Network size={13} />}
          title="网络"
          uuid={uuid}
          value={
            latestRaw?.net_in != null && latestRaw?.net_out != null
              ? `${formatTrafficRateLabel(latestRaw.net_in)} / ${formatTrafficRateLabel(latestRaw.net_out)}`
              : "—"
          }
          note={
            <span className="instance-overview-multi">
              <span className="inline-flex items-center gap-1"><ArrowDown size={11} />{latestRaw?.net_total_down != null ? formatBytes(latestRaw.net_total_down) : "—"}</span>
              <span className="inline-flex items-center gap-1"><ArrowUp size={11} />{latestRaw?.net_total_up != null ? formatBytes(latestRaw.net_total_up) : "—"}</span>
            </span>
          }
          points={points}
          keys={NETWORK_KEYS}
          colors={NETWORK_COLORS}
          width={w}
          height={h}
          resolvedAppearance={resolvedAppearance}
          rangeHours={hours}
          spanGaps={connectNulls}
          axisKind="network"
          axisSize={78}
        />
        <ChartCard
          icon={<Workflow size={13} />}
          title="连接数"
          uuid={uuid}
          value={
            latestRaw?.connections != null && latestRaw?.connections_udp != null
              ? `TCP ${Math.round(latestRaw.connections)} / UDP ${Math.round(latestRaw.connections_udp)}`
              : "—"
          }
          note="连接"
          points={points}
          keys={CONNECTION_KEYS}
          colors={CONNECTION_COLORS}
          width={w}
          height={h}
          resolvedAppearance={resolvedAppearance}
          rangeHours={hours}
          spanGaps={connectNulls}
          axisKind="count"
        />
        <ChartCard
          icon={<Gauge size={13} />}
          title="进程"
          uuid={uuid}
          value={
            latestRaw?.process != null
              ? Math.round(latestRaw.process).toString()
              : "—"
          }
          note={
            latestRaw?.load != null
              ? `负载 ${latestRaw.load.toFixed(2)}`
              : "—"
          }
          points={points}
          keys={PROCESS_KEYS}
          colors={PROCESS_COLORS}
          width={w}
          height={h}
          resolvedAppearance={resolvedAppearance}
          rangeHours={hours}
          spanGaps={connectNulls}
          axisKind="count"
        />
      </div>
    </InstancePanel>
  );
}
