"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { pool, runRefresh, type RefreshProgress } from "./refresh";

type Role = "PM" | "SPM";
type RowStatus = "reading" | "ready" | "queued" | "processing" | "scored" | "error";
type Row = { key: string; file: File; name: string; status: RowStatus; error?: string; candidateId?: string };

const UPLOAD_CONCURRENCY = 2; // small limit: each CV makes two model calls
const ACCEPT = ".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const STATUS_TEXT: Record<RowStatus, string> = {
  reading: "Reading…",
  ready: "Ready",
  queued: "Queued",
  processing: "Redacting & scoring…",
  scored: "Scored",
  error: "Error",
};

export default function Uploader() {
  const [role, setRole] = useState<Role>("PM");
  const [rows, setRows] = useState<Row[]>([]);
  const [phase, setPhase] = useState<"idle" | "processing" | "drafting" | "done">("idle");
  const [refresh, setRefresh] = useState<RefreshProgress | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const update = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  async function addFiles(list: FileList | null) {
    if (!list?.length) return;
    const fresh: Row[] = Array.from(list).map((file, i) => ({
      key: `${Date.now()}-${i}-${file.name}`,
      file,
      name: "",
      status: "reading",
    }));
    setRows((rs) => [...rs, ...fresh]);
    if (inputRef.current) inputRef.current.value = "";
    // Pre-fill each name from the first line of the CV; the user can edit it.
    await pool(fresh, 4, async (r) => {
      const fd = new FormData();
      fd.append("file", r.file);
      try {
        const res = await fetch("/api/extract-name", { method: "POST", body: fd });
        const j = await res.json();
        setRows((rs) =>
          rs.map((x) => (x.key === r.key ? { ...x, name: x.name || j.suggestedName || "", status: "ready", error: j.error } : x)),
        );
      } catch {
        update(r.key, { status: "ready" });
      }
    });
  }

  async function processOne(r: Row) {
    update(r.key, { status: "processing", error: undefined });
    if (r.candidateId) {
      // Already stored (scoring failed earlier): re-score instead of creating a duplicate.
      try {
        const res = await fetch(`/api/candidates/${r.candidateId}/rescore`, { method: "POST" });
        const j = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        update(r.key, { status: j.status === "scored" ? "scored" : "error", error: j.error });
      } catch (err) {
        update(r.key, { status: "error", error: (err as Error).message });
      }
      return;
    }
    const fd = new FormData();
    fd.append("file", r.file);
    fd.append("name", r.name);
    fd.append("role", role);
    try {
      const res = await fetch("/api/candidates", { method: "POST", body: fd });
      const j = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      update(r.key, { status: j.status === "scored" ? "scored" : "error", error: j.error, candidateId: j.id ?? undefined });
    } catch (err) {
      update(r.key, { status: "error", error: (err as Error).message });
    }
  }

  async function processAll(only?: Row[]) {
    const todo = only ?? rows.filter((r) => r.status === "ready");
    if (!todo.length) return;
    setPhase("processing");
    setRefreshError(null);
    setRows((rs) => rs.map((r) => (todo.some((t) => t.key === r.key) ? { ...r, status: "queued" } : r)));
    await pool(todo, UPLOAD_CONCURRENCY, processOne);
    setPhase("drafting");
    try {
      await runRefresh(setRefresh);
    } catch (err) {
      setRefreshError((err as Error).message);
    }
    setPhase("done");
  }

  const ready = rows.filter((r) => r.status === "ready");
  const missingNames = ready.filter((r) => !r.name.trim()).length;
  const busy = phase === "processing" || phase === "drafting";
  const counts = {
    scored: rows.filter((r) => r.status === "scored").length,
    error: rows.filter((r) => r.status === "error").length,
    inFlight: rows.filter((r) => r.status === "queued" || r.status === "processing").length,
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Upload CVs</h1>
        <p className="mt-1 text-sm text-stone-600">
          PDF or DOCX. Names, emails, phone numbers and profile links are removed in code before anything is sent to the model.
        </p>
      </div>

      <section className="grid gap-4 rounded-lg border border-stone-200 bg-white p-4 sm:grid-cols-[auto_1fr] sm:items-center">
        <label className="text-sm font-medium">Role applied for</label>
        <div className="inline-flex w-fit rounded-md border border-stone-300 p-0.5">
          {(["PM", "SPM"] as Role[]).map((r) => (
            <button
              key={r}
              type="button"
              disabled={busy}
              onClick={() => setRole(r)}
              className={`rounded px-3 py-1 text-sm ${role === r ? "bg-stone-900 text-white" : "text-stone-700 hover:bg-stone-100"}`}
            >
              {r === "PM" ? "Product Manager (PM)" : "Senior PM (SPM)"}
            </button>
          ))}
        </div>

        <label className="text-sm font-medium" htmlFor="files">CV files</label>
        <input
          id="files"
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT}
          disabled={busy}
          onChange={(e) => addFiles(e.target.files)}
          className="text-sm file:mr-3 file:rounded file:border-0 file:bg-stone-900 file:px-3 file:py-1.5 file:text-white"
        />
      </section>

      {rows.length > 0 && (
        <section className="rounded-lg border border-stone-200 bg-white">
          <div className="flex flex-wrap items-center gap-3 border-b border-stone-200 px-4 py-3 text-sm">
            <span className="font-medium">{rows.length} file{rows.length === 1 ? "" : "s"}</span>
            <span className="text-stone-500">
              {counts.scored} scored · {counts.error} error · {counts.inFlight} in progress
            </span>
            <div className="ml-auto flex gap-2">
              {!busy && rows.some((r) => r.status !== "scored") && (
                <button
                  type="button"
                  onClick={() => setRows((rs) => rs.filter((r) => r.status === "scored"))}
                  className="rounded border border-stone-300 px-3 py-1.5 text-stone-700 hover:bg-stone-50"
                >
                  Clear unprocessed
                </button>
              )}
              <button
                type="button"
                disabled={busy || !ready.length || missingNames > 0}
                onClick={() => processAll()}
                className="rounded bg-stone-900 px-3 py-1.5 font-medium text-white disabled:opacity-40"
              >
                {busy ? "Working…" : `Process ${ready.length} as ${role}`}
              </button>
            </div>
          </div>
          {missingNames > 0 && !busy && (
            <p className="border-b border-stone-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
              {missingNames} file{missingNames === 1 ? " needs" : "s need"} a candidate name before processing.
            </p>
          )}
          <ul className="divide-y divide-stone-100">
            {rows.map((r) => (
              <li key={r.key} className="grid gap-2 px-4 py-2.5 text-sm sm:grid-cols-[1fr_16rem_10rem] sm:items-center">
                <div className="min-w-0">
                  <div className="truncate text-stone-800">{r.file.name}</div>
                  {r.error && <div className="text-xs text-red-700">{r.error}</div>}
                </div>
                <input
                  value={r.name}
                  placeholder="Candidate full name"
                  disabled={r.status !== "ready" && r.status !== "reading"}
                  onChange={(e) => update(r.key, { name: e.target.value })}
                  className="rounded border border-stone-300 px-2 py-1 disabled:bg-stone-50 disabled:text-stone-500"
                />
                <div className="flex items-center gap-2">
                  <StatusDot status={r.status} />
                  <span className="text-stone-600">{STATUS_TEXT[r.status]}</span>
                  {r.status === "scored" && r.candidateId && (
                    <Link href={`/candidates/${r.candidateId}`} className="ml-auto text-sky-700 hover:underline">
                      View
                    </Link>
                  )}
                  {r.status === "error" && !busy && (
                    <button type="button" onClick={() => processAll([r])} className="ml-auto text-sky-700 hover:underline">
                      Retry
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {phase !== "idle" && phase !== "processing" && (
        <section className="rounded-lg border border-stone-200 bg-white p-4 text-sm">
          <div className="font-medium">Briefs & email drafts</div>
          {refresh ? (
            <>
              <div className="mt-2 h-2 overflow-hidden rounded bg-stone-100">
                <div className="h-full bg-stone-900 transition-all" style={{ width: `${refresh.total ? (refresh.done / refresh.total) * 100 : 100}%` }} />
              </div>
              <p className="mt-2 text-stone-600">
                {refresh.total === 0 ? "Everything is up to date." : `${refresh.done} / ${refresh.total} done`}
                {refresh.failed > 0 && <span className="text-red-700"> · {refresh.failed} failed (use “Refresh briefs & drafts” on the dashboard to retry)</span>}
              </p>
            </>
          ) : (
            <p className="mt-2 text-stone-600">Re-ranking…</p>
          )}
          {refreshError && <p className="mt-2 text-red-700">{refreshError}</p>}
          {phase === "done" && (
            <Link href="/dashboard" className="mt-3 inline-block rounded bg-stone-900 px-3 py-1.5 font-medium text-white">
              Open dashboard →
            </Link>
          )}
        </section>
      )}
    </div>
  );
}

function StatusDot({ status }: { status: RowStatus }) {
  const color = {
    reading: "bg-stone-300 animate-pulse",
    ready: "bg-sky-400",
    queued: "bg-stone-300",
    processing: "bg-amber-400 animate-pulse",
    scored: "bg-emerald-500",
    error: "bg-red-500",
  }[status];
  return <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${color}`} />;
}
