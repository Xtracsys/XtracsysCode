/** Limits apply to decoded HTTP body bytes (including decompressed responses). */
export const OPENAI_RESPONSE_LIMITS = {
  modelBytes: 1_048_576,
  errorBytes: 16_384,
  streamBytes: 16_777_216,
  lineBytes: 262_144,
  eventBytes: 1_048_576,
  eventLines: 256,
  toolBytes: 1_048_576,
  toolCalls: 128,
} as const;

/** Whole-stream deadline shared by every provider: local generation is slow, but a
 *  wedged or malicious endpoint must not hold a turn open (or grow memory) forever. */
export const STREAM_DEADLINE_MS = 600_000;

export class ResponseLimitError extends Error {}

/** Own and clear the deadline and caller listener, including fast success paths. */
export function requestLifetime(timeoutMs: number, caller?: AbortSignal) {
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort(caller?.reason);
  if (caller?.aborted) onAbort();
  else caller?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error("request timed out"));
  }, timeoutMs);
  return {
    signal: controller.signal,
    get timedOut() { return timedOut; },
    dispose() { clearTimeout(timer); caller?.removeEventListener("abort", onAbort); },
  };
}

/** Also cancels non-fetch streams used by adapters/tests when the signal fires. */
export function abortReader(reader: ReadableStreamDefaultReader<Uint8Array>, signal: AbortSignal) {
  const cancel = () => { void reader.cancel(signal.reason).catch(() => undefined); };
  if (signal.aborted) cancel();
  else signal.addEventListener("abort", cancel, { once: true });
  return () => signal.removeEventListener("abort", cancel);
}

export async function boundedResponseText(response: Response, maxBytes: number, label: string, signal: AbortSignal): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const detach = abortReader(reader, signal);
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    for (;;) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) return text + decoder.decode();
      bytes += value.byteLength;
      if (bytes > maxBytes) throw new ResponseLimitError(`${label} exceeded the ${maxBytes} byte limit`);
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    detach();
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
