/**
 * Pure RSS 2.0 + Atom 1.0 → FeedItem normaliser.
 *
 * Takes a parsed XML document tree (plain JS object tree as produced
 * by fast-xml-parser) and extracts a list of FeedItem values that
 * the ingest pipeline can hand to the chunker. No I/O, no classes,
 * no throws — errors come back as Result.
 *
 * Supports both shapes:
 *
 *   RSS 2.0 :   rss > channel > item[ title, link, description, pubDate ]
 *   Atom 1.0:   feed > entry[ title, link@href, summary|content, published|updated ]
 *
 * The normaliser detects the shape at the root and dispatches. Edge
 * cases (missing fields, malformed dates, HTML-encoded text) are
 * tolerated — the item is emitted with whatever fields it has, and
 * the body is plain-text-extracted so the chunker sees clean input.
 */

import { Result, err, ok } from 'neverthrow';
import { GraphError } from './errors.js';

export interface FeedItem {
  readonly source_uri: string;
  readonly title: string;
  readonly text: string;
  readonly published_at?: string;
  readonly author?: string;
}

export type ParsedXml = unknown;

/**
 * Detect the feed shape and produce a FeedItem array. Reuses the
 * GraphError.parseError tag for ingest failures so the AppError union
 * doesn't need a fourth family just for feed parsing.
 */
export const normalizeFeed = (root: ParsedXml): Result<readonly FeedItem[], GraphError> => {
  if (!root || typeof root !== 'object') {
    return err(GraphError.parseError('<feed>', 'root must be an object'));
  }
  const obj = root as Record<string, unknown>;

  // RSS 2.0
  const rss = obj.rss as Record<string, unknown> | undefined;
  if (rss) {
    const channel = extract(rss.channel);
    if (!channel) return ok([]);
    const items = asArray(channel.item);
    return ok(items.map(normalizeRssItem).filter((x): x is FeedItem => x !== null));
  }

  // Atom 1.0
  const feed = obj.feed as Record<string, unknown> | undefined;
  if (feed) {
    const entries = asArray(feed.entry);
    return ok(entries.map(normalizeAtomEntry).filter((x): x is FeedItem => x !== null));
  }

  return err(
    GraphError.parseError(
      '<feed>',
      `unknown feed shape: expected 'rss' or 'feed' at root, got ${Object.keys(obj).join(',')}`,
    ),
  );
};

// ─────────────────────── RSS 2.0 ──────────────────────────

const normalizeRssItem = (raw: unknown): FeedItem | null => {
  const item = extract(raw);
  if (!item) return null;
  const link = pickString(item.link);
  const title = pickString(item.title) ?? '(untitled)';
  if (!link) return null;
  const description = pickString(item.description) ?? pickString(item['content:encoded']) ?? '';
  return {
    source_uri: link,
    title: stripHtml(title).trim(),
    text: stripHtml(description).trim(),
    published_at: normalizeDate(pickString(item.pubDate)),
    author: pickString(item.author) ?? pickString(item['dc:creator']),
  };
};

// ─────────────────────── Atom 1.0 ─────────────────────────

const normalizeAtomEntry = (raw: unknown): FeedItem | null => {
  const entry = extract(raw);
  if (!entry) return null;
  const link = atomLink(entry.link);
  if (!link) return null;
  const title = pickString(entry.title) ?? pickAtomText(entry.title) ?? '(untitled)';
  const summary = pickString(entry.summary) ?? pickAtomText(entry.summary);
  const content = pickString(entry.content) ?? pickAtomText(entry.content);
  const text = (content ?? summary ?? '').trim();
  return {
    source_uri: link,
    title: stripHtml(title).trim(),
    text: stripHtml(text),
    published_at: normalizeDate(pickString(entry.published) ?? pickString(entry.updated)),
    author: atomAuthor(entry.author),
  };
};

/** Atom `link` can be a single element or array, with an @href attribute. */
const atomLink = (link: unknown): string | null => {
  if (!link) return null;
  const arr = asArray(link);
  for (const l of arr) {
    if (typeof l === 'string') return l;
    const obj = extract(l);
    if (!obj) continue;
    // fast-xml-parser puts attributes under '@_' prefix by default;
    // we configure it to not prefix, so href is a direct key.
    const rel = pickString(obj.rel) ?? 'alternate';
    if (rel === 'alternate' || rel === undefined) {
      const href = pickString(obj.href);
      if (href) return href;
    }
  }
  // fallback — first link with any href we can find
  for (const l of arr) {
    const obj = extract(l);
    if (obj && pickString(obj.href)) return pickString(obj.href)!;
  }
  return null;
};

const atomAuthor = (author: unknown): string | undefined => {
  if (!author) return undefined;
  const first = asArray(author)[0];
  if (typeof first === 'string') return first;
  const obj = extract(first);
  if (!obj) return undefined;
  return pickString(obj.name);
};

/** Atom text constructs can be `{ type: 'html', '#text': '...' }`. */
const pickAtomText = (v: unknown): string | undefined => {
  const obj = extract(v);
  if (!obj) return undefined;
  return pickString(obj['#text']);
};

// ─────────────────────── helpers ──────────────────────────

/** Coerce `v` into an array. fast-xml-parser returns a single object when a tag has one child. */
const asArray = (v: unknown): readonly unknown[] => {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
};

/** Drill into a non-null object, returning undefined otherwise. */
const extract = (v: unknown): Record<string, unknown> | null => {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
};

const pickString = (v: unknown): string | undefined => {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (v && typeof v === 'object') {
    // fast-xml-parser stores the text of an element under '#text' when
    // it has attributes.
    const obj = v as Record<string, unknown>;
    if (typeof obj['#text'] === 'string') return obj['#text'];
  }
  return undefined;
};

/** Strip HTML tags + decode the most common entities for plain-text chunking. */
const stripHtml = (s: string): string =>
  s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ');

/** Return an ISO-8601 string if `raw` is a parseable date, otherwise undefined. */
const normalizeDate = (raw: string | undefined): string | undefined => {
  if (!raw) return undefined;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString();
};
