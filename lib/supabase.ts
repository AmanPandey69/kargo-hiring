import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env";
import type { Role, Rubric } from "./types";

let client: SupabaseClient | null = null;

export function db(): SupabaseClient {
  if (!client) {
    client = createClient(env.supabaseUrl(), env.supabaseAnonKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

/** Throws on a Supabase error so callers can't silently ignore one. */
export function must<T>(res: { data: T; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
}

export async function getRubric(role: Role): Promise<Rubric> {
  const rows = must(
    await db().from("rubrics").select("id, role, version, criteria, meta").eq("role", role).order("created_at", { ascending: false }).limit(1),
    `load ${role} rubric`,
  );
  if (!rows?.length) throw new Error(`No ${role} rubric in the database. Run the migration in supabase/migrations.`);
  return rows[0] as Rubric;
}

export async function getRubrics(): Promise<Record<Role, Rubric>> {
  const [PM, SPM] = await Promise.all([getRubric("PM"), getRubric("SPM")]);
  return { PM, SPM };
}
