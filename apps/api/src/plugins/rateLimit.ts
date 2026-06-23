/**
 * Per-tier rate limiting.
 *
 * Uses @fastify/rate-limit's per-route + dynamic-max API. We key by
 * consumer.id when authed, by IP when anonymous (discovery routes only).
 *
 * In-memory store in v1 — fine for single-process. Postgres-backed counter
 * is the v1.1 upgrade if/when we scale to multiple workers.
 */
import fp from 'fastify-plugin';
import rateLimit from '@fastify/rate-limit';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { TIER_RATE_LIMITS } from '../auth.js';

export const ANON_PER_MINUTE = 30;  // discovery routes, by IP

// Per-day quota, enforced here as a second (coarse) window for authed consumers.
// In-memory like the per-minute window — fine for single-process v1; a
// Postgres-backed counter is the v1.1 upgrade for multi-worker deploys.
const DAY_MS = 24 * 60 * 60 * 1000;
const dailyCounters = new Map<string, { count: number; resetAt: number }>();

const rateLimitPlugin: FastifyPluginAsync = async (app) => {
  await app.register(rateLimit, {
    global: true,
    hook: 'preHandler',  // run AFTER auth's preHandler so req.consumer is populated
    timeWindow: '1 minute',
    max: (req: FastifyRequest) => {
      if (req.consumer) {
        const limit = TIER_RATE_LIMITS[req.consumer.tier].perMinute;
        return Number.isFinite(limit) ? limit : 1_000_000;  // effectively unlimited
      }
      return ANON_PER_MINUTE;
    },
    keyGenerator: (req: FastifyRequest) => {
      return req.consumer?.id ?? req.ip;
    },
    errorResponseBuilder: (_req, ctx) => ({
      type: 'about:blank',
      title: 'Too Many Requests',
      status: 429,
      detail: `rate limit exceeded (${ctx.max}/min); retry in ${Math.ceil(ctx.ttl / 1000)}s`,
    }),
  });

  // Second window: per-day quota for authed consumers (keyed by consumer.id).
  // Anonymous traffic is bounded by the per-minute IP window above only.
  app.addHook('preHandler', async (req: FastifyRequest, reply) => {
    if (!req.consumer) return;
    const perDay = TIER_RATE_LIMITS[req.consumer.tier].perDay;
    if (!Number.isFinite(perDay)) return;  // unlimited tiers skip the daily check

    const now = Date.now();
    const id = req.consumer.id;
    let entry = dailyCounters.get(id);
    if (!entry || now >= entry.resetAt) {
      entry = { count: 0, resetAt: now + DAY_MS };
      dailyCounters.set(id, entry);
    }
    entry.count += 1;
    if (entry.count > perDay) {
      const retryS = Math.ceil((entry.resetAt - now) / 1000);
      return reply.code(429).send({
        type: 'about:blank',
        title: 'Too Many Requests',
        status: 429,
        detail: `daily quota exceeded (${perDay}/day); retry in ${retryS}s`,
      });
    }
  });
};

export default fp(rateLimitPlugin, { name: 'ahosaji-rate-limit', dependencies: ['ahosaji-auth'] });
