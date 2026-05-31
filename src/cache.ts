/** Minimal subset of Cloudflare's `KVNamespace` used here (avoids a worker-types dep). */
export interface KvStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

/** Suffix → TTL (seconds). `putStr` picks the TTL whose suffix the key ends with. */
export type SuffixTtl = Record<string, number>;

/** Generic KV string cache. TTL on write is resolved from the key's suffix. */
export class Cache {
  constructor(
    readonly kv: KvStore,
    readonly suffixTtl: SuffixTtl,
  ) {}

  /** Missing or empty value → `null` (miss). */
  async getStr(key: string): Promise<string | null> {
    const value = await this.kv.get(key);
    return value ? value : null;
  }

  /** Writes with the TTL of the first matching suffix. Throws if none matches. */
  async putStr(key: string, value: string): Promise<void> {
    const expirationTtl = this.resolveTtl(key);
    await this.kv.put(key, value, { expirationTtl });
  }

  private resolveTtl(key: string): number {
    const suffix = Object.keys(this.suffixTtl).find((s) => key.endsWith(s));
    if (!suffix) throw new Error(`Cache: no TTL suffix matches key "${key}"`);
    return this.suffixTtl[suffix]!;
  }
}
