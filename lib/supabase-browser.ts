import { observedFetch } from "@/lib/operation-trace";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { readAuthCallback } from "@/lib/auth-flow";
import { demoClient, isDemoPath } from '@/lib/demo-client.mjs';

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

function createProductionClient() { return createClient<Database>(supabaseUrl!, supabasePublishableKey!, {
  global: { fetch: observedFetch(fetch, supabaseUrl!, supabasePublishableKey!) },
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: "implicit",
  },
}); }

// Select once, on first use. /demo never initializes Auth, refreshes a real
// session or registers production telemetry. Leaving demo uses a full navigation.
let client: ReturnType<typeof createProductionClient> | undefined;
export const supabase = new Proxy({} as ReturnType<typeof createProductionClient>, {
  get(_target, key) {
    client ||= typeof window !== 'undefined' && isDemoPath(window.location.pathname)
      ? demoClient as unknown as ReturnType<typeof createProductionClient>
      : createProductionClient();
    const value = Reflect.get(client, key);
    return typeof value === 'function' ? value.bind(client) : value;
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
