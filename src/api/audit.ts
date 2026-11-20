import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';

type AuditClient = { query: PoolClient['query'] };
import type { AuditEvent, AuditVerifyResult } from '../shared/types';

const LOCK_KEY = 727272;

export function auditHash(
  prevHash: string,
  createdAtIso: string,
  actor: string,
  type: string,
  detail: string,
): string {
  return createHash('sha256')
    .update(`${prevHash}|${createdAtIso}|${actor}|${type}|${detail}`)
    .digest('hex');
}

/**
 * 監査ログを1件追記する。
 * セッションアドバイザリロックで seq と prev_hash の競合を防ぐ。
 * 呼び出し側は同じ PoolClient を解放する責任を持つ。
 */
export async function appendAudit(
  client: AuditClient,
  actor: string,
  type: string,
  detail: string,
): Promise<AuditEvent> {
  await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
  try {
    const prev = await client.query<{ hash: string }>(
      'SELECT hash FROM audit_events ORDER BY seq DESC LIMIT 1',
    );
    const prevHash = prev.rows[0]?.hash ?? 'GENESIS';
    const createdAt = new Date();
    const createdAtIso = createdAt.toISOString();
    const hash = auditHash(prevHash, createdAtIso, actor, type, detail);
    const inserted = await client.query<{ seq: string; created_at: Date }>(
      `INSERT INTO audit_events (actor, type, detail, prev_hash, hash, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING seq, created_at`,
      [actor, type, detail, prevHash, hash, createdAt],
    );
    const row = inserted.rows[0]!;
    return {
      seq: Number(row.seq),
      actor,
      type,
      detail,
      prevHash,
      hash,
      createdAt: row.created_at.toISOString(),
    };
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]);
  }
}

/** 監査ログ全件を再計算し、prev_hash と hash の連鎖を検証する。 */
export async function verifyAuditChain(client: AuditClient): Promise<AuditVerifyResult> {
  const res = await client.query<{
    seq: string;
    actor: string;
    type: string;
    detail: string;
    prev_hash: string;
    hash: string;
    created_at: Date;
  }>('SELECT seq, actor, type, detail, prev_hash, hash, created_at FROM audit_events ORDER BY seq ASC');

  let prevHash = 'GENESIS';
  for (const row of res.rows) {
    const expected = auditHash(
      prevHash,
      row.created_at.toISOString(),
      row.actor,
      row.type,
      row.detail,
    );
    if (row.prev_hash !== prevHash) {
      return {
        ok: false,
        checked: Number(row.seq) - 1,
        firstBadSeq: Number(row.seq),
        reason: `prev_hash mismatch at seq ${row.seq}`,
        headHash: prevHash === 'GENESIS' ? null : prevHash,
      };
    }
    if (row.hash !== expected) {
      return {
        ok: false,
        checked: Number(row.seq) - 1,
        firstBadSeq: Number(row.seq),
        reason: `hash mismatch at seq ${row.seq}`,
        headHash: prevHash === 'GENESIS' ? null : prevHash,
      };
    }
    prevHash = row.hash;
  }

  return {
    ok: true,
    checked: res.rows.length,
    firstBadSeq: null,
    reason: null,
    headHash: prevHash === 'GENESIS' ? null : prevHash,
  };
}
