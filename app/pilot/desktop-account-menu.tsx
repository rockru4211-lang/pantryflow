'use client';

import {useEffect, useId, useRef, useState} from 'react';
import {KeyRound, LogOut, Smartphone, UserRound, X} from 'lucide-react';
import {releaseInfo} from '@/lib/release';
import ChangePasswordForm from './change-password-form';
import LoginDevices from './login-devices';
import './desktop-account-menu.css';

type Props = {
  displayName: string | null;
  storeName: string;
  demo: boolean;
  disabled: boolean;
  onChangePassword?: (current: string, next: string) => Promise<string | null>;
  onSignOut: () => Promise<void>;
};

type AccountPanel = 'password' | 'devices';

export default function DesktopAccountMenu({displayName, storeName, demo, disabled, onChangePassword, onSignOut}: Props) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<AccountPanel | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState(false);
  const panelTitle = panel === 'password' ? '變更密碼' : '登入裝置';

  useEffect(() => {
    if (!open) return;
    function dismiss(event: PointerEvent) {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open]);

  useEffect(() => {
    if (panel && dialog.current && !dialog.current.open) dialog.current.showModal();
  }, [panel]);

  function showPanel(next: AccountPanel) {
    setOpen(false);
    setPanel(next);
  }

  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);
    setSignOutError(false);
    try {
      await onSignOut();
    } catch {
      setSignOutError(true);
    } finally {
      setSigningOut(false);
    }
  }

  return <div className="desktop-account" ref={root} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }} onKeyDown={event => {
    if (event.key === 'Escape' && open) {
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
    }
  }}>
    <button type="button" className="desktop-account-trigger" ref={trigger} aria-label="我的帳號" aria-expanded={open} aria-controls={`${id}-menu`} disabled={disabled} onClick={() => setOpen(value => !value)}>
      <UserRound className="ui-icon" aria-hidden="true"/>
    </button>
    <section className="desktop-account-menu" id={`${id}-menu`} aria-label="帳號選單" hidden={!open}>
      <header>
        <span className="desktop-account-avatar"><UserRound aria-hidden="true"/></span>
        <div><strong>{displayName || '目前帳號'}</strong><small>{storeName}</small></div>
      </header>
      {onChangePassword && <button type="button" onClick={() => showPanel('password')}><KeyRound aria-hidden="true"/>變更密碼</button>}
      <button type="button" onClick={() => showPanel('devices')}><Smartphone aria-hidden="true"/>管理登入裝置</button>
      <button type="button" className="desktop-account-logout" disabled={signingOut} onClick={() => void signOut()}><LogOut aria-hidden="true"/>{signingOut ? '處理中…' : demo ? '離開體驗' : '登出此裝置'}</button>
      {signOutError && <p role="alert">登出未完成，請重試。</p>}
      <footer>系統版本 {releaseInfo.commitSha.slice(0, 7)}</footer>
    </section>
    {panel && <dialog className="desktop-account-dialog" ref={dialog} aria-labelledby={`${id}-title`} onClose={() => {
      setPanel(null);
      trigger.current?.focus();
    }}>
      <header><h2 id={`${id}-title`}>{panelTitle}</h2><button type="button" className="text-button" aria-label="關閉" onClick={() => dialog.current?.close()}><X size={20} aria-hidden="true"/></button></header>
      {panel === 'devices' ? <LoginDevices demo={demo}/> : onChangePassword && <ChangePasswordForm embedded onChangePassword={onChangePassword}/>}
    </dialog>}
  </div>;
}
