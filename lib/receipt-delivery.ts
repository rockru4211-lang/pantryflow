export type DeliveryIssue = {
  id: string;
  name: string;
  reason: '未收到' | '少收貨' | '多收貨' | '效期太短' | '其他';
  quantity: number | null;
  unit: string;
  note: string;
  status: 'OPEN' | 'COMPLETE';
};
export type ReceiptDelivery = {
  arrived_on: string | null;
  arrived_time: string | null;
  revision: number;
  issues: DeliveryIssue[];
};
export const emptyDelivery = (): ReceiptDelivery => ({arrived_on:null, arrived_time:null, revision:0, issues:[]});
export const pendingDeliveryIssues = (delivery?: ReceiptDelivery) => delivery?.issues.filter(i=>i.status==='OPEN').length || 0;
export const arrivalLabel = (delivery?: ReceiptDelivery) => delivery?.arrived_on ? `到貨 ${delivery.arrived_on}${delivery.arrived_time ? ` ${delivery.arrived_time.slice(0,5)}` : ''}` : '到貨日期未填';
