import { useEffect } from "react";
import { usePreferences } from "@/hooks/usePreferences";
import { useThemeSettings } from "@/hooks/useThemeSettings";
import {
  applyBackgroundCache,
  buildBackgroundCache,
  persistBackgroundCache,
} from "@/utils/background";

/**
 * 让背景图和表面透明度的 CSS 变量始终跟随主题设置与当前外观。本身不渲染任何东西——背景由
 * body::before/::after 根据这些变量绘制；同一份值还会缓存下来，让 index.html 的内联脚本能在
 * 首帧就应用（刷新时不会出现 opaque→glass 闪烁）。没配背景图时清掉缓存和变量，纯色主题保持不动。
 */
export function BackgroundLayer() {
  const { resolvedAppearance } = usePreferences();
  const {
    backgroundImage,
    backgroundImageMobile,
    backgroundAlignment,
    surfaceOpacity,
    isReady,
  } = useThemeSettings();

  useEffect(() => {
    if (!isReady) return;
    const cache = buildBackgroundCache({
      backgroundImage,
      backgroundImageMobile,
      backgroundAlignment,
      surfaceOpacity,
    });
    persistBackgroundCache(cache);
    applyBackgroundCache(cache, resolvedAppearance);
  }, [
    isReady,
    backgroundImage,
    backgroundImageMobile,
    backgroundAlignment,
    surfaceOpacity,
    resolvedAppearance,
  ]);

  return null;
}
