import { describe, test, expect } from 'vitest';

import { orgsFromEnv, parseGithubList, parseOrgsMap, orgList } from './orgs';

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

describe('parseOrgsMap', () => {
  test('undefined → empty', () => {
    expect(parseOrgsMap(undefined)).toEqual([]);
  });

  test('splits pairs on the list separators and lowercases both sides', () => {
    expect(parseOrgsMap('Staging=Prod, Other=Prod')).toEqual([
      ['staging', 'prod'],
      ['other', 'prod'],
    ]);
  });

  test('drops entries missing a side', () => {
    expect(parseOrgsMap('staging=prod bare =prod staging=')).toEqual([['staging', 'prod']]);
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
