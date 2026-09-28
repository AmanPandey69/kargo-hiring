import "server-only";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name} (see .env.example)`);
  return v;
}

export const env = {
  supabaseUrl: () => required("SUPABASE_URL"),
  supabaseAnonKey: () => required("SUPABASE_ANON_KEY"),
  geminiApiKey: () => required("GEMINI_API_KEY"),
  geminiModel: () => process.env.GEMINI_MODEL || "gemini-flash-latest",
  resendApiKey: () => process.env.RESEND_API_KEY || "",
  resendFrom: () => process.env.RESEND_FROM_EMAIL || "Kargo Hiring <onboarding@resend.dev>",
  testRecipient: () => process.env.TEST_RECIPIENT_EMAIL || "",
};
