"use client";

type Task = { kind: "brief" | "email"; role: string; candidateId: string; type?: string };
export type RefreshProgress = { done: number; total: number; failed: number; errors: string[] };

async function pool<T>(items: T[], limit: number, fn: (t: T) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) await fn(items[i++]);
    }),
  );
}

/** Re-ranks, then generates missing/stale briefs and email drafts, one request per task. */
export async function runRefresh(onProgress: (p: RefreshProgress) => void): Promise<RefreshProgress> {
  const res = await fetch("/api/refresh", { method: "POST" });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Refresh failed");
  const tasks: Task[] = json.tasks;
  // Briefs first so the top of the dashboard fills in soonest.
  tasks.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "brief" ? -1 : 1));
  const p: RefreshProgress = { done: 0, total: tasks.length, failed: 0, errors: [] };
  onProgress({ ...p });
  await pool(tasks, 2, async (t) => {
    try {
      const r = await fetch("/api/tasks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(t) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.ok === false) throw new Error(j.error ?? `HTTP ${r.status}`);
    } catch (err) {
      p.failed++;
      p.errors.push(`${t.kind}: ${(err as Error).message}`);
    }
    p.done++;
    onProgress({ ...p, errors: [...p.errors] });
  });
  return p;
}

export { pool };
