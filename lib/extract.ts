import "server-only";
import mammoth from "mammoth";
// Must be imported before pdf-parse so the PDF worker is bundled on serverless (Vercel).
import "pdf-parse/worker";
import { PDFParse } from "pdf-parse";

export const MAX_FILE_BYTES = 4 * 1024 * 1024; // Vercel request body limit is 4.5 MB

/** Extracts plain text from a PDF or DOCX. Detects the format from the file bytes, not just the name. */
export async function extractText(file: File): Promise<string> {
  if (file.size > MAX_FILE_BYTES) throw new Error(`File is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB`);
  const buf = Buffer.from(await file.arrayBuffer());
  const head = buf.subarray(0, 5).toString("latin1");
  const name = file.name.toLowerCase();

  let text: string;
  if (head.startsWith("%PDF")) {
    const parser = new PDFParse({ data: new Uint8Array(buf) });
    try {
      text = (await parser.getText()).text;
    } finally {
      await parser.destroy();
    }
  } else if (head.startsWith("PK") && name.endsWith(".docx")) {
    text = (await mammoth.extractRawText({ buffer: buf })).value;
  } else if (name.endsWith(".doc")) {
    throw new Error("Old .doc files are not supported; save as .docx or PDF");
  } else {
    throw new Error("Unsupported file type; upload PDF or DOCX");
  }

  text = normalise(text);
  if (text.length < 50) throw new Error("Could not read any text from this file (is it a scanned image?)");
  return text;
}

function normalise(s: string): string {
  return s
    .replace(/\r\n?/g, "\n")
    .replace(/-- \d+ of \d+ --/g, "") // pdf-parse page markers
    .replace(/[ \t ]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const HEADINGS =
  /^(education|experience|work experience|professional experience|skills|core skills|key skills|summary|professional summary|profile|professional synopsis|objective|projects|achievements|certifications|contact|academic qualifications|scholastic achievements.*|languages|interests|references|curriculum vitae|resume|résumé|cv)$/i;

/** A line that looks like a person's name: 2-4 capitalised words, letters only, not a heading. */
function looksLikeName(line: string): boolean {
  if (line.length > 40 || HEADINGS.test(line)) return false;
  const words = line.split(/\s+/);
  if (words.length < 2 || words.length > 4) return false;
  return words.every((w) => /^\p{Lu}[\p{L}'’.-]*$/u.test(w) || /^\p{Lu}+$/u.test(w));
}

/** Best guess at the candidate's name from the first lines of the CV ("" if nothing looks like one). */
export function guessName(text: string): string {
  for (const raw of text.split("\n").slice(0, 10)) {
    const line = raw.trim().replace(/\s+/g, " ");
    if (line && looksLikeName(line)) return titleCase(line);
  }
  return "";
}

function titleCase(s: string): string {
  if (s !== s.toUpperCase()) return s;
  return s.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_, p, c) => p + c.toUpperCase());
}
