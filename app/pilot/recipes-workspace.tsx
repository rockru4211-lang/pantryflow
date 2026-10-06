'use client';
import {useCallback,useRef,useState} from 'react';
import {Download,ArrowRightLeft} from 'lucide-react';
import {canExportData,type AppStore} from '@/lib/app-workspace';
import RecipeWorkspaceCore from './recipe-workspace-core';
import RecipeTools from './recipe-tools';
import './recipe-tools.css';
type Leave=(handler:(()=>Promise<boolean>)|null)=>void;
type Props={store:AppStore;userId:string;onBack:()=>void;onPrices?:()=>void;onFormula?:()=>void;registerLeave?:Leave};
export default function RecipesWorkspace(props:Props){
 const saver=useRef<(()=>Promise<boolean>)|null>(null),[generation,setGeneration]=useState(0),[mode,setMode]=useState<'export'|'transfer'|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const register=useCallback<Leave>(handler=>{saver.current=handler;},[]);
 async function open(next:'export'|'transfer'){
  if(busy)return;setBusy(true);setError('');
  try{if(!saver.current||!await saver.current()){setError('請先完成目前食譜與價格的儲存，再開啟此功能。');return;}setMode(next);}catch{setError('尚未確認儲存成功，請先核對頁面的提示。');}finally{setBusy(false);}
 }
 function moved(){
  // The fresh saved workspace confirms moved IDs and archives their device drafts.
  setError('');setGeneration(n=>n+1);setMode(null);
 }
 const admin=['OWNER','LOGISTICS'].includes(props.store.role)&&props.store.access_mode!=='VIEW';
 return <div className="recipe-workspace recipe-tools-workspace">{error&&<p role="alert" className="recipe-alert">{error}</p>}<RecipeWorkspaceCore key={`${props.store.id}:${generation}`} {...props} registerPrepareTools={register} toolsActions={<>{canExportData(props.store)&&props.store.role!=='STAFF'&&<button className="recipe-secondary" disabled={busy} onClick={()=>void open('export')}><Download size={16}/>匯出食譜</button>}{admin&&<button className="recipe-secondary" disabled={busy} onClick={()=>void open('transfer')}><ArrowRightLeft size={16}/>更換門市</button>}</>}/>{mode&&<RecipeTools mode={mode} store={props.store} userId={props.userId} onClose={()=>setMode(null)} onMoved={moved}/>}</div>;
}
