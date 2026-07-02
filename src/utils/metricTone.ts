import { clamp, toHsl } from "@/utils/hsl";
import { formatByteRate } from "@/utils/format";

export function latencyHeatColor(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) {
    return "var(--text-tertiary)";
  }
  if (ms < 100) return "var(--latency-0, #2bd257)";
  if (ms < 150) return "var(--latency-1, #5bde29)";
  if (ms < 200) return "var(--latency-2, #d6e626)";
  if (ms < 300) return "var(--latency-3, #eca820)";
  return "var(--latency-4, #e25112)";
}

// 流量配额条的用量热力色,按 used/limit 取值,但调成读作"还剩多少":剩 ≥50% 时纯绿,随着耗尽
// 从绿→琥珀,快用光时再琥珀→红。早先的曲线在整个常见区间都停在绿→黄绿,用量超 85% 才变红,危险信号
// 基本没出现过。风格与 latency/loss 渐变一致,让各卡片共用一套视觉语言。
export function trafficUsageColor(fraction: number | null | undefined): string {
  if (fraction == null || !Number.isFinite(fraction) || fraction <= 0) {
    return "var(--status-success)";
  }

  const f = clamp(fraction, 0, 1);

  // 剩 ≥50%:保持纯绿,健康的配额绝不读作警告。
  if (f <= 0.5) {
    const t = clamp(f / 0.5, 0, 1);
    return toHsl(150 - 6 * t, 58 + 4 * t, 46 + 2 * t);
  }

  // 剩 50%→22%:绿 → 琥珀。
  if (f <= 0.78) {
    const t = clamp((f - 0.5) / 0.28, 0, 1);
    return toHsl(144 - 104 * t, 62 + 20 * t, 48 + 4 * t);
  }

  // 剩 <22%:琥珀 → 红。
  const t = clamp((f - 0.78) / 0.22, 0, 1);
  return toHsl(40 - 34 * t, 82 + 4 * t, 52 - 6 * t);
}

// 流量配额条位置热力色。`pos` 从 0（最先用掉的字节）到 1（配额耗尽）。
// 用 CSS color-mix 在 `--quota-high`（充足）和 `--quota-low`（耗尽）之间插值，
// 让用户自定义起止色后中间自动渐变。未自定义时回退到 tokens.css 里的 oklch 默认值。
export function trafficQuotaSegmentColor(pos: number): string {
  const p = clamp(pos, 0, 1);
  const pct = (1 - p) * 100;
  return `color-mix(in oklch, var(--quota-high, #2f9e65) ${pct.toFixed(1)}%, var(--quota-low, #dc2626))`;
}

// 速率按"现实可见的四档"着色,量级越大越"热"。单机网卡基本到不了 TB/s·PB/s,不再为它们各留一档,
// 而是把日常常见区间拆开:B/s 超低速(绿) → KB/s 低速(琥珀) → MB/s 高速(橙) → GB/s 及以上 急速(红)。
// GB/TB/PB 全并入急速顶档。挂机(B/s)归最低档保持有色,只有未知单位才回退中性色。
const SPEED_RATE_COLOR: Record<string, string> = {
  "B/s": "var(--speed-idle)",
  "KB/s": "var(--speed-low)",
  "MB/s": "var(--speed-high)",
  "GB/s": "var(--speed-max)",
  "TB/s": "var(--speed-max)",
  "PB/s": "var(--speed-max)",
};

export function speedRateColor(unit: string): string {
  return SPEED_RATE_COLOR[unit] ?? "var(--text-tertiary)";
}

// 给只有原始字节/秒、没有现成 unit 的场景(如脉冲点):先取单位档再上色,把"字节速率→颜色"集中在一处。
export function speedRateColorFromBytes(bytesPerSec: number): string {
  return speedRateColor(formatByteRate(bytesPerSec).unit);
}

export function lossHeatColor(pct: number | null | undefined): string {
  if (pct == null || !Number.isFinite(pct) || pct < 0) {
    return "var(--text-tertiary)";
  }
  if (pct < 1) return "var(--loss-0, #2bd257)";
  if (pct < 3) return "var(--loss-1, #5bde29)";
  if (pct < 5) return "var(--loss-2, #d6e626)";
  if (pct < 10) return "var(--loss-3, #eca820)";
  return "var(--loss-4, #e25112)";
}
