import { planRefresh } from "@/lib/ranking";
import { ROLES } from "@/lib/types";

// Returns the brief/email tasks needed after new uploads; the browser runs them one by one.
export async function POST() {
  try {
    const tasks = (await Promise.all(ROLES.map(planRefresh))).flat();
    return Response.json({ tasks });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
