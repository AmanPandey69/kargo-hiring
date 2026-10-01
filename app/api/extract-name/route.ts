import { extractText, guessName } from "@/lib/extract";
import { nameFromFilename } from "@/lib/names";
import { nameAppearsIn } from "@/lib/pii";

// Reads a CV only to suggest the candidate's name for the upload form. Nothing is stored.
// The suggestion must appear in the CV, because it is exactly what gets redacted before scoring.
export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "file is required" }, { status: 400 });
  const fromFile = nameFromFilename(file.name);
  try {
    const text = await extractText(file);
    const suggestedName = [fromFile, guessName(text)].find((g) => g && nameAppearsIn(g, text)) ?? "";
    return Response.json({
      suggestedName,
      error: suggestedName ? undefined : "Couldn't find the candidate's name in this CV. Type it exactly as written in the CV.",
    });
  } catch (err) {
    console.error("[extract-name]", file.name, err);
    return Response.json({ suggestedName: "", error: `Could not read this file: ${(err as Error).message}` });
  }
}
