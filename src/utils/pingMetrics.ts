import type { PingRecord, PingTask, PingTaskStats } from "@/types/komari";

export const PING_LATENCY_METRIC = "ping.latency_ms";
export const PING_LOSS_METRIC = "ping.loss";

export interface PingMetricPoint {
  time: string;
  value: number | null;
  count: number;
}

export interface PingMetricSeries {
  metricKey: string;
  client: string;
  tags: Record<string, string>;
  points: PingMetricPoint[];
}

function parseTaskId(tags: Record<string, string>) {
  const parsed = Number.parseInt(tags.task_id ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function seriesKey(client: string, taskId: number) {
  return `${client}\u0000${taskId}`;
}

function pointTimeKey(time: string) {
  const timestamp = Date.parse(time);
  return Number.isFinite(timestamp) ? String(timestamp) : time;
}

export function resolvePingSampleCounts(
  sample: Pick<PingRecord, "value" | "count" | "loss">,
) {
  const total =
    typeof sample.count === "number" && Number.isFinite(sample.count) && sample.count > 0
      ? Math.max(1, Math.round(sample.count))
      : 1;
  const reportedLoss = sample.loss;
  const lost =
    typeof reportedLoss === "number" && Number.isFinite(reportedLoss)
      ? Math.min(total, Math.max(0, Math.round((reportedLoss / 100) * total)))
      : sample.value < 0
        ? total
        : 0;
  return { total, lost, valid: total - lost };
}

export function resolvePingChartInterval(
  metricIntervalSeconds: number | null | undefined,
  taskIntervalSeconds: number | null | undefined,
  fallbackSeconds = 60,
) {
  for (const value of [metricIntervalSeconds, taskIntervalSeconds, fallbackSeconds]) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return value;
    }
  }
  return 60;
}

export function mergePingMetricSeries(series: PingMetricSeries[]): PingRecord[] {
  const lossSeries = new Map<string, PingMetricSeries>();
  for (const item of series) {
    if (item.metricKey !== PING_LOSS_METRIC) continue;
    const taskId = parseTaskId(item.tags);
    if (taskId == null || !item.client) continue;
    lossSeries.set(seriesKey(item.client, taskId), item);
  }

  const records: PingRecord[] = [];
  for (const latency of series) {
    if (latency.metricKey !== PING_LATENCY_METRIC) continue;
    const taskId = parseTaskId(latency.tags);
    if (taskId == null || !latency.client) continue;

    const matchingLoss = lossSeries.get(seriesKey(latency.client, taskId));
    const lossByTime = new Map(
      (matchingLoss?.points ?? []).map((point) => [pointTimeKey(point.time), point] as const),
    );

    for (const point of latency.points) {
      const lossPoint = lossByTime.get(pointTimeKey(point.time));
      const total = Math.max(point.count, lossPoint?.count ?? 0);
      if (total <= 0) continue;

      const fallbackLossRatio = point.value != null && point.value < 0 ? 1 : 0;
      const lossRatio = Math.max(
        0,
        Math.min(1, lossPoint?.value ?? fallbackLossRatio),
      );
      const lost = Math.min(total, Math.max(0, Math.round(lossRatio * total)));
      const valid = total - lost;

      let value: number;
      if (valid <= 0) {
        value = -1;
      } else if (point.value == null) {
        continue;
      } else if (lost > 0) {
        value = (point.value * total + lost) / valid;
      } else {
        value = point.value;
      }

      records.push({
        task_id: taskId,
        time: point.time,
        value,
        client: latency.client,
        count: total,
        loss: lossRatio * 100,
      });
    }
  }

  records.sort((left, right) => {
    const timeDiff = Date.parse(String(left.time)) - Date.parse(String(right.time));
    if (Number.isFinite(timeDiff) && timeDiff !== 0) return timeDiff;
    if (left.client !== right.client) return left.client.localeCompare(right.client);
    return left.task_id - right.task_id;
  });
  return records;
}

export function pingTasksFromMetricStats(stats: PingTaskStats[]): PingTask[] {
  const tasks = new Map<number, PingTask>();
  for (const stat of stats) {
    const existing = tasks.get(stat.taskId);
    if (existing) {
      if (stat.client && !existing.clients.includes(stat.client)) {
        existing.clients.push(stat.client);
      }
      continue;
    }
    tasks.set(stat.taskId, {
      id: stat.taskId,
      interval: stat.interval || 60,
      name: stat.name || `任务 #${stat.taskId}`,
      loss: stat.loss,
      clients: stat.client ? [stat.client] : [],
      type: stat.type || "icmp",
      target: "",
      weight: stat.taskId,
    });
  }
  return [...tasks.values()].sort((left, right) => left.id - right.id);
}
