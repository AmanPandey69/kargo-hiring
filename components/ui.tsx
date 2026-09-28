import type { Band } from "@/lib/types";

const BAND_STYLE: Record<Band, string> = {
  shortlist: "bg-emerald-100 text-emerald-800 ring-emerald-200",
  review: "bg-amber-100 text-amber-800 ring-amber-200",
  below: "bg-stone-100 text-stone-600 ring-stone-200",
};
export const BAND_LABEL: Record<Band, string> = { shortlist: "Shortlist", review: "Review", below: "Below the line" };

export function BandBadge({ band }: { band: Band }) {
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${BAND_STYLE[band]}`}>
      {BAND_LABEL[band]}
    </span>
  );
}

export function Pill({ children, tone = "stone" }: { children: React.ReactNode; tone?: "stone" | "blue" | "violet" | "red" }) {
  const tones = {
    stone: "bg-stone-100 text-stone-700",
    blue: "bg-sky-100 text-sky-800",
    violet: "bg-violet-100 text-violet-800",
    red: "bg-red-100 text-red-800",
  };
  return <span className={`inline-flex items-center whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>;
}
