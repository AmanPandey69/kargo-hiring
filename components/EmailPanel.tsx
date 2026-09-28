"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { EmailRow, Role } from "@/lib/types";

type Props = {
  candidateId: string;
  role: Role;
  fullName: string;
  candidateEmail: string | null;
  email: EmailRow | null;
  expectedType: "invite" | "rejection";
  sendingConfigured: boolean;
  testRecipient: string;
};

// Preview only. The real substitution happens on the server when the email is sent.
const preview = (t: string, name: string) => t.replaceAll("[NAME]", name);

export default function EmailPanel(props: Props) {
  const { email, fullName, sendingConfigured, testRecipient } = props;
  const router = useRouter();
  const [subject, setSubject] = useState(email?.subject ?? "");
  const [body, setBody] = useState(email?.body ?? "");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState<null | "save" | "send" | "draft">(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  const dirty = email && (subject !== email.subject || body !== email.body);

  async function generate() {
    setBusy("draft");
    setMsg(null);
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "email", role: props.role, candidateId: props.candidateId, type: props.expectedType }),
    });
    const j = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok || j.ok === false) setMsg({ tone: "err", text: j.error ?? "Could not draft email" });
    else if (j.skipped) setMsg({ tone: "err", text: `Skipped: ${j.skipped}. Reload the page.` });
    else window.location.reload(); // remount the editor with the new draft
  }

  async function save() {
    if (!email) return;
    setBusy("save");
    const res = await fetch(`/api/emails/${email.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subject, body }),
    });
    const j = await res.json().catch(() => ({}));
    setBusy(null);
    setMsg(res.ok ? { tone: "ok", text: "Draft saved" } : { tone: "err", text: j.error ?? "Save failed" });
    router.refresh();
  }

  async function send() {
    if (!email) return;
    setBusy("send");
    const res = await fetch(`/api/emails/${email.id}/send`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subject, body, confirmed: true }),
    });
    const j = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
    setBusy(null);
    setConfirming(false);
    setMsg(j.ok ? { tone: "ok", text: `Sent to ${j.to} (Resend id ${j.resendId})` } : { tone: "err", text: `Send failed: ${j.error}` });
    router.refresh();
  }

  if (!email) {
    return (
      <section className="rounded-lg border border-stone-200 bg-white p-4">
        <h2 className="text-sm font-semibold">Email</h2>
        <p className="mt-2 text-sm text-stone-600">No draft yet. Based on the current ranking this candidate would get a {props.expectedType} draft.</p>
        <button type="button" onClick={generate} disabled={busy !== null} className="mt-3 rounded bg-stone-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
          {busy === "draft" ? "Drafting…" : `Draft ${props.expectedType}`}
        </button>
        {msg && <p className={`mt-2 text-sm ${msg.tone === "ok" ? "text-emerald-700" : "text-red-700"}`}>{msg.text}</p>}
      </section>
    );
  }

  const sent = email.status === "sent";

  return (
    <section className="rounded-lg border border-stone-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-semibold">
          {email.type === "invite" ? "Interview invite" : "Rejection"} draft
        </h2>
        <span
          className={`rounded px-1.5 py-0.5 text-xs font-medium ${
            sent ? "bg-emerald-100 text-emerald-800" : email.status === "failed" ? "bg-red-100 text-red-800" : "bg-stone-100 text-stone-700"
          }`}
        >
          {email.status}
        </span>
        {sent && email.sent_at && <span className="text-xs text-stone-500">sent {new Date(email.sent_at).toLocaleString()} · Resend id {email.resend_id}</span>}
      </div>

      {!sent && email.type !== props.expectedType && (
        <div className="mt-3 rounded border border-amber-200 bg-amber-50 p-2 text-sm text-amber-900">
          The ranking has changed: this is a {email.type} draft but the candidate is now in the {props.expectedType === "invite" ? "top 5" : "rest of the pool"}.{" "}
          <button type="button" onClick={generate} className="font-medium underline" disabled={busy !== null}>
            Redraft as {props.expectedType}
          </button>
        </div>
      )}
      {email.status === "failed" && email.error_message && <p className="mt-2 text-sm text-red-700">Last attempt failed: {email.error_message}</p>}

      <label className="mt-4 block text-xs font-medium uppercase tracking-wide text-stone-500">Subject</label>
      <input value={subject} onChange={(e) => setSubject(e.target.value)} disabled={sent} className="mt-1 w-full rounded border border-stone-300 px-2 py-1.5 text-sm disabled:bg-stone-50" />
      <label className="mt-3 block text-xs font-medium uppercase tracking-wide text-stone-500">
        Body <span className="normal-case tracking-normal text-stone-400">([NAME] is replaced with the candidate&apos;s name when sent)</span>
      </label>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        disabled={sent}
        rows={12}
        className="mt-1 w-full rounded border border-stone-300 px-2 py-1.5 font-mono text-sm leading-relaxed disabled:bg-stone-50"
      />
      {!sent && !body.includes("[NAME]") && <p className="text-xs text-amber-700">Heads up: the body no longer contains [NAME].</p>}

      {!sent && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" onClick={save} disabled={!dirty || busy !== null} className="rounded border border-stone-300 px-3 py-1.5 text-sm hover:bg-stone-50 disabled:opacity-40">
            {busy === "save" ? "Saving…" : "Save draft"}
          </button>
          {sendingConfigured ? (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              disabled={busy !== null || !subject.trim() || !body.trim()}
              className="rounded bg-stone-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
            >
              Confirm &amp; Send…
            </button>
          ) : (
            <button type="button" disabled className="cursor-not-allowed rounded bg-stone-200 px-3 py-1.5 text-sm font-medium text-stone-500">
              Email sending not configured
            </button>
          )}
        </div>
      )}
      {msg && <p className={`mt-2 text-sm ${msg.tone === "ok" ? "text-emerald-700" : "text-red-700"}`}>{msg.text}</p>}

      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-lg bg-white p-5 shadow-xl">
            <h3 id="confirm-title" className="text-lg font-semibold">Send this email?</h3>
            <div className="mt-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">
              Test mode: sending to {testRecipient}
            </div>
            <dl className="mt-3 grid grid-cols-[6rem_1fr] gap-y-1 text-sm">
              <dt className="text-stone-500">To</dt>
              <dd className="font-medium">{testRecipient}</dd>
              <dt className="text-stone-500">Candidate</dt>
              <dd>
                {fullName} <span className="text-stone-400">({props.candidateEmail ?? "no email on file"}, not used in test mode)</span>
              </dd>
              <dt className="text-stone-500">Subject</dt>
              <dd className="font-medium">{preview(subject, fullName)}</dd>
            </dl>
            <pre className="mt-3 whitespace-pre-wrap rounded border border-stone-200 bg-stone-50 p-3 font-sans text-sm leading-relaxed">{preview(body, fullName)}</pre>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setConfirming(false)} disabled={busy === "send"} className="rounded border border-stone-300 px-3 py-1.5 text-sm">
                Cancel
              </button>
              <button type="button" onClick={send} disabled={busy === "send"} className="rounded bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
                {busy === "send" ? "Sending…" : "Send 1 email"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
