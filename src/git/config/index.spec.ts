import { describe, test, expect } from 'vitest';

import { gitConfigFirstValue } from './index';

const url = (text: string) => gitConfigFirstValue(text, 'lfs', 'url');

describe('gitConfigFirstValue', () => {
  test('reads a plain value', () => {
    expect(url('[lfs]\n\turl = https://h/p\n')).toBe('https://h/p');
  });

  test('case-insensitive section + key', () => {
    expect(url('[LFS]\n\tURL = https://h/p\n')).toBe('https://h/p');
  });

  test('null when the key is absent', () => {
    expect(url('[lfs]\n\tpushurl = https://h/p\n')).toBeNull();
    expect(url('[core]\n\turl = https://h/p\n')).toBeNull();
  });

  test('strips a `;` inline comment', () => {
    expect(url('[lfs]\n\turl = https://h/p ; prod\n')).toBe('https://h/p');
  });

  test('strips a `#` inline comment', () => {
    expect(url('[lfs]\n\turl = https://h/p # note\n')).toBe('https://h/p');
  });

  test('unwraps a double-quoted value', () => {
    expect(url('[lfs]\n\turl = "https://h/p"\n')).toBe('https://h/p');
  });

  test('quotes shield a comment char and preserve inner whitespace', () => {
    expect(url('[lfs]\n\turl = "https://h/p#frag" ; tail\n')).toBe('https://h/p#frag');
    expect(url('[lfs]\n\turl = "a b"\n')).toBe('a b');
  });

  test('applies `\\` escapes', () => {
    expect(url('[lfs]\n\turl = a\\tb\n')).toBe('a\tb');
    expect(url('[lfs]\n\turl = a\\"b\n')).toBe('a"b');
  });

  test('ignores a trailing comment on the section header', () => {
    expect(url('[lfs] ; mapping\n\turl = https://h/p\n')).toBe('https://h/p');
  });

  test('skips an `[lfs "sub"]` subsection, reads the plain [lfs]', () => {
    expect(url('[lfs "x"]\n\turl = https://other\n[lfs]\n\turl = https://h/p\n')).toBe(
      'https://h/p',
    );
  });

  test('returns the first matching value', () => {
    expect(url('[lfs]\n\turl = https://first\n\turl = https://second\n')).toBe('https://first');
  });

  test('tolerates no spaces around `=`', () => {
    expect(url('[lfs]\nurl=https://h/p\n')).toBe('https://h/p');
  });
});
