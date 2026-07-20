import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getAdminPingTasks, saveThemeSettings } from "@/services/api";
import { useThemeSettings } from "@/hooks/useThemeSettings";
import { usePublicConfig } from "@/hooks/usePublicConfig";
import { invertHomepagePingTaskBindings } from "@/utils/pingTasks";
import type { ReactNode } from "react";

interface Props {
  uuid: string;
  children: ReactNode;
}

export function PingTaskSwitcher({ uuid, children }: Props) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingTaskId, setSavingTaskId] = useState<number | null>(null);
  const [menuStyle, setMenuStyle] = useState<Record<string, string> | null>(null);
  const queryClient = useQueryClient();
  const { homepagePingBindings } = useThemeSettings();
  const { data: config } = usePublicConfig();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const { data: pingTasks = [] } = useQuery({
    queryKey: ["admin", "ping-tasks"],
    queryFn: getAdminPingTasks,
    staleTime: 60_000,
  });

  const nodeToTask = invertHomepagePingTaskBindings(homepagePingBindings);
  const currentTaskId = nodeToTask.get(uuid);

  const currentTaskIdStr = currentTaskId != null ? String(currentTaskId) : undefined;

  const visibleTasks = pingTasks.filter(
    (t) => t.clients.includes(uuid) || String(t.id) === currentTaskIdStr,
  );

  const currentTaskName = currentTaskIdStr
    ? pingTasks.find((t) => String(t.id) === currentTaskIdStr)?.name
    : undefined;

  const show = useCallback(() => {
    clearTimeout(timerRef.current);
    if (wrapperRef.current) {
      const rect = wrapperRef.current.getBoundingClientRect();
      setMenuStyle({
        position: "fixed",
        left: `${Math.max(8, rect.right - 288)}px`,
        top: `${rect.bottom + 4}px`,
      });
    }
    setOpen(true);
  }, []);

  const hide = useCallback(() => {
    timerRef.current = setTimeout(() => {
      setOpen(false);
      setMenuStyle(null);
    }, 200);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onScroll = () => {
      setOpen(false);
      setMenuStyle(null);
    };
    window.addEventListener("scroll", onScroll, true);
    return () => window.removeEventListener("scroll", onScroll, true);
  }, [open]);

  const handleSwitch = useCallback(
    async (event: React.MouseEvent, newTaskId: number) => {
      event.preventDefault();
      event.stopPropagation();
      if (!config?.theme || saving) return;
      setSaving(true);
      setSavingTaskId(newTaskId);
      try {
        const baseBindings = { ...homepagePingBindings };
        for (const [taskId, uuids] of Object.entries(baseBindings)) {
          if (uuids.includes(uuid)) {
            baseBindings[taskId] = uuids.filter((id) => id !== uuid);
          }
        }
        const taskKey = String(newTaskId);
        baseBindings[taskKey] = [...(baseBindings[taskKey] || []), uuid];

        const nextSettings: Record<string, unknown> = {
          ...(config.theme_settings ?? {}),
          homepagePingBindings: baseBindings,
        };
        await saveThemeSettings(config.theme, nextSettings);
        await queryClient.invalidateQueries({ queryKey: ["public"] });
        setOpen(false);
        setMenuStyle(null);
      } catch {
        // 切换失败，用户可以重试
      } finally {
        setSaving(false);
        setSavingTaskId(null);
      }
    },
    [uuid, homepagePingBindings, config, saving, queryClient],
  );

  if (visibleTasks.length < 1 || pingTasks.length < 2) return <>{children}</>;

  return (
    <div ref={wrapperRef} onMouseEnter={show} onMouseLeave={hide}>
      {children}
      {open && menuStyle && (
        <Portal>
          <div
            style={menuStyle}
            className="z-50 w-72 rounded-xl border border-[var(--border)] bg-[var(--surface-elev)] p-1.5 shadow-lg"
            onMouseEnter={show}
            onMouseLeave={hide}
          >
            <div className="px-2 py-1.5 text-[11px] font-semibold text-[var(--text-tertiary)]">
              切换检测节点
              {currentTaskName && (
                <span className="ml-1 font-normal">
                  · 当前: {currentTaskName}
                </span>
              )}
            </div>
            <div className="flex flex-col gap-0.5">
              {visibleTasks.map((task) => {
                const isCurrent =
                  currentTaskIdStr != null && String(task.id) === currentTaskIdStr;
                const isLoading = saving && savingTaskId === task.id;
                return (
                  <button
                    key={task.id}
                    type="button"
                    disabled={saving || isCurrent}
                    onClick={(e) => handleSwitch(e, task.id)}
                    className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--hover-bg)] hover:text-[var(--text-primary)] disabled:opacity-50"
                  >
                    <span className="flex-none w-4 text-[var(--text-tertiary)]">
                      {isLoading ? (
                        <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-[var(--border-strong)] border-t-transparent" />
                      ) : isCurrent ? (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      ) : null}
                    </span>
                    <span className="flex-1 truncate">{task.name}</span>
                    {task.target && (
                      <span className="max-w-[100px] flex-none truncate text-[10px] text-[var(--text-tertiary)]">
                        {task.target}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </Portal>
      )}
    </div>
  );
}

function Portal({ children }: { children: ReactNode }) {
  return createPortal(children, document.body);
}
