export const SEND_REQUEST_TIMEOUT_MS = 15000;

export class RequestTimeoutError extends Error {
  readonly name = "RequestTimeoutError";
  constructor(message = "The request took too long. Please try again.") {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Run an async operation with a hard timeout. The operation receives an
 * AbortSignal it can forward to fetch/customFetch so the underlying
 * network call is actually cancelled (not just ignored) when the timeout
 * fires. This guarantees the caller's spinner/UI is never left hanging on
 * a stuck network request.
 */
export async function withTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number = SEND_REQUEST_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await run(controller.signal);
  } catch (err) {
    if (controller.signal.aborted) {
      throw new RequestTimeoutError();
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
