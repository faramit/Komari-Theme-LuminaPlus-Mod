import { useMemo } from "react";
import { useNodeMeta, useNodeMetrics, useNodeTrafficTrend } from "@/hooks/useNode";
import { useNodePingOverview, usePingBuckets } from "@/hooks/usePingMini";
import { useThemeSettings } from "@/hooks/useThemeSettings";
import { formatRenewalPrice } from "@/utils/billing";
import { getExpireTextColor } from "@/utils/expireStatus";
import {
  formatBytes,
  formatByteRate,
  formatExpireDays,
  formatUptimeDays,
  joinDisplayParts,
  parseTags,
} from "@/utils/format";
import { latencyHeatColor, lossHeatColor, trafficUsageColor } from "@/utils/metricTone";
import { resolveTrafficUsage, trafficTypeLabel, type TrafficDisplay } from "@/utils/traffic";
import { resolveOsInfo } from "@/components/ui/OsLogo";

export function useNodeCardModel(uuid: string, pingBucketCount?: number) {
  const meta = useNodeMeta(uuid);
  const metrics = useNodeMetrics(uuid);
  const trafficTrend = useNodeTrafficTrend(uuid);
  const ping = useNodePingOverview(uuid);
  const pingBuckets = usePingBuckets(ping, pingBucketCount);

  const { showCardGroup } = useThemeSettings();

  // meta 派生字段（tag 解析、到期、续费价、OS 查询）只在 meta 变化时才变（很少），
  // 不能每秒 metrics 刷新都重算，所以单独用一个只依赖 meta 的 memo。
  const metaModel = useMemo(() => {
    if (!meta) return null;
    const tags = parseTags(meta.tags);
    const group = showCardGroup ? meta.group : undefined;
    const subtitleParts = [group, meta.public_remark]
      .map((part) => part?.trim())
      .filter((part): part is string => Boolean(part));
    const subtitleLabels = new Set(subtitleParts.map((part) => part.toLowerCase()));
    const compactFooterTags = tags.filter(
      (tag) => !subtitleLabels.has(tag.label.trim().toLowerCase()),
    );
    const fallbackFooterTags =
      tags.length > 0
        ? tags
        : meta.group
          ? [{ label: meta.group, color: "gray" }]
          : [];
    return {
      tags,
      footerTags: fallbackFooterTags,
      compactFooterTags,
      subtitle: joinDisplayParts(subtitleParts),
      expire: formatExpireDays(meta.expired_at),
      expireColor: getExpireTextColor(meta.expired_at),
      renewalPrice: formatRenewalPrice(meta),
      osName: resolveOsInfo(meta.os).name,
      loadBaseline: meta.cpu_cores > 0 ? meta.cpu_cores : 4,
    };
  }, [meta, showCardGroup]);

  // ping 派生的颜色只在 ping item 变化时才变。
  const pingModel = useMemo(
    () => ({
      latencyColor: latencyHeatColor(ping.lastValue),
      lossColor: lossHeatColor(ping.loss),
      hasHomepagePingBinding: ping.isAssigned,
    }),
    [ping],
  );

  return useMemo(() => {
    if (!meta || !metrics || !metaModel) {
      return {
        node: undefined,
        trafficTrend,
        ping,
        pingBuckets,
      };
    }

    const { loadBaseline } = metaModel;

    // 流量配额：按节点的 traffic_limit_type（与后端一致）把累计上/下行算成"已用"，
    // 在这里一次性算出剩余和使用占比，让两种卡片布局共用这套计算。
    const trafficUsage = resolveTrafficUsage(
      meta.traffic_limit_type,
      metrics.trafficUp,
      metrics.trafficDown,
      meta.traffic_limit,
    );
    const trafficUsedLabel = formatBytes(trafficUsage.used);
    // 不限量时渲染成 ∞，让剩余值和"已用/上限"那行与限量情况保持一致
    //（"剩余 ∞" + "2.73 GB / ∞"）。
    const trafficLimitLabel = trafficUsage.unlimited ? "∞" : formatBytes(trafficUsage.limit);
    const traffic: TrafficDisplay = {
      fraction: trafficUsage.fraction,
      color: trafficUsage.unlimited
        ? "var(--status-success)"
        : trafficUsageColor(trafficUsage.fraction),
      remainingLabel: trafficUsage.unlimited ? "∞" : formatBytes(trafficUsage.remaining),
      detail: `${trafficUsedLabel} / ${trafficLimitLabel}`,
      typeLabel: trafficTypeLabel(meta.traffic_limit_type),
    };

    return {
      node: { ...meta, ...metrics },
      trafficTrend,
      ping,
      pingBuckets,
      traffic,
      ...metaModel,
      ...pingModel,
      uptime: formatUptimeDays(metrics.uptime),
      loadFraction: Math.max(0, Math.min(1, metrics.load1 / loadBaseline)),
      upRate: formatByteRate(metrics.netUp),
      downRate: formatByteRate(metrics.netDown),
      isOnline: metrics.online === true,
      isOffline: metrics.online === false,
    };
  }, [meta, metrics, metaModel, pingModel, ping, pingBuckets, trafficTrend]);
}
