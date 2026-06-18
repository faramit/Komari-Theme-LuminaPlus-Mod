import { useEffect } from "react";
import { usePreferences } from "@/hooks/usePreferences";
import { useThemeSettings } from "@/hooks/useThemeSettings";
import {
  applyBackgroundCache,
  buildBackgroundCache,
  persistBackgroundCache,
} from "@/utils/background";

/**
 * Keeps the site background + surface-transparency CSS variables in sync with
 * the saved theme settings and the current appearance. Renders nothing — the
 * image is painted by the body::before/::after layers from these variables, and
 * the same values are cached so the index.html inline script can apply them on
 * the first frame (no opaque→glass flash on refresh). With no background image
 * configured the cache/vars are cleared and the solid theme is untouched.
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
