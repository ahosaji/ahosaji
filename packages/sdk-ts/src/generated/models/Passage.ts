/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { Verse } from './Verse';
export type Passage = {
    translation?: string;
    book?: string;
    start?: {
        chapter?: number;
        verse?: number;
    };
    end?: {
        chapter?: number;
        verse?: number;
    };
    verses?: Array<Verse>;
    meta?: {
        count?: number;
    };
};

