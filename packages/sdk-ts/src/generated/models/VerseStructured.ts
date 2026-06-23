/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { Footnote } from './Footnote';
import type { Token } from './Token';
export type VerseStructured = {
    tokens?: Array<Token>;
    footnotes?: Array<Footnote>;
    crossRefs?: Array<string>;
    heading?: string | null;
    paragraphStart?: boolean;
    poetic?: boolean;
    poeticLines?: Array<string> | null;
};

