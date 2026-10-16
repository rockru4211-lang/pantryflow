import type {Json} from './database.types';
import type {ExpiryItem, RiskLocation} from './expiry-waste';
export type WasteOrigin = 'expiry' | 'waste' | 'risk' | 'erp';
export type WasteReceipt = {id: string; type: string; already_completed?: boolean; active?: boolean};
export type WastePending = {id: string; action: string; payload: Json; origin: WasteOrigin};
export type WasteDraft = {
  page: 'waste-new' | 'discard'; fields: Record<string, string>;
  item: ExpiryItem | null; risk: RiskLocation | null; riskWaste: boolean; openedAt: number;
};
export type WasteRecovery = {draft: WasteDraft | null; pending: WastePending | null; completed: {receipt: WasteReceipt; origin: WasteOrigin} | null};
const origins = ['expiry','waste','risk','erp'];
export function validWasteRecovery(value: unknown): value is WasteRecovery {
  const v = value as WasteRecovery;
  return !!v && typeof v === 'object' &&
    (v.draft === null || !!v.draft && ['waste-new','discard'].includes(v.draft.page) && !!v.draft.fields && typeof v.draft.fields === 'object' && !Array.isArray(v.draft.fields) && Object.values(v.draft.fields).every(x => typeof x === 'string') && typeof v.draft.openedAt === 'number' && typeof v.draft.riskWaste === 'boolean' && (v.draft.item === null || typeof v.draft.item?.id === 'string') && (v.draft.risk === null || typeof v.draft.risk?.id === 'string')) &&
    (v.pending === null || !!v.pending && typeof v.pending.id === 'string' && typeof v.pending.action === 'string' && !!v.pending.payload && typeof v.pending.payload === 'object' && !Array.isArray(v.pending.payload) && origins.includes(v.pending.origin)) &&
    (v.completed === null || !!v.completed && confirmedWasteReceipt(v.completed.receipt) && origins.includes(v.completed.origin));
}
export function confirmedWasteReceipt(value: unknown): value is WasteReceipt {
  const v = value as WasteReceipt;
  return !!v && typeof v.id === 'string' && !!v.id && typeof v.type === 'string' &&
    ['REMINDER','WASTE','USED','RISK_SAVE','RISK_CHECK','RISK_ISSUE','ERP_COMPLETE','RISK_EXPIRED','RISK_ACTIVE'].includes(v.type);
}
