/**
 * Subscribe to a MediaQueryList's `change` event and return an unsubscribe
 * function. Falls back to the deprecated addListener/removeListener pair for
 * Safari < 14, which never shipped addEventListener on MediaQueryList.
 */
export function subscribeMediaQuery(mq: MediaQueryList, handler: () => void): () => void {
  if (typeof mq.addEventListener === "function") {
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }
  mq.addListener(handler);
  return () => mq.removeListener(handler);
}
