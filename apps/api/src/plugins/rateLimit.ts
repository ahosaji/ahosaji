import fp from 'fastify-plugin';
import rateLimit from '@fastify/rate-limit';
import type { FastifyPluginAsync } from 'fastify';
import type { Consumer } from '../auth.js';
import { consumeConsumerQuota } from '../lib/quota.js';

export const ANON_PER_MINUTE = 30;
export const INGRESS_PER_MINUTE = 10_000;

// Registered before authentication; bounded LRU memory and no database access.
export const ingressLimitPlugin = fp(async app => {
  await app.register(rateLimit, {
    global: true, hook: 'onRequest', timeWindow: 60_000, max: INGRESS_PER_MINUTE,
    cache: 10_000, keyGenerator: req => req.ip,
    errorResponseBuilder: () => ({ title: 'Too Many Requests', status: 429, detail: 'IP request limit exceeded' }),
  });
}, { name: 'ahosaji-ingress-limit' });

const rateLimitPlugin: FastifyPluginAsync<{ consumeQuota?: (consumer: Consumer) => Promise<boolean> }> = async (app, options) => {
  const consumeQuota = options.consumeQuota ?? consumeConsumerQuota;
  if (!app.hasDecorator('createRateLimit')) await app.register(rateLimit, { global: false, cache: 10_000 });
  const anonymousLimit = app.createRateLimit({ max: ANON_PER_MINUTE, timeWindow: 60_000 });
  app.addHook('preHandler', async (req, reply) => {
    if (!req.consumer) {
      const limit = await anonymousLimit(req);
      if (!limit.isAllowed && limit.isExceeded) return reply.code(429).send({ title: 'Too Many Requests', status: 429, detail: 'anonymous IP quota exceeded' });
      return;
    }
    if (!await consumeQuota(req.consumer)) {
      reply.header('retry-after', '60');
      return reply.code(429).send({ title: 'Too Many Requests', status: 429, detail: 'consumer minute or UTC daily quota exceeded' });
    }
  });
};
export default fp(rateLimitPlugin, { name: 'ahosaji-rate-limit', dependencies: ['ahosaji-auth'] });
