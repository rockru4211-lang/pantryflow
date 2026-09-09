import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { readAuthCallback } from "@/lib/auth-flow";

// Capture callback intent before the SDK consumes and removes the URL hash.
export const initialAuthCallback = typeof window === "undefined" ? null : readAuthCallback(window.location.href);

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
export const BETA_PROJECT_REF = "qckwzwyeqpuqogbydvvl";

function projectRef(url: string | undefined) {
  if (!url) return "missing";
  try {
    return new URL(url).hostname.split(".")[0] || "invalid";
  } catch {
    return "invalid";
  }
}

export const activeProjectRef = projectRef(supabaseUrl);

if (!supabaseUrl || !supabasePublishableKey) {
  throw new Error("Supabase 環境變數尚未設定");
}

if (activeProjectRef !== BETA_PROJECT_REF) {
  throw new Error(`Supabase environment mismatch: expected ${BETA_PROJECT_REF}, received ${activeProjectRef}.`);
}

export const supabase = createClient<Database>(supabaseUrl, supabasePublishableKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: "implicit",
  },
});

export async function googleSignInAvailable() {
  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/settings`, {
      headers: { apikey: supabasePublishableKey! },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return false;
    const settings = await response.json();
    return settings.external?.google === true;
  } catch { return false; }
}
