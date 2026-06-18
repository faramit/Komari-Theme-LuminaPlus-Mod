import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWithTimeout, signalWithTimeout } from "@/utils/abort";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("fetchWithTimeout", () => {
  it("clears the timeout the moment the request settles", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true }) as Response));

    await fetchWithTimeout("/x", undefined, 10_000);

    // The regression we guard: the timeout timer must not outlive the settled
    // request (it used to linger for the full timeout).
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears the timeout even when the request rejects", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("network down");
    }));

    await expect(fetchWithTimeout("/x", undefined, 10_000)).rejects.toThrow("network down");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("passes an unaborted combined signal to fetch", async () => {
    let seen: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: unknown, init?: RequestInit) => {
        seen = init?.signal ?? undefined;
        return { ok: true } as Response;
      }),
    );

    await fetchWithTimeout("/x", undefined, 10_000);
    expect(seen).toBeInstanceOf(AbortSignal);
    expect(seen?.aborted).toBe(false);
  });

  it("propagates an already-aborted upstream signal to fetch", async () => {
    const upstream = new AbortController();
    upstream.abort();
    let seen: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: unknown, init?: RequestInit) => {
        seen = init?.signal ?? undefined;
        return { ok: true } as Response;
      }),
    );

    await fetchWithTimeout("/x", undefined, 10_000, upstream.signal);
    expect(seen?.aborted).toBe(true);
  });
});

describe("signalWithTimeout", () => {
  it("aborts the derived signal once the timeout elapses", () => {
    vi.useFakeTimers();
    const signal = signalWithTimeout(undefined, 5_000);
    expect(signal.aborted).toBe(false);
    vi.advanceTimersByTime(5_000);
    expect(signal.aborted).toBe(true);
  });

  it("aborts immediately when the upstream is already aborted", () => {
    const upstream = new AbortController();
    upstream.abort();
    expect(signalWithTimeout(upstream.signal, 5_000).aborted).toBe(true);
  });
});
