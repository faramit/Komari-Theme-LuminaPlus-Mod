import { usePreferences } from "@/hooks/usePreferences";

// 挂载这个 hook 会初始化 preferences store 并订阅外观变化。DOM 写入
// （data-appearance、color-scheme、theme-color）统一在 usePreferences 的 commit()
// 里完成，所以这里没有单独的 DOM 写入 effect。
export function useAppearance() {
  return usePreferences().resolvedAppearance;
}
