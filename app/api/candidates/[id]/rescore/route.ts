import { scoreCandidate } from "@/lib/pipeline";

export const maxDuration = 300;

export async function POST(_req: Request, ctx: RouteContext<"/api/candidates/[id]/rescore">) {
  const { id } = await ctx.params;
  return Response.json(await scoreCandidate(id));
}
