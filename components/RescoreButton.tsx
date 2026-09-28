"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function RescoreButton({ candidateId }: { candidateId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/candidates/${candidateId}/rescore`, { method: "POST" });
    const j = await res.json().catch(() => ({}));
    if (j.status !== "scored") setError(j.error ?? "Re-score failed");
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="self-center text-xs">
      <button type="button" onClick={go} disabled={busy} className="rounded border border-stone-300 px-2 py-1 text-stone-600 hover:bg-stone-50 disabled:opacity-50">
        {busy ? "Scoring…" : "Re-score"}
      </button>
      {error && <div className="mt-1 max-w-48 text-red-700">{error}</div>}
    </div>
  );
}
