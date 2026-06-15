import { clamp, toHsl } from "@/utils/hsl";

export function latencyHeatColor(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) {
    return "var(--text-tertiary)";
  }

  if (ms <= 100) {
    const t = clamp(ms / 100, 0, 1);
    return toHsl(145 - 18 * t, 62 + 8 * t, 48 + 3 * t);
  }

  if (ms <= 150) {
    const t = clamp((ms - 100) / 50, 0, 1);
    return toHsl(127 - 47 * t, 70 + 6 * t, 51 + 1 * t);
  }

  if (ms <= 200) {
    const t = clamp((ms - 150) / 50, 0, 1);
    return toHsl(80 - 30 * t, 76 + 6 * t, 52 + 1 * t);
  }

  if (ms <= 300) {
    const t = clamp((ms - 200) / 100, 0, 1);
    return toHsl(50 - 20 * t, 82 + 4 * t, 53 - 1 * t);
  }

  const t = clamp((ms - 300) / 300, 0, 1);
  return toHsl(30 - 24 * t, 86 - 2 * t, 52 - 8 * t);
}

// Usage heat for the traffic-quota bar: green when there's plenty left, sliding
// through amber to red as used/limit approaches 1. Mirrors the latency/loss
// gradient style so the cards share one visual vocabulary.
export function trafficUsageColor(fraction: number | null | undefined): string {
  if (fraction == null || !Number.isFinite(fraction) || fraction <= 0) {
    return "var(--status-success)";
  }

  const f = clamp(fraction, 0, 1);

  if (f <= 0.6) {
    const t = clamp(f / 0.6, 0, 1);
    return toHsl(146 - 56 * t, 60 + 8 * t, 47 + 3 * t);
  }

  if (f <= 0.85) {
    const t = clamp((f - 0.6) / 0.25, 0, 1);
    return toHsl(90 - 48 * t, 72 + 6 * t, 51);
  }

  const t = clamp((f - 0.85) / 0.15, 0, 1);
  return toHsl(42 - 36 * t, 80 + 4 * t, 52 - 5 * t);
}

export function lossHeatColor(pct: number | null | undefined): string {
  if (pct == null || !Number.isFinite(pct) || pct < 0) {
    return "var(--text-tertiary)";
  }

  if (pct <= 1) {
    const t = clamp(pct / 1, 0, 1);
    return toHsl(145 - 18 * t, 62 + 8 * t, 48 + 3 * t);
  }

  if (pct <= 3) {
    const t = clamp((pct - 1) / 2, 0, 1);
    return toHsl(127 - 47 * t, 70 + 6 * t, 51 + 1 * t);
  }

  if (pct <= 5) {
    const t = clamp((pct - 3) / 2, 0, 1);
    return toHsl(80 - 30 * t, 76 + 6 * t, 52 + 1 * t);
  }

  if (pct <= 10) {
    const t = clamp((pct - 5) / 5, 0, 1);
    return toHsl(50 - 20 * t, 82 + 4 * t, 53 - 1 * t);
  }

  const t = clamp((pct - 10) / 20, 0, 1);
  return toHsl(30 - 24 * t, 86 - 2 * t, 52 - 8 * t);
}
