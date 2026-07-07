import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { clearCssColorCache } from "@/components/node/CanvasStrip";
import { usePublicConfig } from "@/hooks/usePublicConfig";
import { usePreferences } from "@/hooks/usePreferences";
import { saveThemeSettings } from "@/services/api";
import type { PublicConfig } from "@/types/komari";

// 用户自定义的卡片指标配色。覆盖 tokens.css 里的 --* 变量（内联写到 <html>）。
// 存到后端 theme_settings.metricColors（全局、跨设备同步、清缓存不丢；仅登录管理员可改）。
// 负载跟随独立色、流量方向/速率热力同理。

export type MetricColorKey =
  | "cpu"
  | "memory"
  | "disk"
  | "load"
  | "swap"
  | "speedIdle"
  | "speedLow"
  | "speedHigh"
  | "speedMax"
  | "speedUpIdle"
  | "speedUpLow"
  | "speedUpHigh"
  | "speedUpMax"
  | "speedDownIdle"
  | "speedDownLow"
  | "speedDownHigh"
  | "speedDownMax"
  | "trafficUp"
  | "trafficDown"
  | "latency0"
  | "latency1"
  | "latency2"
  | "latency3"
  | "latency4"
  | "loss0"
  | "loss1"
  | "loss2"
  | "loss3"
  | "loss4"
  | "quotaHigh"
  | "quotaLow";

export type MetricColorGroup = "metric" | "speed" | "traffic";

export const METRIC_COLOR_GROUPS: ReadonlyArray<{ id: MetricColorGroup; label: string }> = [
  { id: "metric", label: "卡片配色" },
  { id: "speed", label: "速率热力" },
  { id: "traffic", label: "流量方向" },
];

export const METRIC_COLOR_META: ReadonlyArray<{
  key: MetricColorKey;
  label: string;
  cssVar: string;
  group: MetricColorGroup;
}> = [
  { key: "cpu", label: "CPU", cssVar: "--progress-cpu", group: "metric" },
  { key: "memory", label: "内存", cssVar: "--progress-memory", group: "metric" },
  { key: "disk", label: "磁盘", cssVar: "--progress-disk", group: "metric" },
  { key: "load", label: "负载", cssVar: "--progress-load", group: "metric" },
  { key: "swap", label: "Swap", cssVar: "--progress-swap", group: "metric" },
  { key: "speedIdle", label: "超低速", cssVar: "--speed-idle", group: "speed" },
  { key: "speedLow", label: "低速", cssVar: "--speed-low", group: "speed" },
  { key: "speedHigh", label: "高速", cssVar: "--speed-high", group: "speed" },
  { key: "speedMax", label: "急速", cssVar: "--speed-max", group: "speed" },
  { key: "speedUpIdle", label: "上行超低速", cssVar: "--speed-up-idle", group: "speed" },
  { key: "speedUpLow", label: "上行低速", cssVar: "--speed-up-low", group: "speed" },
  { key: "speedUpHigh", label: "上行高速", cssVar: "--speed-up-high", group: "speed" },
  { key: "speedUpMax", label: "上行急速", cssVar: "--speed-up-max", group: "speed" },
  { key: "speedDownIdle", label: "下行超低速", cssVar: "--speed-down-idle", group: "speed" },
  { key: "speedDownLow", label: "下行低速", cssVar: "--speed-down-low", group: "speed" },
  { key: "speedDownHigh", label: "下行高速", cssVar: "--speed-down-high", group: "speed" },
  { key: "speedDownMax", label: "下行急速", cssVar: "--speed-down-max", group: "speed" },
  { key: "trafficUp", label: "上行", cssVar: "--traffic-up", group: "traffic" },
  { key: "trafficDown", label: "下行", cssVar: "--traffic-down", group: "traffic" },
  { key: "quotaHigh", label: "剩余流量充足", cssVar: "--quota-high", group: "traffic" },
  { key: "quotaLow", label: "剩余流量不足", cssVar: "--quota-low", group: "traffic" },
  { key: "latency0", label: "延迟 ＜100ms", cssVar: "--latency-0", group: "metric" },
  { key: "latency1", label: "延迟 ＜150ms", cssVar: "--latency-1", group: "metric" },
  { key: "latency2", label: "延迟 ＜200ms", cssVar: "--latency-2", group: "metric" },
  { key: "latency3", label: "延迟 ＜300ms", cssVar: "--latency-3", group: "metric" },
  { key: "latency4", label: "延迟 ≥300ms", cssVar: "--latency-4", group: "metric" },
  { key: "loss0", label: "丢包 ＜1%", cssVar: "--loss-0", group: "metric" },
  { key: "loss1", label: "丢包 ＜3%", cssVar: "--loss-1", group: "metric" },
  { key: "loss2", label: "丢包 ＜5%", cssVar: "--loss-2", group: "metric" },
  { key: "loss3", label: "丢包 ＜10%", cssVar: "--loss-3", group: "metric" },
  { key: "loss4", label: "丢包 ≥10%", cssVar: "--loss-4", group: "metric" },
];

export type MetricColors = Partial<Record<MetricColorKey, string>>;

/** 明暗双主题分别保存的配色。 */
export type ThemeMetricColors = {
  light: MetricColors;
  dark: MetricColors;
};

const SETTINGS_KEY = "metricColors";
const HEX = /^#[0-9a-f]{6}$/;

function toInputHex(value: string): string {
  let v = value.trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(v)) v = "#" + [...v.slice(1)].map((c) => c + c).join("");
  return HEX.test(v) ? v : "#888888";
}

/**
 * 从后端 theme_settings 解析出已保存的指标配色。
 * 新格式: { light: { cpu: "#hex" }, dark: { cpu: "#hex" } }
 * 旧格式(兼容): { cpu: "#hex" } → 双主题都应用该色 */
export function readMetricColorsFromSettings(
  settings: Record<string, unknown> | undefined,
): ThemeMetricColors {
  const raw = settings?.[SETTINGS_KEY];
  if (!raw || typeof raw !== "object") return { light: {}, dark: {} };
  const source = raw as Record<string, unknown>;

  // 新格式：含 light/dark 键
  if ("light" in source || "dark" in source) {
    const out: ThemeMetricColors = { light: {}, dark: {} };
    for (const theme of ["light", "dark"] as const) {
      const sub = source[theme];
      if (sub && typeof sub === "object") {
        for (const { key } of METRIC_COLOR_META) {
          const v = (sub as Record<string, unknown>)[key];
          if (typeof v === "string" && HEX.test(v.toLowerCase())) out[theme][key] = v.toLowerCase();
        }
      }
    }
    return out;
  }

  // 旧格式: 单层 { cpu: "#hex" } → 应用到两个主题
  const flat: MetricColors = {};
  for (const { key } of METRIC_COLOR_META) {
    const v = source[key];
    if (typeof v === "string" && HEX.test(v.toLowerCase())) flat[key] = v.toLowerCase();
  }
  return { light: { ...flat }, dark: { ...flat } };
}

// ---- 已应用配色：写 CSS 变量 + 维护 version 让 canvas 卡片即时重绘 ----
let version = 0;
let appliedSig = "__init__";
let rafId: number | null = null;
const listeners = new Set<() => void>();

// 编辑会话:管理员一旦改色,直到这一笔保存成功回环之前都置 true。期间本地草稿/预览是
// 唯一权威——任何无关的 public config 刷新(窗口聚焦、其它设置保存返回旧 metricColors)
// 都不得经全局同步或编辑器把颜色打回旧值。全局同步与编辑器共用这一个模块级标记。
let metricColorEditing = false;

function bumpVersionThrottled() {
  // 拖动取色器时每帧多次调用，version+emit 合并到每帧一次，避免每个事件都重渲染/重绘所有卡片。
  if (rafId != null) return;
  rafId = requestAnimationFrame(() => {
    rafId = null;
    version += 1;
    for (const l of listeners) l();
  });
}

/** 无论去重/编辑状态如何，强制清除 <html> 上所有指标色 CSS 变量内联覆盖。 */
function clearMetricColorVars() {
  const root = document.documentElement;
  for (const { cssVar } of METRIC_COLOR_META) root.style.removeProperty(cssVar);
  clearCssColorCache();
  bumpVersionThrottled();
  appliedSig = "__init__";
}

/** 把一组配色应用到 <html>（CSS 变量即时覆盖；canvas 经 version 重绘）。相同配色不重复应用。 */
export function applyMetricColors(colors: MetricColors) {
  const sig = JSON.stringify(colors ?? {});
  if (sig === appliedSig) return;
  appliedSig = sig;
  const root = document.documentElement;
  for (const { key, cssVar } of METRIC_COLOR_META) {
    const v = colors[key];
    if (v) root.style.setProperty(cssVar, v);
    else root.style.removeProperty(cssVar);
  }
  // 清掉 canvas 颜色缓存，否则进度条/圆点会继续画旧色。
  clearCssColorCache();
  bumpVersionThrottled();
}

/** 供 canvas 卡片（NodeCard）订阅：配色变化时拼进 redrawKey 触发重绘。 */
export function useMetricColorsVersion(): number {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    () => version,
    () => version,
  );
}

/** 读取每个指标当前生效的 hex（含默认 token），供取色器显示初值。 */
export function readEffectiveColors(): Record<MetricColorKey, string> {
  const styles = getComputedStyle(document.documentElement);
  const out = {} as Record<MetricColorKey, string>;
  for (const { key, cssVar } of METRIC_COLOR_META) out[key] = toInputHex(styles.getPropertyValue(cssVar));
  return out;
}

/** 全局：把后端保存的配色应用到所有访客（在 AppShell 挂载一次）。明暗切换时自动切换对应主题的配色。 */
export function useMetricColorsSync() {
  const { data: config } = usePublicConfig();
  const { resolvedAppearance } = usePreferences();
  const themeColors = useMemo(
    () => readMetricColorsFromSettings(config?.theme_settings),
    [config?.theme_settings],
  );
  useEffect(() => {
    // 先无条件清除所有旧覆盖色，让 <html> 回退到 CSS 默认值
    // （var(--text-primary) 按 data-appearance 自动解析为对应主题色）。
    clearMetricColorVars();
    // 不在编辑会话中时再应用已保存的配色覆盖。正在编辑时编辑器负责预览，
    // 此处不清掉则旧覆盖会被编辑器保留，切主题后就能看到旧主题的覆盖色。
    if (metricColorEditing) return;
    applyMetricColors(themeColors[resolvedAppearance]);
  }, [themeColors, resolvedAppearance]);
}

/** 管理员编辑：改色即时预览 + 防抖保存到后端 theme_settings。
 *  明暗主题分别独立保存编辑。 */
export function useMetricColorsEditor() {
  const { data: config } = usePublicConfig();
  const { resolvedAppearance } = usePreferences();
  const queryClient = useQueryClient();
  const serverThemeColors = useMemo(
    () => readMetricColorsFromSettings(config?.theme_settings),
    [config?.theme_settings],
  );

  const [drafts, setDrafts] = useState<ThemeMetricColors>(serverThemeColors);
  const [saveError, setSaveError] = useState(false);
  const draftsRef = useRef<ThemeMetricColors>(serverThemeColors);
  const saveTimer = useRef<number | null>(null);
  const serverThemeColorsRef = useRef<ThemeMetricColors>(serverThemeColors);
  const pendingDraftsRef = useRef<ThemeMetricColors | null>(null);
  const mountedRef = useRef(true);
  const inFlightRef = useRef(false);
  const hasQueuedRef = useRef(false);
  const queuedDraftsRef = useRef<ThemeMetricColors>({ light: {}, dark: {} });

  // 正在编辑的主题 = 当前外观
  const editingTheme: "light" | "dark" = resolvedAppearance;

  // 后端配色变化时同步草稿。正在编辑时本地草稿压过服务端。
  useEffect(() => {
    if (metricColorEditing) return;
    serverThemeColorsRef.current = serverThemeColors;
    draftsRef.current = serverThemeColors;
    setDrafts(serverThemeColors);
  }, [serverThemeColors]);

  // 外观在编辑过程中切换时，应用新主题的草稿到 DOM 预览
  const prevThemeRef = useRef(editingTheme);
  useEffect(() => {
    if (prevThemeRef.current !== editingTheme) {
      prevThemeRef.current = editingTheme;
      if (metricColorEditing) {
        clearMetricColorVars();
        applyMetricColors(draftsRef.current[editingTheme]);
      }
    }
  }, [editingTheme]);

  const finishEditing = useCallback((restoreSaved = false) => {
    metricColorEditing = false;
    if (restoreSaved) {
      clearMetricColorVars();
      const t = document.documentElement.dataset.appearance === "dark" ? "dark" : "light";
      applyMetricColors(serverThemeColorsRef.current[t]);
    }
  }, []);

  const persist = useCallback(
    async (d: ThemeMetricColors) => {
      if (!config) {
        if (!mountedRef.current) finishEditing(true);
        return;
      }
      if (inFlightRef.current) {
        queuedDraftsRef.current = d;
        hasQueuedRef.current = true;
        return;
      }
      inFlightRef.current = true;
      let current = d;
      let lastOk = false;
      let savedAny = false;
      try {
        for (;;) {
          const latest = queryClient.getQueryData<PublicConfig>(["public"]) ?? config;
          const nextSettings: Record<string, unknown> = { ...(latest.theme_settings ?? {}) };
          if (Object.keys(current.light).length > 0 || Object.keys(current.dark).length > 0) {
            nextSettings[SETTINGS_KEY] = current;
          } else {
            delete nextSettings[SETTINGS_KEY];
          }
          try {
            await saveThemeSettings(latest.theme, nextSettings);
            lastOk = true;
            savedAny = true;
            serverThemeColorsRef.current = current;
            if (mountedRef.current) setSaveError(false);
          } catch {
            lastOk = false;
            if (mountedRef.current) setSaveError(true);
          }
          if (!hasQueuedRef.current) break;
          hasQueuedRef.current = false;
          current = queuedDraftsRef.current;
        }
      } finally {
        inFlightRef.current = false;
      }
      if (lastOk) {
        finishEditing();
      } else if (!mountedRef.current) {
        finishEditing(true);
      }
      if (savedAny) {
        void queryClient.invalidateQueries({ queryKey: ["public"] });
      }
    },
    [config, finishEditing, queryClient],
  );

  const persistRef = useRef(persist);
  useEffect(() => {
    persistRef.current = persist;
  }, [persist]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (saveTimer.current != null) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
      if (pendingDraftsRef.current != null) {
        void persistRef.current(pendingDraftsRef.current);
        pendingDraftsRef.current = null;
      } else if (inFlightRef.current) {
      } else {
        finishEditing(true);
      }
    };
  }, [finishEditing]);

  const scheduleSave = useCallback(
    (d: ThemeMetricColors) => {
      if (!config) return;
      if (saveTimer.current != null) clearTimeout(saveTimer.current);
      pendingDraftsRef.current = d;
      saveTimer.current = window.setTimeout(() => {
        saveTimer.current = null;
        pendingDraftsRef.current = null;
        void persist(d);
      }, 500);
    },
    [config, persist],
  );

  const commit = useCallback(
    (next: MetricColors) => {
      metricColorEditing = true;
      const newDrafts: ThemeMetricColors = { ...draftsRef.current, [editingTheme]: next };
      draftsRef.current = newDrafts;
      setDrafts(newDrafts);
      clearMetricColorVars();
      applyMetricColors(next);
      scheduleSave(newDrafts);
    },
    [editingTheme, scheduleSave],
  );

  const setColor = useCallback(
    (key: MetricColorKey, hex: string) => {
      const v = hex.toLowerCase();
      if (HEX.test(v)) commit({ ...draftsRef.current[editingTheme], [key]: v });
    },
    [commit, editingTheme],
  );

  const resetColor = useCallback(
    (key: MetricColorKey) => {
      const next = { ...draftsRef.current[editingTheme] };
      delete next[key];
      commit(next);
    },
    [commit, editingTheme],
  );

  const resetAll = useCallback(() => commit({}), [commit]);

  return {
    colors: drafts[editingTheme],
    editingTheme,
    setColor,
    resetColor,
    resetAll,
    saveError,
  };
}
