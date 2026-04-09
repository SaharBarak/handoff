/**
 * generic_url source adapter.
 *
 * Fetches a single URL, runs the HtmlExtractor on the response, and
 * emits one ContentItem. Useful for manually seeding a room with a
 * specific article ("add this paper to fundraise") and as a smoke
 * test for the whole fetch → extract → chunk → index pipeline.
 *
 * Config shape:
 *   {
 *     url: string   // the URL to fetch; http(s) or file://
 *     title?: string  // optional override — Readability's detected title is used otherwise
 *   }
 *
 * The emitted item's source_uri == the (post-redirect) fetched URL so
 * that re-running this adapter with the same config dedups cleanly.
 */

import { ResultAsync, errAsync } from 'neverthrow';
import type { AppError } from '../../domain/errors.js';
import type { ContentItem } from '../../domain/content.js';
import type { Source, SourceDescriptor } from '../../domain/sources.js';
import type { HttpFetcher } from '../http/fetcher.js';
import type { HtmlExtractor } from '../parsers/html-extractor.js';

interface GenericUrlConfig {
  readonly url: string;
  readonly title?: string;
}

const parseConfig = (raw: Readonly<Record<string, unknown>>): GenericUrlConfig | null => {
  const url = raw.url;
  if (typeof url !== 'string' || url.length === 0) return null;
  return { url, title: typeof raw.title === 'string' ? raw.title : undefined };
};

export interface GenericUrlDeps {
  readonly http: HttpFetcher;
  readonly html: HtmlExtractor;
}

export const genericUrlSource = (deps: GenericUrlDeps) =>
  (descriptor: SourceDescriptor): Source => {
    const cfg = parseConfig(descriptor.config);

    const fetchItems = (): ResultAsync<readonly ContentItem[], AppError> => {
      if (!cfg) {
        return errAsync<readonly ContentItem[], AppError>({
          type: 'InvalidNode',
          field: 'config.url',
          node_id: descriptor.id,
        });
      }
      return deps.http
        .get(cfg.url)
        .mapErr((e): AppError => e)
        .andThen((response) =>
          deps.html
            .extract(response.body, response.url)
            .mapErr((e): AppError => e)
            .map((article): readonly ContentItem[] => [
              {
                source_uri: response.url,
                title: cfg.title ?? article.title ?? response.url,
                text: article.text,
                author: article.byline,
                metadata: {
                  kind: 'generic_url',
                  site: article.site,
                  excerpt: article.excerpt,
                  length: article.length,
                },
              },
            ]),
        );
    };

    return { descriptor, fetch: fetchItems };
  };
