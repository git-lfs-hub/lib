import { USER_AGENT } from './api';

// Response headers forwarded from GitHub to the proxy client.
// Allow-list: anything not listed (Set-Cookie, rate-limit, request-id,
// Content-Encoding, Transfer-Encoding, etc.) is dropped to avoid leaking
// GitHub session state and to keep hop-by-hop / body-framing headers honest.
const FORWARDED_RESPONSE_HEADERS = ['Content-Type', 'X-OAuth-Scopes', 'X-Accepted-OAuth-Scopes'];

export async function githubProxyFetch(url: string, init?: RequestInit): Promise<Response> {
  const headers = {
    ...(init?.headers as Record<string, string>),
    'User-Agent': USER_AGENT,
  };
  const res = await fetch(url, { ...init, headers });
  return new Response(res.body, {
    status: res.status,
    headers: pickHeaders(res.headers, FORWARDED_RESPONSE_HEADERS),
  });
}

function pickHeaders(src: Headers, filter: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of filter) {
    const value = src.get(name);
    if (value !== null) out[name] = value;
  }
  return out;
}
