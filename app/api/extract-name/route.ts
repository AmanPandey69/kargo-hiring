import { extractText, guessName, nameAppearsIn } from "@/lib/extract";
import { nameFromFilename } from "@/lib/names";

// Reads a CV only to suggest the candidate's name for the upload form. Nothing is stored.
export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "file is required" }, { status: 400 });
  const fromFile = nameFromFilename(file.name);
  try {
    const text = await extractText(file);
    // Prefer a guess that really appears in the CV: the name is what gets redacted before scoring.
    const guesses = [guessName(text), fromFile].filter(Boolean);
    const suggestedName = guesses.find((g) => nameAppearsIn(g, text)) ?? guesses[0] ?? "";
    return Response.json({ suggestedName });
  } catch (err) {
    console.error("[extract-name]", file.name, err);
    return Response.json({ suggestedName: fromFile, error: `Could not read this file: ${(err as Error).message}` });
  }
}
