export type GithubErrorCode =
  | "no_installation"
  | "forbidden"
  | "missing"
  | "unauthorized"
  | "transient";

/**
 * Single error class for all GitHub API failures. Consumers inspect `.code`
 * (categorical) and `.status` (HTTP status, when known) to map to their own
 * domain states.
 */
export class GithubError extends Error {
  readonly code: GithubErrorCode;
  readonly status?: number;
  constructor(code: GithubErrorCode, message: string, status?: number) {
    super(message);
    this.name = "GithubError";
    this.code = code;
    this.status = status;
  }
}

export function isHttpError(e: unknown): e is { status: number; message: string } {
  return (
    typeof e === "object" &&
    e !== null &&
    "status" in e &&
    typeof (e as { status: unknown }).status === "number"
  );
}

export function mapHttpError(e: unknown, where: string): GithubError {
  if (isHttpError(e)) {
    if (e.status === 401) return new GithubError("unauthorized", `${where}: 401`, 401);
    if (e.status === 403) return new GithubError("forbidden", `${where}: 403`, 403);
    if (e.status === 404) return new GithubError("missing", `${where}: 404`, 404);
    return new GithubError("transient", `${where}: ${e.status}`, e.status);
  }
  return new GithubError(
    "transient",
    e instanceof Error ? e.message : String(e),
  );
}
