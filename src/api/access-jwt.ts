/**
 * Cloudflare Access の JWT（Cf-Access-Jwt-Assertion）を検証する。
 *
 * 目的: `/api/auth/access` が「本文のメール」を信頼していた穴を塞ぎ、
 * Access が付与した署名済みトークンから email を取り出す。
 *
 * 前提: API が Access 配下（Tunnel 経由・同一ホスト）で配信されること。
 * 鍵はチームの JWKS（https://<team>.cloudflareaccess.com/cdn-cgi/access/certs）から取得し、
 * プロセス内でキャッシュする。テストでは `keys` を直接注入できる。
 */
import { createPublicKey, verify as cryptoVerify } from 'node:crypto';

export type AccessJwtClaims = {
  email: string;
  aud: string[];
  iss: string;
  exp: number;
  iat?: number;
  sub?: string;
};

export type AccessJwtConfig = {
  /** 例: https://winter-lake-f4c9.cloudflareaccess.com */
  teamDomain: string;
  /** Access アプリの AUD タグ */
  aud: string;
  /** 検証に使う JWK 一覧（未指定なら teamDomain の JWKS を取得） */
  keys?: Jwk[];
  /** JWKS 取得のタイムアウト */
  timeoutMs?: number;
};

type Jwk = { kid?: string; kty: string; n?: string; e?: string; alg?: string; use?: string };

export class AccessJwtError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

const jwksCache = new Map<string, { keys: Jwk[]; fetchedAt: number }>();
const JWKS_TTL_MS = 60 * 60 * 1000;

function decodeSegment(segment: string): unknown {
  const json = Buffer.from(segment.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  return JSON.parse(json);
}

async function loadKeys(config: AccessJwtConfig): Promise<Jwk[]> {
  if (config.keys && config.keys.length) return config.keys;
  const cached = jwksCache.get(config.teamDomain);
  if (cached && Date.now() - cached.fetchedAt < JWKS_TTL_MS) return cached.keys;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs ?? 5000);
  try {
    const res = await fetch(`${config.teamDomain.replace(/\/$/, '')}/cdn-cgi/access/certs`, {
      signal: controller.signal,
    });
    if (!res.ok) throw new AccessJwtError('ACCESS_JWKS_UNAVAILABLE', 'Access の公開鍵を取得できません');
    const body = (await res.json()) as { keys?: Jwk[] };
    const keys = Array.isArray(body.keys) ? body.keys : [];
    if (!keys.length) throw new AccessJwtError('ACCESS_JWKS_UNAVAILABLE', 'Access の公開鍵が空です');
    jwksCache.set(config.teamDomain, { keys, fetchedAt: Date.now() });
    return keys;
  } finally {
    clearTimeout(timer);
  }
}

export async function verifyAccessJwt(
  token: string,
  config: AccessJwtConfig,
  now = Date.now(),
): Promise<AccessJwtClaims> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new AccessJwtError('ACCESS_JWT_MALFORMED', 'JWTの形式が不正です');
  const [headerB64, payloadB64, signatureB64] = parts as [string, string, string];

  let header: { alg?: string; kid?: string };
  let payload: AccessJwtClaims & { nbf?: number };
  try {
    header = decodeSegment(headerB64) as { alg?: string; kid?: string };
    payload = decodeSegment(payloadB64) as AccessJwtClaims & { nbf?: number };
  } catch {
    throw new AccessJwtError('ACCESS_JWT_MALFORMED', 'JWTを復号できません');
  }
  if (header.alg !== 'RS256') throw new AccessJwtError('ACCESS_JWT_ALG', 'RS256以外は受け付けません');

  const keys = await loadKeys(config);
  const candidates = header.kid ? keys.filter((k) => k.kid === header.kid || !k.kid) : keys;
  const data = Buffer.from(`${headerB64}.${payloadB64}`);
  const signature = Buffer.from(signatureB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

  let verified = false;
  for (const jwk of candidates) {
    try {
      const key = createPublicKey({ key: jwk as never, format: 'jwk' });
      if (cryptoVerify('RSA-SHA256', data, key, signature)) {
        verified = true;
        break;
      }
    } catch {
      // 形状の合わない鍵はスキップ
    }
  }
  if (!verified) throw new AccessJwtError('ACCESS_JWT_SIGNATURE', 'JWTの署名を検証できません');

  const nowSec = Math.floor(now / 1000);
  if (typeof payload.exp !== 'number' || payload.exp <= nowSec) {
    throw new AccessJwtError('ACCESS_JWT_EXPIRED', 'JWTの有効期限が切れています');
  }
  if (typeof payload.nbf === 'number' && payload.nbf > nowSec + 60) {
    throw new AccessJwtError('ACCESS_JWT_NOT_YET_VALID', 'JWTはまだ有効ではありません');
  }
  const expectedIss = config.teamDomain.replace(/\/$/, '');
  if (payload.iss !== expectedIss) {
    throw new AccessJwtError('ACCESS_JWT_ISSUER', 'JWTの発行者が一致しません');
  }
  const auds = Array.isArray(payload.aud) ? payload.aud : [String(payload.aud ?? '')];
  if (!auds.includes(config.aud)) {
    throw new AccessJwtError('ACCESS_JWT_AUDIENCE', 'JWTの対象アプリが一致しません');
  }
  if (!payload.email || typeof payload.email !== 'string') {
    throw new AccessJwtError('ACCESS_JWT_EMAIL', 'JWTにemailがありません');
  }
  return { ...payload, aud: auds, email: payload.email.toLowerCase() };
}
