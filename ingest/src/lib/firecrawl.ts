import { sourceEndpoint } from './config.js';
import { isRecord } from '../validate.js';

// Official REST contract: https://docs.firecrawl.dev/api-reference/endpoint/scrape
const FIRECRAWL_SCRAPE_URL = 'https://api.firecrawl.dev/v2/scrape';
const REMOTE_TIMEOUT_MS = 60_000;
export const MAX_HTML_RESPONSE_BYTES = 8 * 1024 * 1024;
const PLAIN_FETCH_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
interface RequestOptions { fetchImpl?: typeof fetch; timeoutMs?: number; onFallback?(): void }
class ScrapeRequestError extends Error {}

function targetUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('Source URL must be a valid HTTP(S) URL'); }
  if (url.username || url.password || url.hash) throw new Error('Source URL must not contain credentials or a fragment');
  // Reuse the configured source rules, allowing the passage query on the target URL.
  sourceEndpoint(url.origin, '');
  return url.href;
}

/** Bound headers, streamed bytes and total elapsed time, including response-body reads. */
async function requestText(url: string, init: RequestInit, label: string, options: RequestOptions, defaultTimeoutMs: number): Promise<string> {
  const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 65_000) throw new Error('Request timeout must be between 1 and 65000 milliseconds');
  const controller = new AbortController();
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutError = () => new ScrapeRequestError(`${label} request timed out`);
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { expired = true; reject(timeoutError()); controller.abort(); }, timeoutMs);
  });
  try {
    const request = (async () => {
      const response = await (options.fetchImpl ?? fetch)(url, { ...init, redirect: init.redirect ?? 'error', signal: controller.signal });
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        throw new ScrapeRequestError(`${label} request failed (HTTP ${response.status})`);
      }
      const length = Number(response.headers.get('content-length'));
      if (Number.isFinite(length) && length > MAX_HTML_RESPONSE_BYTES) {
        await response.body?.cancel().catch(() => {});
        throw new ScrapeRequestError(`${label} response exceeds ${MAX_HTML_RESPONSE_BYTES} bytes`);
      }
      if (!response.body) throw new ScrapeRequestError(`${label} returned an empty response`);
      const reader = response.body.getReader();
      const abortBody = () => { void reader.cancel().catch(() => {}); };
      controller.signal.addEventListener('abort', abortBody, { once: true });
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      try {
        while (true) {
          if (controller.signal.aborted) throw timeoutError();
          const { value, done } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > MAX_HTML_RESPONSE_BYTES) throw new ScrapeRequestError(`${label} response exceeds ${MAX_HTML_RESPONSE_BYTES} bytes`);
          chunks.push(value);
        }
        return Buffer.concat(chunks, bytes).toString('utf8');
      } finally {
        controller.signal.removeEventListener('abort', abortBody);
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
    })();
    return await Promise.race([request, deadline]);
  } catch (error) {
    if (expired) throw timeoutError();
    if (error instanceof ScrapeRequestError) throw error;
    // Provider responses and fetch errors can contain URLs or credentials. Do not expose them.
    throw new ScrapeRequestError(`${label} request failed`);
  } finally { clearTimeout(timer); }
}

/** Only the documented rawHtml format is needed; the REST payload nests it under data. */
export async function scrapeFirecrawlRawHtml(url: string, apiKey: string, options: RequestOptions = {}): Promise<string> {
  const target = targetUrl(url);
  if (!apiKey.trim() || /[\r\n]/.test(apiKey)) throw new Error('FIRECRAWL_API_KEY is required for the scraping fallback');
  const text = await requestText(FIRECRAWL_SCRAPE_URL, {
    method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: target, formats: ['rawHtml'], onlyMainContent: false, timeout: REMOTE_TIMEOUT_MS }),
  }, 'Firecrawl', options, REMOTE_TIMEOUT_MS + 5_000);
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new ScrapeRequestError('Firecrawl returned an invalid response'); }
  if (!isRecord(raw) || raw.success !== true || !isRecord(raw.data)) throw new ScrapeRequestError('Firecrawl scrape failed');
  const data = raw.data;
  if (isRecord(data.metadata) && 'statusCode' in data.metadata) {
    const status = data.metadata.statusCode;
    if (typeof status !== 'number' || !Number.isInteger(status)) throw new ScrapeRequestError('Firecrawl returned an invalid page status');
    if (!(status >= 200 && status < 300) && status !== 304) throw new ScrapeRequestError(`Firecrawl target page failed (HTTP ${status})`);
  }
  if (typeof data.rawHtml !== 'string' || !data.rawHtml.trim()) throw new ScrapeRequestError('Firecrawl returned empty or invalid raw HTML');
  return data.rawHtml;
}

/** Preserve the free direct fetch first; use Firecrawl only when it fails or looks blocked. */
export async function fetchSourceHtml(url: string, apiKey: string, options: RequestOptions = {}): Promise<string> {
  const target = targetUrl(url);
  try {
    const html = await requestText(target, { redirect: 'follow', headers: { 'User-Agent': PLAIN_FETCH_UA } }, 'Source', options, 30_000);
    if (html.length < 10_000 || !html.includes('passage-content')) throw new ScrapeRequestError('Source returned an invalid passage response');
    return html;
  } catch (error) {
    if (!apiKey) throw error;
    options.onFallback?.();
    return scrapeFirecrawlRawHtml(target, apiKey, options);
  }
}
