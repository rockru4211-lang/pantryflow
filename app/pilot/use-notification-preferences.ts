'use client';
import {useEffect,useState} from 'react';
import {defaultNotificationPreferences,notificationPreferenceKey,parseNotificationPreferences,type NotificationPreferences} from '@/lib/notification-preferences';
export function useNotificationPreferences(userId:string,storeId:string){
 const key=notificationPreferenceKey(userId,storeId);
 const [snapshot,setSnapshot]=useState<{key:string;value:NotificationPreferences}>();
 const [error,setError]=useState('');
 useEffect(()=>{const read=()=>{try{setSnapshot({key,value:parseNotificationPreferences(localStorage.getItem(key))});}catch{setError('此瀏覽器無法儲存通知偏好，請檢查隱私設定。');}};read();window.addEventListener('storage',read);window.addEventListener('beape-notification-preferences',read);return()=>{window.removeEventListener('storage',read);window.removeEventListener('beape-notification-preferences',read);};},[key]);
 const value=snapshot?.key===key?snapshot.value:defaultNotificationPreferences;
 const save=(next:NotificationPreferences)=>{try{localStorage.setItem(key,JSON.stringify(next));setSnapshot({key,value:next});setError('');window.dispatchEvent(new Event('beape-notification-preferences'));}catch{setError('儲存失敗，通知設定未變更。');}};
 return {value,save,error,ready:snapshot?.key===key};
}
