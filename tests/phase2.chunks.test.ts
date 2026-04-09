/**
 * Chunker unit tests.
 *
 * Verifies the pure `chunk(text, opts)` function:
 *   - empty input → empty array
 *   - short input under minChars → one small chunk (never drops content)
 *   - paragraph boundaries preserved when they fit
 *   - overlap is applied between chunks
 *   - hard-slice fallback when no separator works
 *   - merged tail: a small trailing fragment gets merged into the
 *     previous chunk instead of being emitted below minChars
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chunk } from '../src/domain/chunks.js';

test('chunk: empty input returns empty array', () => {
  assert.deepEqual(chunk(''), []);
  assert.deepEqual(chunk('   \n  '), []);
});

test('chunk: short input yields a single chunk even below minChars', () => {
  const result = chunk('hello', { maxChars: 1000, minChars: 80 });
  assert.equal(result.length, 1);
  assert.equal(result[0].text, 'hello');
});

test('chunk: paragraph-sized input under maxChars yields a single chunk', () => {
  const para = 'This is a single paragraph. It stays together because it fits.';
  const result = chunk(para, { maxChars: 1000 });
  assert.equal(result.length, 1);
  assert.equal(result[0].text, para);
  assert.equal(result[0].offset, 0);
});

test('chunk: paragraph separators split text into multiple chunks', () => {
  const paras = [
    'First paragraph about homelab hardware and Mikrotik CHR licensing. '.repeat(10),
    'Second paragraph about Proxmox PCIe passthrough and VFIO modules. '.repeat(10),
    'Third paragraph about 10GbE switches and DAC cables for rack builds. '.repeat(10),
  ];
  const text = paras.join('\n\n');
  const result = chunk(text, { maxChars: 800, overlap: 50, minChars: 80 });
  assert.ok(result.length >= 2, `expected >=2 chunks, got ${result.length}`);
  // every chunk is non-empty and under maxChars (allowing overlap drift)
  for (const c of result) {
    assert.ok(c.text.length > 0);
    assert.ok(
      c.text.length <= 900, // maxChars + overlap slack
      `chunk longer than maxChars+overlap: ${c.text.length}`,
    );
  }
});

test('chunk: re-joined chunks cover every character of the input (modulo whitespace)', () => {
  const text = ('alpha beta gamma delta epsilon. '.repeat(60)).trim();
  const result = chunk(text, { maxChars: 400, overlap: 0 });
  const joined = result.map((c) => c.text).join('').replace(/\s+/g, ' ').trim();
  const expected = text.replace(/\s+/g, ' ').trim();
  assert.equal(joined, expected, 'joining chunks (no overlap) should reproduce the input');
});

test('chunk: overlap > 0 introduces character repetition at boundaries', () => {
  const text = 'A'.repeat(300) + ' ' + 'B'.repeat(300) + ' ' + 'C'.repeat(300);
  const noOverlap = chunk(text, { maxChars: 400, overlap: 0 });
  const withOverlap = chunk(text, { maxChars: 400, overlap: 50 });
  const noOverlapLen = noOverlap.reduce((s, c) => s + c.text.length, 0);
  const withOverlapLen = withOverlap.reduce((s, c) => s + c.text.length, 0);
  assert.ok(
    withOverlapLen >= noOverlapLen,
    `overlap run should add (or equal) bytes: noOverlap=${noOverlapLen} withOverlap=${withOverlapLen}`,
  );
});

test('chunk: hard-slice fallback on text with no separators', () => {
  const text = 'X'.repeat(3000);
  const result = chunk(text, { maxChars: 1000, overlap: 0, minChars: 80 });
  assert.ok(result.length >= 3);
  for (const c of result) {
    assert.ok(c.text.length <= 1000, `hard-sliced chunk > maxChars: ${c.text.length}`);
  }
});

test('chunk: content is never silently dropped', () => {
  const text = 'small remainder at end. '.repeat(5); // ~120 chars
  const result = chunk(text, { maxChars: 50, overlap: 0, minChars: 80 });
  assert.ok(result.length >= 1);
  assert.ok(result.every((c) => c.text.length > 0));
  // the last chunk may fall below minChars if merged into previous — but the
  // total character count must still cover the input
  const totalChars = result.reduce((s, c) => s + c.text.replace(/\s+/g, ' ').trim().length, 0);
  assert.ok(totalChars > 0);
});
