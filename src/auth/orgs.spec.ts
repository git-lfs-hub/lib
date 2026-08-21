import { describe, test, expect } from 'vitest';

import { orgsFromEnv, parseGithubList, orgList } from './orgs';

describe('parseGithubList', () => {
  test('undefined → empty', () => {
    expect(parseGithubList(undefined)).toEqual([]);
  });

  test('empty string → empty', () => {
    expect(parseGithubList('')).toEqual([]);
  });

  test('splits on spaces, commas, semicolons and drops blanks', () => {
    expect(parseGithubList(' foo, bar;baz   qux ')).toEqual(['foo', 'bar', 'baz', 'qux']);
  });
});

describe('orgList', () => {
  test('array passes through, blanks dropped', () => {
    expect(orgList(['a', '', 'b'])).toEqual(['a', 'b']);
  });

  test('string is split like GITHUB_ORGS', () => {
    expect(orgList('a, b')).toEqual(['a', 'b']);
  });

  test('undefined → empty', () => {
    expect(orgList(undefined)).toEqual([]);
  });
});

describe('orgsFromEnv', () => {
  test('reads GITHUB_ORGS', () => {
    expect(orgsFromEnv({ GITHUB_ORGS: 'a b' })).toEqual(['a', 'b']);
  });

  test('reads legacy singular GITHUB_ORG', () => {
    expect(orgsFromEnv({ GITHUB_ORG: 'solo' })).toEqual(['solo']);
  });

  test('merges GITHUB_ORGS and GITHUB_ORG', () => {
    expect(orgsFromEnv({ GITHUB_ORGS: 'a b', GITHUB_ORG: 'c' })).toEqual(['a', 'b', 'c']);
  });

  test('whitespace-only GITHUB_ORG is dropped', () => {
    expect(orgsFromEnv({ GITHUB_ORG: '   ' })).toEqual([]);
  });

  test('neither set → empty', () => {
    expect(orgsFromEnv({})).toEqual([]);
  });
});
