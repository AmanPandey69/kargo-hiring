import { extractText, guessName } from "@/lib/extract";

// Reads a CV only to suggest the candidate's name for the upload form. Nothing is stored.
export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "file is required" }, { status: 400 });
  try {
    const text = await extractText(file);
    return Response.json({ suggestedName: guessName(text) });
  } catch (err) {
    return Response.json({ suggestedName: "", error: (err as Error).message });
  }
}
