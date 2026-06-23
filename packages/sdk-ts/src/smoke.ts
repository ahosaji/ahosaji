/**
 * Smoke test for the generated SDK. Hits a live local API.
 *   pnpm --filter @ahosaji/sdk smoke
 *
 * Requires:
 *   - API running at http://localhost:3001
 *   - AHOSAJI_KEY env var (or hardcode below for quick test)
 */
import { AhosajiClient } from './generated/index.js';

const KEY = process.env.AHOSAJI_KEY ?? 'ahk_fb1LwZBN8bhaietY0D7R70izh9ZPalFvaI9e9dpKFx4';
const BASE = process.env.AHOSAJI_BASE ?? 'http://localhost:3001';

async function main(): Promise<void> {
  const client = new AhosajiClient({
    BASE,
    TOKEN: KEY,
  });

  console.log('▶ list translations');
  const t = await client.discovery.getV1Translations();
  console.log('  →', t);

  console.log('▶ get JHN.3.16 (en) — single verse');
  // Generator suffixed `1` because this URL collides with the verse-range URL
  const v = await client.bible.getV1BibleTranslationsBooksChaptersVerses1({
    code: 'en', usfm: 'JHN', n: 3, v: 16,
  });
  console.log('  → ref:', (v as { ref?: string }).ref);
  console.log('  → text:', ((v as { text?: string }).text ?? '').slice(0, 80));

  console.log('▶ search "born again" (en)');
  const s = await client.search.getV1Search({
    q: 'born again', translation: 'en', limit: 3,
  });
  console.log('  → total:', (s as { meta?: { total?: number } }).meta?.total);

  console.log('▶ parallel TOB.1.25 (Vulgate overflow → mapped from en TOB.1.22)');
  const p = await client.bible.getV1Parallel({
    translations: 'en,ar', ref: 'TOB.1.25',
  });
  type PEntry = { translation: string; present: boolean; mapped_to?: string[] | null; mapping_note?: string | null };
  type PRef = { ref: string; translations: PEntry[] };
  for (const r of ((p as { refs?: PRef[] }).refs ?? [])) {
    for (const t of r.translations) {
      const note = t.mapped_to?.length ? `  ← ${JSON.stringify(t.mapped_to)}`
        : t.mapping_note ? `  (NULL: ${t.mapping_note})` : '';
      console.log(`  → ${r.ref}/${t.translation}: present=${t.present}${note}`);
    }
  }

  console.log('▶ parallel SIR.1.34 (Vulgate-only verse — null mapping)');
  const p2 = await client.bible.getV1Parallel({
    translations: 'en,ar', ref: 'SIR.1.34',
  });
  for (const r of ((p2 as { refs?: PRef[] }).refs ?? [])) {
    for (const t of r.translations) {
      const note = t.mapped_to?.length ? `  ← ${JSON.stringify(t.mapped_to)}`
        : t.mapping_note ? `  (NULL: ${t.mapping_note})` : '';
      console.log(`  → ${r.ref}/${t.translation}: present=${t.present}${note}`);
    }
  }
}

main().catch(err => { console.error('FAILED:', err); process.exit(1); });
