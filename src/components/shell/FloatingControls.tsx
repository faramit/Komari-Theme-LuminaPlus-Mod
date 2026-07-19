import { useState } from "react";
import { AlertTriangle, ChevronLeft, ChevronRight, Grid3x3, LayoutGrid, List, Monitor, Palette, Rows3, Settings, SlidersHorizontal, Sun, Moon } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { MetricColorPicker } from "./MetricColorPicker";
import { usePreferences } from "@/hooks/usePreferences";
import { useViewMode } from "@/hooks/useViewMode";
import { useNodeStoreStatus } from "@/hooks/useNode";
import { FAILURE_STREAK_WARN_THRESHOLD } from "@/services/wsStore";
import { useAuth } from "@/hooks/useAuth";
import { useThemeSettings } from "@/hooks/useThemeSettings";
import type { NodeViewMode } from "@/utils/themeSettings";
import { clsx } from "clsx";

const VIEW_MODE_META: Record<NodeViewMode, { icon: typeof LayoutGrid; label: string }> = {
  large: { icon: LayoutGrid, label: "大视图" },
  compact: { icon: Rows3, label: "小视图" },
  mini: { icon: Grid3x3, label: "迷你视图" },
  list: { icon: List, label: "列表视图" },
};

const APPEARANCE_OPTIONS = [
  { value: "light", icon: Sun, label: "浅色" },
  { value: "system", icon: Monitor, label: "跟随系统" },
  { value: "dark", icon: Moon, label: "深色" },
] as const;

export function FloatingControls({ onExpandedChange }: { onExpandedChange?: (expanded: boolean) => void }) {
  const [searchParams] = useSearchParams();
  // 在任何 node-store hook 跑之前先读路由:theme-manage 视图这里什么都不渲染,否则下面的 useNodeStoreStatus 会白启动实时节点轮询又立刻丢弃
  if (searchParams.get("view") === "theme-manage") {
    return null;
  }
  return <FloatingControlsInner onExpandedChange={onExpandedChange} />;
}

function FloatingControlsInner({ onExpandedChange }: { onExpandedChange?: (expanded: boolean) => void }) {
  const { appearance, setAppearance } = usePreferences();
  const { mode, nextMode, toggleMode } = useViewMode();
  const { data: me } = useAuth();
  const themeSettings = useThemeSettings();
  const { failureStreak } = useNodeStoreStatus();
  const [collapsed, setCollapsed] = useState(true);
  const toggleCollapsed = () => setCollapsed((value) => {
    const next = !value;
    onExpandedChange?.(!next);
    return next;
  });
  const [colorsOpen, setColorsOpen] = useState(false);
  const settingsReady = themeSettings.isReady;
  const showAdmin = settingsReady && themeSettings.enableAdminButton;
  // 主题管理入口与配色取色器都仅对登录管理员开放（配色存后端、全局生效）。
  const loggedIn = Boolean(me?.logged_in);
  const showThemeManage = loggedIn;
  const showColorPicker = loggedIn;
  const showSyncWarning = failureStreak >= FAILURE_STREAK_WARN_THRESHOLD;
  const hiddenTabIndex = collapsed ? -1 : undefined;
  const ToggleIcon = collapsed ? ChevronLeft : ChevronRight;
  const ViewIcon = VIEW_MODE_META[nextMode].icon;
  const isReducedView = mode !== "large";

  return (
    <div
      className={clsx(
        "floating-controls",
        collapsed && "is-collapsed",
        showSyncWarning && "has-warning",
      )}
    >
      <div className="floating-controls-inner">
        <div className="floating-controls-row">
          <div className="floating-controls-actions" aria-hidden={collapsed}>
            {settingsReady && (
              <>
                <div
                  className="control-group"
                  role="group"
                  aria-label="外观选择"
                >
                  {APPEARANCE_OPTIONS.map(({ value, icon: Icon, label }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setAppearance(value)}
                      aria-label={label}
                      aria-pressed={appearance === value}
                      title={label}
                      tabIndex={hiddenTabIndex}
                      className={clsx(
                        "control-button control-toggle grid h-9 w-9 place-items-center",
                        appearance === value && "is-active",
                      )}
                    >
                      <Icon size={16} />
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={toggleMode}
                  aria-label="切换卡片视图"
                  aria-pressed={isReducedView}
                  title={`临时切换到${VIEW_MODE_META[nextMode].label}`}
                  tabIndex={hiddenTabIndex}
                  className={clsx(
                    "control-button grid h-9 w-9 place-items-center",
                    isReducedView && "control-toggle is-active",
                  )}
                >
                  <ViewIcon size={16} />
                </button>
                {showColorPicker && (
                  <button
                    type="button"
                    onClick={() => setColorsOpen((value) => !value)}
                    aria-label="卡片配色"
                    aria-pressed={colorsOpen}
                    title="卡片配色"
                    tabIndex={hiddenTabIndex}
                    className={clsx(
                      "control-button grid h-9 w-9 place-items-center",
                      colorsOpen && "control-toggle is-active",
                    )}
                  >
                    <Palette size={16} />
                  </button>
                )}
              </>
            )}
            {showThemeManage && (
              <Link
                to="/?view=theme-manage"
                aria-label="主题设置"
                title="主题设置"
                tabIndex={hiddenTabIndex}
                className="control-button grid h-9 w-9 place-items-center"
              >
                <SlidersHorizontal size={16} />
              </Link>
            )}
            {showAdmin && (
              <a
                href="/admin"
                aria-label={me?.logged_in ? "管理" : "后台登录"}
                title={me?.logged_in ? "管理" : "后台登录"}
                tabIndex={hiddenTabIndex}
                className="control-button grid h-9 w-9 place-items-center"
              >
                <Settings size={16} />
              </a>
            )}
          </div>
          <button
            type="button"
            className="control-button floating-controls-trigger grid h-9 w-9 place-items-center"
            aria-label={collapsed ? "展开快捷按钮" : "收起快捷按钮"}
            aria-expanded={!collapsed}
            onClick={toggleCollapsed}
            title={collapsed ? "展开快捷按钮" : "收起快捷按钮"}
          >
            <ToggleIcon size={16} />
            {showSyncWarning && collapsed && (
              <span className="floating-controls-warning-dot" aria-hidden />
            )}
          </button>
        </div>
        {showColorPicker && !collapsed && colorsOpen && <MetricColorPicker />}
        {showSyncWarning && !collapsed && (
          <div className="pointer-events-none flex items-center gap-2 rounded-full border border-[color-mix(in_srgb,var(--status-offline)_32%,transparent)] bg-[color-mix(in_srgb,var(--surface-a)_90%,transparent)] px-3 py-1 text-[11px] font-medium text-[var(--status-offline)] shadow-[0_10px_25px_-18px_rgba(0,0,0,0.8)] backdrop-blur">
            <AlertTriangle size={12} />
            <span>实时状态同步异常，当前展示的是最近缓存</span>
          </div>
        )}
      </div>
    </div>
  );
}
