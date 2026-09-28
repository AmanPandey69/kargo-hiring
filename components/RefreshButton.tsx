"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { runRefresh, type RefreshProgress } from "./refresh";

/** Re-ranks and fills any missing briefs / email drafts (e.g. after an interrupted upload). */
export default function RefreshButton() {
  const router = useRouter();
  const [p, setP] = useState<RefreshProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setBusy(true);
    setError(null);
    try {
      const res = await runRefresh(setP);
      if (res.failed) setError(res.errors.slice(0, 3).join("; "));
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="text-right text-xs">
      <button
        type="button"
        onClick={go}
        disabled={busy}
        className="rounded border border-stone-300 bg-white px-3 py-1.5 text-sm text-stone-700 hover:bg-stone-50 disabled:opacity-50"
      >
        {busy ? (p ? `Drafting ${p.done}/${p.total}…` : "Re-ranking…") : "Refresh briefs & drafts"}
      </button>
      {!busy && p && !error && <div className="mt-1 text-stone-500">{p.total ? `Updated ${p.done - p.failed} item(s)` : "Up to date"}</div>}
      {error && <div className="mt-1 max-w-sm text-red-700">{error}</div>}
    </div>
  );
}
