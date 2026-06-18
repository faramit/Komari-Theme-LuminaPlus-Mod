interface ManagedTimeoutSignal {
  signal: AbortSignal;
  // Clears the pending timeout and detaches the upstream-abort listener.
  // Idempotent — safe to call from a finally block and again on abort.
  cleanup: () => void;
}

// Combine an optional upstream signal with a timeout under a single controller.
// The timer is always self-managed (never AbortSignal.timeout, whose timer
// lingers for the full duration even after the work settles), so `cleanup` can
// cancel it the instant the caller is done. Consumed by signalWithTimeout (which
// drops the handle) and fetchWithTimeout (which runs it in finally).
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

// Derive an AbortSignal that fires when `signal` aborts or `ms` elapses.
//
// NOTE: this drops the cleanup handle, so its timer survives until it fires even
// if the work finished first (bounded churn — one timer per call, capped at the
// timeout). Callers that own the request lifecycle should prefer fetchWithTimeout
// so the timer is cancelled the moment the request settles.
export function signalWithTimeout(
  signal: AbortSignal | undefined,
  ms: number,
): AbortSignal {
  return createTimeoutSignal(signal, ms).signal;
}

// fetch() whose timeout timer and upstream-abort listener are torn down the
// instant the request settles — success or failure — rather than lingering until
// the timeout elapses. Prefer this over fetch(url, { signal: signalWithTimeout })
// on hot paths.
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
