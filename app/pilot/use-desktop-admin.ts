'use client';
import {useSyncExternalStore} from 'react';
// A wide touch screen is still a field device; rotation must not select the legacy desktop home.
const query='(min-width:900px) and (hover:hover) and (pointer:fine)';
function subscribe(change:()=>void){const media=window.matchMedia(query);media.addEventListener('change',change);return()=>media.removeEventListener('change',change);}
export function useDesktopAdmin(){return useSyncExternalStore(subscribe,()=>window.matchMedia(query).matches,()=>false);}
