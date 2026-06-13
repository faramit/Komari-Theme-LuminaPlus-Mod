import { useMemo } from "react";
import { usePublicConfig } from "@/hooks/usePublicConfig";
import { normalizeThemeSettings, type ResolvedThemeSettings } from "@/utils/themeSettings";

export type ThemeSettingsState = ResolvedThemeSettings & {
  /**
   * True once the server config has arrived. If the config request fails, this
   * also becomes true so the app can fall back to defaults instead of staying
   * blank forever.
   */
  isReady: boolean;
  isLoading: boolean;
  isError: boolean;
};

export function useThemeSettings(): ThemeSettingsState {
  const { data: config, isError, isLoading } = usePublicConfig();
  const hasConfig = config != null;
  const isReady = hasConfig || isError;
  return useMemo(
    () => ({
      ...normalizeThemeSettings(config?.theme_settings),
      isReady,
      isLoading: isLoading && !hasConfig,
      isError,
    }),
    [config?.theme_settings, hasConfig, isError, isLoading, isReady],
  );
}
