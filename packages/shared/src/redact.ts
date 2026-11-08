// Secrets and personal data never leave the page. These patterns run in the overlay before anything is sent, and again in the daemon.
// They are heuristics: they catch the common shapes, not every name or address.

// Patterns that start only at the beginning of a run (a lookbehind), so one long unbroken string is read once, not once per character.
const EMAIL = /(?<![\w.+-])[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const JWT = /\beyJ[\w-]{5,}\.[\w-]{5,}\.[\w-]{5,}/g;
const KEYED = /\b(?:sk|pk|rk|ghp|gho|ghu|ghs|ghr|xox[abprs]|AKIA)[-_]?[A-Za-z0-9_-]{16,}/g;
const BEARER = /\b(Bearer|Basic)\s+[\w.~+/=-]{12,}/gi;
// A run of digits with spaces, dashes, dots or brackets between them: a phone number or a card number. Dates and prices have too few digits.
const DIGITS = /\+?\d[\d ().-]{6,}\d/g;
// A long unbroken token that is not a word: base64 or hex of 32 or more characters.
const LONG = /(?<![A-Za-z0-9+/_-])(?=[A-Za-z0-9+/_-]*\d)(?=[A-Za-z0-9+/_-]*[A-Za-z])[A-Za-z0-9+/_-]{32,}(?![A-Za-z0-9+/_-])/g;

/** Longest text one call reads. Everything the product redacts is cut to a limit far below this; a longer text is a mistake or an attack, and is cut. */
const MAX_READ = 20_000;

/** Text with emails, phone and card numbers, tokens and keys replaced by `[email]`, `[phone]`, `[card]` and `[secret]`. */
export function redactText(text: string): string {
  return text
    .slice(0, MAX_READ)
    .replace(JWT, "[secret]")
    .replace(KEYED, "[secret]")
    .replace(BEARER, "$1 [secret]")
    .replace(EMAIL, "[email]")
    .replace(DIGITS, (run) => {
      const n = run.replace(/\D/g, "").length;
      return n >= 13 ? "[card]" : n >= 9 ? "[phone]" : run;
    })
    .replace(LONG, "[secret]");
}

/** A web address without its query string and fragment: they carry tokens, emails and session ids. */
export function stripQuery(url: string): string {
  const cut = url.search(/[?#]/);
  return cut < 0 ? url : `${url.slice(0, cut)}${url[cut] === "?" ? "?…" : ""}`;
}

/** Attribute names whose value is never kept: they hold credentials. */
export const SECRET_ATTR = /^(?:data-)?[\w-]*(?:token|secret|password|passwd|auth(?:orization)?(?![a-z])|session|csrf|nonce|api-?key|credential)[\w-]*$/i;
