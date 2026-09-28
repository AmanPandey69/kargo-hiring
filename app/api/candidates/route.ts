import { processUpload } from "@/lib/pipeline";
import type { Role } from "@/lib/types";

export const maxDuration = 300;

export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get("file");
  const name = String(form.get("name") ?? "").trim();
  const role = String(form.get("role") ?? "") as Role;
  if (!(file instanceof File)) return Response.json({ error: "file is required" }, { status: 400 });
  if (!name) return Response.json({ error: "name is required" }, { status: 400 });
  if (role !== "PM" && role !== "SPM") return Response.json({ error: "role must be PM or SPM" }, { status: 400 });
  try {
    return Response.json(await processUpload(file, name, role));
  } catch (err) {
    return Response.json({ id: null, status: "error", error: (err as Error).message }, { status: 500 });
  }
}
