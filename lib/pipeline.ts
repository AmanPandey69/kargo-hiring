import "server-only";
import { extractText } from "./extract";
import { separatePii } from "./pii";
import { scoreCv } from "./scoring";
import { db, getRubrics, must } from "./supabase";
import { ROLES, type Role } from "./types";

export type ProcessResult = { id: string | null; status: "scored" | "error"; error?: string };

/**
 * Upload pipeline for one CV:
 * extract text -> separate PII in code -> store -> score redacted text against BOTH rubrics.
 * Only cv_content_redacted is ever sent to the model.
 */
export async function processUpload(file: File, fullName: string, role: Role): Promise<ProcessResult> {
  let pii;
  try {
    const raw = await extractText(file);
    pii = separatePii(raw, fullName);
  } catch (err) {
    // Record the failure without storing any unredacted text.
    const row = must(
      await db()
        .from("candidates")
        .insert({
          role_applied: role,
          full_name: fullName.trim() || file.name,
          original_filename: file.name,
          status: "error",
          error_message: (err as Error).message,
        })
        .select("id")
        .single(),
      "save candidate",
    ) as { id: string };
    return { id: row.id, status: "error", error: (err as Error).message };
  }

  const row = must(
    await db()
      .from("candidates")
      .insert({
        role_applied: role,
        full_name: pii.full_name,
        email: pii.email,
        phone: pii.phone,
        cv_content_redacted: pii.redacted,
        original_filename: file.name,
        status: "new",
      })
      .select("id")
      .single(),
    "save candidate",
  ) as { id: string };

  return scoreCandidate(row.id);
}

/** Scores a stored candidate's redacted CV against both rubrics. Safe to re-run. */
export async function scoreCandidate(candidateId: string): Promise<ProcessResult> {
  try {
    const cand = must(
      await db().from("candidates").select("id, cv_content_redacted").eq("id", candidateId).single(),
      "load candidate",
    ) as { id: string; cv_content_redacted: string | null };
    if (!cand.cv_content_redacted) throw new Error("No redacted CV text stored; re-upload the file");

    const rubrics = await getRubrics();
    const results = await Promise.all(ROLES.map((r) => scoreCv(rubrics[r], cand.cv_content_redacted!)));

    must(
      await db()
        .from("scores")
        .upsert(
          ROLES.map((r, i) => ({ candidate_id: candidateId, rubric_role: r, ...results[i], created_at: new Date().toISOString() })),
          { onConflict: "candidate_id,rubric_role" },
        ),
      "save scores",
    );
    must(await db().from("candidates").update({ status: "scored", error_message: null }).eq("id", candidateId), "update candidate");
    return { id: candidateId, status: "scored" };
  } catch (err) {
    const message = (err as Error).message;
    await db().from("candidates").update({ status: "error", error_message: message }).eq("id", candidateId);
    return { id: candidateId, status: "error", error: message };
  }
}
