import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  parseRoleLines,
  readRoleFile,
  resolveAccessRoles,
  type AppConfig,
  type AppConfig as Config,
} from '../../src/api/config';

function baseConfig(over: Partial<Config> = {}): AppConfig {
  return {
    port: 7440,
    databaseUrl: 'postgresql:///unused?host=/var/run/postgresql',
    appOrigin: 'http://127.0.0.1:7440',
    nodeEnv: 'test',
    cookieSecure: false,
    sessionTtlHours: 8,
    staticDir: '/nonexistent',
    corsOrigins: [],
    accessRoles: {},
    accessRoleDomains: {},
    ...over,
  };
}

describe('parseRoleLines', () => {
  it('parses emails and domains, ignoring comments, blanks and unknown roles', () => {
    const map = parseRoleLines(`
      # 現場担当者
      staff@example.com, field
      Staff2@Example.com , field , agent
      boss@example.com,agent,hq,it,unknown
      @example.co.jp,field
      not-a-line
    `);
    expect(map['staff@example.com']).toEqual(['field']);
    expect(map['staff2@example.com']).toEqual(['field', 'agent']);
    expect(map['boss@example.com']).toEqual(['agent', 'hq', 'it']);
    expect(map['@example.co.jp']).toEqual(['field']);
    expect(Object.keys(map)).toHaveLength(4);
  });
});

describe('readRoleFile', () => {
  it('returns null for a missing file and parses an existing one', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sas-roles-'));
    expect(readRoleFile(join(dir, 'missing.txt'))).toBeNull();
    const file = join(dir, 'roles.txt');
    writeFileSync(file, 'a@example.com,agent\n@example.jp,field\n');
    expect(readRoleFile(file)).toEqual({
      'a@example.com': ['agent'],
      '@example.jp': ['field'],
    });
  });
});

describe('resolveAccessRoles', () => {
  it('prefers the file (email, then domain) and falls back to env', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sas-roles-'));
    const file = join(dir, 'roles.txt');
    writeFileSync(file, 'one@example.com,field,agent\n@corp.example,hq\n');
    const config = baseConfig({
      accessRolesFile: file,
      accessRoles: { 'fallback@example.com': ['it'] },
      accessRoleDomains: { 'example.net': ['field'] },
    });

    expect(resolveAccessRoles(config, 'One@Example.com')).toEqual(['field', 'agent']);
    expect(resolveAccessRoles(config, 'anyone@corp.example')).toEqual(['hq']);
    // ファイルに無い場合は env の個別指定／ドメインへ
    expect(resolveAccessRoles(config, 'fallback@example.com')).toEqual(['it']);
    expect(resolveAccessRoles(config, 'x@example.net')).toEqual(['field']);
    expect(resolveAccessRoles(config, 'nobody@example.org')).toBeUndefined();
  });

  it('ignores the file when it cannot be read and uses env', () => {
    const config = baseConfig({
      accessRolesFile: '/nonexistent/roles.txt',
      accessRoles: { 'boss@example.com': ['agent', 'hq', 'it'] },
    });
    expect(resolveAccessRoles(config, 'boss@example.com')).toEqual(['agent', 'hq', 'it']);
  });
});
