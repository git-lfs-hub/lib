import { describe, test, expect } from 'vitest';

import { GithubError } from '../github/errors';
import { authorizeOrgRole } from './authorizeOrgRole';

// Per-org roles; a GithubError value throws for that org.
function fakeApiByOrg(roles: Record<string, 'admin' | 'member' | null | GithubError>) {
  return {
    orgRole: async (org: string) => {
      const r = roles[org];
      if (r instanceof GithubError) throw r;
      return r ?? null;
    },
  };
}

const forbidden = new GithubError('forbidden', 'membership: 403', 403);

describe('authorizeOrgRole', () => {
  test('returns the orgs the caller admins, in order', async () => {
    const api = fakeApiByOrg({ a: 'admin', b: 'member', c: 'admin' });
    expect(await authorizeOrgRole(api, ['a', 'b', 'c'], 'admin')).toEqual(['a', 'c']);
  });

  test('admin of one of many is enough', async () => {
    const api = fakeApiByOrg({ a: null, b: 'admin', c: 'member' });
    expect(await authorizeOrgRole(api, ['a', 'b', 'c'], 'admin')).toEqual(['b']);
  });

  test('member role matches admin or member', async () => {
    const api = fakeApiByOrg({ a: 'admin', b: 'member', c: null });
    expect(await authorizeOrgRole(api, ['a', 'b', 'c'], 'member')).toEqual(['a', 'b']);
  });

  test('forbidden orgs are dropped, not fatal', async () => {
    const api = fakeApiByOrg({ a: forbidden, b: 'admin' });
    expect(await authorizeOrgRole(api, ['a', 'b'], 'admin')).toEqual(['b']);
  });

  test('admin of none → 403 with role-required wording', async () => {
    const api = fakeApiByOrg({ a: 'member', b: null });
    const res = await authorizeOrgRole(api, ['a', 'b'], 'admin');
    expect((res as Response).status).toBe(403);
    expect(await (res as Response).text()).toBe('Forbidden: org admin status required');
  });

  test('member of none → 403 with membership wording', async () => {
    const res = await authorizeOrgRole(fakeApiByOrg({ a: null }), ['a'], 'member');
    expect(await (res as Response).text()).toBe('Forbidden: org membership required');
  });

  test('all orgs forbidden → 403 with cannot-verify wording', async () => {
    const api = fakeApiByOrg({ a: forbidden, b: forbidden });
    const res = await authorizeOrgRole(api, ['a', 'b'], 'admin');
    expect((res as Response).status).toBe(403);
    expect(await (res as Response).text()).toBe(
      'Forbidden: cannot verify org membership. GitHub App not installed or no access.',
    );
  });

  test('forbidden on one but member-not-admin on another → role-required wording', async () => {
    const api = fakeApiByOrg({ a: forbidden, b: 'member' });
    const res = await authorizeOrgRole(api, ['a', 'b'], 'admin');
    expect(await (res as Response).text()).toBe('Forbidden: org admin status required');
  });

  test('rethrows a non-forbidden GithubError', async () => {
    const api = fakeApiByOrg({ a: new GithubError('transient', 'upstream', 503) });
    await expect(authorizeOrgRole(api, ['a'], 'admin')).rejects.toMatchObject({
      code: 'transient',
    });
  });
});
