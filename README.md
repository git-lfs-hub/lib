# Git LFS Hub — auth

[![CI][ci-badge]][gh-wf-href]
[![Coverage][coverage-badge]][coverage-href]
[![CodeQL][codeql-badge]][codeql-href]
[![Socket][socket-badge]][socket-href]
[![License][license-badge]][license-href]

Shared authentication library for [Git LFS Hub](https://github.com/git-lfs-hub). Extracts the GitHub OAuth and session logic that was previously embedded in the server Worker into a package that the Worker and the admin GC UI both depend on.

For the bigger picture (what the stack does, the deploy flow, the other repos) see the [org overview](https://github.com/git-lfs-hub).

## Setup

This package is consumed by other workspaces in [git-lfs-hub/deploy](https://github.com/git-lfs-hub/deploy). You rarely need to work in this repo unless you are changing auth logic.

Install from the deploy root:

```sh
bun install
```

## API

### `oauth.ts`

GitHub OAuth flow helpers.

- **`signState(payload, secret, ttl?)`** — signs a state token (HS256 JWT) sealing the loopback `redirect_uri` and `client_state` for the callback round-trip.
- **`verifyState(token, secret)`** → `StatePayload | null` — verifies and decodes a signed state token.
- **`buildAuthorizeUrl(clientId, redirectUri, state, opts?)`** → URL string — builds the `https://github.com/login/oauth/authorize` redirect URL.
- **`exchangeCode(clientId, clientSecret, code, redirectUri)`** → `Record<string, string>` — POSTs to GitHub's token endpoint and returns the parsed JSON body.

### `session.ts`

JWE session token helpers.

- **`encryptSession(payload, secret, ttl?)`** → JWE string (AES-256-GCM) — encrypts a `SessionPayload` (`token`, optional `refresh_token`). Used for both session cookies and short-lived ephemeral codes.
- **`decryptSession(token, secret)`** → `SessionPayload | null` — decrypts a JWE session token.
- **`validateSession(cookie, secret)`** → `Session | null` — decrypts the cookie, calls `users.getAuthenticated` to resolve the GitHub username, returns `{ token, username }` or null on any failure.

### `membership.ts`

GitHub org role check.

- **`checkOrgRole(token, org)`** → `"admin" | "member" | null` — checks the authenticated user's org membership role; returns null if not an active member or on any error.

## Key format

`secret` parameters are 64-character hex strings (32 bytes). The same format as `LOGIN_SECRET` in the Worker's `wrangler.jsonc`.

## Development

```sh
bun install
bun run test      # vitest (node environment)
```

[ci-badge]: https://badgen.net/github/checks/git-lfs-hub/auth/main?icon=vitest&label=CI
[gh-wf-href]: https://github.com/git-lfs-hub/auth/actions/workflows/main.yml?query=branch%3Amain

[coverage-badge]: https://badgen.net/https/git-lfs-hub.github.io/auth/coverage-badge.json?icon=vitest
[coverage-href]: https://git-lfs-hub.github.io/auth/lcov-report/

[codeql-badge]: https://github.com/git-lfs-hub/auth/actions/workflows/github-code-scanning/codeql/badge.svg
[codeql-href]: https://github.com/git-lfs-hub/auth/actions/workflows/github-code-scanning/codeql?query=branch%3Amain

[socket-badge]: https://badgen.net/static/Socket/report/blue?icon=socket
[socket-href]: https://socket.dev/dashboard/org/git-lfs-hub/repo/@git-lfs-hub/auth

[license-badge]: https://badgen.net/github/license/git-lfs-hub/auth
[license-href]: LICENSE.md
