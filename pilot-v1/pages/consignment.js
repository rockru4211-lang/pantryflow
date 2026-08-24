import{backButton,emptyState}from'../components/layout.js';
export function consignmentPage(){return `${backButton()}<h2 class="page-title">寄庫</h2>${emptyState('尚無正式寄庫資料','寄庫資料只讀 Supabase，且不會混入店內實體盤點庫存。')}`}
