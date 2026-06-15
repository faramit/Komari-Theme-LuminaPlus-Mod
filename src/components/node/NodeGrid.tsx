import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CircleDollarSign } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useAllNodeMeta, useHomeNodeSummaries } from "@/hooks/useNode";
import { useHomepagePingOverview } from "@/hooks/usePingMini";
import { useThemeSettings } from "@/hooks/useThemeSettings";
import { useViewMode } from "@/hooks/useViewMode";
import {
  formatBytes,
  formatTrafficRate,
  formatTrafficRateLabel,
} from "@/utils/format";
import { calculateCostSummary, formatCnyMoney, getExchangeRates } from "@/utils/cost";
import {
  getHomeGroupLabel,
  getHomeGroupOptions,
  HOME_ALL_GROUP,
  sortHomeGroupOptions,
  sortHomeNodeSummaries,
} from "@/utils/homeNodes";
import { Spinner } from "@/components/ui/Spinner";
import { CompactNodeCard } from "./CompactNodeCard";
import { CostSummary } from "./CostSummary";
import { NodeCard } from "./NodeCard";

// Joins uuids into a single signature string for memo keying. A comma is safe:
// node uuids are standard UUIDs ([0-9a-f-]) and never contain one.
const UUID_KEY_SEPARATOR = ",";

interface HomeOverview {
  totalNodes: number;
  onlineNodes: number;
  offlineNodes: number;
  trafficUp: number;
  trafficDown: number;
  netUp: number;
  netDown: number;
}

function HomeOverviewCards({
  overview,
  costSummary,
  costLoading,
  showDetailButton,
  onOpenCostSummary,
}: {
  overview: HomeOverview;
  costSummary: { remainingCny: number } | null;
  costLoading: boolean;
  showDetailButton: boolean;
  onOpenCostSummary: () => void;
}) {
  const [trafficValue, trafficUnit] = formatBytes(
    overview.trafficUp + overview.trafficDown,
  ).split(" ");
  const rate = formatTrafficRate(overview.netUp + overview.netDown);
  const onlinePct =
    overview.totalNodes > 0 ? (overview.onlineNodes / overview.totalNodes) * 100 : 0;
  const offlinePct =
    overview.totalNodes > 0 ? (overview.offlineNodes / overview.totalNodes) * 100 : 0;
  const remainingValue = costSummary
    ? formatCnyMoney(costSummary.remainingCny)
    : costLoading
      ? "计算中"
      : "—";

  return (
    <section className="home-overview" aria-label="首页总览">
      <article className="overview-card">
        <span className="overview-card-label">在线节点</span>
        <div className="overview-card-main">
          <p className="overview-card-value">
            {overview.onlineNodes}
            <span className="overview-card-unit">/ {overview.totalNodes}</span>
          </p>
        </div>
        <div className="overview-bar" role="presentation">
          <span className="overview-bar-online" style={{ width: `${onlinePct}%` }} />
          <span className="overview-bar-offline" style={{ width: `${offlinePct}%` }} />
        </div>
      </article>

      <article className="overview-card">
        <span className="overview-card-label">累计流量</span>
        <div className="overview-card-main">
          <p className="overview-card-value">
            {trafficValue}
            <span className="overview-card-unit">{trafficUnit}</span>
          </p>
        </div>
        <p className="overview-card-sub">
          ↑ {formatBytes(overview.trafficUp)} · ↓ {formatBytes(overview.trafficDown)}
        </p>
      </article>

      <article className="overview-card">
        <span className="overview-card-label">实时带宽</span>
        <div className="overview-card-main">
          <p className="overview-card-value">
            {rate.value}
            <span className="overview-card-unit">{rate.unit}</span>
          </p>
        </div>
        <p className="overview-card-sub">
          ↑ {formatTrafficRateLabel(overview.netUp)} · ↓ {formatTrafficRateLabel(overview.netDown)}
        </p>
      </article>

      <article className="overview-card">
        <div className="overview-card-head">
          <span className="overview-card-label">资产概览</span>
          {showDetailButton && (
            <button
              type="button"
              className="overview-card-action"
              onClick={onOpenCostSummary}
              aria-label="打开资产统计详情"
              title="资产统计"
            >
              <CircleDollarSign size={15} />
            </button>
          )}
        </div>
        <div className="overview-card-main">
          <p className="overview-card-value">{remainingValue}</p>
        </div>
        <p className="overview-card-caption">实时汇率计算</p>
      </article>
    </section>
  );
}

function GroupTabs({
  groups,
  selectedGroup,
  onSelectGroup,
}: {
  groups: string[];
  selectedGroup: string;
  onSelectGroup: (group: string) => void;
}) {
  return (
    <div className="home-group-tabs" role="tablist" aria-label="节点分组">
      <button
        type="button"
        role="tab"
        aria-selected={selectedGroup === HOME_ALL_GROUP}
        data-active={selectedGroup === HOME_ALL_GROUP ? "true" : "false"}
        onClick={() => onSelectGroup(HOME_ALL_GROUP)}
      >
        全部
      </button>
      {groups.map((group) => (
        <button
          key={group}
          type="button"
          role="tab"
          aria-selected={selectedGroup === group}
          data-active={selectedGroup === group ? "true" : "false"}
          onClick={() => onSelectGroup(group)}
          title={group}
        >
          {group}
        </button>
      ))}
    </div>
  );
}

export function NodeGrid() {
  const nodes = useHomeNodeSummaries();
  const allMeta = useAllNodeMeta();
  const { data: me } = useAuth();
  const themeSettings = useThemeSettings();
  const { mode } = useViewMode();
  const [selectedGroup, setSelectedGroup] = useState(HOME_ALL_GROUP);
  const [costSummaryOpen, setCostSummaryOpen] = useState(false);
  useHomepagePingOverview();

  const visibleNodes = useMemo(
    () => nodes.filter((node) => me?.logged_in === true || !node.hidden),
    [me?.logged_in, nodes],
  );
  const overview = useMemo<HomeOverview>(() => {
    let onlineNodes = 0;
    let offlineNodes = 0;
    let trafficUp = 0;
    let trafficDown = 0;
    let netUp = 0;
    let netDown = 0;
    for (const node of visibleNodes) {
      if (node.online === true) onlineNodes += 1;
      else if (node.online === false) offlineNodes += 1;
      trafficUp += node.trafficUp;
      trafficDown += node.trafficDown;
      netUp += node.netUp;
      netDown += node.netDown;
    }

    return {
      totalNodes: visibleNodes.length,
      onlineNodes,
      offlineNodes,
      trafficUp,
      trafficDown,
      netUp,
      netDown,
    };
  }, [visibleNodes]);
  const showHomeOverview = themeSettings.isReady && themeSettings.showHomeOverview;
  const hasNodes = allMeta.length > 0;
  // The 资产概览 card (剩余价值) always shows in the overview so toggling cost
  // settings never reflows the row. showCostSummary gates that card's top-right
  // detail button; the floating ball is a fallback entry — shown only when the
  // detail button isn't (overview hidden or its toggle off), so the two entry
  // points never both appear (when both settings are on, the in-card detail wins).
  const showAssetCard = showHomeOverview && hasNodes;
  const showCostDetailButton =
    showAssetCard && themeSettings.isReady && themeSettings.showCostSummary;
  const showCostFloatingButton =
    themeSettings.isReady &&
    themeSettings.showCostSummaryFloatingButton &&
    hasNodes &&
    !showCostDetailButton;
  // Compute cost whenever something consumes it: the always-on asset card, or the
  // floating ball / panel. The panel is only mounted when it can actually be opened.
  const costNeeded = showAssetCard || showCostFloatingButton;
  const shouldRenderCostSummary = showCostDetailButton || showCostFloatingButton;
  const rateQuery = useQuery({
    queryKey: ["cost-rates", themeSettings.costRateApiUrl],
    queryFn: () => getExchangeRates(themeSettings.costRateApiUrl),
    staleTime: 60 * 60 * 1000,
    enabled: costNeeded,
    retry: 1,
  });
  const costSummary = useMemo(
    () =>
      rateQuery.data
        ? calculateCostSummary(allMeta, themeSettings.costIgnoredNodes, rateQuery.data.rates)
        : null,
    [allMeta, themeSettings.costIgnoredNodes, rateQuery.data],
  );
  const costLoading = costNeeded && rateQuery.isLoading;
  useEffect(() => {
    if (!shouldRenderCostSummary && costSummaryOpen) setCostSummaryOpen(false);
  }, [shouldRenderCostSummary, costSummaryOpen]);
  const groupOptions = useMemo(
    () =>
      sortHomeGroupOptions(
        getHomeGroupOptions(visibleNodes),
        themeSettings.isReady ? themeSettings.homeGroupOrder : [],
      ),
    [visibleNodes, themeSettings.homeGroupOrder, themeSettings.isReady],
  );
  const filteredNodes = useMemo(() => {
    const filtered =
      selectedGroup === HOME_ALL_GROUP
        ? visibleNodes
        : visibleNodes.filter((node) => getHomeGroupLabel(node.group) === selectedGroup);
    return sortHomeNodeSummaries(
      filtered,
      themeSettings.isReady && themeSettings.moveOfflineNodesBack,
    );
  }, [visibleNodes, selectedGroup, themeSettings.isReady, themeSettings.moveOfflineNodesBack]);

  useEffect(() => {
    if (selectedGroup !== HOME_ALL_GROUP && !groupOptions.includes(selectedGroup)) {
      setSelectedGroup(HOME_ALL_GROUP);
    }
  }, [groupOptions, selectedGroup]);

  // The summary objects get a fresh reference every ~1s tick, so filteredNodes
  // (and a naive uuids map) rebuild constantly. Key the rendered card list on a
  // stable uuid signature instead, so the list only re-renders when the set or
  // order actually changes — each card subscribes to its own store slices and
  // updates independently.
  const uuidsKey = useMemo(
    () => filteredNodes.map((node) => node.uuid).join(UUID_KEY_SEPARATOR),
    [filteredNodes],
  );
  const cards = useMemo(() => {
    const uuids = uuidsKey ? uuidsKey.split(UUID_KEY_SEPARATOR) : [];
    return uuids.map((uuid) => (
      <div key={uuid} className="min-w-0">
        {mode === "compact" ? <CompactNodeCard uuid={uuid} /> : <NodeCard uuid={uuid} />}
      </div>
    ));
  }, [uuidsKey, mode]);
  const showGroupTabs =
    themeSettings.isReady && themeSettings.showGroupTabs && groupOptions.length > 0;
  // Shared by the group-tab rail and the card grid so the tab bar sits in the same
  // grid and fills exactly one card column — its edges line up with the first card.
  const gridClassName = mode === "compact" ? "grid gap-3 xl:gap-4" : "grid gap-4 xl:gap-5";
  const gridColumns =
    mode === "compact"
      ? "repeat(auto-fill, minmax(min(100%, 340px), 1fr))"
      : "repeat(auto-fill, minmax(min(100%, 360px), 1fr))";

  if (!themeSettings.isReady) {
    return (
      <div className="flex h-[40vh] items-center justify-center">
        <Spinner size={24} />
      </div>
    );
  }

  if (visibleNodes.length === 0) {
    return (
      <>
        {shouldRenderCostSummary && (
          <CostSummary
            open={costSummaryOpen}
            onOpenChange={setCostSummaryOpen}
            showLauncher={showCostFloatingButton}
          />
        )}
        {showHomeOverview && (
          <HomeOverviewCards
            overview={overview}
            showDetailButton={showCostDetailButton}
            costSummary={costSummary}
            costLoading={costLoading}
            onOpenCostSummary={() => setCostSummaryOpen(true)}
          />
        )}
        <div className="flex h-[40vh] flex-col items-center justify-center gap-2 text-[var(--text-tertiary)]">
          <span className="text-[15px]">尚未连接到任何节点</span>
          <span className="text-[12px]">等待后端推送或前往管理后台添加</span>
        </div>
      </>
    );
  }

  return (
    <>
      {shouldRenderCostSummary && (
        <CostSummary
          open={costSummaryOpen}
          onOpenChange={setCostSummaryOpen}
          showLauncher={showCostFloatingButton}
        />
      )}
      {showHomeOverview && (
        <HomeOverviewCards
          overview={overview}
          showDetailButton={showCostDetailButton}
          costSummary={costSummary}
          costLoading={costLoading}
          onOpenCostSummary={() => setCostSummaryOpen(true)}
        />
      )}
      {showGroupTabs && (
        <div className={`${gridClassName} mb-4`} style={{ gridTemplateColumns: gridColumns }}>
          <GroupTabs
            groups={groupOptions}
            selectedGroup={selectedGroup}
            onSelectGroup={setSelectedGroup}
          />
        </div>
      )}
      <div className={gridClassName} style={{ gridTemplateColumns: gridColumns }}>
        {cards}
      </div>
    </>
  );
}
