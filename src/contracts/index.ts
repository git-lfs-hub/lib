/**
 * Cross-worker contracts shared between lfs-server (producer) and lfs-admin (consumer).
 *
 * Cloudflare Queues do not validate message shapes — the platform binds by queue
 * name only, message bodies are opaque JSON. Keep both sides importing from here
 * so type drift surfaces at compile time.
 */

/** Cloudflare Queue: `lfs-object-events`. Producer = lfs-server. Consumer = lfs-admin. */
export type ObjectEvent = {
  owner: string;
  repo: string;
  oid: string;
  size: number;
  operation: "upload" | "verify" | "download";
};

/**
 * Service binding `LFS_SERVER`: lfs-admin (consumer) → lfs-server `AdminEntrypoint`
 * (producer). The producer must `implements LfsServer` so a signature change there
 * fails its own compile; the consumer narrows the binding to this shape.
 */
export interface LfsServer {
  /** Block all LFS access for the repo (uploads + downloads → 404). */
  blockRepo(owner: string, repo: string): Promise<void>;
  /** Resume normal serving. */
  unblockRepo(owner: string, repo: string): Promise<void>;
  /** Post-R2-purge cleanup: wipe Locks + mark the registry row purged. Idempotent. */
  purgeRepo(owner: string, repo: string): Promise<void>;
}
