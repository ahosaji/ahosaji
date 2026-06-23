/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { SearchHit } from './SearchHit';
export type SearchResult = {
    query?: string;
    translation?: string;
    filters?: Record<string, string>;
    hits?: Array<SearchHit>;
    meta?: {
        count?: number;
        total?: number | null;
        limit?: number;
        offset?: number;
        page?: number;
        pageSize?: number;
        totalPages?: number | null;
        next?: string | null;
        prev?: string | null;
        mode?: 'page' | 'offset';
        processingTimeMs?: number;
    };
};

