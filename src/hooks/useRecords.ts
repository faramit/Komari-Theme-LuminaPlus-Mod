import { useQuery } from "@tanstack/react-query";
import { getLoadRecords, getPingRecords } from "@/services/api";

export function useLoadRecords(uuid: string, hours = 6, enabled = true) {
  return useQuery({
    queryKey: ["records", "load", uuid, hours],
    queryFn: () => getLoadRecords(uuid, hours),
    staleTime: 300_000,
    // 关掉后台自动重拉（聚焦/切标签页的 refetch 会让 uplot-react 重建图表、偶发闪空白）；有手动刷新兜底。
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    enabled: Boolean(uuid) && enabled,
  });
}

export function usePingRecords(uuid: string, hours = 6, enabled = true, refreshKey = 0) {
  return useQuery({
    queryKey: ["records", "ping", uuid, hours, refreshKey],
    queryFn: () => getPingRecords(uuid, hours),
    staleTime: 300_000,
    // 关掉后台自动重拉（聚焦/切标签页的 refetch 会让 uplot-react 重建图表、偶发闪空白）；有手动刷新兜底。
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    enabled: Boolean(uuid) && enabled,
  });
}
