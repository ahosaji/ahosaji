/**
 * GraphQL schema (SDL). Mirrors REST capabilities. Resolvers in resolvers.ts.
 *
 * Auth and rate-limiting happen at the Fastify route level (preHandler hooks);
 * the resolver layer assumes req.consumer is set when the request reached it.
 */
export const typeDefs = /* GraphQL */ `
  type Query {
    translations: [Translation!]!
    translation(code: ID!): Translation
    book(translation: ID!, usfm: ID!): Book
    chapter(translation: ID!, usfm: ID!, chapter: Int!): Chapter
    verse(translation: ID!, usfm: ID!, chapter: Int!, verse: Int!): Verse
    verses(translation: ID!, usfm: ID!, chapter: Int!, from: Int!, to: Int!): [Verse!]!
    passage(translation: ID!, start: String!, end: String!): Passage
    parallel(translations: [ID!]!, ref: String, start: String, end: String, preferAligned: Boolean = false): ParallelResult
    search(translation: ID!, q: String!, filters: SearchFilters, limit: Int = 20, offset: Int = 0): SearchResult!
  }

  type Translation {
    code: ID!
    name: String!
    language: String!
    source: String!
    copyright: String
    versification: String!
    bookCount: Int
    verseCount: Int
  }

  type Book {
    usfm: ID!
    nameEn: String!
    nameAr: String!
    testament: String!
    canon: String!
    bookOrder: Int!
    chapterCount: Int!
    bookGroup: String
  }

  type Chapter {
    translation: ID!
    book: ID!
    chapter: Int!
    verses: [Verse!]!
    headings: [Heading!]!
  }

  type Verse {
    ref: String!
    book: ID!
    chapter: Int!
    verse: Int!
    text: String!
    structured: VerseStructured!
  }

  type VerseStructured {
    tokens: [Token!]!
    footnotes: [Footnote!]!
    crossRefs: [String!]!
    heading: String
    paragraphStart: Boolean!
    poetic: Boolean!
    poeticLines: [String!]
  }

  type Token {
    text: String!
    italic: Boolean!
    redLetter: Boolean!
  }

  type Footnote {
    marker: String!
    text: String!
  }

  type Heading {
    beforeVerse: Int!
    text: String!
    level: Int!
  }

  type Passage {
    translation: ID!
    book: ID!
    start: String!
    end: String!
    verses: [Verse!]!
  }

  type ParallelEntry {
    translation: ID!
    present: Boolean!
    text: String
    structured: VerseStructured
    "Versification: equivalent ref(s) this entry was mapped to (null when identity-matched)."
    mappedTo: [String!]
    "Versification: explanation when no equivalent exists in this translation."
    mappingNote: String
  }

  type ParallelVerse {
    ref: String!
    translations: [ParallelEntry!]!
  }

  type ParallelResult {
    refs: [ParallelVerse!]!
  }

  input SearchFilters {
    book: ID
    testament: String
    canon: String
    bookGroup: String
  }

  type SearchHit {
    ref: String!
    book: ID!
    chapter: Int!
    verse: Int!
    text: String!
    formatted: String!
    heading: String
    bookName: String
    testament: String
    canon: String
  }

  type SearchResult {
    query: String!
    translation: ID!
    hits: [SearchHit!]!
    total: Int
    limit: Int!
    offset: Int!
  }
`;
