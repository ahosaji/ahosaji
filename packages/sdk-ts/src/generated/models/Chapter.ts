/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { Heading } from './Heading';
import type { Verse } from './Verse';
export type Chapter = {
    translation?: string;
    book?: string;
    chapter?: number;
    verses?: Array<Verse>;
    headings?: Array<Heading>;
    meta?: {
        count?: number;
        headings?: number;
    };
};

