import { githubProxyFetch } from './proxy';

export async function githubAccessToken(
  params: Record<string, string>,
): Promise<Record<string, string>> {
  const r = await githubAccessTokenFetch(params);
  return (await r.json()) as Record<string, string>;
}

export function githubAccessTokenFetch(params: Record<string, string>): Promise<Response> {
  return githubProxyFetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams(params),
  });
}
