/**
 * Arabic text normalization for search.
 *
 * Coptic-Orthodox Arabic readers expect diacritic-insensitive search ("الراعي"
 * matches "الرَّاعِي"). We index both the original text *and* a normalized
 * variant; queries are normalized at request time and matched against either.
 *
 * Operations applied:
 *   1. Strip tashkeel (combining diacritics U+064B–U+065F, U+0670)
 *   2. Strip tatweel (U+0640) — used for justification, never meaningful
 *   3. Unify alif variants: أ (U+0623), إ (U+0625), آ (U+0622) → ا (U+0627)
 *   4. Unify ya: ى (U+0649) → ي (U+064A)
 *   5. Unify ha-of-ta-marbuta in some contexts: ة (U+0629) → ه (U+0647)
 *      (Conservative: do this only on word-final ة that's not at index 0,
 *       so we don't mangle words. Many search engines just leave ة alone.)
 *
 * For v1 we apply 1, 2, 3, 4. ة handling is kept conservative (untouched).
 */

const TASHKEEL = /[ً-ٰٟ]/g;
const TATWEEL = /ـ/g;
const ALIF_VARIANTS = /[آأإ]/g;     // آ أ إ → ا
const YA_VARIANT = /ى/g;                       // ى → ي

export function normalizeArabic(s: string): string {
  return s
    .replace(TASHKEEL, '')
    .replace(TATWEEL, '')
    .replace(ALIF_VARIANTS, 'ا')
    .replace(YA_VARIANT, 'ي');
}
