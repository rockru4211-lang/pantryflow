"use client";
import {createContext,useContext,useLayoutEffect,useMemo,useRef,useState,type Dispatch,type SetStateAction,type ReactNode} from 'react';
// Only navigation/preferences live here. Operational data is always fetched in the current store scope.
const Memory=createContext<{scope:string;cache:Map<string,unknown>}|null>(null);
export function WorkspaceMemory({scope,children}:{scope:string;children:ReactNode}){const[cache]=useState(()=>new Map<string,unknown>());const value=useMemo(()=>({scope,cache}),[scope,cache]);return <Memory.Provider value={value}>{children}</Memory.Provider>;}
export function useUiState<T>(key:string,initial:T|(()=>T)):[T,Dispatch<SetStateAction<T>>]{
 const memory=useContext(Memory);const cache=memory?.cache;const scopedKey=`${memory?.scope}:${key}`;const[value,setValue]=useState<T>(()=>cache?.has(scopedKey)?cache.get(scopedKey) as T:typeof initial==='function'?(initial as ()=>T)():initial);
 const set:Dispatch<SetStateAction<T>>=next=>setValue(old=>{const value=typeof next==='function'?(next as (v:T)=>T)(old):next;cache?.set(scopedKey,value);return value;});
 return[value,set];
}
export function RememberPosition({name,children}:{name:string;children:ReactNode}){
 const memory=useContext(Memory);const cache=memory?.cache;const scope=memory?.scope;const ref=useRef<HTMLDivElement>(null);
 useLayoutEffect(()=>{const content=ref.current;const scroller=content?.closest('.shell-content');if(!content||!scroller)return;
  const key=`${scope}:scroll:${name}`;const target=Number(cache?.get(key)||0);let restored=false;
  const restore=()=>{if(restored)return;scroller.scrollTop=target;if(scroller.scrollHeight-scroller.clientHeight>=target){restored=true;observer.disconnect();}};
  const observer=new ResizeObserver(restore);observer.observe(content);restore();
  const save=()=>{if(restored)cache?.set(key,scroller.scrollTop);};scroller.addEventListener('scroll',save);
  return()=>{save();observer.disconnect();scroller.removeEventListener('scroll',save);};
 },[cache,name,scope]);
 return <div ref={ref}>{children}</div>;
}
