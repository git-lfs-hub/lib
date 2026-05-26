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
