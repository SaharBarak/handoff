import { describe, it, expect } from 'vitest';
import { slugifyPath } from '../src/domain/slug.js';

describe('slugifyPath', () => {
  it('converts an absolute mac path to a leading-dash slug', () => {
    expect(slugifyPath('/Users/saharbarak/workspace/handoff')).toBe(
      '-Users-saharbarak-workspace-handoff',
    );
  });

  it('converts an absolute linux path to a leading-dash slug', () => {
    expect(slugifyPath('/home/ubuntu/workspace/handoff')).toBe('-home-ubuntu-workspace-handoff');
  });

  it('rejects relative paths', () => {
    expect(() => slugifyPath('relative/path')).toThrow(/absolute/);
  });

  it('handles single-segment paths', () => {
    expect(slugifyPath('/srv')).toBe('-srv');
  });
});
