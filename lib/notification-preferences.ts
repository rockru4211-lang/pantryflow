export type NotificationPreferences={bulletins:boolean;completed:boolean};
export const defaultNotificationPreferences:NotificationPreferences={bulletins:true,completed:true};
export const notificationPreferenceKey=(userId:string,storeId:string)=>`beape:notifications:${userId}:${storeId}`;
export function parseNotificationPreferences(value:string|null):NotificationPreferences{
 try{const parsed=JSON.parse(value||'null');return {bulletins:parsed?.bulletins!==false,completed:parsed?.completed!==false};}catch{return {...defaultNotificationPreferences};}
}
export function showNotification(row:{category:string;pending:boolean},prefs:NotificationPreferences){
 // Pending operational alerts always remain visible, regardless of preferences.
 return row.category==='bulletin'?prefs.bulletins:row.pending||prefs.completed;
}
