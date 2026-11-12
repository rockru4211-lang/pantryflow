'use client';

import { useCallback, useState, type ReactNode } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { Popover } from 'radix-ui';
import { zhTW } from 'date-fns/locale';
import { Calendar } from '@/components/ui/calendar';
import { taipeiDate } from '@/lib/expiry-waste';
import { calendarDay, calendarDayKey, moveWorkMonth, validWorkDateRange, workMonthRange, type WorkDateRange } from '@/lib/work-date-selection';
import './work-date-picker.css';

type PickerProps = { label: string; disabled?: boolean; id?: string };
const dateText = (value: string) => value.replaceAll('-', '/');
const monthText = (value: string) => `${value.slice(0, 4)}年${Number(value.slice(5, 7))}月`;
const calendarFormat = {
  formatCaption: (date: Date) => monthText(calendarDayKey(date)),
  formatWeekdayName: (date: Date) => '日一二三四五六'[date.getDay()],
};

function PickerPopup({ id, label, disabled, open, onOpenChange, children, display, icon = false }: PickerProps & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  display: string;
  icon?: boolean;
}) {
  const [container, setContainer] = useState<HTMLDialogElement | null>(null);
  const anchor = useCallback((node: HTMLButtonElement | null) => setContainer(node?.closest('dialog') ?? null), []);
  return (
    <Popover.Root open={open && !disabled} onOpenChange={onOpenChange}>
      <Popover.Trigger ref={anchor} id={id} type="button" className="work-date-trigger"
        disabled={disabled} aria-label={`${label}，${display}`}>
        {icon && <CalendarDays size={15} aria-hidden="true" />}
        <span>{display}</span>
      </Popover.Trigger>
      <Popover.Portal container={container}>
        <Popover.Content aria-label={label} className="work-date-popup" align="start" sideOffset={5} collisionPadding={10}>
          {children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function WorkMonthPicker({ value, onChange, label, disabled, clearable = false, min = '0001-01', max = '9999-12' }: PickerProps & {
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  clearable?: boolean;
}) {
  const current = taipeiDate().slice(0, 7);
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(Number((value || current).slice(0, 4)));
  const previous = moveWorkMonth(value || current, -1);
  const next = moveWorkMonth(value || current, 1);
  const allowed = (month: string) => month >= min && month <= max;

  function select(month: string) {
    setOpen(false);
    if (month !== value && (allowed(month) || clearable && !month)) onChange(month);
  }

  return (
    <div className="work-date-month">
      <button type="button" aria-label="上一個月" disabled={disabled || !allowed(previous)} onClick={() => select(previous)}>
        <ChevronLeft size={16} aria-hidden="true" />
      </button>
      <PickerPopup label={label} disabled={disabled} display={value ? monthText(value) : clearable ? '全部月份' : '選擇月份'} open={open}
        onOpenChange={show => { if (show) setYear(Number((value || current).slice(0, 4))); setOpen(show); }}>
        <div className="work-date-month-heading">
          <button type="button" aria-label="上一年" disabled={year <= Number(min.slice(0, 4))} onClick={() => setYear(year - 1)}>
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
          <strong aria-live="polite">{year}年</strong>
          <button type="button" aria-label="下一年" disabled={year >= Number(max.slice(0, 4))} onClick={() => setYear(year + 1)}>
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>
        <div className="work-date-month-grid" role="group" aria-label={`${year}年月份`}>
          {Array.from({ length: 12 }, (_, i) => {
            const month = `${String(year).padStart(4, '0')}-${String(i + 1).padStart(2, '0')}`;
            return <button type="button" key={month} aria-pressed={month === value} disabled={!allowed(month)}
              onClick={() => select(month)}>{i + 1}月</button>;
          })}
        </div>
        <div className="work-date-footer">
          {clearable && value && <button type="button" onClick={() => select('')}>全部月份</button>}
          <button type="button" disabled={!allowed(current)} onClick={() => select(current)}>回本月</button>
        </div>
      </PickerPopup>
      <button type="button" aria-label="下一個月" disabled={disabled || !allowed(next)} onClick={() => select(next)}>
        <ChevronRight size={16} aria-hidden="true" />
      </button>
    </div>
  );
}

export function WorkDayPicker({ value, onChange, label, disabled, id, name, min, max, required = false, clearable = false }: PickerProps & {
  value: string;
  onChange: (value: string) => void;
  name?: string;
  required?: boolean;
  min?: string;
  max?: string;
  clearable?: boolean;
}) {
  const today = taipeiDate();
  const date = calendarDay(value);
  const todayDate = calendarDay(today)!;
  const minDate = min ? calendarDay(min) : undefined;
  const maxDate = max ? calendarDay(max) : undefined;
  const initial = date ?? (max && today > max ? maxDate : min && today < min ? minDate : todayDate) ?? todayDate;
  const [open, setOpen] = useState(false);
  function select(day: string) {
    setOpen(false);
    if (day !== value) onChange(day);
  }
  return (
    <div className="work-date-day">
      {name && <input type="hidden" name={name} value={value} disabled={disabled} />}
      <PickerPopup id={id} label={label} disabled={disabled} display={date ? dateText(value) : '選擇日期'} icon open={open} onOpenChange={setOpen}>
        <Calendar mode="single" required locale={zhTW} showOutsideDays={false} formatters={calendarFormat}
          today={todayDate} selected={date} defaultMonth={initial} startMonth={minDate} endMonth={maxDate}
          disabled={[...(minDate ? [{ before: minDate }] : []), ...(maxDate ? [{ after: maxDate }] : [])]}
          onSelect={day => select(calendarDayKey(day))} />
        <div className="work-date-footer">
          {clearable && value && <button type="button" onClick={() => select('')}>清除</button>}
          <button type="button" disabled={Boolean(min && today < min || max && today > max)} onClick={() => select(today)}>今天</button>
        </div>
      </PickerPopup>
      {required && <input className="work-date-validation" type="text" tabIndex={-1} aria-hidden="true" required
        disabled={disabled} value={date && (!min || value >= min) && (!max || value <= max) ? value : ''}
        onChange={() => {}} onInvalid={event => {
          event.preventDefault();
          event.currentTarget.parentElement?.querySelector('button')?.focus();
          setOpen(true);
        }}/>}
    </div>
  );
}

export function WorkDateRangePicker({ value, onChange, label, disabled }: PickerProps & {
  value: WorkDateRange;
  onChange: (value: WorkDateRange) => void;
}) {
  const current = taipeiDate().slice(0, 7);
  const thisMonth = workMonthRange(current);
  const lastMonth = workMonthRange(moveWorkMonth(current, -1));
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [month, setMonth] = useState(() => calendarDay(value.from) ?? calendarDay(thisMonth.from)!);
  const from = calendarDay(draft.from);
  const to = calendarDay(draft.to);
  const same = (a: WorkDateRange, b: WorkDateRange) => a.from === b.from && a.to === b.to;
  const period = same(draft, thisMonth) ? 'this' : same(draft, lastMonth) ? 'last' : 'custom';
  const valid = validWorkDateRange(draft);
  const display = value.from && value.to
    ? value.from === value.to ? dateText(value.from) : `${dateText(value.from)} – ${dateText(value.to)}`
    : '選擇日期區間';

  function choose(range: WorkDateRange) {
    setDraft(range);
    setMonth(calendarDay(range.from) ?? month);
  }

  return (
    <div className="work-date-range">
      <PickerPopup label={label} disabled={disabled} display={display} icon open={open} onOpenChange={show => {
        if (show) { setDraft(value); setMonth(calendarDay(value.from) ?? calendarDay(thisMonth.from)!); }
        setOpen(show);
      }}>
        <div className="work-date-presets">
          <button type="button" aria-pressed={period === 'this'} onClick={() => choose(thisMonth)}>本月</button>
          <button type="button" aria-pressed={period === 'last'} onClick={() => choose(lastMonth)}>上月</button>
          <button type="button" aria-pressed={period === 'custom'} onClick={() => choose({ from: '', to: '' })}>自訂</button>
        </div>
        <div className="work-date-endpoints">
          {([['from', '開始日期'], ['to', '結束日期']] as const).map(([key, title]) => (
            <label key={key}>{title}
              <input type="text" placeholder="YYYY/MM/DD" value={dateText(draft[key])}
                onChange={event => {
                  const day = event.target.value.replaceAll('/', '-');
                  setDraft({ ...draft, [key]: day });
                  const date = calendarDay(day);
                  if (date) setMonth(date);
                }} />
            </label>
          ))}
        </div>
        <Calendar mode="range" required resetOnSelect locale={zhTW} showOutsideDays={false} formatters={calendarFormat}
          today={calendarDay(taipeiDate())} month={month} onMonthChange={setMonth}
          selected={from && (!to || to >= from) ? { from, to } : undefined}
          onSelect={range => setDraft({ from: range.from ? calendarDayKey(range.from) : '', to: range.to ? calendarDayKey(range.to) : '' })} />
        <div className="work-date-footer">
          <button type="button" className="work-date-apply" disabled={!valid} onClick={() => {
            setOpen(false);
            if (!same(draft, value)) onChange(draft);
          }}>套用</button>
        </div>
      </PickerPopup>
    </div>
  );
}
