/**
 * hn_algolia source adapter.
 *
 * Hacker News exposes a searchable JSON API at hn.algolia.com. We
 * query the search endpoint, filter to stories, and emit a
 * ContentItem per hit.
 *
 * Config shape:
 *   {
 *     query: string           // search query, e.g. "embeddings OR vector db"
 *     tags?: string           // Algolia tags filter, default "story"
 *     max_items?: number      // default 20
 *     hits_per_page?: number  // Algolia pagination, default max_items
 *   }
 *
 * The Algolia API returns JSON — no XML parser involved. We just
 * fetch + JSON.parse + map hits.
 *
 * Stable URI for dedup: HN story URLs look like
 * https://news.ycombinator.com/item?id=<id>, and the real article
 * URL is on `hit.url`. We prefer the HN URL for dedup so that a
 * re-submit of the same article (different HN thread) is seen as a
 * new item, and we drop the item entirely if it has no real URL to
 * follow (Ask HN / Show HN / poll are skipped in Phase 2).
 */

import { ResultAsync, errAsync, okAsync } from 'neverthrow';
import type { AppError, GraphError } from '../../domain/errors.js';
import { GraphError as GE } from '../../domain/errors.js';
import type { ContentItem } from '../../domain/content.js';
import type { Source, SourceDescriptor } from '../../domain/sources.js';
import type { HttpFetcher } from '../http/fetcher.js';

interface HnAlgoliaConfig {
  readonly query: string;
  readonly tags?: string;
  readonly max_items?: number;
  readonly hits_per_page?: number;
}

interface AlgoliaHit {
  readonly objectID: string;
  readonly title?: string;
  readonly story_title?: string;
  readonly url?: string;
  readonly author?: string;
  readonly created_at?: string;
  readonly story_text?: string;
  readonly _highlightResult?: unknown;
}

const parseConfig = (raw: Readonly<Record<string, unknown>>): HnAlgoliaConfig | null => {
  const query = raw.query;
  if (typeof query !== 'string' || query.length === 0) return null;
  return {
    query,
    tags: typeof raw.tags === 'string' ? raw.tags : 'story',
    max_items: typeof raw.max_items === 'number' ? raw.max_items : undefined,
    hits_per_page: typeof raw.hits_per_page === 'number' ? raw.hits_per_page : undefined,
  };
};

const buildUrl = (cfg: HnAlgoliaConfig): string => {
  const params = new URLSearchParams({
    query: cfg.query,
    tags: cfg.tags ?? 'story',
    hitsPerPage: String(cfg.hits_per_page ?? cfg.max_items ?? 20),
  });
  return `https://hn.algolia.com/api/v1/search?${params.toString()}`;
};

const parseResponse = (body: string, url: string): ResultAsync<readonly AlgoliaHit[], GraphError> => {
  try {
    const parsed = JSON.parse(body) as { hits?: AlgoliaHit[] };
    if (!parsed || !Array.isArray(parsed.hits)) {
      return errAsync(GE.parseError(url, 'expected { hits: [] } from Algolia'));
    }
    return okAsync(parsed.hits);
  } catch (e) {
    return errAsync(GE.parseError(url, (e as Error).message));
  }
};

const hitToItem = (hit: AlgoliaHit): ContentItem | null => {
  const title = hit.title ?? hit.story_title;
  if (!title) return null;
  const url = hit.url;
  if (!url) return null; // skip self-posts for Phase 2
  return {
    source_uri: `https://news.ycombinator.com/item?id=${hit.objectID}`,
    title,
    text: hit.story_text ?? title,
    published_at: hit.created_at,
    author: hit.author,
    metadata: { kind: 'hn_algolia', target_url: url, hn_id: hit.objectID },
  };
};

export interface HnAlgoliaDeps {
  readonly http: HttpFetcher;
}

export const hnAlgoliaSource = (deps: HnAlgoliaDeps) =>
  (descriptor: SourceDescriptor): Source => {
    const cfg = parseConfig(descriptor.config);

    const fetchItems = (): ResultAsync<readonly ContentItem[], AppError> => {
      if (!cfg) {
        return errAsync<readonly ContentItem[], AppError>({
          type: 'InvalidNode',
          field: 'config.query',
          node_id: descriptor.id,
        });
      }
      const url = buildUrl(cfg);
      const max = cfg.max_items ?? 20;
      return deps.http
        .get(url)
        .mapErr((e): AppError => e)
        .andThen((response) => parseResponse(response.body, url).mapErr((e): AppError => e))
        .map((hits): readonly ContentItem[] => {
          const items: ContentItem[] = [];
          for (const h of hits) {
            const item = hitToItem(h);
            if (item) items.push(item);
            if (items.length >= max) break;
          }
          return items;
        });
    };

    return { descriptor, fetch: fetchItems };
  };
