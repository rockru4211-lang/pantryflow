import type {Json} from './database.types';
export type SpotPending = {action: string; data: Record<string, Json | undefined>};
export type SpotRecovery = {
  draft: {id: string; revision: number; values: Record<string, string>; notes: Record<string, string>} | null;
  pending: SpotPending | null;
};
const strings = (value: unknown): value is Record<string, string> => !!value && typeof value === 'object' && !Array.isArray(value) && Object.values(value).every(v => typeof v === 'string');
export function validSpotRecovery(value: unknown): value is SpotRecovery {
  const v = value as SpotRecovery;
  return !!v && typeof v === 'object' &&
    (v.draft === null || !!v.draft && typeof v.draft.id === 'string' && Number.isInteger(v.draft.revision) && strings(v.draft.values) && strings(v.draft.notes)) &&
    (v.pending === null || !!v.pending && ['create','plan','add_items','save_entries','save_reasons','submit','finish','review','close','return'].includes(v.pending.action) && !!v.pending.data && typeof v.pending.data.id === 'string' && typeof v.pending.data.request_id === 'string');
}
