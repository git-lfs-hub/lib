/** Org-list parsing. `GITHUB_ORGS` (plural) plus the legacy singular `GITHUB_ORG`. */

export function orgsFromEnv(env: { GITHUB_ORGS?: string; GITHUB_ORG?: string }): string[] {
  return [
    ...parseGithubList(env.GITHUB_ORGS),
    ...(env.GITHUB_ORG?.trim() ? [env.GITHUB_ORG.trim()] : []),
  ];
}

/** Splits a space/comma/semicolon-separated slug list; empty/undefined → []. */
export function parseGithubList(s: string | undefined): string[] {
  if (!s) return [];
  return s.split(/[,;\s]+/).filter(Boolean);
}
