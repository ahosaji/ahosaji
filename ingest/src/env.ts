import { config } from 'dotenv';
import { parseIngestConfig } from './lib/config.js';
config({ path: new URL('../../.env', import.meta.url) });
export const env = parseIngestConfig(process.env);
