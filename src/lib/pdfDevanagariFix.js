// react-pdf (fontkit) draws a word-initial Devanagari vowel like "ई" wrongly (the matra
// floats on its own: "ईशा" → "ॅशा"). A zero-width space before the word fixes the
// shaping and is invisible (copy/paste of the PDF text still gives "ईशा").
// Import this file (side effect) in every PDF document that uses the Devanagari font.
import { Font } from "@react-pdf/renderer";

const DEVANAGARI_START = /^[ऀ-ॿ]/;

export function devanagariWord(word) {
  return [DEVANAGARI_START.test(word) ? "​" + word : word];
}

Font.registerHyphenationCallback(devanagariWord);
