/**
 * Arabic text normalization (mirror of ingest/src/lib/arabic.ts).
 *
 * Future v1.x: extract to packages/shared so this file is one place.
 */

const TASHKEEL = /[ً-ٰٟ]/g;
const TATWEEL = /ـ/g;
const ALIF_VARIANTS = /[آأإ]/g;
const YA_VARIANT = /ى/g;

export function normalizeArabic(s: string): string {
  return s
    .replace(TASHKEEL, '')
    .replace(TATWEEL, '')
    .replace(ALIF_VARIANTS, 'ا')
    .replace(YA_VARIANT, 'ي');
}
