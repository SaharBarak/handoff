/**
 * Feed normalizer unit tests.
 *
 * Verifies that normalizeFeed handles:
 *   - RSS 2.0 with channel > item[] and pubDate + description
 *   - Atom 1.0 with feed > entry[] including:
 *       - link.href attribute
 *       - summary vs content precedence
 *       - published/updated normalization
 *   - Unknown root shape → Result::err
 *
 * The tests build the parsed-XML tree by hand — fast-xml-parser
 * isn't needed for normalisation itself, only for parsing.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeFeed } from '../src/domain/feeds.js';

test('feeds: RSS 2.0 shape is extracted and dates are normalised', () => {
  const raw = {
    rss: {
      channel: {
        title: 'Example Feed',
        item: [
          {
            title: 'Article one',
            link: 'https://example.com/one',
            description: '<p>first body</p>',
            pubDate: 'Tue, 01 Apr 2026 10:00:00 GMT',
            author: 'alice@example.com',
          },
          {
            title: 'Article two',
            link: 'https://example.com/two',
            'content:encoded': '<div>rich body</div>',
            pubDate: 'Wed, 02 Apr 2026 10:00:00 GMT',
          },
        ],
      },
    },
  };
  const result = normalizeFeed(raw);
  assert.ok(result.isOk());
  const items = result._unsafeUnwrap();
  assert.equal(items.length, 2);
  assert.equal(items[0].source_uri, 'https://example.com/one');
  assert.equal(items[0].title, 'Article one');
  assert.equal(items[0].text, 'first body');
  assert.equal(items[0].published_at, new Date('Tue, 01 Apr 2026 10:00:00 GMT').toISOString());
  assert.equal(items[1].text, 'rich body');
});

test('feeds: Atom 1.0 shape handles link.href and content/summary precedence', () => {
  const raw = {
    feed: {
      title: 'Atom Example',
      entry: [
        {
          title: 'Atom entry one',
          link: { href: 'https://example.com/atom1', rel: 'alternate' },
          summary: 'a short summary',
          content: { '#text': 'full body', type: 'text' },
          published: '2026-04-01T10:00:00Z',
          author: { name: 'Alice' },
        },
        {
          title: { '#text': 'Atom entry two' },
          link: [
            { href: 'https://example.com/atom2a', rel: 'self' },
            { href: 'https://example.com/atom2', rel: 'alternate' },
          ],
          summary: 'only a summary here',
          updated: '2026-04-02T10:00:00Z',
        },
      ],
    },
  };
  const result = normalizeFeed(raw);
  assert.ok(result.isOk());
  const items = result._unsafeUnwrap();
  assert.equal(items.length, 2);
  assert.equal(items[0].source_uri, 'https://example.com/atom1');
  assert.equal(items[0].text, 'full body', 'content takes precedence over summary when both exist');
  assert.equal(items[0].author, 'Alice');
  assert.equal(items[0].published_at, '2026-04-01T10:00:00.000Z');
  assert.equal(items[1].source_uri, 'https://example.com/atom2', 'prefers rel=alternate link');
  assert.equal(items[1].title, 'Atom entry two');
  assert.equal(items[1].text, 'only a summary here', 'falls back to summary when content is absent');
  assert.equal(items[1].published_at, '2026-04-02T10:00:00.000Z');
});

test('feeds: unknown root shape returns an error', () => {
  const result = normalizeFeed({ random: 'thing' });
  assert.ok(result.isErr());
});

test('feeds: single-item RSS (not an array) is coerced correctly', () => {
  const raw = {
    rss: {
      channel: {
        item: {
          title: 'lone item',
          link: 'https://example.com/solo',
          description: 'just one',
        },
      },
    },
  };
  const result = normalizeFeed(raw);
  assert.ok(result.isOk());
  const items = result._unsafeUnwrap();
  assert.equal(items.length, 1);
  assert.equal(items[0].source_uri, 'https://example.com/solo');
});

test('feeds: malformed dates are dropped rather than propagated', () => {
  const raw = {
    rss: {
      channel: {
        item: {
          title: 'bad date',
          link: 'https://example.com/bad-date',
          description: 'body',
          pubDate: 'not a real date',
        },
      },
    },
  };
  const items = normalizeFeed(raw)._unsafeUnwrap();
  assert.equal(items.length, 1);
  assert.equal(items[0].published_at, undefined);
});
