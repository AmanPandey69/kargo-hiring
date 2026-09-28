import Link from "next/link";
import { connection } from "next/server";
import RefreshButton from "@/components/RefreshButton";
import { BAND_LABEL, BandBadge, Pill } from "@/components/ui";
import { TOP_N } from "@/lib/ranking";
import { topCriteria } from "@/lib/scoring-math";
import { db, getRubrics, must } from "@/lib/supabase";
import { otherRole, ROLES, type Band, type Candidate, type EmailRow, type Role, type ScoreRow } from "@/lib/types";

const BAND_ORDER: Band[] = ["shortlist", "review", "below"];

export default async function Dashboard(props: PageProps<"/dashboard">) {
  await connection();
  const sp = await props.searchParams;
  const tab: Role = sp.role === "SPM" ? "SPM" : "PM";

  let data;
  try {
    data = await load();
  } catch (err) {
    return <SetupError message={(err as Error).message} />;
  }
  const { rubrics, candidates, scores, briefIds, emails } = data;

  const scoreOf = (cid: string, role: Role) => scores.find((s) => s.candidate_id === cid && s.rubric_role === role);
  const scored = candidates.filter((c) => c.status === "scored");
  const failed = candidates.filter((c) => c.status !== "scored");

  // Top 5 per role = applicants for that role ranked on that role's rubric (who get a brief + invite).
  const topByRole = Object.fromEntries(
    ROLES.map((r) => [
      r,
      new Set(
        scored
          .filter((c) => c.role_applied === r && scoreOf(c.id, r))
          .sort((a, b) => Number(scoreOf(b.id, r)!.weighted_total) - Number(scoreOf(a.id, r)!.weighted_total) || a.created_at.localeCompare(b.created_at))
          .slice(0, TOP_N)
          .map((c) => c.id),
      ),
    ]),
  ) as Record<Role, Set<string>>;

  const rows = scored
    .map((c) => ({ c, s: scoreOf(c.id, tab), other: scoreOf(c.id, otherRole(tab)) }))
    .filter((r): r is typeof r & { s: ScoreRow } => Boolean(r.s))
    .sort((a, b) => Number(b.s.weighted_total) - Number(a.s.weighted_total) || a.c.created_at.localeCompare(b.c.created_at));

  const rubric = rubrics[tab];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Candidates</h1>
          <p className="mt-1 text-sm text-stone-600">
            Everyone is scored on both rubrics. This tab ranks all candidates on the {tab} rubric (v{rubric.version}). Nobody is hidden or auto-rejected.
          </p>
        </div>
        <div className="ml-auto">
          <RefreshButton />
        </div>
      </div>

      <div className="flex gap-1 border-b border-stone-200">
        {ROLES.map((r) => (
          <Link
            key={r}
            href={`/dashboard?role=${r}`}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${
              r === tab ? "border-stone-900 text-stone-900" : "border-transparent text-stone-500 hover:text-stone-800"
            }`}
          >
            {r === "PM" ? "Product Manager" : "Senior Product Manager"}
            <span className="ml-2 text-xs text-stone-400">{scored.length}</span>
          </Link>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-stone-300 bg-white p-8 text-center text-sm text-stone-500">
          No scored candidates yet. <Link href="/" className="text-sky-700 hover:underline">Upload CVs</Link>.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <th className="w-10 px-3 py-2">#</th>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Applied</th>
                <th className="px-3 py-2 text-right">{tab} score</th>
                <th className="px-3 py-2">Band</th>
                <th className="px-3 py-2">Top 2 criteria</th>
                <th className="px-3 py-2">Flags</th>
                <th className="px-3 py-2">Email</th>
              </tr>
            </thead>
            {BAND_ORDER.map((band) => {
              const inBand = rows.filter((r) => r.s.band === band);
              return (
                <tbody key={band} className="border-t-2 border-stone-300">
                  <tr className={band === "below" ? "bg-stone-100" : band === "review" ? "bg-amber-50" : "bg-emerald-50"}>
                    <td colSpan={8} className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-stone-600">
                      {BAND_LABEL[band]} · {band === "shortlist" ? "75–100" : band === "review" ? "55–74" : "20–54"} · {inBand.length}
                    </td>
                  </tr>
                  {inBand.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-3 py-2 text-xs text-stone-400">None</td>
                    </tr>
                  )}
                  {inBand.map(({ c, s, other }) => {
                    const rank = rows.findIndex((r) => r.c.id === c.id) + 1;
                    const top2 = topCriteria(rubric.criteria, s.criterion_scores);
                    const strongerOther = other && Number(other.weighted_total) > Number(s.weighted_total);
                    const email = emails.get(c.id);
                    return (
                      <tr key={c.id} className="border-t border-stone-100 hover:bg-stone-50">
                        <td className="px-3 py-2 text-stone-400">{rank}</td>
                        <td className="px-3 py-2">
                          <Link href={`/candidates/${c.id}`} className="font-medium text-stone-900 hover:underline">
                            {c.full_name}
                          </Link>
                        </td>
                        <td className="px-3 py-2">
                          <Pill>{c.role_applied}</Pill>
                        </td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums">{Number(s.weighted_total).toFixed(0)}</td>
                        <td className="px-3 py-2">
                          <BandBadge band={s.band} />
                        </td>
                        <td className="px-3 py-2 text-xs text-stone-600">
                          {top2.map((cr) => (
                            <div key={cr.id} className="truncate">
                              <span className="font-mono text-stone-400">{cr.id}</span> {cr.name}{" "}
                              <span className="font-medium text-stone-800">{s.criterion_scores[cr.id].score}/5</span>
                            </div>
                          ))}
                        </td>
                        <td className="space-x-1 px-3 py-2">
                          {strongerOther && <Pill tone="violet">Stronger {otherRole(tab)} fit</Pill>}
                          {topByRole[c.role_applied].has(c.id) && <Pill tone="blue">Top {TOP_N} {c.role_applied}</Pill>}
                          {briefIds.has(`${c.id}:${c.role_applied}`) && <Pill>Brief</Pill>}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {email ? (
                            <span className={email.status === "sent" ? "text-emerald-700" : email.status === "failed" ? "text-red-700" : "text-stone-600"}>
                              {email.type} · {email.status}
                            </span>
                          ) : (
                            <span className="text-stone-400">no draft</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              );
            })}
          </table>
        </div>
      )}

      {failed.length > 0 && (
        <section className="rounded-lg border border-red-200 bg-white">
          <h2 className="border-b border-red-100 px-4 py-2 text-sm font-medium text-red-800">Not scored ({failed.length})</h2>
          <ul className="divide-y divide-stone-100 text-sm">
            {failed.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-2">
                <Link href={`/candidates/${c.id}`} className="font-medium hover:underline">{c.full_name}</Link>
                <span className="text-stone-500">{c.original_filename}</span>
                <Pill tone="red">{c.status}</Pill>
                <span className="text-xs text-red-700">{c.error_message}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

async function load() {
  const [rubrics, candidates, scores, briefs, emails] = await Promise.all([
    getRubrics(),
    db().from("candidates").select("id, full_name, role_applied, status, error_message, original_filename, created_at").order("created_at"),
    db().from("scores").select("candidate_id, rubric_role, criterion_scores, weighted_total, band"),
    db().from("briefs").select("candidate_id, role"),
    db().from("emails").select("candidate_id, type, status, created_at").order("created_at", { ascending: false }),
  ]);
  const emailRows = must(emails, "load emails") as Pick<EmailRow, "candidate_id" | "type" | "status">[];
  const latestEmail = new Map<string, (typeof emailRows)[number]>();
  for (const e of emailRows) if (!latestEmail.has(e.candidate_id)) latestEmail.set(e.candidate_id, e);
  return {
    rubrics,
    candidates: must(candidates, "load candidates") as Candidate[],
    scores: must(scores, "load scores") as ScoreRow[],
    briefIds: new Set((must(briefs, "load briefs") as { candidate_id: string; role: Role }[]).map((b) => `${b.candidate_id}:${b.role}`)),
    emails: latestEmail,
  };
}

function SetupError({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-900">
      <h1 className="text-lg font-semibold">Can&apos;t reach the database</h1>
      <p className="mt-2">{message}</p>
      <p className="mt-2 text-red-800">
        Check SUPABASE_URL and SUPABASE_ANON_KEY in .env.local and that the migration in supabase/migrations has been run.
      </p>
    </div>
  );
}
