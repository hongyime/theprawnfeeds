const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

class FeedError extends Error {
  constructor(message, status = 502, retryAfter = 0) {
    super(message);
    this.name = 'FeedError';
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

function createBudget(milliseconds = 25000, parentSignal = null) {
  const controller = new AbortController();
  const deadline = Date.now() + milliseconds;
  const parentAbort = () => controller.abort(parentSignal.reason);
  if (parentSignal?.aborted) parentAbort();
  else parentSignal?.addEventListener('abort', parentAbort, { once: true });
  const timer = setTimeout(() => controller.abort(new FeedError('Feed request timed out', 504)), milliseconds);
  return {
    signal: controller.signal,
    remaining: () => Math.max(0, deadline - Date.now()),
    async run(operation) {
      controller.signal.throwIfAborted();
      let listener;
      const cancelled = new Promise((_, reject) => {
        listener = () => reject(controller.signal.reason);
        controller.signal.addEventListener('abort', listener, { once: true });
      });
      try { return await Promise.race([Promise.resolve().then(operation), cancelled]); }
      finally { controller.signal.removeEventListener('abort', listener); }
    },
    close() { clearTimeout(timer); parentSignal?.removeEventListener('abort', parentAbort); }
  };
}

function discard(response) {
  try { Promise.resolve(response?.body?.cancel()).catch(() => {}); } catch { /* Already consumed. */ }
}

async function readLimited(response, budget, maxBytes = MAX_RESPONSE_BYTES) {
  if (Number(response.headers?.get('content-length')) > maxBytes) {
    discard(response);
    throw new FeedError('Feed response exceeded size limit', 413);
  }
  if (!response.body?.getReader) {
    const text = await budget.run(() => response.text());
    if (Buffer.byteLength(text, 'utf8') > maxBytes) throw new FeedError('Feed response exceeded size limit', 413);
    return text;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await budget.run(() => reader.read());
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) throw new FeedError('Feed response exceeded size limit', 413);
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join('');
  } catch (error) {
    try { Promise.resolve(reader.cancel()).catch(() => {}); } catch { /* Best-effort cleanup. */ }
    throw error;
  } finally {
    try { reader.releaseLock(); } catch { /* Cancellation may still be settling. */ }
  }
}

function retryAfterSeconds(value, now = Date.now()) {
  if (typeof value !== 'string' || !value.trim()) return 60;
  const seconds = /^\d+$/.test(value.trim()) ? Number(value) : (Date.parse(value) - now) / 1000;
  return Number.isFinite(seconds) ? Math.max(1, Math.ceil(Math.min(seconds, Number.MAX_SAFE_INTEGER / 1000))) : 60;
}

async function fetchText(url, { budget, accept, retries = 1, retry404 = false, timeoutMs = 8000, fetchImpl = fetch } = {}) {
  for (let attempt = 0; ; attempt++) {
    budget.signal.throwIfAborted();
    const attemptBudget = createBudget(Math.max(1, Math.min(timeoutMs, budget.remaining())), budget.signal);
    const signal = attemptBudget.signal;
    try {
      return await budget.run(() => attemptBudget.run(async () => {
        const response = await fetchImpl(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RSS Reader/1.0)', Accept: accept,
            'Accept-Language': 'en-US,en;q=0.9' },
          redirect: 'manual', signal
        });
        if (!response.ok || response.status === 202) {
          discard(response);
          throw new FeedError(`HTTP ${response.status}`, response.status,
            response.status === 429 ? retryAfterSeconds(response.headers?.get('retry-after')) : 0);
        }
        return readLimited(response, attemptBudget);
      }));
    } catch (error) {
      budget.signal.throwIfAborted();
      const retryable = error.status >= 500 || (retry404 && error.status === 404)
        || error instanceof TypeError || ['ECONNRESET','ETIMEDOUT','EAI_AGAIN'].includes(error.cause?.code);
      if (!retryable || attempt >= retries || budget.remaining() < 1350) throw error;
    } finally {
      attemptBudget.close();
    }
    await budget.run(() => new Promise(resolve => setTimeout(resolve, 350)));
  }
}

module.exports = { FeedError, createBudget, fetchText, readLimited, retryAfterSeconds };
