import { Octokit } from '@octokit/rest';
import { SignJWT, importPKCS8 } from 'jose';

import { Cache, type KvStore } from '../cache';
import type { GithubOrgApi } from './api-org';

export const USER_AGENT = 'git-lfs-hub';

export type RepoAccess = 'read' | 'write';

const CACHE_TTL = {
  ':user': 86400, // token -> user 1 day
  ':access': 300, // user -> access 5 min
};

export class GithubApi {
  readonly octokit: Octokit;
  private readonly token: string;
  private readonly cache?: Cache;
  private cachedUsername?: string;

  constructor(token: string, kv?: KvStore) {
    this.token = token;
    this.cache = kv ? new Cache(kv, CACHE_TTL) : undefined;
    this.octokit = new Octokit({ auth: token, userAgent: USER_AGENT });
  }

  static async forApp(appId: string, appPrivateKey: string): Promise<GithubApi> {
    return new GithubApi(await signAppJwt(appId, appPrivateKey));
  }

  async orgApi(org: string): Promise<GithubOrgApi> {
    // Dynamic import breaks the api ↔ api-org cycle.
    const { GithubOrgApi } = await import('./api-org');
    return GithubOrgApi.forAppOrg(this, org);
  }

  async authenticatedUsername(): Promise<string | null> {
    if (this.cachedUsername) return this.cachedUsername;
    const login = await this.withCache(
      () => this.userKey(),
      () =>
        this.octokit.rest.users
          .getAuthenticated()
          .then(({ data }) => data.login)
          .catch(() => null),
    );
    if (login) this.cachedUsername = login;
    return login;
  }

  async orgRole(org: string): Promise<'admin' | 'member' | null> {
    return this.withCache(
      () => this.accessKey(org),
      () =>
        this.octokit.rest.orgs
          .getMembershipForAuthenticatedUser({ org })
          .then(({ data }) => {
            if (data.state !== 'active') return null;
            return data.role === 'admin' ? 'admin' : 'member';
          })
          .catch(() => null),
    );
  }

  async repoAccess(owner: string, repo: string): Promise<RepoAccess | null> {
    return this.withCache(
      () => this.accessKey(`${owner}/${repo}`),
      () =>
        this.octokit.rest.repos
          .get({ owner, repo })
          .then(({ data }) =>
            data.permissions?.push || data.permissions?.admin ? 'write' : 'read',
          )
          .catch(() => null),
    );
  }

  /** Cache read → `fetch` on miss → cache write on success. */
  private async withCache<T extends string>(
    keyFn: () => Promise<string | null>,
    fetch: () => Promise<T | null>,
  ): Promise<T | null> {
    const key = this.cache ? await keyFn() : null;
    if (key) {
      const hit = await this.cache!.getStr(key);
      if (hit) return hit as T;
    }
    const value = await fetch();
    if (value && key) await this.cache!.putStr(key, value);
    return value;
  }

  /** `{hash}:user` key (SHA-256 of token, hex). */
  private async userKey(): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(this.token));
    const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
    return `${hash}:user`;
  }

  /** `{user}:{scope}:access` key, or `null` when the user is unknown. */
  private async accessKey(scope: string): Promise<string | null> {
    const user = await this.authenticatedUsername();
    return user ? `${user}:${scope}:access`.toLowerCase() : null;
  }
}

const APP_JWT_TTL_SECONDS = 600;
const CLOCK_SKEW_SECONDS = 30;

async function signAppJwt(appId: string, privateKeyPem: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const key = await importPKCS8(privateKeyPem, 'RS256');
  return new SignJWT({})
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(String(appId))
    .setIssuedAt(now - CLOCK_SKEW_SECONDS)
    .setExpirationTime(now + APP_JWT_TTL_SECONDS)
    .sign(key);
}
