"use client";

import { useRef, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { canManageMembers, canManageStores, hasCrossStore, type AppStore } from '@/lib/app-workspace';
import { FormalAppShell } from './app-shell';
import CountWorkspace from './count-workspace';
import TransfersWorkspace from './transfers-workspace';
import ExpiryWasteWorkspace from './expiry-waste-workspace';
import ReceivingWorkspace from './receiving-workspace';
import BusinessSettings from './business-settings';
import MembersWorkspace from './members-workspace';
import ChangePasswordForm from './change-password-form';

type Props = {
  session: Pick<Session, 'user'>;
  profile: { display_name: string | null; role: string | null };
  stores: AppStore[];
  selectedStoreId: string;
  versionPanel: ReactNode;
  onStoreChange: (id: string) => Promise<void>;
  onChanged: () => Promise<void>;
  onSignOut: () => Promise<void>;
  onChangePassword?: (current: string, next: string) => Promise<string | null>;
  registerLeave?: (handler: (() => Promise<boolean>) | null) => void;
};

export default function XuInventoryWorkspace(props: Props) {
  const [view, setView] = useState<'count' | 'transfers' | 'waste' | 'receiving' | 'settings' | 'business' | 'members'>('count');
  const [busy, setBusy] = useState(false);
  const [countEntry, setCountEntry] = useState(0);
  const [message, setMessage] = useState('');
  const leaveCount = useRef<(() => Promise<boolean>) | null>(null);
  const navigationLock = useRef(false);
  const store = props.stores.find(item => item.id === props.selectedStoreId)!;
  const manager = store.role === 'OWNER' || store.role === 'SUPERVISOR';

  const active = store.is_active !== false;
  const canAccessLoans = store.role !== 'STAFF' && hasCrossStore(store);
  const backToCount = () => setView('count');

  async function navigate(action: () => void | Promise<void>) {
    if (navigationLock.current) return;
    navigationLock.current = true;
    try {
      if (leaveCount.current && !await leaveCount.current()) return;
      setBusy(true); setMessage('');
      await action();
    } catch {
      setMessage('切換未完成，請重試；目前門市仍保留。');
    } finally {
      navigationLock.current = false; setBusy(false);
    }
  }

  const account = <>
    <p>{props.profile.display_name || '目前帳號'} · {store.name}（{store.store_code}）</p>
    {props.onChangePassword && store.role !== 'STAFF' && props.session.user.email &&
      !props.session.user.email.endsWith('@auth.pantryflow.invalid') &&
      <ChangePasswordForm onChangePassword={props.onChangePassword}/>}
    {props.versionPanel}
  </>;

  return <FormalAppShell role={store.role} businessType="CHAIN_RESTAURANT"
    storeName={store.name} stores={props.stores} storeId={store.id}
    xuOperations view={view}
    onStoreChange={id => void navigate(async () => { await props.onStoreChange(id); setView('count'); })}
    onNavigate={next => void navigate(() => {
      if (next === 'count') setCountEntry(value => value + 1);
      if (next === 'count' || next === 'transfers' || next === 'waste' || next === 'receiving' || next === 'settings') setView(next);
    })}>
    {message && <p role="alert" className="pilot-message">{message}</p>}
    {busy && <p role="status">正在切換…</p>}
    {view === 'count' && active && <CountWorkspace key={`${store.id}:${countEntry}`}
      stores={[store]} organizationId={store.organization_id} session={props.session}
      inventoryOnly businessType="CHAIN_RESTAURANT" canManage={manager} canImport={manager}
      canViewFullDetails={store.role !== 'STAFF'} canOperateStock={false}
      returnLabel="返回盤點首頁" onBack={() => setCountEntry(value => value + 1)}
      registerLeave={handler => { leaveCount.current = handler; props.registerLeave?.(handler); }}/>} 
    {view === 'transfers' && active && (canAccessLoans
      ? <TransfersWorkspace key={store.id} store={store} userId={props.session.user.id} loansOnly
          initialPage="home" returnLabel="返回盤點" onBack={backToCount}/>
      : <p role="status">{store.role === 'STAFF' ? '門市借貸請洽店長辦理。' : '啟用第二間關聯門市後，即可使用門市借貸。'}</p>)}
    {view === 'waste' && active && <ExpiryWasteWorkspace key={store.id} storeId={store.id}
      initialPage={store.role === 'OWNER' || store.role === 'LOGISTICS' ? 'history' : 'waste'}
      returnLabel="返回盤點" onBack={backToCount}/>}
    {view === 'receiving' && active && <ReceivingWorkspace key={store.id} userId={props.session.user.id}
      storeId={store.id} organizationId={store.organization_id} role={store.role}
      businessType="CHAIN_RESTAURANT" initialPage="list" returnLabel="返回盤點" onBack={backToCount}/>}
    {['count','transfers','waste','receiving'].includes(view) && !active && <p role="status">此門市已停用，請切換其他門市，或由管理者在門市設定恢復。</p>}
    {view === 'settings' && <section className="shell-section">
      <div className="shell-section-head"><h1>設定</h1></div>
      <div className="shell-card shell-list">
        {canManageStores(store) && <button className="shell-list-row" onClick={() => setView('business')}><span>品牌與門市設定</span><b>›</b></button>}
        {canManageMembers(store) && <button className="shell-list-row" onClick={() => setView('members')}><span>人員與門市權限</span><b>›</b></button>}
      </div>
      {account}
      <button className="shell-secondary full" disabled={busy} onClick={() => void navigate(props.onSignOut)}>登出</button>
    </section>}
    {view === 'business' && canManageStores(store) && <BusinessSettings key={store.id}
      store={store} userId={props.session.user.id} section="business"
      stores={props.stores.filter(canManageStores)} onManageStore={props.onStoreChange}
      onBack={() => setView('settings')} onNavigate={() => setView('settings')} onChanged={props.onChanged}/>}
    {view === 'members' && canManageMembers(store) && <MembersWorkspace key={store.id}
      store={store} userId={props.session.user.id} section="members"
      onBack={() => setView('settings')} onChanged={props.onChanged}/>}
  </FormalAppShell>;
}
