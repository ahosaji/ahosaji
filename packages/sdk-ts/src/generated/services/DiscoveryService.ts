/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { Book } from '../models/Book';
import type { Translation } from '../models/Translation';
import type { CancelablePromise } from '../core/CancelablePromise';
import type { BaseHttpRequest } from '../core/BaseHttpRequest';
export class DiscoveryService {
    constructor(public readonly httpRequest: BaseHttpRequest) {}
    /**
     * Liveness check
     * @returns any Service is alive
     * @throws ApiError
     */
    public getV1Healthz(): CancelablePromise<{
        status?: string;
        db?: string;
    }> {
        return this.httpRequest.request({
            method: 'GET',
            url: '/v1/healthz',
        });
    }
    /**
     * Build info & supported domains/transports
     * @returns any Service info
     * @throws ApiError
     */
    public getV1Info(): CancelablePromise<{
        name?: string;
        version?: string;
        domains?: Array<string>;
        transports?: Array<string>;
    }> {
        return this.httpRequest.request({
            method: 'GET',
            url: '/v1/info',
        });
    }
    /**
     * List all translations
     * @returns any Available translations
     * @throws ApiError
     */
    public getV1Translations(): CancelablePromise<{
        translations?: Array<Translation>;
    }> {
        return this.httpRequest.request({
            method: 'GET',
            url: '/v1/translations',
        });
    }
    /**
     * Get a single translation by code
     * @returns Translation Translation details
     * @throws ApiError
     */
    public getV1Translations1({
        code,
    }: {
        code: 'en' | 'ar',
    }): CancelablePromise<Translation> {
        return this.httpRequest.request({
            method: 'GET',
            url: '/v1/translations/{code}',
            path: {
                'code': code,
            },
            errors: {
                404: `Resource not found`,
            },
        });
    }
    /**
     * List books in a translation
     * @returns any Books list
     * @throws ApiError
     */
    public getV1TranslationsBooks({
        code,
    }: {
        code: 'en' | 'ar',
    }): CancelablePromise<{
        translation?: string;
        books?: Array<Book>;
    }> {
        return this.httpRequest.request({
            method: 'GET',
            url: '/v1/translations/{code}/books',
            path: {
                'code': code,
            },
            errors: {
                404: `Resource not found`,
            },
        });
    }
}
