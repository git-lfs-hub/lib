import { generateKeyPair, exportPKCS8, jwtVerify } from 'jose';
import { describe, test, expect, vi } from 'vitest';

import type { KvStore } from '../cache';
import { GithubApi } from './api';
import { GithubOrgApi } from './api-org';
import { GithubError, mapHttpError } from './errors';

function api(octokit: any): GithubApi {
  const a = new GithubApi('t');
  (a as { octokit: unknown }).octokit = octokit;
  return a;
}

/** In-memory KV fake. */
function fakeKv() {
  const store = new Map<string, string>();
  const kv = {
    get: (k: string) => Promise.resolve(store.get(k) ?? null),
    put: (k: string, v: string) => {
      store.set(k, v);
      return Promise.resolve();
    },
  } as unknown as KvStore;
  return { kv, store };
}

function cachedApi(octokit: any, kv: KvStore): GithubApi {
  const a = new GithubApi('t', kv);
  (a as { octokit: unknown }).octokit = octokit;
  return a;
}

function orgApi(octokit: any, org = 'my-org'): GithubOrgApi {
  const o = new GithubOrgApi('t', org);
  (o as { octokit: unknown }).octokit = octokit;
  return o;
}

describe('authenticatedUsername', () => {
  test('returns login when authenticated', async () => {
    const a = api({
      rest: {
        users: {
          getAuthenticated: () => Promise.resolve({ data: { login: 'alice' } }),
        },
      },
    });
    expect(await a.authenticatedUsername()).toBe('alice');
  });

  test('returns null on rejection', async () => {
    const a = api({
      rest: {
        users: {
          getAuthenticated: () => Promise.reject(new Error('401')),
        },
      },
    });
    expect(await a.authenticatedUsername()).toBeNull();
  });
});

function membershipApi(impl: {
  state?: string;
  role?: 'admin' | 'member';
  reject?: number | boolean;
}) {
  return api({
    rest: {
      orgs: {
        getMembershipForAuthenticatedUser: () =>
          impl.reject
            ? Promise.reject(
                Object.assign(new Error(String(impl.reject)), {
                  status: impl.reject === true ? 404 : impl.reject,
                }),
              )
            : Promise.resolve({ data: { state: impl.state, role: impl.role } }),
      },
    },
  });
}

describe('orgRole', () => {
  test("returns 'admin' for active admin membership", async () => {
    expect(await membershipApi({ state: 'active', role: 'admin' }).orgRole('my-org')).toBe('admin');
  });

  test("returns 'member' for active member", async () => {
    expect(await membershipApi({ state: 'active', role: 'member' }).orgRole('my-org')).toBe(
      'member',
    );
  });

  test('returns null for pending membership', async () => {
    expect(await membershipApi({ state: 'pending', role: 'member' }).orgRole('my-org')).toBeNull();
  });

  test('returns null when API errors with 404', async () => {
    expect(await membershipApi({ reject: 404 }).orgRole('my-org')).toBeNull();
  });

  test('throws GithubError forbidden when API errors with 403', async () => {
    await expect(membershipApi({ reject: 403 }).orgRole('my-org')).rejects.toMatchObject({
      code: 'forbidden',
      status: 403,
    });
  });
});

function repoApi(
  permissions: { push?: boolean; admin?: boolean; pull?: boolean } | undefined | Error,
) {
  return api({
    rest: {
      repos: {
        get: () =>
          permissions instanceof Error
            ? Promise.reject(permissions)
            : Promise.resolve({ data: { permissions } }),
      },
    },
  });
}

describe('repoAccess', () => {
  test("returns 'write' when push permission", async () => {
    expect(await repoApi({ push: true, pull: true }).repoAccess('o', 'r')).toBe('write');
  });

  test("returns 'write' when admin permission", async () => {
    expect(await repoApi({ admin: true, push: false }).repoAccess('o', 'r')).toBe('write');
  });

  test("returns 'read' when only pull permission", async () => {
    expect(await repoApi({ pull: true, push: false, admin: false }).repoAccess('o', 'r')).toBe(
      'read',
    );
  });

  test("returns 'read' when permissions undefined", async () => {
    expect(await repoApi(undefined).repoAccess('o', 'r')).toBe('read');
  });

  test('returns null when repo lookup fails', async () => {
    expect(await repoApi(new Error('404')).repoAccess('o', 'r')).toBeNull();
  });
});

describe('installedOrgs', () => {
  function pageIterator(pages: Array<{ data: any[] }>) {
    return async function* () {
      for (const p of pages) yield p;
    };
  }

  test('returns installed accounts (org and user), skips null accounts', async () => {
    const pages = [
      {
        data: [
          { id: 1, account: { login: 'Acme' } },
          { id: 2, account: null },
          { id: 3, account: { login: 'alice' } },
        ],
      },
    ];
    const a = api({
      paginate: { iterator: () => pageIterator(pages)() },
      rest: { apps: { listInstallations: vi.fn() } },
    });
    expect(await a.installedOrgs()).toEqual([
      { login: 'Acme', id: 1 },
      { login: 'alice', id: 3 },
    ]);
  });

  test('throws GithubError on listing failure', async () => {
    // eslint-disable-next-line require-yield -- async generator that only throws
    const failingIter = async function* () {
      throw Object.assign(new Error('403'), { status: 403 });
    };
    const a = api({
      paginate: { iterator: () => failingIter() },
      rest: { apps: { listInstallations: vi.fn() } },
    });
    await expect(a.installedOrgs()).rejects.toMatchObject({ code: 'forbidden', status: 403 });
  });
});

describe('orgApi', () => {
  test('mints an installation token → GithubOrgApi bound to the account', async () => {
    const a = api({
      rest: {
        apps: {
          createInstallationAccessToken: () => Promise.resolve({ data: { token: 'ghs_abc' } }),
        },
      },
    });
    const child = await a.orgApi({ login: 'my-org', id: 42 });
    expect(child).toBeInstanceOf(GithubOrgApi);
    expect(child.org).toBe('my-org');
  });

  test('throws unauthorized when App credentials rejected', async () => {
    const a = api({
      rest: {
        apps: {
          createInstallationAccessToken: () =>
            Promise.reject(Object.assign(new Error('401'), { status: 401 })),
        },
      },
    });
    await expect(a.orgApi({ login: 'my-org', id: 42 })).rejects.toMatchObject({
      code: 'unauthorized',
      status: 401,
    });
  });

  test('throws transient on token mint 5xx', async () => {
    const a = api({
      rest: {
        apps: {
          createInstallationAccessToken: () =>
            Promise.reject(Object.assign(new Error('500'), { status: 500 })),
        },
      },
    });
    await expect(a.orgApi({ login: 'my-org', id: 42 })).rejects.toMatchObject({
      code: 'transient',
      status: 500,
    });
  });
});

describe('listRepos', () => {
  function pageIterator(pages: Array<{ data: any[]; headers: Record<string, string> }>) {
    return async function* () {
      for (const p of pages) yield p;
    };
  }

  test('yields pages of repos', async () => {
    const pages = [
      { data: [{ owner: { login: 'Acme' }, name: 'alpha' }], headers: {} },
      { data: [{ owner: { login: 'Acme' }, name: 'beta' }], headers: {} },
    ];
    const o = orgApi({
      paginate: { iterator: () => pageIterator(pages)() },
      rest: { apps: { listReposAccessibleToInstallation: vi.fn() } },
    });
    const collected: string[] = [];
    for await (const page of o.listRepos()) {
      for (const r of page) collected.push(r.name);
    }
    expect(collected).toEqual(['alpha', 'beta']);
  });

  test('warns on low rate-limit remaining', async () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const pages = [
      { data: [{ owner: { login: 'x' }, name: 'r' }], headers: { 'x-ratelimit-remaining': '50' } },
    ];
    const o = orgApi({
      paginate: { iterator: () => pageIterator(pages)() },
      rest: { apps: { listReposAccessibleToInstallation: vi.fn() } },
    });
    for await (const _ of o.listRepos()) {
      /* drain */
    }
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('low rate limit'));
    spy.mockRestore();
  });

  test('throws GithubError forbidden on 403', async () => {
    // eslint-disable-next-line require-yield -- async generator that only throws
    const failingIter = async function* () {
      throw Object.assign(new Error('403'), { status: 403 });
    };
    const o = orgApi({
      paginate: { iterator: () => failingIter() },
      rest: { apps: { listReposAccessibleToInstallation: vi.fn() } },
    });
    await expect(async () => {
      for await (const _ of o.listRepos()) {
        /* drain */
      }
    }).rejects.toMatchObject({ code: 'forbidden', status: 403 });
  });

  test('throws GithubError missing on 404', async () => {
    // eslint-disable-next-line require-yield -- async generator that only throws
    const failingIter = async function* () {
      throw Object.assign(new Error('404'), { status: 404 });
    };
    const o = orgApi({
      paginate: { iterator: () => failingIter() },
      rest: { apps: { listReposAccessibleToInstallation: vi.fn() } },
    });
    await expect(async () => {
      for await (const _ of o.listRepos()) {
        /* drain */
      }
    }).rejects.toMatchObject({ code: 'missing', status: 404 });
  });
});

describe('cache', () => {
  test('authenticatedUsername caches login; second call skips Octokit', async () => {
    const { kv } = fakeKv();
    const getAuthenticated = vi.fn(() => Promise.resolve({ data: { login: 'alice' } }));
    const a = cachedApi({ rest: { users: { getAuthenticated } } }, kv);
    expect(await a.authenticatedUsername()).toBe('alice');
    expect(await a.authenticatedUsername()).toBe('alice');
    expect(getAuthenticated).toHaveBeenCalledTimes(1);
  });

  test('failed auth is not cached', async () => {
    const { kv, store } = fakeKv();
    const a = cachedApi(
      { rest: { users: { getAuthenticated: () => Promise.reject(new Error('401')) } } },
      kv,
    );
    expect(await a.authenticatedUsername()).toBeNull();
    expect(store.size).toBe(0);
  });

  test('orgRole caches role; second call skips Octokit', async () => {
    const { kv } = fakeKv();
    const getMembershipForAuthenticatedUser = vi.fn(() =>
      Promise.resolve({ data: { state: 'active', role: 'member' } }),
    );
    const a = cachedApi(
      {
        rest: {
          users: { getAuthenticated: () => Promise.resolve({ data: { login: 'alice' } }) },
          orgs: { getMembershipForAuthenticatedUser },
        },
      },
      kv,
    );
    expect(await a.orgRole('acme')).toBe('member');
    expect(await a.orgRole('acme')).toBe('member');
    expect(getMembershipForAuthenticatedUser).toHaveBeenCalledTimes(1);
  });

  test('inactive membership is not cached', async () => {
    const { kv, store } = fakeKv();
    const a = cachedApi(
      {
        rest: {
          users: { getAuthenticated: () => Promise.resolve({ data: { login: 'alice' } }) },
          orgs: {
            getMembershipForAuthenticatedUser: () =>
              Promise.resolve({ data: { state: 'pending', role: 'member' } }),
          },
        },
      },
      kv,
    );
    expect(await a.orgRole('acme')).toBeNull();
    expect(store.has('alice:acme:access')).toBe(false);
  });

  test('repoAccess caches access; second call skips Octokit', async () => {
    const { kv } = fakeKv();
    const get = vi.fn(() => Promise.resolve({ data: { permissions: { push: true } } }));
    const a = cachedApi(
      {
        rest: {
          users: { getAuthenticated: () => Promise.resolve({ data: { login: 'alice' } }) },
          repos: { get },
        },
      },
      kv,
    );
    expect(await a.repoAccess('acme', 'hub')).toBe('write');
    expect(await a.repoAccess('acme', 'hub')).toBe('write');
    expect(get).toHaveBeenCalledTimes(1);
  });

  test('no repo access is not cached', async () => {
    const { kv, store } = fakeKv();
    const a = cachedApi(
      {
        rest: {
          users: { getAuthenticated: () => Promise.resolve({ data: { login: 'alice' } }) },
          repos: { get: () => Promise.reject(new Error('404')) },
        },
      },
      kv,
    );
    expect(await a.repoAccess('acme', 'hub')).toBeNull();
    expect(store.has('alice:acme/hub:access')).toBe(false);
  });

  test('username resolved once across orgRole and repoAccess', async () => {
    const { kv } = fakeKv();
    const getAuthenticated = vi.fn(() => Promise.resolve({ data: { login: 'alice' } }));
    const a = cachedApi(
      {
        rest: {
          users: { getAuthenticated },
          orgs: {
            getMembershipForAuthenticatedUser: () =>
              Promise.resolve({ data: { state: 'active', role: 'admin' } }),
          },
          repos: { get: () => Promise.resolve({ data: { permissions: { pull: true } } }) },
        },
      },
      kv,
    );
    await a.orgRole('acme');
    await a.repoAccess('acme', 'hub');
    expect(getAuthenticated).toHaveBeenCalledTimes(1);
  });
});

describe('constructor', () => {
  test('instantiates Octokit', () => {
    const a = new GithubApi('ghu_x');
    expect(a.octokit).toBeDefined();
  });
});

describe('GithubError', () => {
  test('carries code and status', () => {
    const e = new GithubError('forbidden', 'nope', 403);
    expect(e.code).toBe('forbidden');
    expect(e.status).toBe(403);
    expect(e.name).toBe('GithubError');
    expect(e).toBeInstanceOf(Error);
  });
});

describe('mapHttpError', () => {
  test('maps a non-Error thrown value via String()', () => {
    const e = mapHttpError('boom', 'ctx');
    expect(e.code).toBe('transient');
    expect(e.message).toBe('boom');
    expect(e.status).toBeUndefined();
  });
});

describe('forApp', () => {
  test('signs an RS256 App JWT and builds an authenticated client', async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256', {
      extractable: true,
    });
    const pem = await exportPKCS8(privateKey);
    const a = await GithubApi.forApp('12345', pem);
    expect(a).toBeInstanceOf(GithubApi);

    const auth = await (a.octokit as { auth: () => Promise<{ token: string }> }).auth();
    const { payload, protectedHeader } = await jwtVerify(auth.token, publicKey);
    expect(protectedHeader.alg).toBe('RS256');
    expect(payload.iss).toBe('12345');
    expect(payload.iat).toBeLessThan(payload.exp!);
  });
});
