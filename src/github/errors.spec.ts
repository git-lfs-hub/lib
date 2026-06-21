import { test, expect, describe } from 'vitest';

import { mapHttpError, GithubError } from './errors';

function httpError(status: number, headers?: Record<string, string>) {
  return Object.assign(new Error(String(status)), {
    status,
    response: headers ? { headers } : undefined,
  });
}

describe('mapHttpError', () => {
  test('401 → unauthorized', () => {
    expect(mapHttpError(httpError(401), 'w')).toMatchObject({ code: 'unauthorized', status: 401 });
  });

  test('plain 403 (no rate headers) → forbidden', () => {
    expect(mapHttpError(httpError(403), 'w')).toMatchObject({ code: 'forbidden', status: 403 });
  });

  test('404 → missing', () => {
    expect(mapHttpError(httpError(404), 'w')).toMatchObject({ code: 'missing', status: 404 });
  });

  test('5xx → transient', () => {
    expect(mapHttpError(httpError(503), 'w')).toMatchObject({ code: 'transient', status: 503 });
  });

  test('non-HTTP throw → transient', () => {
    expect(mapHttpError(new Error('boom'), 'w')).toMatchObject({ code: 'transient' });
  });

  test('429 → rate_limited', () => {
    expect(mapHttpError(httpError(429), 'w')).toMatchObject({ code: 'rate_limited', status: 429 });
  });

  test('403 with exhausted primary limit (remaining=0) → rate_limited, not forbidden', () => {
    const err = mapHttpError(httpError(403, { 'x-ratelimit-remaining': '0' }), 'w');
    expect(err).toMatchObject({ code: 'rate_limited', status: 403 });
  });

  test('403 secondary limit → rate_limited with Retry-After backoff', () => {
    const err = mapHttpError(httpError(403, { 'retry-after': '30' }), 'w');
    expect(err).toBeInstanceOf(GithubError);
    expect(err.code).toBe('rate_limited');
    expect(err.retryAfterMs).toBe(30_000);
  });

  test('rate_limited derives backoff from X-RateLimit-Reset when no Retry-After', () => {
    const reset = Math.floor(Date.now() / 1000) + 60;
    const err = mapHttpError(
      httpError(403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) }),
      'w',
    );
    expect(err.code).toBe('rate_limited');
    expect(err.retryAfterMs).toBeGreaterThan(50_000);
    expect(err.retryAfterMs).toBeLessThanOrEqual(60_000);
  });
});
