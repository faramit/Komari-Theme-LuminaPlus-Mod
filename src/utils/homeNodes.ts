import type { HomeNodeSummary } from "@/services/wsStore";

export const HOME_ALL_GROUP = "__all__";

export function getHomeGroupLabel(group: string) {
  return group.trim();
}

export function getHomeGroupOptions(nodes: HomeNodeSummary[]) {
  const seen = new Set<string>();
  const groups: string[] = [];

  for (const node of nodes) {
    const label = getHomeGroupLabel(node.group);
    if (!label) continue;
    if (seen.has(label)) continue;
    seen.add(label);
    groups.push(label);
  }

  return groups;
}

export function sortHomeNodeSummaries(
  nodes: HomeNodeSummary[],
  moveOfflineNodesBack: boolean,
) {
  if (!moveOfflineNodesBack) return nodes;
  return [...nodes].sort((left, right) => {
    const leftOffline = left.online === false ? 1 : 0;
    const rightOffline = right.online === false ? 1 : 0;
    if (leftOffline !== rightOffline) return leftOffline - rightOffline;
    if (left.weight !== right.weight) return left.weight - right.weight;
    return left.uuid.localeCompare(right.uuid);
  });
}
