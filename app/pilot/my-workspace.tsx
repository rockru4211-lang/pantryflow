'use client';

import {ChartNoAxesCombined, ChevronRight, FileText, UserRoundCog} from 'lucide-react';
import {canExportData, canManageMembers, canManageStores, canViewReports, type AppStore} from '@/lib/app-workspace';
import type {ShellView} from './app-shell';

type Props = {
  store: AppStore;
  canChangePassword: boolean;
  demo: boolean;
  onNavigate: (view: ShellView) => void;
  onCountSettings: () => void;
  onSignOut: () => void;
};

export default function MyWorkspace({store, canChangePassword, demo, onNavigate, onCountSettings, onSignOut}: Props) {
  const countDescription = store.role === 'OWNER' || store.role === 'SUPERVISOR'
    ? '匯入品項、設定儲物區域'
    : store.business_type === 'SINGLE_RESTAURANT' ? '匯入品項、查看盤點資料' : '查看盤點品項與資料';
  const management = [
    {id: 'business', label: '門市設定', description: '店名與作業方式', visible: canManageStores(store), onClick: () => onNavigate('business')},
    {id: 'count', label: '盤點設定與資料', description: countDescription, visible: store.role !== 'STAFF', onClick: onCountSettings},
    {id: 'members', label: '員工與權限', description: '新增成員、分配門市', visible: canManageMembers(store), onClick: () => onNavigate('members')},
  ].filter(item => item.visible);
  const operations = [
    {id: 'reports' as const, label: '報表中心', icon: ChartNoAxesCombined, visible: canViewReports(store)},
    {id: 'exports' as const, label: '資料匯出', icon: FileText, visible: canExportData(store)},
  ].filter(item => item.visible);

  return <div className="my-page">
    <h1>我的</h1>
    {management.length > 0 && <section className="my-section" aria-labelledby="my-management-title">
      <header className="my-section-head">
        <h2 id="my-management-title">門市管理</h2>
        {management.length > 1 && <span>建議設定順序</span>}
      </header>
      <div className="shell-card">
        {management.map((item, index) => <button type="button" className={`my-menu-row my-management-row${index === 0 ? ' my-first-row' : ''}`} key={item.id} onClick={item.onClick}>
          <span className="my-step" aria-hidden="true">{index + 1}</span>
          <span className="my-menu-copy"><strong>{item.label}</strong><small>{item.description}</small></span>
          <ChevronRight className="my-chevron" aria-hidden="true"/>
        </button>)}
      </div>
    </section>}

    {operations.length > 0 && <section className="my-section" aria-labelledby="my-operations-title">
      <header className="my-section-head"><h2 id="my-operations-title">營運資料</h2></header>
      <div className="shell-card">
        {operations.map(item => <button type="button" className="my-menu-row" key={item.id} onClick={() => onNavigate(item.id)}>
          <item.icon className="my-menu-icon" aria-hidden="true"/>
          <span className="my-menu-copy"><strong>{item.label}</strong></span>
          <ChevronRight className="my-chevron" aria-hidden="true"/>
        </button>)}
      </div>
    </section>}

    <section className="my-section" aria-labelledby="my-account-title">
      <header className="my-section-head"><h2 id="my-account-title">帳號設定</h2></header>
      <div className="shell-card">
        <button type="button" className="my-menu-row my-account-row" onClick={() => onNavigate('preferences')}>
          <UserRoundCog className="my-menu-icon" aria-hidden="true"/>
          <span className="my-menu-copy"><strong>個人設定</strong><small>{canChangePassword ? '偏好設定與變更密碼' : '登入與裝置設定'}</small></span>
          <ChevronRight className="my-chevron" aria-hidden="true"/>
        </button>
      </div>
    </section>
    <button type="button" className="my-sign-out" onClick={onSignOut}>{demo ? '離開體驗' : '登出'}</button>
  </div>;
}
