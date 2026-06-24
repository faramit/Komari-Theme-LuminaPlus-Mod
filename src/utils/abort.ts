interface ManagedTimeoutSignal {
  signal: AbortSignal;
  // 清掉待触发的 timeout 并解绑 upstream abort 监听。幂等,finally 里调用、abort 时再调用都安全。
  cleanup: () => void;
}

// 把可选的 upstream signal 和一个 timeout 合并到同一个 controller 下。timer 始终自己管
// (不用 AbortSignal.timeout,它的定时器即便活儿干完了也会挂满整个时长),这样 cleanup 能在
// 调用方结束的瞬间取消它。signalWithTimeout(丢掉 handle)和 fetchWithTimeout(在 finally 里跑)都用它。
function createTimeoutSignal(
  upstream: AbortSignal | undefined,
  ms: number,
): ManagedTimeoutSignal {
  const controller = new AbortController();
  const delay = Math.max(0, Number.isFinite(ms) ? ms : 0);
  let timer: ReturnType<typeof globalThis.setTimeout> | undefined;
  let cleaned = false;

  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    if (timer !== undefined) globalThis.clearTimeout(timer);
    upstream?.removeEventListener("abort", onUpstreamAbort);
  };

  function onUpstreamAbort() {
    cleanup();
    if (!controller.signal.aborted) controller.abort(upstream?.reason);
  }

  if (upstream?.aborted) {
    controller.abort(upstream.reason);
  } else {
    timer = globalThis.setTimeout(() => {
      cleanup();
      if (!controller.signal.aborted) controller.abort();
    }, delay);
    upstream?.addEventListener("abort", onUpstreamAbort, { once: true });
  }

  return { signal: controller.signal, cleanup };
}

// 派生一个在 `signal` abort 或 `ms` 到时触发的 AbortSignal。
//
// 注意:这里丢掉了 cleanup handle,所以即便活儿先干完,timer 也会一直挂到触发为止(开销有限,
// 每次调用一个 timer,上限就是这个 timeout)。掌握请求生命周期的调用方应优先用 fetchWithTimeout,
// 请求一结束 timer 就被取消。
export function signalWithTimeout(
  signal: AbortSignal | undefined,
  ms: number,
): AbortSignal {
  return createTimeoutSignal(signal, ms).signal;
}

// 请求一结束(不管成功失败)就立刻拆掉 timeout timer 和 upstream abort 监听的 fetch(),而不是
// 一直挂到 timeout 到时。热路径上优先用它,别用 fetch(url, { signal: signalWithTimeout })。
export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  ms: number,
  upstream?: AbortSignal,
): Promise<Response> {
  const { signal, cleanup } = createTimeoutSignal(upstream, ms);
  try {
    return await fetch(input, { ...init, signal });
  } finally {
    cleanup();
  }
}
