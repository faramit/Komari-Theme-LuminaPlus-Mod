import { useCallback, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getAdminPingTasks, getPingOverview, saveThemeSettings } from "@/services/api";
import { useThemeSettings } from "@/hooks/useThemeSettings";
import { usePublicConfig } from "@/hooks/usePublicConfig";
import { buildPingOverviewItems, setPingPreview } from "@/hooks/usePingMini";
import { invertHomepagePingTaskBindings } from "@/utils/pingTasks";
import type { ReactNode } from "react";

interface Props {
  uuid: string;
  children: ReactNode;
}

export function PingTaskBar({ uuid, children }: Props) {
  const [saving, setSaving] = useState(false);
  const [savingTaskId, setSavingTaskId] = useState<number | null>(null);
  const queryClient = useQueryClient();
  const { homepagePingBindings, enablePingTaskBar } = useThemeSettings();
  const { data: config } = usePublicConfig();
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const previewAbortRef = useRef<AbortController | null>(null);

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

  const clearPreview = useCallback(() => {
    previewAbortRef.current?.abort();
    previewAbortRef.current = null;
    setPingPreview(uuid, null);
  }, [uuid]);

  const triggerPreview = useCallback(
    async (taskId: number) => {
      if (taskId === currentTaskId) return;
      previewAbortRef.current?.abort();
      const controller = new AbortController();
      previewAbortRef.current = controller;
      try {
        const resp = await getPingOverview(1, taskId, {
          entityIds: [uuid],
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        const items = buildPingOverviewItems(
          taskId,
          resp.records,
          resp.stats ?? [],
          resp.intervalSeconds,
        );
        const item = items.get(uuid);
        if (item) {
          setPingPreview(uuid, item);
        } else {
          setPingPreview(uuid, {
            client: uuid,
            isAssigned: true,
            lastValue: null,
            samples: [],
            max: 1,
            loss: null,
          });
        }
      } catch {
        if (!controller.signal.aborted) {
          setPingPreview(uuid, null);
        }
      }
    },
    [uuid, currentTaskId],
  );

  const handleSwitch = useCallback(
    async (newTaskId: number) => {
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
        clearPreview();
      } catch {
        // 切换失败，用户可以重试
      } finally {
        setSaving(false);
        setSavingTaskId(null);
      }
    },
    [uuid, homepagePingBindings, config, saving, queryClient, clearPreview],
  );

  const handleBarLeave = useCallback(() => {
    timerRef.current = setTimeout(() => {
      clearPreview();
    }, 200);
  }, [clearPreview]);

  const handleSegmentEnter = useCallback(
    (taskId: number) => {
      clearTimeout(timerRef.current);
      triggerPreview(taskId);
    },
    [triggerPreview],
  );

  if (!enablePingTaskBar || visibleTasks.length < 1 || pingTasks.length < 2) return <>{children}</>;

  return (
    <div>
      {children}
      <div
        className="ping-task-bar"
        onMouseLeave={handleBarLeave}
      >
        {visibleTasks.map((task) => {
          const isActive = currentTaskIdStr != null && String(task.id) === currentTaskIdStr;
          const isLoading = saving && savingTaskId === task.id;
          return (
            <button
              key={task.id}
              type="button"
              className={
                "ping-task-bar-segment" +
                (isActive ? " active" : "") +
                (isLoading ? " saving" : "")
              }
              disabled={saving || isActive}
              onClick={() => handleSwitch(task.id)}
              onMouseEnter={() => handleSegmentEnter(task.id)}
              title={task.name}
            >
              <span className="ping-task-bar-track" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
