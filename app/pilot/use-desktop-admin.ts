'use client';
import {useSyncExternalStore} from 'react';
const query='(min-width:900px)';
function subscribe(change:()=>void){const media=window.matchMedia(query);media.addEventListener('change',change);return()=>media.removeEventListener('change',change);}
export function useDesktopAdmin(){return useSyncExternalStore(subscribe,()=>window.matchMedia(query).matches,()=>false);}
