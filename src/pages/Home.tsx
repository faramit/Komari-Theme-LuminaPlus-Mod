import { lazy, Suspense } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { Lock } from "lucide-react";
import { NodeGrid } from "@/components/node/NodeGrid";
import { Spinner } from "@/components/ui/Spinner";
import { useAuth } from "@/hooks/useAuth";
import { usePublicConfig } from "@/hooks/usePublicConfig";

const ThemeManage = lazy(() =>
  import("@/pages/ThemeManage").then((module) => ({ default: module.ThemeManage })),
);

export function Home() {
  const [searchParams] = useSearchParams();
  const {
    data: me,
    isPending: authPending,
    isFetching: authFetching,
    error: authError,
    refetch: refetchAuth,
  } = useAuth();
  const { data: publicConfig } = usePublicConfig();
  const isThemeManageView = searchParams.get("view") === "theme-manage";

  if (isThemeManageView) {
    if (me?.logged_in) {
      return (
        <Suspense
          fallback={
            <div className="flex min-h-[60vh] items-center justify-center">
              <Spinner size={24} />
            </div>
          }
        >
          <ThemeManage />
        </Suspense>
      );
    }

    if (authPending || (!me && authFetching)) {
      return (
        <div className="flex min-h-[60vh] items-center justify-center">
          <Spinner size={24} />
        </div>
      );
    }

    if (authError) {
      return (
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
          <div className="space-y-2">
            <div className="text-[15px] font-semibold text-[var(--text-primary)]">
              无法确认当前登录状态
            </div>
            <p className="max-w-[32rem] text-[13px] text-[var(--text-secondary)]">
              {authError instanceof Error ? authError.message : "请稍后重试。"}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => {
                void refetchAuth();
              }}
              className="control-button px-4 py-2 text-[13px] font-medium"
            >
              重试
            </button>
            <Link to="/" className="control-button px-4 py-2 text-[13px] font-medium">
              返回首页
            </Link>
          </div>
        </div>
      );
    }

    return <Navigate to="/" replace />;
  }

  // 私有站点拦截页。后端把 /api/public、/api/me 加进白名单（web/api/Auth.go
  // publicPaths），就是为了让前端能识别这个状态并提示登录,而不是让每个节点请求
  // 都 401 变成空白网格。
  //
  // 默认渲染网格,只有明确知道站点私有且访客确实未登录时才换成拦截页:这样常见的
  // 公开访问不会卡在 /api/public 的整页 spinner 上,而等待 authPending 也保证私有
  // 站点的已登录访客不会看到拦截页一闪。/api/public 偶发失败会落到网格(无法判定
  // 私有),这是可接受的取舍。
  if (publicConfig?.private_site === true && !authPending && me?.logged_in !== true) {
    return <PrivateSiteGate />;
  }

  return (
    <div className="py-2">
      <NodeGrid />
    </div>
  );
}

// 私有站点对匿名访客显示。登录由 Komari 后端负责(密码 / OAuth / 2FA 都在
// /admin),所以这里新开标签页跳过去,而不是自己重写一套登录表单。访客回来时
// useAuth 的 refetchOnWindowFocus 会重新校验,登录后拦截页自动消失,无需手动刷新。
function PrivateSiteGate() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <div className="grid h-12 w-12 place-items-center rounded-full bg-[var(--surface-elev)] text-[var(--text-tertiary)]">
        <Lock size={22} strokeWidth={2} />
      </div>
      <div className="space-y-2">
        <div className="text-[15px] font-semibold text-[var(--text-primary)]">
          站点已设为私有
        </div>
        <p className="max-w-[32rem] text-[13px] text-[var(--text-secondary)]">
          登录后即可查看节点数据。
        </p>
      </div>
      <a
        href="/admin"
        target="_blank"
        rel="noopener noreferrer"
        className="control-button px-4 py-2 text-[13px] font-medium"
      >
        前往登录
      </a>
    </div>
  );
}
