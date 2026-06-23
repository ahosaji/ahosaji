/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { Chapter } from '../models/Chapter';
import type { ParallelResult } from '../models/ParallelResult';
import type { Passage } from '../models/Passage';
import type { Verse } from '../models/Verse';
import type { CancelablePromise } from '../core/CancelablePromise';
import type { BaseHttpRequest } from '../core/BaseHttpRequest';
export class BibleService {
    constructor(public readonly httpRequest: BaseHttpRequest) {}
    /**
     * Get a whole chapter (verses + headings)
     * @returns Chapter Chapter contents
     * @throws ApiError
     */
    public getV1BibleTranslationsBooksChapters({
        code,
        usfm,
        n,
    }: {
        code: 'en' | 'ar',
        /**
         * USFM 3-letter book code (e.g. JHN, TOB)
         */
        usfm: string,
        n: number,
    }): CancelablePromise<Chapter> {
        return this.httpRequest.request({
            method: 'GET',
            url: '/v1/bible/translations/{code}/books/{usfm}/chapters/{n}',
            path: {
                'code': code,
                'usfm': usfm,
                'n': n,
            },
            errors: {
                401: `Missing or invalid Authorization`,
                404: `Resource not found`,
            },
        });
    }
    /**
     * Verse range within a chapter
     * @returns any Verse range
     * @throws ApiError
     */
    public getV1BibleTranslationsBooksChaptersVerses({
        code,
        usfm,
        n,
        from,
        to,
    }: {
        code: 'en' | 'ar',
        /**
         * USFM 3-letter book code (e.g. JHN, TOB)
         */
        usfm: string,
        n: number,
        from: number,
        to: number,
    }): CancelablePromise<{
        translation?: string;
        book?: string;
        chapter?: number;
        from?: number;
        to?: number;
        verses?: Array<Verse>;
    }> {
        return this.httpRequest.request({
            method: 'GET',
            url: '/v1/bible/translations/{code}/books/{usfm}/chapters/{n}/verses',
            path: {
                'code': code,
                'usfm': usfm,
                'n': n,
            },
            query: {
                'from': from,
                'to': to,
            },
            errors: {
                400: `Bad request`,
                401: `Missing or invalid Authorization`,
            },
        });
    }
    /**
     * Single verse with cross-references
     * @returns Verse Single verse
     * @throws ApiError
     */
    public getV1BibleTranslationsBooksChaptersVerses1({
        code,
        usfm,
        n,
        v,
    }: {
        code: 'en' | 'ar',
        /**
         * USFM 3-letter book code (e.g. JHN, TOB)
         */
        usfm: string,
        n: number,
        v: number,
    }): CancelablePromise<Verse> {
        return this.httpRequest.request({
            method: 'GET',
            url: '/v1/bible/translations/{code}/books/{usfm}/chapters/{n}/verses/{v}',
            path: {
                'code': code,
                'usfm': usfm,
                'n': n,
                'v': v,
            },
            errors: {
                401: `Missing or invalid Authorization`,
                404: `Resource not found`,
            },
        });
    }
    /**
     * Cross-chapter passage range (single book)
     * @returns Passage Passage
     * @throws ApiError
     */
    public getV1BiblePassages({
        translation,
        start,
        end,
    }: {
        translation: string,
        /**
         * USFM ref (e.g. JHN.3.16)
         */
        start: string,
        /**
         * USFM ref (same book)
         */
        end: string,
    }): CancelablePromise<Passage> {
        return this.httpRequest.request({
            method: 'GET',
            url: '/v1/bible/passages',
            query: {
                'translation': translation,
                'start': start,
                'end': end,
            },
            errors: {
                400: `Bad request`,
            },
        });
    }
    /**
     * Cross-translation parallel query (signature feature)
     * Returns the same verse(s) across multiple translations side-by-side. Each
     * per-translation entry has `present: bool` so missing-in-one-tradition
     * verses (Tobit Vulgate vs Rahlfs LXX divergence) are explicit, not 404s.
     *
     * **Versification-aware mode** (`prefer_aligned=1`): the FIRST translation
     * in `translations` becomes the anchor, and other translations show their
     * semantic equivalent of the anchor's verse per the versification mapping
     * tables — even when both translations have the queried ref directly.
     * This surfaces renumbering shifts (e.g. ar:SIR.1.20 = en:SIR.1.16) and
     * Vulgate-only verses (no Greek-LXX equivalent → `present:false +
     * mapping_note`). When the table has no entry for the queried ref,
     * falls back to identity matching transparently.
     *
     * @returns ParallelResult Parallel result
     * @throws ApiError
     */
    public getV1Parallel({
        translations,
        ref,
        start,
        end,
        preferAligned,
    }: {
        /**
         * Comma-separated codes (e.g. en,ar)
         */
        translations: string,
        ref?: string,
        start?: string,
        end?: string,
        /**
         * When set ("1", "true", "yes"), apply versification mapping with the
         * first listed translation as the anchor. See description above.
         *
         */
        preferAligned?: string,
    }): CancelablePromise<ParallelResult> {
        return this.httpRequest.request({
            method: 'GET',
            url: '/v1/parallel',
            query: {
                'translations': translations,
                'ref': ref,
                'start': start,
                'end': end,
                'prefer_aligned': preferAligned,
            },
        });
    }
}
