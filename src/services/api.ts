import { z } from "zod";
import { getRpc2Client } from "@/services/rpc2Client";
import {
  MeSchema,
  NodeInfoSchema,
  PublicConfigSchema,
  AdminClientSchema,
  LoadRecordSchema,
  PingRecordSchema,
  PingTaskSchema,
  type Me,
  type NodeInfo,
  type PublicConfig,
  type AdminClient,
  type LoadRecordsResponse,
  type PingRecordsResponse,
  type PingTask,
  type PingTaskStats,
} from "@/types/komari";
import { fetchWithTimeout } from "@/utils/abort";
import { inferHistoryIntervalSeconds } from "@/utils/historyRange";
import {
  LOAD_LAST_AGGREGATION,
  LOAD_METRIC_KEYS,
  mergeLoadMetricSeries,
  type LoadMetricSeries,
} from "@/utils/loadMetrics";
import {
  mergePingMetricSeries,
  pingTasksFromMetricStats,
  PING_LATENCY_METRIC,
  PING_LOSS_METRIC,
  type PingMetricSeries,
} from "@/utils/pingMetrics";
import {
  TODAY_TRAFFIC_AGGREGATION,
  TODAY_TRAFFIC_METRIC_KEYS,
  type TrafficMetricSeries,
} from "@/utils/trafficStats";

// Optional CSRF token injection. If the page defines a global `csrfToken` (e.g., via a meta tag or script), it will be sent as `X-CSRF-Token` header.
function addCsrfHeader(headers: Record<string, string>) {
  try {
    const token = (window as any).csrfToken;
    if (token) {
      headers["X-CSRF-Token"] = String(token);
    }
  } catch {
    // ignore if window undefined (e.g., during SSR) or token not set
  }
  return headers;
}

// Optional central error reporting hook. If a global `reportError` function exists, forward caught errors.
function maybeReportError(err: unknown) {
  try {
    if (typeof (window as any).reportError === "function") {
      (window as any).reportError(err);
    }
  } catch {
    // ignore any failures in the reporting mechanism itself
  }
}

const ApiEnvelope = <T extends z.ZodTypeAny>(inner: T) =>
  z.object({
    status: z.string().optional(),
    message: z.string().optional(),
    data: inner,
  });

const RpcRecordsSchema = z
  .object({
    count: z.number().default(0),
    records: z.unknown().optional(),
    tasks: z.unknown().optional(),
  })
  .passthrough();

const MetricPointSchema = z
  .object({
    time: z.string(),
    value: z.number().nullable().default(null),
    count: z.number().default(0),
    tags: z.record(z.string(), z.string()).optional(),
  })
  .passthrough();

const MetricSeriesSchema = z
  .object({
    metric_key: z.string(),
    entity_id: z.string().default(""),
    tags: z.record(z.string(), z.string()).optional(),
    tag: z.record(z.string(), z.string()).optional(),
    interval_seconds: z.number().default(0),
    points: z.array(MetricPointSchema).default([]),
  })
  .passthrough();

const MetricQueryResponseSchema = z
  .object({
    start: z.string().optional(),
    end: z.string().optional(),
    series: z.array(MetricSeriesSchema).default([]),
  })
  .passthrough();

const PingMetricStatSchema = z
  .object({
    entity_id: z.string().default(""),
    task_id: z.union([z.string(), z.number()]),
    name: z.string().default(""),
    type: z.string().default("icmp"),
    interval: z.number().default(60),
    total: z.number().default(0),
    valid: z.number().default(0),
    loss: z.number().default(0),
    min: z.number().nullable().optional(),
    max: z.number().nullable().optional(),
    avg: z.number().nullable().optional(),
    latest: z.number().nullable().optional(),
    p50: z.number().nullable().optional(),
    p99: z.number().nullable().optional(),
    stddev: z.number().nullable().optional(),
    p99_p50_ratio: z.number().default(0),
  })
  .passthrough();

const PingMetricStatsResponseSchema = z
  .object({
    stats: z.array(PingMetricStatSchema).default([]),
  })
  .passthrough();

const LOAD_RECORDS_PER_HOUR = 12;
const PING_RECORDS_PER_HOUR = 240;
const MAX_RPC_RECORDS = 20_000;
const OVERVIEW_PING_MAX_COUNT = 4_000;
const OVERVIEW_METRIC_MAX_POINTS = 60;
const DETAIL_METRIC_MAX_POINTS = 500;
// 普通 HTTP GET(/api/nodes、/api/public、load/ping 兜底)自身没有传输超时,
// 在这里统一兜底,half-open socket 能快速失败而不是无限挂住调用方。
const DEFAULT_API_TIMEOUT_MS = 12_000;

interface RpcRecordsPayload {
  count?: number;
  records?: unknown;
  tasks?: unknown;
}

interface PingOverviewResponse {
  records: PingRecordsResponse["records"];
  tasks: PingTask[];
  rangeStartMs?: number;
  rangeEndMs?: number;
  intervalSeconds?: number;
  stats?: PingTaskStats[];
}

interface RequestRange {
  rangeStartMs: number;
  rangeEndMs: number;
}

export class ApiRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly path: string,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

function normalizeRpcLatestStatus(
  payload: unknown,
): Record<string, unknown> {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const obj = payload as Record<string, unknown>;

    // Try { records: { uuid: data } } — standard komari RPC envelope
    const maybeRecords = obj.records as Record<string, unknown> | undefined;
    const wrapped = z.record(z.string(), z.unknown()).safeParse(maybeRecords);
    if (wrapped.success) return wrapped.data;

    // Try { data: { records: { uuid: data } } } or { data: { uuid: data } }
    const maybeData = obj.data as Record<string, unknown> | undefined;
    if (maybeData) {
      const viaDataRecords = z.record(z.string(), z.unknown()).safeParse(
        (maybeData as Record<string, unknown>).records,
      );
      if (viaDataRecords.success) return viaDataRecords.data;

      const viaData = z.record(z.string(), z.unknown()).safeParse(maybeData);
      if (viaData.success) return viaData.data;
    }
  }

  // Try { uuid: data } directly
  const direct = z.record(z.string(), z.unknown()).safeParse(payload);
  if (direct.success) return direct.data;

  return {};
}

function getRecordsMaxCount(hours: number, recordsPerHour: number) {
  const safeHours = Number.isFinite(hours) && hours > 0 ? hours : 1;
  return Math.min(
    MAX_RPC_RECORDS,
    Math.max(recordsPerHour, Math.ceil(safeHours * recordsPerHour)),
  );
}

async function apiGet<T>(
  path: string,
  schema: z.ZodType<T>,
  options?: { signal?: AbortSignal; timeout?: number },
): Promise<T> {
  const headers = addCsrfHeader({ Accept: "application/json" });
  const resp = await fetchWithTimeout(
    path,
    {
      credentials: "include",
      headers,
    },
    options?.timeout ?? DEFAULT_API_TIMEOUT_MS,
    options?.signal,
  );
  if (!resp.ok) {
    const err = new ApiRequestError(`Request ${path} failed: ${resp.status}`, resp.status, path);
    maybeReportError(err);
    throw err;
  }
  const json = (await resp.json()) as unknown;
  const envelopeResult = ApiEnvelope(schema).safeParse(json);
  if (envelopeResult.success) return envelopeResult.data.data as T;
  const rawResult = schema.safeParse(json);
  if (rawResult.success) return rawResult.data;
  // 两种解析错误都抛出来:enveloped 接口看 envelope 错误,裸 array/object 接口看 raw
  // 错误,而这里无法判断接口本该返回哪种结构。
  throw new Error(
    `Schema mismatch on ${path}: envelope=${
      envelopeResult.error.issues[0]?.message ?? ""
    }; raw=${rawResult.error.issues[0]?.message ?? ""}`,
  );
}

async function rpcCall<T>(
  method: string,
  params: Record<string, unknown>,
  schema: z.ZodType<T>,
  options?: { timeout?: number; signal?: AbortSignal },
): Promise<T> {
  const payload = await getRpc2Client().call(method, params, options);
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new Error(
      `Schema mismatch on rpc:${method}: ${parsed.error.issues[0]?.message ?? ""}`,
    );
  }
  return parsed.data;
}

// 丢掉单条解析失败的记录,而不是让整个数组抛错。否则一条坏记录会让 RPC normalize
// 抛错,调用方捕获后兜底到完整 HTTP 请求 —— 一条坏数据就变成每次轮询都 RPC + HTTP
// 双重拉取。
function parseArrayLenient<S extends z.ZodTypeAny>(schema: S, value: unknown): z.infer<S>[] {
  if (!Array.isArray(value)) return [];
  const out: z.infer<S>[] = [];
  let dropped = 0;
  for (const item of value) {
    const parsed = schema.safeParse(item);
    if (parsed.success) {
      out.push(parsed.data);
    } else {
      dropped += 1;
    }
  }
  if (dropped > 0) {
    console.debug(`parseArrayLenient: dropped ${dropped}/${value.length} records`);
  }
  return out;
}

function extractRpcRecords(payload: RpcRecordsPayload, key?: string): unknown[] {
  // Direct array of records
  if (Array.isArray(payload.records)) return payload.records;

  // records is a plain object — { uuid: [record, ...] } or { uuid: [record, ...] }
  if (payload.records && typeof payload.records === "object") {
    const recordsByKey = payload.records as Record<string, unknown>;
    if (key && Array.isArray(recordsByKey[key])) {
      return recordsByKey[key];
    }
    return Object.values(recordsByKey).flatMap((value) =>
      Array.isArray(value) ? value : [],
    );
  }

  // Try nested under { data: { records: ... } } or { data: [...] }
  const data = (payload as unknown as Record<string, unknown>).data;
  if (data && typeof data === "object") {
    const dataObj = data as Record<string, unknown>;
    if (Array.isArray(dataObj.records)) return dataObj.records;
    if (dataObj.records && typeof dataObj.records === "object") {
      const byKey = dataObj.records as Record<string, unknown>;
      if (key && Array.isArray(byKey[key])) return byKey[key];
    }
    if (Array.isArray(data)) return data;
  }

  return [];
}

function normalizeRpcLoadRecords(
  uuid: string,
  payload: RpcRecordsPayload,
  range?: RequestRange,
): LoadRecordsResponse {
  const records = parseArrayLenient(LoadRecordSchema, extractRpcRecords(payload, uuid));
  return {
    count: payload.count || records.length,
    records,
    intervalSeconds: inferHistoryIntervalSeconds(records),
    ...range,
  };
}

function derivePingTasks(records: PingRecordsResponse["records"]): PingTask[] {
  return Array.from(new Set(records.map((record) => record.task_id)))
    .sort((a, b) => a - b)
    .map((id) => ({
      id,
      interval: 60,
      name: `任务 #${id}`,
      loss: 0,
      clients: [],
      type: "icmp",
      target: "",
      weight: id,
    }));
}

function normalizeRpcPingRecords(
  uuid: string,
  payload: RpcRecordsPayload,
  range?: RequestRange,
): PingRecordsResponse {
  const records = parseArrayLenient(PingRecordSchema, extractRpcRecords(payload, uuid));
  const parsedTasks = z.array(PingTaskSchema).safeParse(payload.tasks);
  const tasks = parsedTasks.success ? parsedTasks.data : derivePingTasks(records);
  return {
    count: payload.count || records.length,
    records,
    tasks,
    ...range,
  };
}

function normalizeRpcPingOverview(
  payload: RpcRecordsPayload,
  range?: RequestRange,
): PingOverviewResponse {
  const records = parseArrayLenient(PingRecordSchema, extractRpcRecords(payload));
  const parsedTasks = z.array(PingTaskSchema).safeParse(payload.tasks);
  return {
    records,
    tasks: parsedTasks.success ? parsedTasks.data : derivePingTasks(records),
    ...range,
  };
}

function createRequestRange(hours: number, now = Date.now()): RequestRange {
  const safeHours = Number.isFinite(hours) && hours > 0 ? hours : 1;
  return {
    rangeStartMs: now - safeHours * 60 * 60 * 1000,
    rangeEndMs: now,
  };
}

function getMetricPayloadRange(
  payload: z.output<typeof MetricQueryResponseSchema>,
  fallback: RequestRange,
): RequestRange {
  const start = Date.parse(payload.start ?? "");
  const end = Date.parse(payload.end ?? "");
  return {
    rangeStartMs: Number.isFinite(start) ? start : fallback.rangeStartMs,
    rangeEndMs: Number.isFinite(end) ? end : fallback.rangeEndMs,
  };
}

function isAbortError(error: unknown) {
  return error instanceof DOMException
    ? error.name === "AbortError"
    : error instanceof Error && error.name === "AbortError";
}

function isMissingMetricMethod(error: unknown) {
  if (!(error instanceof Error)) return false;
  return /method.*(?:not found|unknown|registered)|(?:not found|unknown).*method/i.test(
    error.message,
  );
}

let metricQueryApiUnavailable = false;

async function queryMetricPayload(
  params: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<z.output<typeof MetricQueryResponseSchema>> {
  if (metricQueryApiUnavailable) {
    throw new Error("Metric query API is unavailable on this server");
  }

  try {
    const payload = await rpcCall(
      "public:queryMetrics",
      params,
      MetricQueryResponseSchema,
      { signal },
    );
    return payload as z.output<typeof MetricQueryResponseSchema>;
  } catch (error) {
    if (signal?.aborted || isAbortError(error)) throw error;
    if (isMissingMetricMethod(error)) metricQueryApiUnavailable = true;
    throw error;
  }
}

let publicPingTasksCache: PingTask[] | null = null;
let publicPingTasksCachedAt = 0;
let publicPingTasksRequest: Promise<PingTask[]> | null = null;

function loadPublicPingTasks() {
  if (publicPingTasksCache && Date.now() - publicPingTasksCachedAt < 60_000) {
    return Promise.resolve(publicPingTasksCache);
  }
  if (publicPingTasksRequest) return publicPingTasksRequest;

  publicPingTasksRequest = rpcCall(
    "public:getPublicPingTasks",
    {},
    z.array(PingTaskSchema),
  )
    .then((tasks) => {
      const parsed = tasks as PingTask[];
      publicPingTasksCache = parsed;
      publicPingTasksCachedAt = Date.now();
      return parsed;
    })
    .finally(() => {
      publicPingTasksRequest = null;
    });
  return publicPingTasksRequest;
}

function normalizePingMetricStats(
  payload: z.output<typeof PingMetricStatsResponseSchema>,
): PingTaskStats[] {
  const out: PingTaskStats[] = [];
  for (const item of payload.stats) {
    const taskId = Number.parseInt(String(item.task_id), 10);
    if (!Number.isFinite(taskId) || taskId <= 0 || !item.entity_id) continue;
    out.push({
      client: item.entity_id,
      taskId,
      name: item.name,
      type: item.type,
      interval: item.interval,
      total: item.total,
      valid: item.valid,
      loss: item.loss,
      min: item.min ?? null,
      max: item.max ?? null,
      avg: item.avg ?? null,
      latest: item.latest ?? null,
      p50: item.p50 ?? null,
      p99: item.p99 ?? null,
      stddev: item.stddev ?? null,
      p99P50Ratio: item.p99_p50_ratio,
    });
  }
  return out;
}

async function getLoadMetricData(
  uuid: string,
  hours: number,
): Promise<LoadRecordsResponse> {
  const requestRange = createRequestRange(hours);
  const metricPayload = await queryMetricPayload({
    hours,
    entity_ids: [uuid],
    metric_keys: LOAD_METRIC_KEYS,
    max_points: DETAIL_METRIC_MAX_POINTS,
    aggregation: "avg",
    aggregation_by_metric: LOAD_LAST_AGGREGATION,
    fill_empty: false,
  });
  const series: LoadMetricSeries[] = metricPayload.series.map((item) => ({
    metricKey: item.metric_key,
    client: item.entity_id,
    tags: item.tags ?? item.tag ?? {},
    points: item.points,
  }));
  const records = mergeLoadMetricSeries(series);
  const intervalSeconds = Math.max(
    0,
    ...metricPayload.series.map((item) => item.interval_seconds),
  );
  return {
    count: records.length,
    records,
    ...getMetricPayloadRange(metricPayload, requestRange),
    intervalSeconds: intervalSeconds > 0 ? intervalSeconds : undefined,
  };
}

async function getPingMetricData({
  hours,
  entityIds,
  taskId,
  maxPoints,
  signal,
}: {
  hours: number;
  entityIds?: string[];
  taskId?: number;
  maxPoints: number;
  signal?: AbortSignal;
}): Promise<PingRecordsResponse> {
  if (metricQueryApiUnavailable) {
    throw new Error("Metric query API is unavailable on this server");
  }

  const requestRange = createRequestRange(hours);
  const commonParams = {
    hours,
    ...(entityIds?.length ? { entity_ids: entityIds } : {}),
    ...(taskId != null ? { task_id: taskId } : {}),
    max_points: maxPoints,
  };

  const statsRequest = rpcCall(
    "public:getPingMetricStats",
    commonParams,
    PingMetricStatsResponseSchema,
    { signal },
  )
    .then((payload) => payload as z.output<typeof PingMetricStatsResponseSchema>)
    .catch((error: unknown) => {
      if (signal?.aborted || isAbortError(error)) throw error;
      return null;
    });
  const [metricPayload, statsPayload, publicTasks] = await Promise.all([
    queryMetricPayload(
      {
        ...commonParams,
        metric_keys: [PING_LATENCY_METRIC, PING_LOSS_METRIC],
        ...(taskId != null ? { tags: { task_id: String(taskId) } } : {}),
        aggregation: "avg",
        fill_empty: true,
      },
      signal,
    ),
    statsRequest,
    loadPublicPingTasks().catch(() => null),
  ]);
  const stats = statsPayload ? normalizePingMetricStats(statsPayload) : [];
  const series: PingMetricSeries[] = metricPayload.series.map((item) => ({
    metricKey: item.metric_key,
    client: item.entity_id,
    tags: item.tags ?? item.tag ?? {},
    points: item.points,
  }));
  const records = mergePingMetricSeries(series);
  const intervalSeconds = Math.max(
    0,
    ...metricPayload.series.map((item) => item.interval_seconds),
  );
  const observedTaskIds = new Set([
    ...records.map((record) => record.task_id),
    ...stats.map((stat) => stat.taskId),
  ]);
  const statByTask = new Map(stats.map((stat) => [stat.taskId, stat] as const));
  const tasks = publicTasks
    ?.filter((task) => observedTaskIds.has(task.id))
    .map((task) => ({
      ...task,
      loss: statByTask.get(task.id)?.loss ?? task.loss,
    }));
  const statsTasks = pingTasksFromMetricStats(stats);
  return {
    count: records.length,
    records,
    ...getMetricPayloadRange(metricPayload, requestRange),
    intervalSeconds: intervalSeconds > 0 ? intervalSeconds : undefined,
    tasks:
      tasks && tasks.length > 0
        ? tasks
        : statsTasks.length > 0
          ? statsTasks
          : derivePingTasks(records),
    stats,
  };
}

export async function getMe(): Promise<Me> {
  // 必须 cast:zod `.passthrough()` schema 经 apiGet 推断出的是 input 类型(默认字段
  // 变可选),这里要重新收窄回来。
  return (await apiGet("/api/me", MeSchema)) as Me;
}

export async function getPublic(): Promise<PublicConfig> {
  return (await apiGet("/api/public", PublicConfigSchema)) as PublicConfig;
}

export async function getNodesLatestStatus(
  uuids?: string[],
  options?: { timeout?: number },
): Promise<Record<string, unknown>> {
  const payload = await rpcCall(
    "common:getNodesLatestStatus",
    uuids && uuids.length > 0 ? { uuids } : {},
    z.unknown(),
    options,
  );
  return normalizeRpcLatestStatus(payload);
}

export async function getNodes(): Promise<NodeInfo[]> {
  // 走 common:getNodes（RPC2）：它按 SendIpAddrToGuest 设置下发 ipv4/ipv6（管理员全量 /
  // 访客打码），所以前端能显示 V4/V6；/api/nodes 则永远抹掉 IP，拿不到。
  try {
    const map = await rpcCall(
      "common:getNodes",
      {},
      z.record(z.string(), NodeInfoSchema),
    );
    return Object.values(map) as NodeInfo[];
  } catch {
    // RPC 不可用时兜底回旧的 HTTP 接口（拿不到 IP，但节点列表照常加载）。
    return (await apiGet("/api/nodes", z.array(NodeInfoSchema))) as NodeInfo[];
  }
}

export async function getAdminClients(): Promise<AdminClient[]> {
  return (await apiGet("/api/admin/client/list", z.array(AdminClientSchema))) as AdminClient[];
}

export async function getLoadRecords(
  uuid: string,
  hours = 6,
): Promise<LoadRecordsResponse> {
  const requestRange = createRequestRange(hours);
  try {
    return await getLoadMetricData(uuid, hours);
  } catch {
    // 旧版后端没有 public metric API，或新接口暂时失败时回退兼容记录接口。
  }

  try {
    const maxCount = getRecordsMaxCount(hours, LOAD_RECORDS_PER_HOUR);
    const payload = await rpcCall(
      "common:getRecords",
      {
        uuid,
        hours,
        type: "load",
        maxCount,
      },
      RpcRecordsSchema,
    );
    return normalizeRpcLoadRecords(uuid, payload, requestRange);
  } catch {
    const legacy = (await apiGet(
      `/api/records/load?${new URLSearchParams({ uuid, hours: String(hours) })}`,
      z.object({
        count: z.number().default(0),
        records: z.array(LoadRecordSchema).default([]),
      }),
    )) as LoadRecordsResponse;
    return {
      ...legacy,
      ...requestRange,
      intervalSeconds: inferHistoryIntervalSeconds(legacy.records),
    };
  }
}

export async function getPingRecords(
  uuid: string,
  hours = 6,
): Promise<PingRecordsResponse> {
  const requestRange = createRequestRange(hours);
  try {
    return await getPingMetricData({
      hours,
      entityIds: [uuid],
      maxPoints: DETAIL_METRIC_MAX_POINTS,
    });
  } catch {
    // 旧版后端没有 public metric API，或新版接口暂时失败时回退兼容记录接口。
  }

  try {
    const maxCount = getRecordsMaxCount(hours, PING_RECORDS_PER_HOUR);
    const payload = await rpcCall(
      "common:getRecords",
      {
        uuid,
        hours,
        type: "ping",
        maxCount,
      },
      RpcRecordsSchema,
    );
    return normalizeRpcPingRecords(uuid, payload, requestRange);
  } catch {
    const legacy = (await apiGet(
      `/api/records/ping?${new URLSearchParams({ uuid, hours: String(hours) })}`,
      z.object({
        count: z.number().default(0),
        records: z.array(PingRecordSchema).default([]),
        tasks: z.array(PingTaskSchema).default([]),
      }),
    )) as PingRecordsResponse;
    return {
      ...legacy,
      ...requestRange,
    };
  }
}

export async function getAdminPingTasks(): Promise<PingTask[]> {
  return (await apiGet("/api/admin/ping", z.array(PingTaskSchema))) as PingTask[];
}

export async function saveThemeSettings(
  theme: string,
  settings: Record<string, unknown>,
): Promise<void> {
  const resp = await fetchWithTimeout(
    `/api/admin/theme/settings?theme=${encodeURIComponent(theme)}`,
    {
      method: "POST",
      credentials: "include",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(settings),
    },
    DEFAULT_API_TIMEOUT_MS,
  );

  if (!resp.ok) {
    let message = `Request /api/admin/theme/settings failed: ${resp.status}`;
    try {
      const json = (await resp.json()) as { message?: string };
      if (json?.message) {
        message = json.message;
      }
    } catch {
      // body 不是 JSON 时保留兜底错误信息。
    }
    throw new ApiRequestError(message, resp.status, "/api/admin/theme/settings");
  }
}

export interface TodayTrafficMetricResponse {
  series: TrafficMetricSeries[];
  rangeStartMs: number;
  rangeEndMs: number;
  intervalSeconds?: number;
}

export async function getTodayTrafficMetrics(
  entityIds: string[],
  startMs: number,
  endMs: number,
  options?: { signal?: AbortSignal; timeout?: number },
): Promise<TodayTrafficMetricResponse> {
  if (entityIds.length === 0) {
    return { series: [], rangeStartMs: startMs, rangeEndMs: endMs };
  }

  const fiveMinutesMs = 5 * 60 * 1000;
  const maxPoints = Math.max(1, Math.ceil((endMs - startMs) / fiveMinutesMs));
  const requestRange = { rangeStartMs: startMs, rangeEndMs: endMs };
  const metricPayload = await queryMetricPayload(
    {
      start: new Date(startMs).toISOString(),
      end: new Date(endMs).toISOString(),
      entity_ids: entityIds,
      metric_keys: TODAY_TRAFFIC_METRIC_KEYS,
      max_points: maxPoints,
      aggregation_by_metric: TODAY_TRAFFIC_AGGREGATION,
      fill_empty: false,
    },
    options?.signal,
  );
  const series: TrafficMetricSeries[] = metricPayload.series.map((item) => ({
    metricKey: item.metric_key,
    client: item.entity_id,
    tags: item.tags ?? item.tag ?? {},
    intervalSeconds: item.interval_seconds,
    points: item.points,
  }));
  const intervalSeconds = Math.max(0, ...series.map((item) => item.intervalSeconds ?? 0));
  return {
    series,
    ...getMetricPayloadRange(metricPayload, requestRange),
    intervalSeconds: intervalSeconds > 0 ? intervalSeconds : undefined,
  };
}

export async function getPingOverview(
  hours = 1,
  taskId?: number,
  options?: { signal?: AbortSignal; entityIds?: string[] },
): Promise<PingOverviewResponse> {
  const requestRange = createRequestRange(hours);
  try {
    return await getPingMetricData({
      hours,
      entityIds: options?.entityIds,
      taskId,
      maxPoints: OVERVIEW_METRIC_MAX_POINTS,
      signal: options?.signal,
    });
  } catch (error) {
    if (options?.signal?.aborted || isAbortError(error)) throw error;
    // 旧版后端没有 public metric API 时继续走原有记录接口。
  }

  try {
    const payload = await rpcCall(
      "common:getRecords",
      {
        hours,
        type: "ping",
        ...(taskId != null ? { task_id: taskId } : {}),
        maxCount: OVERVIEW_PING_MAX_COUNT,
      },
      RpcRecordsSchema,
      { signal: options?.signal },
    );
    return normalizeRpcPingOverview(payload, requestRange);
  } catch {
    if (taskId == null) {
      throw new Error("Ping overview fallback requires a concrete task_id");
    }
    if (options?.signal?.aborted) {
      throw options.signal.reason ?? new DOMException("Aborted", "AbortError");
    }

    const data = await apiGet(
      `/api/records/ping?${new URLSearchParams({ task_id: String(taskId), hours: String(hours) })}`,
      z.object({
        records: z.array(PingRecordSchema).default([]),
        tasks: z.array(PingTaskSchema).default([]),
      }),
      { signal: options?.signal },
    );
    return {
      records: data.records,
      tasks: data.tasks,
      ...requestRange,
    } as PingOverviewResponse;
  }
}
