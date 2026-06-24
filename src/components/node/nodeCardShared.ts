// NodeCard 和 CompactNodeCard 之间共享的非视觉逻辑。两张卡刻意用不同的 class
// 名和布局,所以 markup 不共享——只共享逻辑和文案,否则改一处另一处会漂移。

/** 卡片标签行的完整 tag 列表 tooltip(两种卡片布局共用同一文案)。 */
export function joinTagTitle(tags: { label: string }[]) {
  return tags.map((tag) => tag.label).join(" / ");
}

/**
 * 卡片首页 ping 区块的空状态文案。绑定了首页 Ping 任务但还没有成功样本的节点显示
 * "无样本";未绑定的节点显示"未配置"。共享以防 NodeCard 和 CompactNodeCard 措辞
 * 漂移。`title` 是较长的标题形式(仅 NodeCard 用);`text` 是两张卡都用的内联占位符。
 */
export function pingEmptyLabels(hasHomepagePingBinding: boolean): { title: string; text: string } {
  return hasHomepagePingBinding
    ? { title: "暂无有效样本", text: "无样本" }
    : { title: "未配置首页 Ping", text: "未配置" };
}

/** 节点卡片头部"查看实例详情"链接的 title 和 aria-label。 */
export function nodeDetailLinkLabels(name: string, osName: string) {
  return {
    title: `${osName} · 查看详情`,
    ariaLabel: `查看 ${name} 详情，系统 ${osName}`,
  };
}

// MiniBars(延迟)和 QualityBars(丢包)共享的柱状条几何/命中检测。两者都渲染
// 定数量的 canvas 柱子行,所以 slot 计算和柱宽/间距必须保持一致。

/** 指针 offset 落在哪个 slot(0..count-1),没有柱子时返回 null。 */
export function getBarSlot(offsetX: number, width: number, count: number): number | null {
  if (count === 0 || width <= 0) return null;
  const slotWidth = width / count;
  return Math.max(0, Math.min(count - 1, Math.floor(offsetX / slotWidth)));
}

/** 跨 `width` px、含 `count` 根柱子的条形,每根柱宽和柱间间距。 */
export function getBarGeometry(width: number, count: number): { gap: number; barWidth: number } {
  const gap = count > 48 ? 1 : 2;
  const barWidth = Math.max(1, (width - gap * (count - 1)) / Math.max(1, count));
  return { gap, barWidth };
}
