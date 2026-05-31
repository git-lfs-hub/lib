/** Return `value` if it is a string, else `undefined`. Narrows untyped JSON/JWT claims. */
export function ifString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Build a URL string from `base`, setting each non-empty query param. */
export function urlWithParams(base: string, params: Record<string, string | undefined>): string {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) if (value) url.searchParams.set(key, value);
  return url.toString();
}
