import { describe, test, expect } from 'vitest';

import { GithubError } from '../github/errors';
import { requireOrgRole } from './requireOrgRole';

function fakeApi(role: 'admin' | 'member' | null) {
  return { orgRole: async () => role };
}

function fakeApiThrows(e: GithubError) {
  return { orgRole: async () => Promise.reject(e) };
}

describe('requireOrgRole', () => {
  test('admin role passes admin requirement', async () => {
    expect(await requireOrgRole(fakeApi('admin'), 'org', 'admin')).toBeNull();
  });

  test('member role fails admin requirement', async () => {
    const res = await requireOrgRole(fakeApi('member'), 'org', 'admin');
    expect(res?.status).toBe(403);
    expect(await res?.text()).toBe('Forbidden: org admin status required');
  });

  test('non-member fails admin requirement', async () => {
    const res = await requireOrgRole(fakeApi(null), 'org', 'admin');
    expect(res?.status).toBe(403);
    expect(await res?.text()).toBe('Forbidden: org admin status required');
  });

  test('GithubError forbidden explains GitHub App installation', async () => {
    const res = await requireOrgRole(
      fakeApiThrows(
        new GithubError('forbidden', 'getMembershipForAuthenticatedUser for git-lfs-hub: 403', 403),
      ),
      'git-lfs-hub',
      'admin',
    );
    expect(await res?.text()).toBe(
      'Forbidden: cannot verify org membership. GitHub App not installed or no access.',
    );
  });

  test('rethrows non-forbidden GithubError', async () => {
    await expect(
      requireOrgRole(fakeApiThrows(new GithubError('transient', 'upstream', 503)), 'org', 'admin'),
    ).rejects.toMatchObject({ code: 'transient' });
  });

  test('admin role passes member requirement', async () => {
    expect(await requireOrgRole(fakeApi('admin'), 'org', 'member')).toBeNull();
  });

  test('member role passes member requirement', async () => {
    expect(await requireOrgRole(fakeApi('member'), 'org', 'member')).toBeNull();
  });

  test('non-member fails member requirement', async () => {
    const res = await requireOrgRole(fakeApi(null), 'org', 'member');
    expect(res?.status).toBe(403);
    expect(await res?.text()).toBe('Forbidden: org membership required');
  });
});
