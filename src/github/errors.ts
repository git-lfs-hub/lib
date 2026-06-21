export type GithubErrorCode =
  | 'no_installation'
  | 'forbidden'
  | 'missing'
  | 'unauthorized'
  | 'rate_limited'
  | 'transient';

/**
 * Single error class for all GitHub API failures. Consumers inspect `.code`
 * (categorical) and `.status` (HTTP status, when known) to map to their own
 * domain states. `retryAfterMs` is set on `rate_limited` when GitHub tells us
 * how long to wait.
 */
export class GithubError extends Error {
  readonly code: GithubErrorCode;
  readonly status?: number;
  readonly retryAfterMs?: number;
  constructor(code: GithubErrorCode, message: string, status?: number, retryAfterMs?: number) {
    super(message);
    this.name = 'GithubError';
    this.code = code;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

export function isHttpError(e: unknown): e is { status: number; message: string } {
  return (
    typeof e === 'object' &&
    e !== null &&
    'status' in e &&
    typeof (e as { status: unknown }).status === 'number'
  );
}

export function mapHttpError(e: unknown, where: string): GithubError {
  if (isHttpError(e)) {
    if (e.status === 401) return new GithubError('unauthorized', `${where}: 401`, 401);
    // 429, or a 403 carrying rate-limit headers, is throttling — NOT a permission denial.
    // GitHub uses both statuses for primary (remaining=0) and secondary (retry-after) limits.
    if (e.status === 429 || (e.status === 403 && isRateLimited(e)))
      return new GithubError('rate_limited', `${where}: ${e.status}`, e.status, retryAfterMs(e));
    if (e.status === 403) return new GithubError('forbidden', `${where}: 403`, 403);
    if (e.status === 404) return new GithubError('missing', `${where}: 404`, 404);
    return new GithubError('transient', `${where}: ${e.status}`, e.status);
  }
  return new GithubError('transient', e instanceof Error ? e.message : String(e));
}

function isRateLimited(e: unknown): boolean {
  const h = responseHeaders(e);
  return h['x-ratelimit-remaining'] === '0' || h['retry-after'] !== undefined;
}

/** Backoff hint: `Retry-After` seconds (secondary limit), else time until `X-RateLimit-Reset`. */
function retryAfterMs(e: unknown): number | undefined {
  const h = responseHeaders(e);
  const retryAfter = h['retry-after'];
  if (retryAfter !== undefined) return Number(retryAfter) * 1000;
  const reset = h['x-ratelimit-reset'];
  if (reset !== undefined) return Math.max(0, Number(reset) * 1000 - Date.now());
  return undefined;
}

function responseHeaders(e: unknown): Record<string, string | undefined> {
  const res = (e as { response?: { headers?: unknown } }).response;
  return res && typeof res.headers === 'object' && res.headers !== null
    ? (res.headers as Record<string, string | undefined>)
    : {};
}
