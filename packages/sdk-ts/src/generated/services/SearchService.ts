/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { SearchResult } from '../models/SearchResult';
import type { CancelablePromise } from '../core/CancelablePromise';
import type { BaseHttpRequest } from '../core/BaseHttpRequest';
export class SearchService {
    constructor(public readonly httpRequest: BaseHttpRequest) {}
    /**
     * Full-text search across one translation
     * Arabic queries normalized server-side (tashkeel stripped, alif unified).
     * Supports `limit`/`offset` (estimated total) or `page`/`pageSize` (exact total).
     * Response includes `next`/`prev` URLs.
     *
     * @returns SearchResult Search hits
     * @throws ApiError
     */
    public getV1Search({
        q,
        translation,
        book,
        testament,
        canon,
        bookGroup,
        limit = 20,
        offset,
        page,
        pageSize,
    }: {
        q: string,
        translation: 'en' | 'ar',
        book?: string,
        testament?: 'OT' | 'NT',
        canon?: 'protocanonical' | 'deuterocanonical',
        bookGroup?: string,
        limit?: number,
        offset?: number,
        page?: number,
        pageSize?: number,
    }): CancelablePromise<SearchResult> {
        return this.httpRequest.request({
            method: 'GET',
            url: '/v1/search',
            query: {
                'q': q,
                'translation': translation,
                'book': book,
                'testament': testament,
                'canon': canon,
                'bookGroup': bookGroup,
                'limit': limit,
                'offset': offset,
                'page': page,
                'pageSize': pageSize,
            },
        });
    }
}
