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
  // manual = Arjun chose the email type himself (used for Review-band candidates)
  | { kind: "email"; role: Role; candidateId: string; type: "invite" | "rejection"; manual?: boolean };

/**
 * What the system prepares for a candidate, combining the prompt (top 5 per role) with
 * rubric.txt Part 6 (bands):
 * - Top 5 or Shortlist (75-100): brief + draft invite
 * - Review (55-74): brief only. Arjun reads it and decides; no email is drafted for him.
 * - Below the line (20-54): draft rejection, which Arjun still reviews before sending.
 * The system never sends or rejects on its own.
 */
export function policyFor(r: Ranked): { brief: boolean; email: "invite" | "rejection" | null } {
  const top = r.rank <= TOP_N;
  if (top || r.score.band === "shortlist") return { brief: true, email: "invite" };
  if (r.score.band === "review") return { brief: true, email: null };
  return { brief: false, email: "rejection" };
}

/**
 * Works out what needs (re)generating for a role and returns it as small tasks, so the
 * browser can run them one request at a time (keeps each request short and rate-limit friendly).
 * - Briefs: created for everyone who needs one, regenerated when the top 5 changes, and
 *   removed for people who no longer need one.
 * - Emails: drafted per policyFor. Sent emails and Review-band drafts (Arjun's call) are never touched.
 */
export async function planRefresh(role: Role): Promise<Task[]> {
  const ranked = await rankApplicants(role);
  const needsBrief = new Set(ranked.filter((r) => policyFor(r).brief).map((r) => r.candidate.id));
  const tasks: Task[] = [];

  const briefs = must(await db().from("briefs").select("candidate_id, created_at").eq("role", role), "load briefs") as {
    candidate_id: string;
    created_at: string;
  }[];
  const stale = briefs.filter((b) => !needsBrief.has(b.candidate_id)).map((b) => b.candidate_id);
  if (stale.length) must(await db().from("briefs").delete().eq("role", role).in("candidate_id", stale), "delete stale briefs");

  // The top 5 changed if someone in it was scored after a brief was written. Briefs mention
  // rank, so they are all regenerated then (this is the "regenerate when top 5 changes" rule).
  const newestTopScore = ranked
    .slice(0, TOP_N)
    .map((r) => r.score.created_at)
    .sort()
    .at(-1) ?? "";
  for (const r of ranked) {
    if (!needsBrief.has(r.candidate.id)) continue;
    const b = briefs.find((x) => x.candidate_id === r.candidate.id);
    if (!b || b.created_at < r.score.created_at || b.created_at < newestTopScore)
      tasks.push({ kind: "brief", role, candidateId: r.candidate.id });
  }

  if (ranked.length) {
    const emails = must(
      await db()
        .from("emails")
        .select("id, candidate_id, type, status, origin, created_at")
        .in("candidate_id", ranked.map((r) => r.candidate.id))
        .order("created_at", { ascending: false }),
      "load emails",
    ) as Pick<EmailRow, "id" | "candidate_id" | "type" | "status" | "origin">[];
    const drop: string[] = [];
    for (const r of ranked) {
      const mine = emails.filter((e) => e.candidate_id === r.candidate.id);
      if (mine.some((e) => e.status === "sent")) continue; // already contacted; leave alone
      if (mine[0]?.origin === "arjun") continue; // Arjun's own choice always stands
      const want = policyFor(r).email;
      if (!want) {
        // Review band: Arjun decides, so remove any draft the system made before the score moved here.
        drop.push(...mine.filter((e) => e.origin === "system").map((e) => e.id));
        continue;
      }
      if (mine[0]?.type !== want) tasks.push({ kind: "email", role, candidateId: r.candidate.id, type: want });
    }
    if (drop.length) must(await db().from("emails").delete().in("id", drop).neq("status", "sent"), "remove system drafts in Review band");
  }
  return tasks;
}

export async function runTask(task: Task): Promise<{ skipped?: string }> {
  const ranked = await rankApplicants(task.role);
  const idx = ranked.findIndex((r) => r.candidate.id === task.candidateId);
  if (idx < 0) return { skipped: "candidate no longer ranked" };
  const me = ranked[idx];
  const policy = policyFor(me);

  if (task.kind === "brief") {
    if (!policy.brief) return { skipped: "no brief needed at this score" };
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

  const want = task.manual ? task.type : policy.email;
  if (want !== task.type) return { skipped: "rank changed since planning" };
  const existing = must(
    await db().from("emails").select("id, status, origin").eq("candidate_id", task.candidateId).order("created_at", { ascending: false }),
    "load emails",
  ) as Pick<EmailRow, "id" | "status" | "origin">[];
  if (existing.some((e) => e.status === "sent")) return { skipped: "email already sent" };
  if (!task.manual && existing[0]?.origin === "arjun") return { skipped: "Arjun chose this draft himself" };

  const draft = await draftEmail({ type: want, role: task.role, redactedCv: me.candidate.cv_content_redacted ?? "" });
  // Replace unsent drafts with the new one (a failed send is kept only until redrafted).
  if (existing.length) must(await db().from("emails").delete().in("id", existing.map((e) => e.id)), "clear old drafts");
  must(
    await db().from("emails").insert({
      candidate_id: task.candidateId,
      type: want,
      subject: draft.subject,
      body: draft.body,
      status: "draft",
      origin: task.manual ? "arjun" : "system",
    }),
    "save email draft",
  );
  return {};
}
