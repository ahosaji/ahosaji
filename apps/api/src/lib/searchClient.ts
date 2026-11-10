import { MeiliSearch } from 'meilisearch';
import { env } from '../env.js';

let client: MeiliSearch | undefined;
export function getQueryClient(): MeiliSearch {
  return client ??= new MeiliSearch({ host: env.meilisearchHost, apiKey: env.meilisearchSearchKey, timeout: 5_000 });
}
