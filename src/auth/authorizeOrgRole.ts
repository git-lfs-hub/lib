import { GithubError } from '../github/errors';

type Role = 'admin' | 'member';
type OrgApi = { orgRole(org: string): Promise<'admin' | 'member' | null> };

/**
 * Org-role gate, single pass: the orgs in which the caller holds `role` (non-empty), or a 403
 * when none. A `forbidden` GithubError (App not installed) drops that org rather than failing,
 * mirroring `server/src/login/web-auth.ts`; other GithubErrors rethrow. Structurally typed on
 * `orgRole` to avoid a GithubApi import cycle with this package's github subpath.
 */
export async function authorizeOrgRole(
  api: OrgApi,
  orgs: string[],
  role: Role,
): Promise<string[] | Response> {
  const matched: string[] = [];
  let resolvedAny = false; // any org answered (vs. all forbidden) — picks the 403 wording
  for (const slug of orgs) {
    let actual: 'admin' | 'member' | null;
    try {
      actual = await api.orgRole(slug);
    } catch (e) {
      if (e instanceof GithubError && e.code === 'forbidden') continue;
      throw e;
    }
    resolvedAny = true;
    const ok = role === 'member' ? actual !== null : actual === 'admin';
    if (ok) matched.push(slug);
  }
  if (matched.length) return matched;

  const error = resolvedAny
    ? `org ${role === 'admin' ? 'admin status' : 'membership'} required`
    : `cannot verify org membership. GitHub App not installed or no access.`;
  return new Response(`Forbidden: ${error}`, { status: 403 });
}
