import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import EmailPanel from "@/components/EmailPanel";
import RescoreButton from "@/components/RescoreButton";
import { BandBadge, Pill } from "@/components/ui";
import { env } from "@/lib/env";
import { rankApplicants, TOP_N } from "@/lib/ranking";
import { sendingConfigured } from "@/lib/send";
import { db, getRubrics, must } from "@/lib/supabase";
import { otherRole, type Brief, type Candidate, type EmailRow, type Role, type Rubric, type ScoreRow } from "@/lib/types";

export default async function CandidatePage(props: PageProps<"/candidates/[id]">) {
  await connection();
  const { id } = await props.params;

  const { data: candidate } = await db().from("candidates").select("*").eq("id", id).maybeSingle();
  if (!candidate) notFound();
  const c = candidate as Candidate;

  const [rubrics, scoresRes, briefsRes, emailsRes, ranked] = await Promise.all([
    getRubrics(),
    db().from("scores").select("*").eq("candidate_id", id),
    db().from("briefs").select("*").eq("candidate_id", id),
    db().from("emails").select("*").eq("candidate_id", id).order("created_at", { ascending: false }).limit(1),
    rankApplicants(c.role_applied),
  ]);
  const scores = must(scoresRes, "load scores") as ScoreRow[];
  const brief = (must(briefsRes, "load briefs") as Brief[]).find((b) => b.role === c.role_applied);
  const email = (must(emailsRes, "load email") as EmailRow[])[0] ?? null;
  const rank = ranked.findIndex((r) => r.candidate.id === id) + 1;
  const expectedType = rank > 0 && rank <= TOP_N ? "invite" : "rejection";

  // Applied role first.
  const order: Role[] = [c.role_applied, otherRole(c.role_applied)];

  return (
    <div className="space-y-6">
      <Link href={`/dashboard?role=${c.role_applied}`} className="text-sm text-sky-700 hover:underline">
        ← Dashboard
      </Link>

      <header className="flex flex-wrap items-start gap-4 rounded-lg border border-stone-200 bg-white p-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{c.full_name}</h1>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-stone-600">
            <span>Applied: <Pill>{c.role_applied}</Pill></span>
            {rank > 0 && <span>Rank #{rank} of {ranked.length} {c.role_applied} applicants</span>}
            <span>{c.email ?? "no email found"}</span>
            <span>{c.phone ?? "no phone found"}</span>
            <span className="text-stone-400">{c.original_filename}</span>
          </div>
          {c.status !== "scored" && (
            <p className="mt-2 text-sm text-red-700">
              Status: {c.status}
              {c.error_message ? ` · ${c.error_message}` : ""}
            </p>
          )}
        </div>
        <div className="ml-auto flex gap-2">
          {scores.length > 0 &&
            order.map((r) => {
              const s = scores.find((x) => x.rubric_role === r);
              return s ? (
                <div key={r} className="rounded-md border border-stone-200 px-3 py-2 text-center">
                  <div className="text-xs text-stone-500">{r}</div>
                  <div className="font-mono text-xl tabular-nums">{Number(s.weighted_total).toFixed(0)}</div>
                  <BandBadge band={s.band} />
                </div>
              ) : null;
            })}
          {c.cv_content_redacted && <RescoreButton candidateId={c.id} />}
        </div>
      </header>

      {brief && (
        <section className="rounded-lg border border-sky-200 bg-sky-50 p-4">
          <h2 className="text-sm font-semibold text-sky-900">Brief · {brief.role}</h2>
          <p className="mt-2 text-sm leading-relaxed text-stone-800">{brief.summary}</p>
          <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-sky-900">Probe in interview</h3>
          <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm text-stone-800">
            {brief.probe_questions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ol>
        </section>
      )}

      {order.map((r) => {
        const s = scores.find((x) => x.rubric_role === r);
        return s ? <Breakdown key={r} rubric={rubrics[r]} score={s} applied={r === c.role_applied} /> : null;
      })}

      {c.status === "scored" && (
        <EmailPanel
          candidateId={c.id}
          role={c.role_applied}
          fullName={c.full_name}
          candidateEmail={c.email}
          email={email}
          expectedType={expectedType}
          sendingConfigured={sendingConfigured()}
          testRecipient={env.testRecipient()}
        />
      )}

      {c.cv_content_redacted && (
        <details className="rounded-lg border border-stone-200 bg-white p-4 text-sm">
          <summary className="cursor-pointer font-medium">Redacted CV (exactly what the model saw)</summary>
          <pre className="mt-3 max-h-[32rem] overflow-auto whitespace-pre-wrap font-mono text-xs text-stone-700">{c.cv_content_redacted}</pre>
        </details>
      )}
    </div>
  );
}

function Breakdown({ rubric, score, applied }: { rubric: Rubric; score: ScoreRow; applied: boolean }) {
  return (
    <section className="overflow-hidden rounded-lg border border-stone-200 bg-white">
      <h2 className="flex items-center gap-3 border-b border-stone-200 px-4 py-2 text-sm font-semibold">
        {rubric.role} rubric {applied ? "(applied role)" : "(other role)"}
        <span className="font-mono font-normal text-stone-600">{Number(score.weighted_total).toFixed(1)} / 100</span>
        <BandBadge band={score.band} />
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
            <tr>
              <th className="px-3 py-2">Criterion</th>
              <th className="px-3 py-2 text-right">Score</th>
              <th className="px-3 py-2 text-right">Weight</th>
              <th className="px-3 py-2 text-right">Points</th>
              <th className="px-3 py-2">Evidence</th>
              <th className="px-3 py-2">Rationale</th>
            </tr>
          </thead>
          <tbody>
            {rubric.criteria.map((cr) => {
              const s = score.criterion_scores[cr.id] as ScoreRow["criterion_scores"][string] & { evidence_verbatim?: boolean };
              return (
                <tr key={cr.id} className="border-t border-stone-100 align-top">
                  <td className="px-3 py-2">
                    <span className="font-mono text-xs text-stone-400">{cr.id}</span> {cr.name}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">{s.score}/5</td>
                  <td className="px-3 py-2 text-right font-mono text-stone-500">{cr.weight}%</td>
                  <td className="px-3 py-2 text-right font-mono">{((cr.weight * s.score) / 5).toFixed(0)}</td>
                  <td className="max-w-xs px-3 py-2 text-stone-700">
                    {s.evidence.toLowerCase() === "none" ? (
                      <span className="text-stone-400">none</span>
                    ) : (
                      <>
                        <q className="italic">{s.evidence}</q>
                        {s.evidence_verbatim === false && (
                          <div className="mt-0.5 text-xs text-amber-700">Not found verbatim in the CV; check before relying on it</div>
                        )}
                      </>
                    )}
                  </td>
                  <td className="max-w-xs px-3 py-2 text-stone-600">{s.rationale}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
