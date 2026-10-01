import { z } from "zod";
import { runTask } from "@/lib/ranking";

export const maxDuration = 300;

const role = z.enum(["PM", "SPM"]);
const taskSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("brief"), role, candidateId: z.uuid() }),
  z.object({ kind: z.literal("email"), role, candidateId: z.uuid(), type: z.enum(["invite", "rejection"]), manual: z.boolean().optional() }),
]);

export async function POST(req: Request) {
  const parsed = taskSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid task" }, { status: 400 });
  try {
    return Response.json({ ok: true, ...(await runTask(parsed.data)) });
  } catch (err) {
    return Response.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
