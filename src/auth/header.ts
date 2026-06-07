// Parses the credential from an Authorization header value.
// Pure function, no I/O.
export function authHeaderToken(header: string): { username: string; token: string } | null {
  const space = header.indexOf(' ');
  if (space === -1) return null;

  const scheme = header.slice(0, space).toLowerCase();
  const rest = header.slice(space + 1);

  if (scheme === 'basic') {
    let decoded: string;
    try {
      decoded = atob(rest);
    } catch {
      return null;
    }
    const colon = decoded.indexOf(':');
    if (colon === -1) return null;
    return {
      username: decoded.slice(0, colon),
      token: decoded.slice(colon + 1),
    };
  }

  // RemoteAuth / Bearer / any other scheme: raw credential is the token.
  return { username: '', token: rest };
}
