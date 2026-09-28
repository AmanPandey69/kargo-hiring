export type Role = "PM" | "SPM";
export const ROLES: Role[] = ["PM", "SPM"];
export const otherRole = (r: Role): Role => (r === "PM" ? "SPM" : "PM");

export type Band = "shortlist" | "review" | "below";

export type Criterion = {
  id: string;
  name: string;
  weight: number;
  anchors: Record<string, string>;
  evidence_hires?: string[];
};

export type RubricMeta = {
  scale: { min: number; max: number };
  bands: { shortlist: number; review: number };
  zero_weight: string[];
};

export type Rubric = {
  id: string;
  role: Role;
  version: string;
  criteria: Criterion[];
  meta: RubricMeta;
};

export type CriterionScore = { score: number; evidence: string; rationale: string };

export type ScoreRow = {
  id: string;
  candidate_id: string;
  rubric_role: Role;
  criterion_scores: Record<string, CriterionScore>;
  weighted_total: number;
  band: Band;
  created_at: string;
};

export type Candidate = {
  id: string;
  role_applied: Role;
  full_name: string;
  email: string | null;
  phone: string | null;
  cv_content_redacted: string | null;
  original_filename: string | null;
  status: "new" | "scored" | "error";
  error_message: string | null;
  created_at: string;
};

export type Brief = {
  id: string;
  candidate_id: string;
  role: Role;
  summary: string;
  probe_questions: string[];
  created_at: string;
};

export type EmailRow = {
  id: string;
  candidate_id: string;
  type: "invite" | "rejection";
  subject: string;
  body: string;
  status: "draft" | "sent" | "failed";
  resend_id: string | null;
  error_message: string | null;
  sent_at: string | null;
  created_at: string;
};
