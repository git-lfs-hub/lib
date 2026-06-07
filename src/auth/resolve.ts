import type { Context } from 'hono';

import type { KvStore } from '../cache';
import { GithubApi } from '../github';
import { githubAccessToken } from '../github/accessToken';
import { getSessionCookie, setSessionCookie, type SessionTokens } from './session';

export async function resolveSession(
  c: Context,
  opts: { secret: string; clientId: string; clientSecret: string; cache?: KvStore },
): Promise<{ api: GithubApi; username: string } | null> {
  const cookie = await getSessionCookie(c, opts.secret);
  if (!cookie) return null;

  let api = new GithubApi(cookie.access, opts.cache);
  let username = await api.authenticatedUsername();

  if (!username && cookie.refresh) {
    const data = await githubAccessToken({
      grant_type: 'refresh_token',
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
      refresh_token: cookie.refresh,
    });

    if (data.error || !data.access_token) return null;
    const refreshed: SessionTokens = {
      access: data.access_token,
      refresh: data.refresh_token ?? cookie.refresh,
    };

    api = new GithubApi(refreshed.access, opts.cache);
    username = await api.authenticatedUsername();
    if (!username) return null;

    await setSessionCookie(c, refreshed, opts.secret);
  }

  return username ? { api, username } : null;
}
