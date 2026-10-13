'use client';
import {directoryState,lifecycleLabels,lifecycleOperations,type LifecycleOperation} from '@/lib/directory-lifecycle';
export function DirectoryLifecycleMenu({row,disabled,canDelete,onAction}:{row:{name:string;is_removed?:boolean;is_active?:boolean;archived?:boolean};disabled:boolean;canDelete:boolean;onAction:(action:LifecycleOperation)=>void}){
 return <details className="directory-lifecycle-menu"><summary aria-label={`${row.name}更多操作`}>⋯</summary><div>{lifecycleOperations(directoryState(row),canDelete).map(action=><button key={action} type="button" disabled={disabled} className={action==='delete'?'directory-delete':''} onClick={e=>{e.currentTarget.closest('details')?.removeAttribute('open');onAction(action);}}>{lifecycleLabels[action]}</button>)}</div></details>;
}
