/**
 * GraphQL Yoga handler mounted at /v1/graphql.
 *
 * Auth and rate-limit happen in the Fastify preHandler hooks; if the request
 * reached this handler, the consumer is already validated.
 */
import { GraphQLError } from 'graphql';
import { ClientInputError } from '../lib/errors.js';
import { createYoga, type Plugin } from 'graphql-yoga';
import { makeExecutableSchema } from '@graphql-tools/schema';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { typeDefs } from './schema.js';
import { resolvers } from './resolvers.js';
import { queryLimitsRule } from './limits.js';

interface YogaContext {
  req: FastifyRequest;
  reply: FastifyReply;
}

export async function graphqlRoutes(app: FastifyInstance): Promise<void> {
  const schema = makeExecutableSchema({ typeDefs, resolvers });

  const securityPlugin: Plugin<YogaContext> = {
    onValidate({ addValidationRule }) { addValidationRule(queryLimitsRule); },
    onExecute({ args }) {
      const req = args.contextValue.req;
      return { onExecuteDone({ result, setResult }) {
        if (!('errors' in result) || !result.errors) return;
        setResult({ ...result, errors: result.errors.map(error => {
          const inputError = error.originalError instanceof ClientInputError;
          if (!inputError) req.log.error({ err: error, requestId: req.id }, 'GraphQL backend error');
          return new GraphQLError(inputError ? error.message : 'internal error', {
            path: error.path, extensions: { code: inputError ? 'BAD_USER_INPUT' : 'INTERNAL_SERVER_ERROR', requestId: req.id },
          });
        }) });
      } };
    },
  };
  const yoga = createYoga<YogaContext>({
    schema,
    plugins: [securityPlugin],
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
