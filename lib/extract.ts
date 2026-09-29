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

/** Best guess at the candidate's name: the first short line that looks like a name. */
export function guessName(text: string): string {
  for (const raw of text.split("\n").slice(0, 8)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.length > 60 || /[@\d|/:]/.test(line)) continue;
    if (/\b(curriculum|vitae|resume|résumé|cv|profile|summary|product|manager|contact)\b/i.test(line)) continue;
    const words = line.split(/\s+/);
    if (words.length >= 1 && words.length <= 5) return titleCase(line);
  }
  return "";
}

function titleCase(s: string): string {
  if (s !== s.toUpperCase()) return s;
  return s.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_, p, c) => p + c.toUpperCase());
}

/** True when every word of `name` appears in the CV text as a whole word. */
export function nameAppearsIn(name: string, text: string): boolean {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return false;
  return parts.every((p) => new RegExp(`(?<![\\p{L}])${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}])`, "iu").test(text));
}
