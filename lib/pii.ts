// PII separation is done in code, never by the model. After this step only the
// redacted text is ever sent to Gemini.

export const REDACTED = "[REDACTED]";

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,}/gi;

// Anything that looks like a phone number; filtered by digit count below.
const PHONE_CANDIDATE_RE = /(?:\+\s?\d{1,3}[\s.-]?)?(?:\(\s?\d{1,5}\s?\)[\s.-]?)?\d[\d\s.-]{7,16}\d/g;

const PROFILE_URL_RE =
  /(?:https?:\/\/)?(?:[a-z]{2,3}\.)?(?:www\.)?(?:linkedin\.com|github\.com|[a-z0-9-]+\.github\.io)(?:\/[^\s)\]|,;]*)?/gi;

function isPhone(match: string): boolean {
  const digits = match.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 13) return false;
  // Year ranges like "2018 - 2020 2021" are not phone numbers.
  if (/^(19|20)\d{2}\s*[-–.]\s*(19|20)\d{2}/.test(match.trim())) return false;
  return true;
}

/** The number's last 10 digits with any separators between them, plus an optional country code. */
function phoneVariants(phone: string): RegExp {
  const national = phone.replace(/\D/g, "").slice(-10);
  return new RegExp(`(?:\\+?\\d{1,3}[\\s.()-]*)?${national.split("").join("[\\s.()-]*")}`, "g");
}

function findPhones(text: string): string[] {
  return (text.match(PHONE_CANDIDATE_RE) ?? []).map((m) => m.trim()).filter(isPhone);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Matches the full name (flexible whitespace) and each name part of 3+ letters, as whole words. */
function nameRegex(fullName: string): RegExp | null {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return null;
  const full = parts.map(escapeRe).join("[\\s.]+");
  const tokens = parts.filter((p) => p.replace(/\W/g, "").length >= 3).map(escapeRe);
  const alts = [full, ...tokens].sort((a, b) => b.length - a.length).join("|");
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${alts})(?![\\p{L}\\p{N}])`, "giu");
}

/** True when every word of `name` appears in `text` as a whole word (case-insensitive). */
export function nameAppearsIn(name: string, text: string): boolean {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return false;
  return parts.every((p) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(p)}(?![\\p{L}\\p{N}])`, "iu").test(text));
}

export type PiiResult = {
  full_name: string;
  email: string | null;
  phone: string | null;
  redacted: string;
};

export function separatePii(rawText: string, fullName: string): PiiResult {
  const name = fullName.trim().replace(/\s+/g, " ");
  if (!name) throw new Error("Candidate name is required");
  // Safety stop: redaction removes whatever name is given. If that name isn't in the CV, the
  // real name would reach the model unredacted, so refuse instead of guessing.
  if (!nameAppearsIn(name, rawText))
    throw new Error(`The name "${name}" does not appear in this CV. Check the candidate name and try again.`);

  const email = rawText.match(EMAIL_RE)?.[0] ?? null;
  const phone = findPhones(rawText)[0] ?? null;

  let text = rawText;
  text = text.replace(PROFILE_URL_RE, REDACTED);
  text = text.replace(EMAIL_RE, REDACTED);
  text = text.replace(PHONE_CANDIDATE_RE, (m) => (isPhone(m.trim()) ? REDACTED : m));
  // Second pass: every number found above, wherever else it appears (e.g. glued to a PIN code
  // or written with different separators), matched on its last 10 digits.
  for (const p of findPhones(rawText)) text = text.replace(phoneVariants(p), REDACTED);
  const nre = nameRegex(name);
  if (nre) text = text.replace(nre, REDACTED);

  assertClean(text, { name, email, phone });
  return { full_name: name, email, phone, redacted: text };
}

/** Last line of defence: refuse to continue if any PII survived redaction. */
export function assertClean(text: string, pii: { name: string; email: string | null; phone: string | null }) {
  const lower = text.toLowerCase();
  if (pii.email && lower.includes(pii.email.toLowerCase())) throw new Error("Redaction failed: email still present");
  if (pii.phone && phoneVariants(pii.phone).test(text)) throw new Error("Redaction failed: phone still present");
  const nre = nameRegex(pii.name);
  if (nre && nre.test(text)) throw new Error("Redaction failed: name still present");
  if (new RegExp(EMAIL_RE.source, "i").test(text)) throw new Error("Redaction failed: an email address is still present");
}
