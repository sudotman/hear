export const DEFAULT_FETCH_TIMEOUT_MS = 30_000;

export function isAbortError(error) {
  return error?.name === "AbortError";
}

export async function fetchWithTimeout(resource, options = {}, timeoutMs = DEFAULT_FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const upstreamSignal = options.signal;
  const abortFromUpstream = () => controller.abort(upstreamSignal.reason);

  if (upstreamSignal?.aborted) abortFromUpstream();
  else upstreamSignal?.addEventListener("abort", abortFromUpstream, { once: true });

  const timeoutError = new Error("The request took too long. Try again in a moment.");
  timeoutError.name = "TimeoutError";
  const timer = setTimeout(() => controller.abort(timeoutError), timeoutMs);

  try {
    return await fetch(resource, { ...options, signal: controller.signal });
  } catch (error) {
    if (controller.signal.reason?.name === "TimeoutError") throw controller.signal.reason;
    throw error;
  } finally {
    clearTimeout(timer);
    upstreamSignal?.removeEventListener("abort", abortFromUpstream);
  }
}
