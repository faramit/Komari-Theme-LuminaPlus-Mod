// Shared, non-visual bits between NodeCard and CompactNodeCard. The two cards
// deliberately use different class names / layout, so their markup is NOT shared
// — only logic and copy that would otherwise drift if edited in one place.

/** Full tag-list tooltip for a card's chip row (both card layouts share the copy). */
export function joinTagTitle(tags: { label: string }[]) {
  return tags.map((tag) => tag.label).join(" / ");
}

/**
 * Empty-state copy for a card's homepage-ping section. A node bound to a homepage
 * Ping task but with no successful samples yet reads "无样本" (no samples); an
 * unbound node reads "未配置" (unconfigured). Shared so NodeCard and
 * CompactNodeCard can't drift on the wording. `title` is the longer header form
 * (NodeCard only); `text` is the inline placeholder both cards use.
 */
export function pingEmptyLabels(hasHomepagePingBinding: boolean): { title: string; text: string } {
  return hasHomepagePingBinding
    ? { title: "暂无有效样本", text: "无样本" }
    : { title: "未配置首页 Ping", text: "未配置" };
}

/** Title + aria-label for the "view instance details" link in a node card header. */
export function nodeDetailLinkLabels(name: string, osName: string) {
  return {
    title: `${osName} · 查看详情`,
    ariaLabel: `查看 ${name} 详情，系统 ${osName}`,
  };
}

// Bar-strip geometry/hit-test shared by MiniBars (latency) and QualityBars
// (loss). Both render a fixed-count canvas bar row, so the slot math and bar
// width/gap must stay identical between them.

/** Slot index (0..count-1) under a pointer offset, or null when there are no bars. */
export function getBarSlot(offsetX: number, width: number, count: number): number | null {
  if (count === 0 || width <= 0) return null;
  const slotWidth = width / count;
  return Math.max(0, Math.min(count - 1, Math.floor(offsetX / slotWidth)));
}

/** Per-bar width and inter-bar gap for a `count`-bar strip spanning `width` px. */
export function getBarGeometry(width: number, count: number): { gap: number; barWidth: number } {
  const gap = count > 48 ? 1 : 2;
  const barWidth = Math.max(1, (width - gap * (count - 1)) / Math.max(1, count));
  return { gap, barWidth };
}
