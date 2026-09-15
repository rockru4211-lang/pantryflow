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
export const pendingReceiptErp = (batch: {erp_required?: boolean; erp_completed_at?: string | null; job_status?: string | null}) => !!batch.erp_required && !!batch.job_status && !batch.erp_completed_at;
export const groupReceiptSuppliers = <T extends {supplier?: string;batch_number:string}>(batches:T[]) => {
  const groups=new Map<string,T[]>();
  for(const batch of batches){const supplier=batch.supplier&&batch.supplier!==batch.batch_number?batch.supplier:'未填供應商';groups.set(supplier,[...(groups.get(supplier)||[]),batch]);}
  return [...groups].map(([supplier,receipts])=>({supplier,receipts}));
};
