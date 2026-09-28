import Link from "next/link";
import { connection } from "next/server";
import RefreshButton from "@/components/RefreshButton";
import { BAND_LABEL, BandBadge, Pill } from "@/components/ui";
import { TOP_N } from "@/lib/ranking";
import { topCriteria } from "@/lib/scoring-math";
import { db, getRubrics, must } from "@/lib/supabase";
import { otherRole, ROLES, type Band, type Candidate, type EmailRow, type Role, type ScoreRow } from "@/lib/types";

const BAND_ORDER: Band[] = ["shortlist", "review", "below"];
const BAND_HEADER: Record<Band, string> = {
  shortlist: "border-emerald-100 bg-emerald-50 text-emerald-800",
  review: "border-amber-100 bg-amber-50 text-amber-800",
  below: "border-stone-200 bg-stone-100 text-stone-600",
};
const BAND_DOT: Record<Band, string> = { shortlist: "bg-emerald-500", review: "bg-amber-500", below: "bg-stone-400" };

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

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
  const bandCount = (b: Band) => rows.filter((r) => r.s.band === b).length;
  const sentCount = rows.filter((r) => emails.get(r.c.id)?.status === "sent").length;
  const draftCount = rows.filter((r) => emails.get(r.c.id)?.status === "draft").length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Candidates</h1>
          <p className="mt-1 max-w-2xl text-sm text-stone-600">
            Everyone is scored on both rubrics. This tab ranks all candidates on the {tab} rubric (v{rubric.version}). Nobody is hidden or auto-rejected.
          </p>
        </div>
        <div className="ml-auto">
          <RefreshButton />
        </div>
      </div>

      <div className="inline-flex rounded-lg border border-stone-200 bg-white p-1 shadow-sm">
        {ROLES.map((r) => (
          <Link
            key={r}
            href={`/dashboard?role=${r}`}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
              r === tab ? "bg-stone-900 text-white shadow" : "text-stone-600 hover:bg-stone-100"
            }`}
          >
            {r === "PM" ? "Product Manager" : "Senior Product Manager"}
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="Candidates" value={rows.length} />
        <Stat label="Shortlist" value={bandCount("shortlist")} tone="emerald" />
        <Stat label="Review" value={bandCount("review")} tone="amber" />
        <Stat label="Below the line" value={bandCount("below")} tone="stone" />
        <Stat label="Emails" value={`${sentCount} sent`} sub={`${draftCount} draft${draftCount === 1 ? "" : "s"} waiting`} />
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-stone-300 bg-white p-12 text-center">
          <p className="text-sm text-stone-500">No scored candidates yet.</p>
          <Link href="/" className="mt-3 inline-block rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-white">
            Upload CVs
          </Link>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white shadow-sm">
          <table className="w-full min-w-[880px] text-sm">
            <thead className="border-b border-stone-200 text-left text-[11px] font-semibold uppercase tracking-wider text-stone-500">
              <tr>
                <th className="w-12 px-4 py-3">#</th>
                <th className="px-3 py-3">Candidate</th>
                <th className="w-44 px-3 py-3">{tab} score</th>
                <th className="px-3 py-3">Top 2 criteria</th>
                <th className="px-3 py-3">Flags</th>
                <th className="px-3 py-3">Email</th>
                <th className="w-8 px-3 py-3" />
              </tr>
            </thead>
            {BAND_ORDER.map((band) => {
              const inBand = rows.filter((r) => r.s.band === band);
              return (
                <tbody key={band}>
                  <tr>
                    <td colSpan={7} className={`border-y px-4 py-2 ${BAND_HEADER[band]}`}>
                      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider">
                        <span className={`h-2 w-2 rounded-full ${BAND_DOT[band]}`} />
                        {BAND_LABEL[band]}
                        <span className="font-normal normal-case tracking-normal opacity-70">
                          {band === "shortlist" ? "75–100" : band === "review" ? "55–74" : "20–54"} · {inBand.length} candidate{inBand.length === 1 ? "" : "s"}
                        </span>
                      </div>
                    </td>
                  </tr>
                  {inBand.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-3 text-xs italic text-stone-400">No candidates in this band</td>
                    </tr>
                  )}
                  {inBand.map(({ c, s, other }) => {
                    const rank = rows.findIndex((r) => r.c.id === c.id) + 1;
                    const top2 = topCriteria(rubric.criteria, s.criterion_scores);
                    const strongerOther = other && Number(other.weighted_total) > Number(s.weighted_total);
                    const email = emails.get(c.id);
                    const total = Number(s.weighted_total);
                    return (
                      <tr key={c.id} className="group border-t border-stone-100 transition-colors hover:bg-stone-50">
                        <td className="px-4 py-3 font-mono text-xs text-stone-400">{rank}</td>
                        <td className="px-3 py-3">
                          <Link href={`/candidates/${c.id}`} className="flex items-center gap-3">
                            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-stone-100 text-xs font-semibold text-stone-600">
                              {initials(c.full_name)}
                            </span>
                            <span>
                              <span className="block whitespace-nowrap font-medium text-stone-900 group-hover:underline">{c.full_name}</span>
                              <span className="block whitespace-nowrap text-xs text-stone-500">Applied for {c.role_applied}</span>
                            </span>
                          </Link>
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-3">
                            <span className="w-8 text-right font-mono text-base font-semibold tabular-nums">{total.toFixed(0)}</span>
                            <div className="flex-1">
                              <div className="h-1.5 w-full overflow-hidden rounded-full bg-stone-100">
                                <div className={`h-full rounded-full ${BAND_DOT[s.band]}`} style={{ width: `${total}%` }} />
                              </div>
                              <div className="mt-1">
                                <BandBadge band={s.band} />
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-3 text-xs text-stone-600">
                          {top2.map((cr) => (
                            <div key={cr.id} className="flex items-center gap-2 py-0.5">
                              <span className="w-10 font-mono text-stone-400">{cr.id}</span>
                              <span className="max-w-56 truncate">{cr.name}</span>
                              <span className="ml-auto rounded bg-stone-100 px-1.5 font-mono font-medium text-stone-800">{s.criterion_scores[cr.id].score}/5</span>
                            </div>
                          ))}
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex flex-wrap gap-1">
                            {strongerOther && <Pill tone="violet">↗ Stronger {otherRole(tab)} fit</Pill>}
                            {topByRole[c.role_applied].has(c.id) && <Pill tone="blue">★ Top {TOP_N} {c.role_applied}</Pill>}
                            {briefIds.has(`${c.id}:${c.role_applied}`) && <Pill>Brief ready</Pill>}
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          <EmailStatus email={email} />
                        </td>
                        <td className="px-3 py-3 text-stone-300 group-hover:text-stone-600">
                          <Link href={`/candidates/${c.id}`} aria-label={`Open ${c.full_name}`}>→</Link>
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
  const sb = db(); // throws here (not inside Promise.all) if env is missing
  const [rubrics, candidates, scores, briefs, emails] = await Promise.all([
    getRubrics(),
    sb.from("candidates").select("id, full_name, role_applied, status, error_message, original_filename, created_at").order("created_at"),
    sb.from("scores").select("candidate_id, rubric_role, criterion_scores, weighted_total, band"),
    sb.from("briefs").select("candidate_id, role"),
    sb.from("emails").select("candidate_id, type, status, created_at").order("created_at", { ascending: false }),
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

function Stat({ label, value, sub, tone }: { label: string; value: number | string; sub?: string; tone?: "emerald" | "amber" | "stone" }) {
  const accent = { emerald: "bg-emerald-500", amber: "bg-amber-500", stone: "bg-stone-400" };
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-1.5 text-xs font-medium text-stone-500">
        {tone && <span className={`h-2 w-2 rounded-full ${accent[tone]}`} />}
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">{value}</div>
      {sub && <div className="text-xs text-stone-500">{sub}</div>}
    </div>
  );
}

function EmailStatus({ email }: { email?: Pick<EmailRow, "type" | "status"> }) {
  if (!email) return <span className="text-xs text-stone-400">No draft</span>;
  const tone =
    email.status === "sent"
      ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
      : email.status === "failed"
        ? "bg-red-50 text-red-700 ring-red-200"
        : "bg-white text-stone-600 ring-stone-200";
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${tone}`}>
      {email.type === "invite" ? "Invite" : "Rejection"} · {email.status}
    </span>
  );
}
