'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase-browser';
import { receiptRead } from '@/lib/receipt-read';

export type OnboardingGrant = { saved: boolean; enabled: boolean };

export default function PersonOnboardingPermissions({ userId, disabled, grant, onChange }: {
  userId: string;
  disabled: boolean;
  grant: OnboardingGrant | undefined;
  onChange: (grant: OnboardingGrant) => void;
}) {
  const [status, setStatus] = useState<'loading' | 'unavailable' | 'failed' | 'ready'>('loading');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void receiptRead(signal => supabase.rpc('get_beape_onboarding_grant', { p_user_id: userId })
      .abortSignal(signal), controller.signal).then(({ data, error }) => {
        if (controller.signal.aborted) return;
        if (error) throw error;
        if (typeof data === 'boolean') {
          onChange({ saved: data, enabled: data });
          setStatus('ready');
        } else setStatus('unavailable');
      }).catch(() => {
        if (!controller.signal.aborted) setStatus('failed');
      });
    return () => controller.abort();
  }, [userId, attempt, onChange]);

  return <fieldset className="people-access onboarding-permissions" disabled={disabled}>
    <label className="function-option">
      <input type="checkbox" checked={grant?.enabled ?? false} disabled={status !== 'ready'}
        onChange={event => { if (grant) onChange({ ...grant, enabled: event.target.checked }); }} />
      <span><strong>新人報到權限</strong><small>可進入新人報到系統，開單時選擇報到門店。</small></span>
    </label>
    {status === 'loading' && <p className="people-help" role="status">正在讀取新人報到權限…</p>}
    {status === 'unavailable' && <p className="people-help">目前帳號無法替此人編輯新人報到權限。</p>}
    {status === 'failed' && <>
      <p className="people-help" role="alert">權限讀取失敗。</p>
      <button className="people-edit" type="button" onClick={() => { setStatus('loading'); setAttempt(value => value + 1); }}>重新讀取</button>
    </>}
  </fieldset>;
}
