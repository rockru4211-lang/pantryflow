import {matchesProjectUrl} from "../lib/xu-project-url.mjs";

// Fail before packaging a client that would otherwise render a blank sign-in page.
// Diagnostics identify missing settings without logging any key values.
export function assertClientEnvironment(env, expectedProject) {
  for (const key of ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY']) {
    if (!env[key]?.trim()) throw new Error(`缺少前端設定 ${key}，無法建置可登入的 App。`);
  }
  if (!matchesProjectUrl(env.NEXT_PUBLIC_SUPABASE_URL, expectedProject)) throw new Error('Supabase 前端設定未對應指定專案，停止建置。');
  if (/placeholder/i.test(env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) && env.NEXT_PUBLIC_APP_ENV !== 'ci') {
    throw new Error('正式建置不能使用 CI 的 Supabase 佔位設定。');
  }
}
