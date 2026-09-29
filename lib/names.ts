// Shared by server and browser: no secrets, no server-only imports.

/** "08_vikram_shetty.pdf" / "spm-17-Nalini Iyer.docx" -> "Vikram Shetty" / "Nalini Iyer". */
export function nameFromFilename(filename: string): string {
  const words = filename
    .replace(/\.[a-z0-9]+$/i, "")
    .split(/[\s_.-]+/)
    .filter((w) => /^\p{L}+$/u.test(w))
    .filter((w) => !/^(s?pm|cv|resume|final|updated|new|copy)$/i.test(w));
  if (words.length < 1 || words.length > 4) return "";
  return words.map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(" ");
}
