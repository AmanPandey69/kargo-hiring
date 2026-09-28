import { z } from "zod";
import { sendEmail } from "@/lib/send";

const bodySchema = z.object({ subject: z.string(), body: z.string(), confirmed: z.literal(true) });

// One email per explicit confirmation. No bulk, scheduled or automatic sending exists.
export async function POST(req: Request, ctx: RouteContext<"/api/emails/[id]/send">) {
  const { id } = await ctx.params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false, error: "Confirmation required" }, { status: 400 });
  try {
    const result = await sendEmail(id, parsed.data);
    return Response.json(result, { status: result.ok ? 200 : 422 });
  } catch (err) {
    return Response.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
