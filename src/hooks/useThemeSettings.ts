import { useMemo } from "react";
import { usePublicConfig } from "@/hooks/usePublicConfig";
import { normalizeThemeSettings, type ResolvedThemeSettings } from "@/utils/themeSettings";

export type ThemeSettingsState = ResolvedThemeSettings & {
  /**
   * 服务端 config 到达后为 true。config 请求失败时它也会变 true，
   * 让应用回退到默认值，而不是一直空白。
   */
  isReady: boolean;
  isLoading: boolean;
  isError: boolean;
};

export function useThemeSettings(): ThemeSettingsState {
  const { data: config, isError, isLoading } = usePublicConfig();
  return useMemo(
    () => {
      const hasConfig = config != null;
      return {
        ...normalizeThemeSettings(config?.theme_settings),
        isReady: hasConfig || isError,
        isLoading: isLoading && !hasConfig,
        isError,
      };
    },
    [config, isError, isLoading],
  );
}
