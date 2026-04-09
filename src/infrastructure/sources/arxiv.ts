/**
 * arxiv source adapter.
 *
 * Config shape:
 *   {
 *     query: string           // ArXiv query string, e.g. "cat:cs.AI AND abs:embeddings"
 *     max_items?: number      // default 10
 *     sort_by?: 'relevance' | 'lastUpdatedDate' | 'submittedDate'
 *     sort_order?: 'ascending' | 'descending'
 *   }
 *
 * ArXiv's public API responds with Atom 1.0 at:
 *   http://export.arxiv.org/api/query?search_query=<q>&start=0&max_results=<n>
 *
 * So the adapter is basically generic_rss with a different URL
 * construction step. We still reuse the XmlParser + feed normaliser.
 *
 * Notes:
 *   - ArXiv says 1 request / 3 seconds. Phase 3 will add rate limiting;
 *     Phase 2 just calls it.
 *   - The entry IDs on ArXiv are stable URIs like
 *     http://arxiv.org/abs/2403.12345v1 — we strip the version suffix
 *     so re-runs dedup against content rather than against revisions.
 */

import { ResultAsync, errAsync, okAsync } from 'neverthrow';
import type { AppError } from '../../domain/errors.js';
import type { ContentItem } from '../../domain/content.js';
import type { Source, SourceDescriptor } from '../../domain/sources.js';
import { normalizeFeed } from '../../domain/feeds.js';
import type { HttpFetcher } from '../http/fetcher.js';
import type { XmlParserPort } from '../parsers/xml-parser.js';

interface ArxivConfig {
  readonly query: string;
  readonly max_items?: number;
  readonly sort_by?: 'relevance' | 'lastUpdatedDate' | 'submittedDate';
  readonly sort_order?: 'ascending' | 'descending';
}

const parseConfig = (raw: Readonly<Record<string, unknown>>): ArxivConfig | null => {
  const query = raw.query;
  if (typeof query !== 'string' || query.length === 0) return null;
  return {
    query,
    max_items: typeof raw.max_items === 'number' ? raw.max_items : undefined,
    sort_by: (raw.sort_by as ArxivConfig['sort_by']) ?? 'submittedDate',
    sort_order: (raw.sort_order as ArxivConfig['sort_order']) ?? 'descending',
  };
};

const buildUrl = (cfg: ArxivConfig): string => {
  const params = new URLSearchParams({
    search_query: cfg.query,
    start: '0',
    max_results: String(cfg.max_items ?? 10),
    sortBy: cfg.sort_by ?? 'submittedDate',
    sortOrder: cfg.sort_order ?? 'descending',
  });
  return `http://export.arxiv.org/api/query?${params.toString()}`;
};

/** Strip the `v<N>` version suffix from an ArXiv URI so dedup is stable across revisions. */
const stripVersion = (uri: string): string => uri.replace(/v\d+$/, '');

export interface ArxivDeps {
  readonly http: HttpFetcher;
  readonly xml: XmlParserPort;
}

export const arxivSource = (deps: ArxivDeps) =>
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
      return deps.http
        .get(url)
        .mapErr((e): AppError => e)
        .andThen((response) => {
          const parsed = deps.xml.parse(response.body, url);
          if (parsed.isErr()) {
            return errAsync<readonly ContentItem[], AppError>(parsed.error);
          }
          const normalised = normalizeFeed(parsed.value);
          if (normalised.isErr()) {
            return errAsync<readonly ContentItem[], AppError>(normalised.error);
          }
          const items: readonly ContentItem[] = normalised.value.map((f) => ({
            source_uri: stripVersion(f.source_uri),
            title: f.title,
            text: f.text,
            published_at: f.published_at,
            author: f.author,
            metadata: { kind: 'arxiv', query: cfg.query },
          }));
          return okAsync<readonly ContentItem[], AppError>(items);
        });
    };

    return { descriptor, fetch: fetchItems };
  };
