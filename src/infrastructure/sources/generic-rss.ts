/**
 * generic_rss source adapter.
 *
 * Config shape (stored on SourceDescriptor.config):
 *   {
 *     feed_url: string        // http(s):// or file:// URL of the RSS/Atom feed
 *     max_items?: number      // cap on how many items to return (default 20)
 *   }
 *
 * The adapter:
 *   1. fetches the feed URL as raw text via HttpFetcher
 *   2. parses the XML via XmlParser (fast-xml-parser)
 *   3. normalises RSS 2.0 / Atom 1.0 via domain.feeds.normalizeFeed
 *   4. returns a ContentItem[] trimmed to max_items
 *
 * No HTML parsing happens here — the feed body is text already.
 * Fetching the linked article is a separate concern (generic_url
 * adapter) that Phase 3 can chain.
 */

import { ResultAsync, errAsync, okAsync } from 'neverthrow';
import type { AppError } from '../../domain/errors.js';
import type { ContentItem } from '../../domain/content.js';
import type { Source, SourceDescriptor } from '../../domain/sources.js';
import { normalizeFeed } from '../../domain/feeds.js';
import type { HttpFetcher } from '../http/fetcher.js';
import type { XmlParserPort } from '../parsers/xml-parser.js';

interface GenericRssConfig {
  readonly feed_url: string;
  readonly max_items?: number;
}

const parseConfig = (raw: Readonly<Record<string, unknown>>): GenericRssConfig | null => {
  const feed_url = raw.feed_url;
  if (typeof feed_url !== 'string' || feed_url.length === 0) return null;
  const max_items = typeof raw.max_items === 'number' ? raw.max_items : undefined;
  return { feed_url, max_items };
};

export interface GenericRssDeps {
  readonly http: HttpFetcher;
  readonly xml: XmlParserPort;
}

export const genericRssSource = (deps: GenericRssDeps) =>
  (descriptor: SourceDescriptor): Source => {
    const cfg = parseConfig(descriptor.config);

    const fetchItems = (): ResultAsync<readonly ContentItem[], AppError> => {
      if (!cfg) {
        return errAsync<readonly ContentItem[], AppError>({
          type: 'InvalidNode',
          field: 'config.feed_url',
          node_id: descriptor.id,
        });
      }
      const max = cfg.max_items ?? 20;
      return deps.http
        .get(cfg.feed_url)
        .mapErr((e): AppError => e)
        .andThen((response) => {
          const parsed = deps.xml.parse(response.body, cfg.feed_url);
          if (parsed.isErr()) {
            return errAsync<readonly ContentItem[], AppError>(parsed.error);
          }
          const normalised = normalizeFeed(parsed.value);
          if (normalised.isErr()) {
            return errAsync<readonly ContentItem[], AppError>(normalised.error);
          }
          const items: readonly ContentItem[] = normalised.value.slice(0, max).map((f) => ({
            source_uri: f.source_uri,
            title: f.title,
            text: f.text,
            published_at: f.published_at,
            author: f.author,
            metadata: { kind: 'generic_rss', feed_url: cfg.feed_url },
          }));
          return okAsync<readonly ContentItem[], AppError>(items);
        });
    };

    return { descriptor, fetch: fetchItems };
  };
