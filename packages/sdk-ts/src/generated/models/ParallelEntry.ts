/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { VerseStructured } from './VerseStructured';
export type ParallelEntry = {
    translation?: string;
    present?: boolean;
    text?: string | null;
    structured?: VerseStructured | null;
    /**
     * Set when the verse was resolved via versification mapping rather
     * than identity. Lists the source ref(s) in this translation whose
     * content was returned. Absent when identity matched directly.
     *
     */
    mapped_to?: Array<string> | null;
    /**
     * Set when the versification mapping table marks this verse as
     * having no equivalent in this translation (e.g. a Vulgate-only
     * verse with no Greek-LXX counterpart). Co-occurs with
     * `present: false` and `mapped_to: []`.
     *
     */
    mapping_note?: string | null;
};

