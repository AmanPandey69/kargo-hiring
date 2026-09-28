import { z } from "zod";
import { db } from "@/lib/supabase";

const editSchema = z.object({ subject: z.string().min(1), body: z.string().min(1) });

// Save edits to a draft (never to an email that was already sent).
export async function PATCH(req: Request, ctx: RouteContext<"/api/emails/[id]">) {
  const { id } = await ctx.params;
  const parsed = editSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "subject and body are required" }, { status: 400 });
  const { data, error } = await db().from("emails").update(parsed.data).eq("id", id).neq("status", "sent").select("id");
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!data?.length) return Response.json({ error: "Email not found or already sent" }, { status: 409 });
  return Response.json({ ok: true });
}
