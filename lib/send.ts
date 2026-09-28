import "server-only";
import { createHash } from "node:crypto";
import { Resend } from "resend";
import { env } from "./env";
import { db, must } from "./supabase";
import type { EmailRow } from "./types";

export const NOT_CONFIGURED = "Email sending not configured";

export const sendingConfigured = () => Boolean(env.resendApiKey() && env.testRecipient());

/** [NAME] is replaced with the real name here, at send time, and nowhere else. */
export const fillName = (text: string, name: string) => text.replaceAll("[NAME]", name);

export type SendResult = { ok: true; resendId: string; to: string } | { ok: false; error: string };

/**
 * Sends ONE email after an explicit confirm click. Test mode: always delivers to
 * TEST_RECIPIENT_EMAIL, never to the candidate's own address.
 */
export async function sendEmail(emailId: string, edits: { subject: string; body: string }): Promise<SendResult> {
  if (!sendingConfigured()) return { ok: false, error: NOT_CONFIGURED };

  const email = must(await db().from("emails").select("*").eq("id", emailId).single(), "load email") as EmailRow;
  if (email.status === "sent") return { ok: false, error: "This email was already sent" };
  if (!edits.subject.trim() || !edits.body.trim()) return { ok: false, error: "Subject and body are required" };

  const cand = must(
    await db().from("candidates").select("full_name").eq("id", email.candidate_id).single(),
    "load candidate",
  ) as { full_name: string };

  // Persist any edits made on the page before sending.
  must(await db().from("emails").update({ subject: edits.subject, body: edits.body }).eq("id", emailId), "save edits");

  const to = env.testRecipient();
  const subject = fillName(edits.subject, cand.full_name);
  const text = fillName(edits.body, cand.full_name);
  const idempotencyKey = `${emailId}:${createHash("sha256").update(subject + "\n" + text).digest("hex").slice(0, 16)}`;

  let error: string | null = null;
  let resendId: string | null = null;
  try {
    const res = await new Resend(env.resendApiKey()).emails.send({ from: env.resendFrom(), to, subject, text }, { idempotencyKey });
    if (res.error) error = res.error.message;
    else resendId = res.data?.id ?? null;
  } catch (err) {
    error = (err as Error).message;
  }

  if (error || !resendId) {
    const msg = error ?? "Resend returned no id";
    await db().from("emails").update({ status: "failed", error_message: msg }).eq("id", emailId);
    return { ok: false, error: msg };
  }
  must(
    await db()
      .from("emails")
      .update({ status: "sent", resend_id: resendId, sent_at: new Date().toISOString(), error_message: null })
      .eq("id", emailId),
    "mark sent",
  );
  return { ok: true, resendId, to };
}
