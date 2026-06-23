/**
 * GraphQL Yoga handler mounted at /v1/graphql.
 *
 * Auth and rate-limit happen in the Fastify preHandler hooks; if the request
 * reached this handler, the consumer is already validated.
 */
import { createYoga } from 'graphql-yoga';
import { makeExecutableSchema } from '@graphql-tools/schema';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { typeDefs } from './schema.js';
import { resolvers } from './resolvers.js';

interface YogaContext {
  req: FastifyRequest;
  reply: FastifyReply;
}

export async function graphqlRoutes(app: FastifyInstance): Promise<void> {
  const schema = makeExecutableSchema({ typeDefs, resolvers });

  const yoga = createYoga<YogaContext>({
    schema,
    graphqlEndpoint: '/v1/graphql',
    landingPage: false,
    graphiql: { title: 'Ahosaji GraphQL' },
    logging: { debug: () => {}, info: () => {}, warn: console.warn, error: console.error },
  });

  app.route({
    url: '/v1/graphql',
    method: ['GET', 'POST', 'OPTIONS'],
    handler: async (req, reply) => {
      const response = await yoga.handleNodeRequestAndResponse(req, reply, { req, reply });
      response.headers.forEach((v, k) => reply.header(k, v));
      reply.status(response.status);
      reply.send(response.body);
      return reply;
    },
  });
}
