// Graders: small functions that decide whether an answer passes.
//
// These are plain code checks, not an LLM. They're fast, free, and give the
// same verdict every time, which makes them the best place to start. The cost
// is that they're strict about wording: an answer that says "four weeks"
// where the check wants "28 days" fails. When that happens, add the
// alternative wording to the test case, or use an LLM as the grader (see
// the README).

export type CheckResult = { name: string; pass: boolean; detail?: string };

/** One required item; an array means "any one of these is fine". */
export type Expected = string | string[];

/** Lowercase, straight apostrophes, single spaces: so the checks ignore formatting. */
export function normalize(text: string): string {
  return text.toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, ' ');
}

/** Every item must appear in the text (ignoring case). */
export function mentionsAll(text: string, required: Expected[]): CheckResult {
  const t = normalize(text);
  const missing = required.filter((item) => !(Array.isArray(item) ? item : [item]).some((alt) => t.includes(normalize(alt))));
  return {
    name: 'mentions the expected facts',
    pass: missing.length === 0,
    detail: missing.length ? `missing ${missing.map((m) => JSON.stringify(m)).join(', ')}` : undefined,
  };
}

/** None of the phrases may appear: catches answers that claim something false. */
export function mentionsNone(text: string, forbidden: string[]): CheckResult {
  const t = normalize(text);
  const found = forbidden.filter((phrase) => t.includes(normalize(phrase)));
  return {
    name: 'makes no false claims',
    pass: found.length === 0,
    detail: found.length ? `says ${found.map((f) => JSON.stringify(f)).join(', ')}` : undefined,
  };
}

// Common ways a model says it doesn't know. Models phrase this in many ways,
// so this list is a heuristic; check failures by reading the answer.
// Each pattern is one way of saying it; the text is normalized first
// (lowercase, straight apostrophes). When a correct answer fails this check,
// add its wording here. Unanswerable answers often go on to give partial
// facts (Claude listed sensor revenue), so the check only asks whether the
// answer says it can't answer, not that it says nothing else.
const DOES_NOT_KNOW = [
  // "I can't work out…", "I couldn't find…", "unable to determine…"
  /\b(cannot|can't|can not|could not|couldn't|unable to|not able to|no way to)( be)? (find|found|answer|determine|calculate|compute|work out|worked out|tell|say|give|provide|know)/,
  // "The documents don't mention…", "the database does not contain…"
  /\b(does|do|did)( not|n't) (contain|mention|say|include|specify|have|provide|cover|store|list|track|record)/,
  // "…is not mentioned", "isn't possible"
  /\b(not|n't) (mentioned|specified|stated|included|provided|available|found|possible|recorded|tracked)\b/,
  // "There is no information…", "no cost data"
  /\bno (information|data|record|mention|details)\b|\bno [a-z]+ (data|information)\b/,
];

/** The answer says the information isn't available, instead of guessing. */
export function saysItDoesNotKnow(text: string): CheckResult {
  const normalized = normalize(text);
  const pass = DOES_NOT_KNOW.some((pattern) => pattern.test(normalized));
  return { name: 'says it could not find the answer', pass, detail: pass ? undefined : 'gave an answer instead' };
}

/**
 * Every value from the reference query result must appear in the answer:
 * text values as text, numbers as numbers. Numbers may be rounded to the
 * nearest whole number and formatted any common way ("71,579.70", "71579.7",
 * "71.579,70").
 */
export function containsValues(text: string, rows: Record<string, unknown>[]): CheckResult {
  const t = normalize(text);
  const numbers = extractNumbers(text);
  const missing: string[] = [];
  for (const row of rows) {
    for (const value of Object.values(row)) {
      if (typeof value === 'number' || typeof value === 'bigint') {
        const v = Number(value);
        if (!numbers.some((n) => Math.abs(n - v) <= 0.5)) missing.push(String(Math.round(v * 100) / 100));
      } else if (typeof value === 'string') {
        if (!t.includes(normalize(value))) missing.push(JSON.stringify(value));
      }
    }
  }
  return {
    name: 'matches the reference query',
    pass: missing.length === 0,
    detail: missing.length ? `missing ${missing.join(', ')}` : undefined,
  };
}

/** All numbers written in a text, e.g. "€13,509 and 4.5%" → [13509, 4.5]. */
export function extractNumbers(text: string): number[] {
  // A digit, optionally followed by digits and separators, ending in a digit
  // (so a sentence's final period is not included).
  const matches = text.match(/\d(?:[\d,.  ]*\d)?/g) ?? [];
  return matches.map(parseNumber).filter(Number.isFinite);
}

function parseNumber(raw: string): number {
  let s = raw.replace(/[  ]/g, ''); // non-breaking spaces as thousands separators
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    // Both appear: whichever comes last is the decimal separator.
    const [thousands, decimal] = lastComma > lastDot ? ['.', ','] : [',', '.'];
    s = s.replaceAll(thousands, '').replace(decimal, '.');
  } else if (lastComma >= 0) {
    // Only commas: thousands separators if every group has 3 digits (71,579),
    // otherwise a decimal comma (12,5).
    s = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replaceAll(',', '') : s.replace(',', '.');
  } else if (s.split('.').length > 2) {
    s = s.replaceAll('.', ''); // 1.200.000
  }
  return Number(s);
}
