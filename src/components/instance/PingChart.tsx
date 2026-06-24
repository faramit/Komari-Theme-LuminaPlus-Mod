import { useEffect, useMemo, useRef, useState } from "react";
import UplotReact from "uplot-react";
import type uPlot from "uplot";
import { Eye, EyeOff, RefreshCw } from "lucide-react";
import { usePingRecords } from "@/hooks/useRecords";
import { InstancePanel, InstanceChartLoading } from "./InstancePanel";
import {
  buildChartTooltipHooks,
  colorForSeries,
  createTimeAxisFormatter,
  getAxisColors,
  toChartSeconds,
  useResponsiveChartSize,
  type ChartTooltipState,
} from "./chartShared";
import {
  cutPeakValues,
  detectTypicalIntervalSeconds,
  insertMetricGapSentinels,
} from "./chartData";
import { latencyHeatColor, lossHeatColor } from "@/utils/metricTone";
import { usePreferences } from "@/hooks/usePreferences";
import type { PingRecord } from "@/types/komari";
import type { TimedMetricPoint } from "./chartData";

// 调用方传入已升序排好的数组，min/max/p50/p99 共用一次排序，不必重排（也避免
// `Math.min(...values)`——展开大数组会抛 RangeError）。
function percentileFromSorted(sorted: number[], ratio: number) {
  if (sorted.length === 0) return null;
  const index = (sorted.length - 1) * ratio;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  const weight = index - lower;
  return sorted[lower] + (sorted[upper] - sorted[lower]) * weight;
}

export function PingChart({
  uuid,
  hours,
  active = true,
}: {
  uuid: string;
  hours: number;
  active?: boolean;
}) {
  const { data, isLoading, refetch } = usePingRecords(uuid, hours, active);
  const { resolvedAppearance } = usePreferences();
  const { w, h, ref: chartSizeRef } = useResponsiveChartSize("wide");
  const [hiddenTasks, setHiddenTasks] = useState<Set<number>>(new Set());
  const [connectNulls, setConnectNulls] = useState(false);
  const [cutPeak, setCutPeak] = useState(false);
  const chartRef = useRef<uPlot.AlignedData>([[]]);
  const [tooltip, setTooltip] = useState<ChartTooltipState>({
    show: false,
    left: 0,
    top: 0,
    rows: [],
    time: "",
  });
  const isDark = resolvedAppearance === "dark";
  const tasks = useMemo(() => [...(data?.tasks ?? [])].sort((a, b) => a.id - b.id), [data]);
  const taskLabels = useMemo(() => {
    const counts = new Map<string, number>();
    for (const task of tasks) {
      const label = task.name || `任务 #${task.id}`;
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return new Map(
      tasks.map((task) => {
        const baseLabel = task.name || `任务 #${task.id}`;
        const label = (counts.get(baseLabel) ?? 0) > 1 ? `${baseLabel} #${task.id}` : baseLabel;
        return [task.id, label] as const;
      }),
    );
  }, [tasks]);
  const taskColors = useMemo(
    () => new Map(tasks.map((task, index) => [task.id, colorForSeries(index)] as const)),
    [tasks],
  );
  const taskKeySet = useMemo(() => new Set(tasks.map((task) => String(task.id))), [tasks]);
  const taskKeys = useMemo(() => tasks.map((task) => String(task.id)), [tasks]);
  const taskIndexById = useMemo(
    () => new Map(tasks.map((task, index) => [task.id, index] as const)),
    [tasks],
  );
  const visibleTasks = useMemo(
    () => tasks.filter((task) => !hiddenTasks.has(task.id)),
    [hiddenTasks, tasks],
  );
  const visibleTaskIds = useMemo(
    () => new Set(visibleTasks.map((task) => task.id)),
    [visibleTasks],
  );

  useEffect(() => {
    setHiddenTasks(new Set());
  }, [uuid]);

  useEffect(() => {
    setHiddenTasks((prev) => {
      const validTaskIds = new Set(tasks.map((task) => task.id));
      const next = new Set([...prev].filter((taskId) => validTaskIds.has(taskId)));
      return next.size === prev.size ? prev : next;
    });
  }, [tasks]);

  const chart = useMemo(() => {
    // 为每个 task 构建完整的对齐序列。显隐通过每条 series 的 `show` 标志 (以及渲染门控)
    // 实现，所以切换某条线不会重跑这套分桶流程。
    if (!data?.records.length || !tasks.length) return null;
    const pointMap = new Map<number, TimedMetricPoint>();
    const sortedRecords = data.records
      .map((record) => ({
        record,
        time: toChartSeconds(record.time),
      }))
      .filter(({ time }) => time > 0)
      .sort((left, right) => left.time - right.time);
    const taskIntervals = tasks
      .map((task) => task.interval)
      .filter((value): value is number => typeof value === "number" && value > 0);
    const fallbackInterval = taskIntervals.length > 0
      ? Math.min(...taskIntervals)
      : detectTypicalIntervalSeconds(sortedRecords.map(({ time }) => time), 60);
    const tolerance = Math.min(6, Math.max(0.8, fallbackInterval * 0.25));

    // records 已按时间排序，且 anchor 之间间距总是大于 `tolerance` (只有当现有 anchor 都不
    // 在容差内才会新建)，所以一条 record 至多匹配一个 anchor，且必为最近的那个。这样就是 O(n)
    // 合并，而非原来的 O(records × anchors)。
    let lastAnchor = Number.NEGATIVE_INFINITY;
    for (const { record, time } of sortedRecords) {
      if (!taskKeySet.has(String(record.task_id))) continue;
      const anchor = time - lastAnchor <= tolerance ? lastAnchor : time;
      if (anchor === time) lastAnchor = time;
      const current = pointMap.get(anchor) ?? { time: anchor };
      current[String(record.task_id)] = record.value > 0 ? record.value : null;
      pointMap.set(anchor, current);
    }

    let chartPoints = [...pointMap.values()].sort((a, b) => a.time - b.time);
    if (cutPeak && taskKeys.length > 0) {
      chartPoints = cutPeakValues(chartPoints, taskKeys);
    }
    chartPoints = insertMetricGapSentinels(chartPoints, {
      intervals: new Map(
        tasks
          .filter((task) => typeof task.interval === "number" && task.interval > 0)
          .map((task) => [String(task.id), task.interval] as const),
      ),
      defaultInterval: fallbackInterval,
      matchToleranceRatio: 0.25,
    });
    const times = chartPoints.map((point) => point.time);
    // 让 undefined (off-phase anchor) 和 null (真实丢包/断点) 保持区分：uPlot 会跨过前者、
    // 在后者断开。这里若合并成 null，正是当初把多 task 线条切碎成空的原因。
    const perTask = taskKeys.map((taskKey) =>
      chartPoints.map((point) => point[taskKey]),
    );

    return [times, ...perTask] as uPlot.AlignedData;
  }, [cutPeak, data, taskKeySet, taskKeys, tasks]);

  useEffect(() => {
    if (chart) chartRef.current = chart;
  }, [chart]);

  const yRange = useMemo<[number | null, number | null]>(() => {
    if (!chart) return [null, null];
    // 单次遍历求 min/max——避免分配扁平化的值数组，也避免 `Math.min(...values)` 展开
    // (大数组会抛 RangeError)。
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < tasks.length; index += 1) {
      if (!visibleTaskIds.has(tasks[index].id)) continue;
      const series = chart[index + 1] as Array<number | null | undefined> | undefined;
      if (!series) continue;
      for (const value of series) {
        if (typeof value === "number" && Number.isFinite(value) && value > 0) {
          if (value < min) min = value;
          if (value > max) max = value;
        }
      }
    }
    if (min === Number.POSITIVE_INFINITY) return [0, 100];
    if (min === max) {
      const pad = Math.max(5, min * 0.1);
      return [Math.max(0, min - pad), max + pad];
    }
    const pad = Math.max(5, (max - min) * 0.12);
    return [Math.max(0, min - pad), max + pad];
  }, [chart, tasks, visibleTaskIds]);

  // 除 width/height 外的全部配置。uplot-react 会剥掉 width/height，当两次渲染只有它们不同时
  // 调 u.setSize() 而非重建 chart。让其余配置在 resize 间保持引用稳定，拖拽改尺寸就只是廉价的
  // setSize 调用而非整体拆建。(显隐/范围变化仍会重建——那种情况少且是点击触发。)
  const baseOptions = useMemo<Omit<uPlot.Options, "width" | "height"> | null>(() => {
    if (!chart) return null;
    const { grid, text } = getAxisColors(isDark);
    const tooltipHooks = buildChartTooltipHooks({
      dataRef: chartRef,
      rangeHours: hours,
      estimatedWidth: 196,
      setTooltip,
      buildRows: (idx) =>
        visibleTasks.map((task) => {
          const taskIndex = taskIndexById.get(task.id) ?? 0;
          const value = chartRef.current[taskIndex + 1]?.[idx] as number | null | undefined;
          return {
            label: taskLabels.get(task.id) ?? `任务 #${task.id}`,
            value: value == null ? "—" : `${value.toFixed(1)} ms`,
            color: taskColors.get(task.id) ?? colorForSeries(taskIndex),
          };
        }),
    });
    return {
      padding: [10, 14, 12, 2],
      cursor: { drag: { x: true, y: false } },
      legend: { show: false },
      scales: {
        x: { time: true },
        y: { auto: false, range: yRange },
      },
      axes: [
        {
          stroke: text,
          grid: { stroke: grid, width: 1 },
          ticks: { stroke: grid },
          size: 36,
          values: createTimeAxisFormatter(hours),
        },
        {
          stroke: text,
          grid: { stroke: grid, width: 1 },
          ticks: { stroke: grid },
          size: 54,
          values: (_self, splits) => splits.map((value) => (value === 0 ? "" : `${Math.round(value)} ms`)),
        },
      ],
      series: [
        { label: "time" },
        ...tasks.map((task, index) => ({
          label: taskLabels.get(task.id) ?? `任务 #${task.id}`,
          stroke: taskColors.get(task.id) ?? colorForSeries(index),
          width: 1.7,
          spanGaps: connectNulls,
          show: !hiddenTasks.has(task.id),
          points: { show: false },
        })),
      ],
      hooks: {
        init: [tooltipHooks.onInit],
        setCursor: [tooltipHooks.onSetCursor],
      },
    };
  }, [chart, connectNulls, hiddenTasks, hours, isDark, taskColors, taskIndexById, taskLabels, tasks, visibleTasks, yRange]);

  const options = useMemo<uPlot.Options | null>(
    () => (baseOptions ? { ...baseOptions, width: w, height: h } : null),
    [baseOptions, w, h],
  );

  const taskStats = useMemo(() => {
    const grouped = new Map<number, PingRecord[]>();
    for (const record of data?.records ?? []) {
      const bucket = grouped.get(record.task_id);
      if (bucket) bucket.push(record);
      else grouped.set(record.task_id, [record]);
    }

    for (const records of grouped.values()) {
      records.sort((a, b) => toChartSeconds(a.time) - toChartSeconds(b.time));
    }

    return tasks.map((task, index) => {
      const records = grouped.get(task.id) ?? [];
      const positives = records
        .filter((record) => record.value > 0)
        .map((record) => record.value)
        .sort((a, b) => a - b);
      const latest = [...records].reverse().find((record) => record.value > 0)?.value ?? null;
      const avg = positives.length
        ? positives.reduce((sum, value) => sum + value, 0) / positives.length
        : null;
      const min = positives.length ? positives[0] : null;
      const max = positives.length ? positives[positives.length - 1] : null;
      const p50 = percentileFromSorted(positives, 0.5);
      const p99 = percentileFromSorted(positives, 0.99);
      // positives 全部 > 0，所以非 null 的 p50 必然 > 0——旧的 `p50 > 0` 子判断是多余的。
      const volatility = p50 && p99 ? p99 / p50 : null;
      const total = records.length;
      const lost = records.filter((record) => record.value <= 0).length;
      const loss = total > 0 ? (lost / total) * 100 : task.loss;
      return {
        ...task,
        latest,
        avg,
        min,
        max,
        p50,
        p99,
        volatility,
        total,
        lost,
        loss,
        color: taskColors.get(task.id) ?? colorForSeries(index),
      };
    });
  }, [data, taskColors, tasks]);

  const toggleTask = (taskId: number) => {
    setHiddenTasks((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };

  const toggleAll = () => {
    setHiddenTasks((prev) => (prev.size === 0 ? new Set(tasks.map((task) => task.id)) : new Set()));
  };

  if (isLoading) {
    return <InstanceChartLoading title="Ping 图表" />;
  }

  if (!data?.records.length) {
    return (
      <InstancePanel title="Ping 图表">
        <div className="instance-empty">暂无延迟记录</div>
      </InstancePanel>
    );
  }

  return (
    <InstancePanel title="Ping 图表">
      <div className="instance-ping-toolbar">
        <button
          type="button"
          className="instance-toggle-button instance-switch-button"
          data-active={cutPeak ? "true" : "false"}
          onClick={() => setCutPeak((value) => !value)}
          aria-pressed={cutPeak}
          title="对尖峰值做轻度平滑，仅影响图线显示"
        >
          <span className="instance-switch-copy">削峰平滑</span>
          <span className="instance-switch-track" aria-hidden>
            <span className="instance-switch-thumb" />
          </span>
          <span className="instance-switch-state">
            {cutPeak ? "开启" : "关闭"}
          </span>
        </button>
        <button
          type="button"
          className="instance-toggle-button instance-switch-button"
          data-active={connectNulls ? "true" : "false"}
          onClick={() => setConnectNulls((value) => !value)}
          aria-pressed={connectNulls}
        >
          <span className="instance-switch-copy">断点连线</span>
          <span className="instance-switch-track" aria-hidden>
            <span className="instance-switch-thumb" />
          </span>
          <span className="instance-switch-state">
            {connectNulls ? "开启" : "关闭"}
          </span>
        </button>
        <button type="button" className="instance-toggle-button" onClick={toggleAll}>
          {hiddenTasks.size === 0 ? <EyeOff size={14} /> : <Eye size={14} />}
          {hiddenTasks.size === 0 ? "隐藏全部" : "显示全部"}
        </button>
        <button type="button" className="instance-toggle-button" onClick={() => void refetch()}>
          <RefreshCw size={14} />
          刷新
        </button>
      </div>

      <div className="instance-ping-tasks">
        {taskStats.map((task) => {
          const visible = !hiddenTasks.has(task.id);
          return (
            <button
              key={task.id}
              type="button"
              className="instance-ping-task"
              data-visible={visible ? "true" : "false"}
              aria-pressed={visible}
              onClick={() => toggleTask(task.id)}
              style={{ borderColor: visible ? task.color : "var(--border-subtle)" }}
              title={`最小 ${task.min != null ? `${task.min.toFixed(1)} ms` : "—"} | 最大 ${task.max != null ? `${task.max.toFixed(1)} ms` : "—"} | 样本 ${task.total ?? 0} | 间隔 ${task.interval}s`}
            >
              <div className="instance-ping-task-head">
                <span className="instance-ping-task-name">{taskLabels.get(task.id) ?? `任务 #${task.id}`}</span>
                <span
                  className="instance-ping-task-primary"
                  style={{ color: task.latest != null ? latencyHeatColor(task.latest) : "var(--text-tertiary)" }}
                >
                  {task.latest != null ? `${task.latest.toFixed(1)} ms` : "—"}
                </span>
              </div>
              <div className="instance-ping-task-stats">
                <span>均值 {task.avg != null ? `${task.avg.toFixed(1)} ms` : "—"}</span>
                <span style={{ color: lossHeatColor(task.loss) }}>丢包 {task.loss.toFixed(1)}%</span>
                <span>p99 {task.p99 != null ? `${task.p99.toFixed(0)} ms` : "—"}</span>
                <span>抖动 {task.volatility != null ? task.volatility.toFixed(2) : "—"}</span>
              </div>
              <div className="instance-ping-task-meta">
                <span>min {task.min != null ? `${task.min.toFixed(0)} ms` : "—"}</span>
                <span>max {task.max != null ? `${task.max.toFixed(0)} ms` : "—"}</span>
                <span>样本 {task.total ?? 0}</span>
                <span>{task.interval}s</span>
              </div>
            </button>
          );
        })}
      </div>

      <div ref={chartSizeRef} className="instance-uplot-wrap is-large">
        {chart && options && visibleTasks.length > 0 ? (
          <>
            <UplotReact
              // 把 cutPeak/connectNulls 纳入 key:这两个 toggle 改了数据与 y 轴 range,
              // 复用同一 uPlot 实例(resetScales=false)时会卡成空白且关掉也不恢复;
              // 改变 key 强制重建一个干净实例,开关都能正确重绘。
              key={`${uuid}-${hours}-${cutPeak ? "smooth" : "raw"}-${connectNulls ? "span" : "gap"}`}
              options={options}
              data={chart}
              resetScales={false}
            />
            {tooltip.show && (
              <div
                className="instance-chart-tooltip"
                style={{ left: tooltip.left, top: tooltip.top }}
              >
                <div className="instance-chart-tooltip-time">{tooltip.time}</div>
                {tooltip.rows.map((row) => (
                  <div key={`${row.label}-${row.color}`} className="instance-chart-tooltip-row">
                    <span className="instance-chart-tooltip-dot" style={{ background: row.color }} />
                    <span>{row.label}</span>
                    <strong>{row.value}</strong>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="instance-empty">当前已隐藏全部线路，点击上方按钮可恢复显示</div>
        )}
      </div>
    </InstancePanel>
  );
}
