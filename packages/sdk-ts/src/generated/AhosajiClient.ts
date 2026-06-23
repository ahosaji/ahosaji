/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { BaseHttpRequest } from './core/BaseHttpRequest';
import type { OpenAPIConfig } from './core/OpenAPI';
import { FetchHttpRequest } from './core/FetchHttpRequest';
import { BibleService } from './services/BibleService';
import { DiscoveryService } from './services/DiscoveryService';
import { SearchService } from './services/SearchService';
type HttpRequestConstructor = new (config: OpenAPIConfig) => BaseHttpRequest;
export class AhosajiClient {
    public readonly bible: BibleService;
    public readonly discovery: DiscoveryService;
    public readonly search: SearchService;
    public readonly request: BaseHttpRequest;
    constructor(config?: Partial<OpenAPIConfig>, HttpRequest: HttpRequestConstructor = FetchHttpRequest) {
        this.request = new HttpRequest({
            BASE: config?.BASE ?? 'http://localhost:3001',
            VERSION: config?.VERSION ?? '0.0.0',
            WITH_CREDENTIALS: config?.WITH_CREDENTIALS ?? false,
            CREDENTIALS: config?.CREDENTIALS ?? 'include',
            TOKEN: config?.TOKEN,
            USERNAME: config?.USERNAME,
            PASSWORD: config?.PASSWORD,
            HEADERS: config?.HEADERS,
            ENCODE_PATH: config?.ENCODE_PATH,
        });
        this.bible = new BibleService(this.request);
        this.discovery = new DiscoveryService(this.request);
        this.search = new SearchService(this.request);
    }
}

