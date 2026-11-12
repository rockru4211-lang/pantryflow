import { addDays, addMonths, endOfMonth, format, isValid, parseISO } from 'date-fns';

export type WorkDateRange = { from: string; to: string };

export function calendarDay(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = parseISO(value);
  return isValid(date) && date.getFullYear() > 0 ? date : undefined;
}

export const calendarDayKey = (date: Date) => format(date, 'yyyy-MM-dd');

export function moveWorkMonth(month: string, offset: number) {
  const date = calendarDay(month + '-01');
  return date ? format(addMonths(date, offset), 'yyyy-MM') : '';
}

export function workMonthRange(month: string): WorkDateRange {
  const from = month + '-01';
  const date = calendarDay(from);
  return date ? { from, to: calendarDayKey(endOfMonth(date)) } : { from: '', to: '' };
}

export function splitWorkDateRange(range: WorkDateRange, maxDaysBetween: number): WorkDateRange[] {
  if (!validWorkDateRange(range)) return [];
  const end = calendarDay(range.to)!;
  const chunks: WorkDateRange[] = [];
  for (let start = calendarDay(range.from)!; start <= end;) {
    const limit = addDays(start, maxDaysBetween);
    const to = limit < end ? limit : end;
    chunks.push({ from: calendarDayKey(start), to: calendarDayKey(to) });
    start = addDays(to, 1);
  }
  return chunks;
}

export function validWorkDateRange({ from, to }: WorkDateRange) {
  return Boolean(calendarDay(from) && calendarDay(to) && from <= to);
}
