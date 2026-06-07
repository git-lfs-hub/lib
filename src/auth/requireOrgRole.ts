import { GithubError } from '../github/errors';

/**
 * HTTP guard: returns null when caller has the required org role, or a 403
 * Response otherwise. Structurally typed on `orgRole` to avoid importing
 * GithubApi (which would create a cycle with this package's github subpath).
 */
export async function requireOrgRole(
  api: { orgRole(org: string): Promise<'admin' | 'member' | null> },
  org: string,
  role: 'admin' | 'member',
): Promise<Response | null> {
  let error: string | null = null;

  try {
    const actual = await api.orgRole(org);
    const ok = role === 'member' ? actual !== null : actual === 'admin';
    if (!ok) {
      const scope = role === 'admin' ? 'admin status' : 'membership';
      error = `org ${scope} required`;
    }
  } catch (e) {
    if (e instanceof GithubError && e.code === 'forbidden') {
      error = `cannot verify org membership. GitHub App not installed or no access.`;
    } else {
      throw e;
    }
  }

  if (!error) return null;
  return new Response(`Forbidden: ${error}`, { status: 403 });
}
