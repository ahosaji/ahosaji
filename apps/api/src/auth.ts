/**
 * API key auth core.
 *
 * Keys are high-entropy random tokens (`ahk_<base64url(32 bytes)>`). At rest
 * we store sha256(key) and the first 12 chars of the plaintext as a lookup
 * prefix. Comparison is constant-time.
 *
 * Why sha256 instead of argon2/scrypt: API keys are 32+ random bytes, so
 * brute-force resistance via slow hashing is unnecessary (and would slow the
 * hot path of every authed request). Slow hashing is for low-entropy
 * user-chosen passwords. This is the standard approach for API keys (Stripe,
 * GitHub Personal Access Tokens, etc.).
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { pool } from './db.js';

export type Tier = 'free' | 'church' | 'paid' | 'admin';

export interface Consumer {
  id: string;
  email: string;
  name: string | null;
  tier: Tier;
}

export function generateKey(): { plaintext: string; prefix: string; hash: string } {
  const raw = randomBytes(32).toString('base64url');
  const plaintext = `ahk_${raw}`;
  const prefix = plaintext.slice(0, 12);
  const hash = sha256(plaintext);
  return { plaintext, prefix, hash };
}

export function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// Cache keyed by sha256(token) — never the plaintext — so the in-memory map
// can't leak raw API keys. Bounded to MAX entries with FIFO eviction so a flood
// of distinct invalid tokens can't grow it unboundedly. TTL is short (60s):
// residual trade-off is that a revoked key may keep working for up to 60s after
// revocation; we accept that small window in exchange for not hitting Postgres
// on every authed request.
const lookupCache = new Map<string, { consumer: Consumer | null; ts: number }>();
const CACHE_TTL_MS = 60 * 1000;
const CACHE_MAX_ENTRIES = 10_000;

export async function validateKey(key: string): Promise<Consumer | null> {
  if (!key.startsWith('ahk_') || key.length < 16) return null;
  const prefix = key.slice(0, 12);
  const cacheKey = sha256(key);

  const cached = lookupCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.consumer;
  }

  const r = await pool.query(
    `SELECT k.id AS key_id, k.key_hash, k.revoked_at,
            c.id, c.email, c.name, c.tier
       FROM api_keys k
       JOIN consumers c ON c.id = k.consumer_id
       WHERE k.prefix = $1`,
    [prefix],
  );
  let consumer: Consumer | null = null;
  for (const row of r.rows) {
    if (row.revoked_at) continue;
    if (constantTimeEquals(row.key_hash, cacheKey)) {
      consumer = {
        id: row.id as string,
        email: row.email as string,
        name: (row.name as string | null) ?? null,
        tier: row.tier as Tier,
      };
      // Fire-and-forget last_used_at update (don't block request)
      pool.query('UPDATE api_keys SET last_used_at = now() WHERE id = $1', [row.key_id])
        .catch(err => console.error('failed to update last_used_at:', err));
      break;
    }
  }
  // FIFO eviction: drop the oldest insertion (Map preserves insertion order)
  // once we hit the cap, before inserting the new entry.
  if (!lookupCache.has(cacheKey) && lookupCache.size >= CACHE_MAX_ENTRIES) {
    const oldest = lookupCache.keys().next().value;
    if (oldest !== undefined) lookupCache.delete(oldest);
  }
  lookupCache.set(cacheKey, { consumer, ts: Date.now() });
  return consumer;
}

export const TIER_RATE_LIMITS: Record<Tier, { perMinute: number; perDay: number }> = {
  free:   { perMinute: 60,    perDay: 5_000 },
  church: { perMinute: 600,   perDay: 200_000 },
  paid:   { perMinute: 6_000, perDay: Number.POSITIVE_INFINITY },
  admin:  { perMinute: Number.POSITIVE_INFINITY, perDay: Number.POSITIVE_INFINITY },
};
