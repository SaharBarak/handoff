/**
 * ContentItem — what a Source adapter produces before chunking.
 *
 * This is the shared vocabulary between the source adapters (RSS,
 * ArXiv, HN, URL) and the ingest pipeline. Every adapter returns a
 * list of these regardless of the upstream format.
 *
 * Pure types only — no methods, no classes.
 */

/** One fetched piece of content. */
export interface ContentItem {
  /**
   * Canonical source URI — used as the node's `source_file` + `source_uri`
   * + as the primary key for dedup. MUST be stable across fetches.
   */
  readonly source_uri: string;

  /** Human-friendly title. Used as the node label. */
  readonly title: string;

  /**
   * Main body text, already stripped of HTML/markup by the adapter.
   * This is what gets chunked and embedded.
   */
  readonly text: string;

  /**
   * ISO-8601 publication timestamp if known, otherwise undefined.
   * Adapters should parse the upstream format into ISO-8601.
   */
  readonly published_at?: string;

  /**
   * Author name if known. Displayed in reports, not used for search.
   */
  readonly author?: string;

  /**
   * Free-form structured metadata the adapter wants to preserve on
   * the graph node. Limited to JSON-serialisable values — anything
   * more structured goes into edges or dedicated nodes.
   */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * A single fetched item paired with a stable content fingerprint.
 * Used by the ingest pipeline for dedup decisions.
 */
export interface FingerprintedItem {
  readonly item: ContentItem;
  /** sha256 hex of the normalised body text. */
  readonly content_sha256: string;
}
