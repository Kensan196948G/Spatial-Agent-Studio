import { describe, expect, it } from 'vitest';
import { generateKeyPairSync, sign } from 'node:crypto';
import { AccessJwtError, verifyAccessJwt, type AccessJwtConfig } from '../../src/api/access-jwt';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = publicKey.export({ format: 'jwk' }) as { kty: string; n?: string; e?: string };

const config: AccessJwtConfig = {
  teamDomain: 'https://team.example.com',
  aud: 'aud-123',
  keys: [{ ...jwk, kid: 'test-key' }],
};

const b64 = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');

function token(claims: Record<string, unknown>, alg = 'RS256'): string {
  const header = b64({ alg, kid: 'test-key' });
  const payload = b64(claims);
  const signature = sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), privateKey).toString(
    'base64url',
  );
  return `${header}.${payload}.${signature}`;
}

const base = {
  iss: 'https://team.example.com',
  aud: ['aud-123'],
  email: 'User@Example.org',
  exp: Math.floor(Date.now() / 1000) + 300,
};

describe('Access JWT verification', () => {
  it('accepts a correctly signed token and lowercases the email', async () => {
    const claims = await verifyAccessJwt(token(base), config);
    expect(claims.email).toBe('user@example.org');
    expect(claims.aud).toEqual(['aud-123']);
  });

  it('rejects a tampered payload', async () => {
    const [header, , signature] = token(base).split('.');
    const forged = b64({ ...base, email: 'attacker@example.org' });
    await expect(verifyAccessJwt(`${header}.${forged}.${signature}`, config)).rejects.toMatchObject({
      code: 'ACCESS_JWT_SIGNATURE',
    });
  });

  it('rejects an expired token', async () => {
    const expired = { ...base, exp: Math.floor(Date.now() / 1000) - 10 };
    await expect(verifyAccessJwt(token(expired), config)).rejects.toMatchObject({
      code: 'ACCESS_JWT_EXPIRED',
    });
  });

  it('rejects a wrong audience or issuer', async () => {
    await expect(verifyAccessJwt(token({ ...base, aud: ['other'] }), config)).rejects.toMatchObject({
      code: 'ACCESS_JWT_AUDIENCE',
    });
    await expect(
      verifyAccessJwt(token({ ...base, iss: 'https://evil.example.com' }), config),
    ).rejects.toMatchObject({ code: 'ACCESS_JWT_ISSUER' });
  });

  it('rejects non-RS256 algorithms and malformed tokens', async () => {
    await expect(verifyAccessJwt(token(base, 'none'), config)).rejects.toMatchObject({
      code: 'ACCESS_JWT_ALG',
    });
    await expect(verifyAccessJwt('not-a-jwt', config)).rejects.toBeInstanceOf(AccessJwtError);
  });
});
