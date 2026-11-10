export function chapter(book = 'JHN', number = 1, translation = 'en') {
  return {
    translation, source: translation === 'en' ? 'english' : 'arabic', book,
    chapter: number, fetchedAt: '2026-11-10T00:00:00Z', headings: [],
    verses: [{ ref: `${book}.${number}.1`, book, chapter: number, verse: 1,
      text: 'Example verse', structured: { tokens: [{ text: 'Example verse', italic: false, redLetter: false }],
        footnotes: [], crossRefs: [], heading: null, paragraphStart: false, poetic: false, poeticLines: null } }],
  };
}
