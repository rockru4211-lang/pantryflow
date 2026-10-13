export type DirectoryState='使用中'|'已停用'|'已移除';
export type LifecycleOperation='deactivate'|'activate'|'remove'|'restore'|'delete';
export function directoryState(row:{is_removed?:boolean;is_active?:boolean;archived?:boolean}):DirectoryState{return row.is_removed?'已移除':row.archived||row.is_active===false?'已停用':'使用中';}
export const lifecycleLabels:Record<LifecycleOperation,string>={deactivate:'停用',activate:'恢復使用',remove:'移除',restore:'還原至已停用',delete:'永久刪除'};
export function lifecycleOperations(state:DirectoryState,canDelete=false):LifecycleOperation[]{return state==='使用中'?['deactivate','remove']:state==='已停用'?['activate','remove']:canDelete?['restore','delete']:['restore'];}
export function lifecycleConfirmation(name:string,operation:LifecycleOperation,shared=false){return `${lifecycleLabels[operation]}「${name}」？${shared?'此供應商為兩店共用，狀態會同步影響兩店。':''}${operation==='delete'?'永久刪除無法復原；已有關聯紀錄的資料會保留。':operation==='restore'?'還原後先放在「已停用」，可再恢復使用。':'歷史紀錄會保留。'}`;}
