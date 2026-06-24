import { useQuery } from "@tanstack/react-query";
import { getMe } from "@/services/api";

export function useAuth() {
  return useQuery({
    queryKey: ["me"],
    queryFn: getMe,
    // 保持登录状态相对新鲜（从后台登录页返回时重新聚焦仍会重新校验），
    // 又不会每次挂载和每次聚焦抖动都重新请求——之前那样会把 /api/me 刷爆。
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}
