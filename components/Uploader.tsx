"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { nameFromFilename, roleFromFilename } from "@/lib/names";
import { pool, runRefresh, type RefreshProgress } from "./refresh";

type Role = "PM" | "SPM";
type RowStatus = "reading" | "ready" | "queued" | "processing" | "scored" | "duplicate" | "error";
type Row = {
  key: string;
  file: File;
  name: string;
  role: Role;
  roleLocked: boolean; // true when set from the file name or by hand; otherwise follows the default
  status: RowStatus;
  error?: string;
  candidateId?: string;
};

const UPLOAD_CONCURRENCY = 2; // small limit: each CV makes two model calls
const ACCEPT = ".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const STATUS_TEXT: Record<RowStatus, string> = {
  reading: "Reading…",
  ready: "Ready",
  queued: "Queued",
  processing: "Redacting & scoring…",
  scored: "Scored",
  duplicate: "Already uploaded",
  error: "Error",
};

export default function Uploader() {
  const [role, setRole] = useState<Role>("PM");
  const [rows, setRows] = useState<Row[]>([]);
  const [phase, setPhase] = useState<"idle" | "processing" | "drafting" | "done">("idle");
  const [refresh, setRefresh] = useState<RefreshProgress | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const update = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  async function addFiles(list: FileList | null) {
    if (!list?.length) return;
    const fresh: Row[] = Array.from(list).map((file, i) => {
      const detected = roleFromFilename(file.name);
      return {
        key: `${Date.now()}-${i}-${file.name}`,
        file,
        name: "",
        role: detected ?? role,
        roleLocked: detected !== null,
        status: "reading",
      };
    });
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
          rs.map((x) =>
            x.key !== r.key
              ? x
              : j.alreadyUploaded
                ? { ...x, status: "duplicate", candidateId: j.alreadyUploaded }
                : { ...x, name: x.name || j.suggestedName || "", status: "ready", error: j.error },
          ),
        );
      } catch {
        setRows((rs) =>
          rs.map((x) =>
            x.key === r.key
              ? { ...x, name: x.name || nameFromFilename(r.file.name), status: "ready", error: "Could not read this file to pre-fill the name; check it matches the CV before processing" }
              : x,
          ),
        );
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
    fd.append("role", r.role);
    try {
      const res = await fetch("/api/candidates", { method: "POST", body: fd });
      const j = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      update(r.key, { status: j.skipped ? "duplicate" : j.status === "scored" ? "scored" : "error", error: j.error, candidateId: j.id ?? undefined });
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

  function setDefaultRole(r: Role) {
    setRole(r);
    // Files without pm_/spm_ in their name follow the default.
    setRows((rs) => rs.map((x) => (!x.roleLocked && (x.status === "ready" || x.status === "reading") ? { ...x, role: r } : x)));
  }

  const ready = rows.filter((r) => r.status === "ready");
  const readyPm = ready.filter((r) => r.role === "PM").length;
  const readySpm = ready.length - readyPm;
  const missingNames = ready.filter((r) => !r.name.trim()).length;
  const busy = phase === "processing" || phase === "drafting";
  const counts = {
    scored: rows.filter((r) => r.status === "scored").length,
    duplicate: rows.filter((r) => r.status === "duplicate").length,
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

      <section className="grid gap-4 rounded-xl border border-stone-200 bg-white p-5 shadow-sm sm:grid-cols-[8rem_1fr] sm:items-center">
        <label className="text-sm font-medium">Default role</label>
        <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex w-fit rounded-md border border-stone-300 p-0.5">
          {(["PM", "SPM"] as Role[]).map((r) => (
            <button
              key={r}
              type="button"
              disabled={busy}
              onClick={() => setDefaultRole(r)}
              className={`rounded px-3 py-1 text-sm ${role === r ? "bg-stone-900 text-white" : "text-stone-700 hover:bg-stone-100"}`}
            >
              {r === "PM" ? "Product Manager (PM)" : "Senior PM (SPM)"}
            </button>
          ))}
        </div>
        <span className="text-xs text-stone-500">
          Files named <code className="rounded bg-stone-100 px-1">pm_…</code> or <code className="rounded bg-stone-100 px-1">spm_…</code> are set automatically. You can change any file below.
        </span>
        </div>

        <label className="text-sm font-medium">CV files</label>
        <label
          htmlFor="files"
          onDragOver={(e) => {
            e.preventDefault();
            if (!busy) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (!busy) addFiles(e.dataTransfer.files);
          }}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors ${
            busy ? "cursor-not-allowed opacity-50" : dragging ? "border-emerald-500 bg-emerald-50" : "border-stone-300 hover:border-stone-400 hover:bg-stone-50"
          }`}
        >
          <svg className="h-8 w-8 text-stone-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 16V4m0 0l-4 4m4-4l4 4M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
          </svg>
          <span className="mt-2 text-sm font-medium text-stone-800">Drop CVs here or click to browse</span>
          <span className="mt-0.5 text-xs text-stone-500">PDF or DOCX · up to 60 at once · 4 MB each</span>
          <input
            id="files"
            ref={inputRef}
            type="file"
            multiple
            accept={ACCEPT}
            disabled={busy}
            onChange={(e) => addFiles(e.target.files)}
            className="sr-only"
          />
        </label>
      </section>

      {rows.length > 0 && (
        <section className="overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center gap-3 border-b border-stone-200 px-4 py-3 text-sm">
            <span className="font-medium">{rows.length} file{rows.length === 1 ? "" : "s"}</span>
            <span className="text-stone-500">
              {counts.scored} scored · {counts.error} error · {counts.inFlight} in progress
              {counts.duplicate > 0 && ` · ${counts.duplicate} already uploaded (skipped)`}
            </span>
            <div className="ml-auto flex gap-2">
              {!busy && rows.some((r) => r.status !== "scored") && (
                <button
                  type="button"
                  onClick={() => setRows((rs) => rs.filter((r) => r.status === "scored" || r.status === "duplicate"))}
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
                {busy ? "Working…" : `Process ${ready.length} CV${ready.length === 1 ? "" : "s"} (${readyPm} PM · ${readySpm} SPM)`}
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
              <li key={r.key} className="grid gap-2 px-4 py-2.5 text-sm sm:grid-cols-[1fr_16rem_6.5rem_10rem] sm:items-center">
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
                <select
                  value={r.role}
                  aria-label={`Role for ${r.file.name}`}
                  disabled={r.status !== "ready" && r.status !== "reading"}
                  onChange={(e) => update(r.key, { role: e.target.value as Role, roleLocked: true })}
                  className={`rounded border px-2 py-1 font-medium disabled:opacity-60 ${
                    r.role === "SPM" ? "border-violet-200 bg-violet-50 text-violet-800" : "border-sky-200 bg-sky-50 text-sky-800"
                  }`}
                >
                  <option value="PM">PM</option>
                  <option value="SPM">SPM</option>
                </select>
                <div className="flex items-center gap-2">
                  <StatusDot status={r.status} />
                  <span className="text-stone-600">{STATUS_TEXT[r.status]}</span>
                  {(r.status === "scored" || r.status === "duplicate") && r.candidateId && (
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
        <section className="rounded-xl border border-stone-200 bg-white p-5 text-sm shadow-sm">
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
    duplicate: "bg-stone-300",
    error: "bg-red-500",
  }[status];
  return <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${color}`} />;
}
