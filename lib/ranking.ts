import "server-only";
import { draftBrief, draftEmail } from "./drafts";
import { db, getRubric, must } from "./supabase";
import type { Candidate, EmailRow, Role, ScoreRow } from "./types";

export const TOP_N = 5;

export type Ranked = { candidate: Candidate; score: ScoreRow; rank: number };

/** Scored candidates who applied for `role`, ranked by their score on that role's rubric. */
export async function rankApplicants(role: Role): Promise<Ranked[]> {
  const candidates = must(
    await db().from("candidates").select("*").eq("role_applied", role).eq("status", "scored"),
    "load candidates",
  ) as Candidate[];
  if (!candidates.length) return [];
  const scores = must(
    await db().from("scores").select("*").eq("rubric_role", role).in("candidate_id", candidates.map((c) => c.id)),
    "load scores",
  ) as ScoreRow[];
  const byId = new Map(scores.map((s) => [s.candidate_id, { ...s, weighted_total: Number(s.weighted_total) }]));
  return candidates
    .filter((c) => byId.has(c.id))
    .map((c) => ({ candidate: c, score: byId.get(c.id)! }))
    .sort((a, b) => b.score.weighted_total - a.score.weighted_total || a.candidate.created_at.localeCompare(b.candidate.created_at))
    .map((r, i) => ({ ...r, rank: i + 1 }));
}

export type Task =
  | { kind: "brief"; role: Role; candidateId: string }
  | { kind: "email"; role: Role; candidateId: string; type: "invite" | "rejection" };

/**
 * Works out what needs (re)generating for a role and returns it as small tasks, so the
 * browser can run them one request at a time (keeps each request short and rate-limit friendly).
 * - If the top-5 set changed, stale briefs are deleted and all top-5 briefs regenerated.
 * - Top 5 need an invite draft, everyone else a rejection draft. Sent emails are never touched.
 */
export async function planRefresh(role: Role): Promise<Task[]> {
  const ranked = await rankApplicants(role);
  const top = new Set(ranked.slice(0, TOP_N).map((r) => r.candidate.id));
  const tasks: Task[] = [];

  const briefs = must(await db().from("briefs").select("candidate_id, created_at").eq("role", role), "load briefs") as {
    candidate_id: string;
    created_at: string;
  }[];
  const briefIds = new Set(briefs.map((b) => b.candidate_id));
  const sameSet = briefIds.size === top.size && [...top].every((id) => briefIds.has(id));
  const stale = [...briefIds].filter((id) => !top.has(id));
  if (stale.length) must(await db().from("briefs").delete().eq("role", role).in("candidate_id", stale), "delete stale briefs");
  for (const r of ranked.slice(0, TOP_N)) {
    const rescoredSinceBrief = briefs.find((b) => b.candidate_id === r.candidate.id && b.created_at < r.score.created_at);
    if (!sameSet || rescoredSinceBrief) tasks.push({ kind: "brief", role, candidateId: r.candidate.id });
  }

  if (ranked.length) {
    const emails = must(
      await db()
        .from("emails")
        .select("candidate_id, type, status, created_at")
        .in("candidate_id", ranked.map((r) => r.candidate.id))
        .order("created_at", { ascending: false }),
      "load emails",
    ) as Pick<EmailRow, "candidate_id" | "type" | "status">[];
    for (const r of ranked) {
      const mine = emails.filter((e) => e.candidate_id === r.candidate.id);
      if (mine.some((e) => e.status === "sent")) continue; // already contacted; leave alone
      const want = top.has(r.candidate.id) ? "invite" : "rejection";
      if (mine[0]?.type !== want) tasks.push({ kind: "email", role, candidateId: r.candidate.id, type: want });
    }
  }
  return tasks;
}

export async function runTask(task: Task): Promise<{ skipped?: string }> {
  const ranked = await rankApplicants(task.role);
  const idx = ranked.findIndex((r) => r.candidate.id === task.candidateId);
  if (idx < 0) return { skipped: "candidate no longer ranked" };
  const me = ranked[idx];
  const inTop = idx < TOP_N;

  if (task.kind === "brief") {
    if (!inTop) return { skipped: "no longer in top 5" };
    const rubric = await getRubric(task.role);
    const brief = await draftBrief({
      rubric,
      score: me.score,
      rank: me.rank,
      poolSize: ranked.length,
      redactedCv: me.candidate.cv_content_redacted ?? "",
    });
    must(
      await db()
        .from("briefs")
        .upsert(
          { candidate_id: task.candidateId, role: task.role, ...brief, created_at: new Date().toISOString() },
          { onConflict: "candidate_id,role" },
        ),
      "save brief",
    );
    return {};
  }

  const want = inTop ? "invite" : "rejection";
  if (want !== task.type) return { skipped: "rank changed since planning" };
  const existing = must(
    await db().from("emails").select("id, status").eq("candidate_id", task.candidateId),
    "load emails",
  ) as Pick<EmailRow, "id" | "status">[];
  if (existing.some((e) => e.status === "sent")) return { skipped: "email already sent" };

  const draft = await draftEmail({ type: want, role: task.role, redactedCv: me.candidate.cv_content_redacted ?? "" });
  // Replace unsent drafts with the new one (a failed send is kept only until redrafted).
  if (existing.length) must(await db().from("emails").delete().in("id", existing.map((e) => e.id)), "clear old drafts");
  must(
    await db().from("emails").insert({ candidate_id: task.candidateId, type: want, subject: draft.subject, body: draft.body, status: "draft" }),
    "save email draft",
  );
  return {};
}
