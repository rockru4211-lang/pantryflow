'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase-browser';
import { operationDeadline } from '@/lib/operation-deadline';

type Permission = {
  store_id: string;
  name: string;
  can_open: boolean;
  can_receive: boolean;
};

export default function PersonOnboardingPermissions({ userId, disabled, onBusyChange }: {
  userId: string;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
}) {
  const [saved, setSaved] = useState<Permission[]>();
  const [draft, setDraft] = useState<Permission[]>([]);
  const [status, setStatus] = useState('');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void supabase.rpc('get_beape_onboarding_permissions', { p_user_id: userId })
      .abortSignal(controller.signal).then(({ data, error }) => {
        if (controller.signal.aborted || error) return;
        const rows = (data ?? []) as unknown as Permission[];
        setSaved(rows);
        setDraft(rows);
      });
    return () => controller.abort();
  }, [userId]);

  if (!saved?.length) return null;

  const changes = draft.flatMap((row, index) => {
    const previous = saved[index];
    if (row.can_open === previous.can_open && row.can_receive === previous.can_receive) return [];
    return [{ store_id: row.store_id, can_open: row.can_open, can_receive: row.can_receive,
      previous_open: previous.can_open, previous_receive: previous.can_receive }];
  });

  async function save() {
    onBusyChange(true);
    setStatus('');
    setFailed(false);
    try {
      const { data, error } = await operationDeadline(signal => supabase.rpc('save_beape_onboarding_permissions',
        { p_user_id: userId, p_changes: changes }).abortSignal(signal));
      if (error) throw error;
      const rows = data as unknown as Permission[];
      setSaved(rows);
      setDraft(rows);
      setStatus('新人報到權限已儲存。');
    } catch {
      setFailed(true);
      setStatus('權限未能儲存。請重新開啟人員設定，核對後再試。');
    } finally {
      onBusyChange(false);
    }
  }

  return <fieldset className="people-access" disabled={disabled}>
    <legend>新人報到權限</legend>
    <div className="people-data-table">
      <div className="people-data-row onboarding-permission-row">
        <strong>授權門市</strong><span>新人報到開單</span><span>人資收件</span>
      </div>
      {draft.map((row, index) => <div className="people-data-row onboarding-permission-row" key={row.store_id}>
        <strong>{row.name}</strong>
        {(['can_open', 'can_receive'] as const).map(key => <input key={key} type="checkbox"
          aria-label={row.name + (key === 'can_open' ? ' 新人報到開單' : ' 人資收件')}
          checked={row[key]} onChange={event => {
            const checked = event.target.checked;
            setDraft(current => current.map((value, i) => i === index ? { ...value, [key]: checked } : value));
            setStatus('');
          }} />)}
      </div>)}
    </div>
    {status && <p className="people-help" role={failed ? 'alert' : 'status'}>{status}</p>}
    <button className="people-edit" type="button" disabled={!changes.length} onClick={() => void save()}>儲存權限</button>
  </fieldset>;
}
