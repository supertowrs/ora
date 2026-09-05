import { dayBounds, localDate, parseDateTimeLocal } from './time';

export const MAX_SLOTS_PER_DAY = 6;
export const MAX_EXCLUSIONS = 31;

export interface ScheduleSlot {
  id: string;
  weekday: number;
  startTime: string;
  endTime: string;
  endNextDay: boolean;
  storeId: string;
}

export interface ScheduleConfig {
  enabled: boolean;
  startDate: string;
  endDate: string | null;
  slots: ScheduleSlot[];
  exclusions: { startDate: string; endDate: string }[];
}

export interface ScheduledSlot {
  slot: ScheduleSlot;
  date: string;
  startAt: number;
  endAt: number;
  invalidTime: boolean;
}

export function addScheduleDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function validScheduleDate(date: string) {
  if (
    !/^(19|[2-9]\d)\d{2}-\d{2}-\d{2}$/.test(date) ||
    date > '9998-12-31' ||
    !Number.isFinite(Date.parse(date)) ||
    new Date(date).toISOString().slice(0, 10) !== date
  )
    throw new Error('Introduce una fecha válida.');
}

function minutes(time: string): number {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))
    throw new Error('Introduce horas válidas con formato HH:mm.');
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

/** Validates the whole circular week, including a Sunday shift ending on Monday. */
export function validateSchedule(config: ScheduleConfig): void {
  validScheduleDate(config.startDate);
  if (config.endDate !== null) {
    validScheduleDate(config.endDate);
    if (config.endDate < config.startDate)
      throw new Error('El final debe ser posterior al inicio.');
  }
  if (config.slots.length > MAX_SLOTS_PER_DAY * 7)
    throw new Error('Puedes configurar hasta seis tramos por día.');
  if (config.enabled && config.slots.length === 0)
    throw new Error('Añade al menos un tramo antes de activar el horario.');
  const ids = new Set<string>();
  const counts = new Map<number, number>();
  const intervals = config.slots.map((slot) => {
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(slot.id) || ids.has(slot.id))
      throw new Error('Los identificadores de los tramos deben ser únicos.');
    ids.add(slot.id);
    if (!Number.isInteger(slot.weekday) || slot.weekday < 1 || slot.weekday > 7)
      throw new Error('El día de la semana no es válido.');
    counts.set(slot.weekday, (counts.get(slot.weekday) ?? 0) + 1);
    if (counts.get(slot.weekday)! > MAX_SLOTS_PER_DAY)
      throw new Error('Puedes configurar hasta seis tramos por día.');
    const start = minutes(slot.startTime);
    const end = minutes(slot.endTime) + (slot.endNextDay ? 1440 : 0);
    if (end <= start || end - start > 1440)
      throw new Error('La salida debe seguir a la entrada y el tramo no puede superar 24 horas.');
    return { start: (slot.weekday - 1) * 1440 + start, end: (slot.weekday - 1) * 1440 + end };
  });
  for (let i = 0; i < intervals.length; i++) {
    for (let j = i + 1; j < intervals.length; j++) {
      if (
        [-10080, 0, 10080].some(
          (offset) =>
            intervals[i].start < intervals[j].end + offset &&
            intervals[i].end > intervals[j].start + offset,
        )
      )
        throw new Error('Hay tramos que se solapan, incluso entre días o tiendas diferentes.');
    }
  }
  if (config.exclusions.length > MAX_EXCLUSIONS)
    throw new Error('Puedes configurar hasta 31 intervalos sin fichajes.');
  const exclusions = [...config.exclusions].sort((a, b) => a.startDate.localeCompare(b.startDate));
  for (let i = 0; i < exclusions.length; i++) {
    const exclusion = exclusions[i];
    validScheduleDate(exclusion.startDate);
    validScheduleDate(exclusion.endDate);
    if (exclusion.endDate < exclusion.startDate)
      throw new Error('Revisa las fechas de los días excluidos.');
    if (i > 0 && exclusions[i - 1].endDate >= exclusion.startDate)
      throw new Error('Los intervalos sin fichajes no pueden solaparse.');
  }
}

function excluded(config: ScheduleConfig, date: string) {
  return config.exclusions.find((range) => range.startDate <= date && range.endDate >= date);
}

/**
 * First occurrence of repeated autumn times. A nonexistent spring time marks the
 * whole shift for review; the fallback only schedules that review, never a punch.
 */
function wallTime(date: string, time: string): { at: number; invalid: boolean } {
  try {
    return { at: parseDateTimeLocal(`${date}T${time}`, 'earlier'), invalid: false };
  } catch {
    return { at: dayBounds(date).startAt + minutes(time) * 60_000, invalid: true };
  }
}

/** Find the next start strictly after the cursor; exclusions are jumped as ranges. */
export function nextScheduledSlot(config: ScheduleConfig, afterAt: number): ScheduledSlot | null {
  if (!config.enabled || config.slots.length === 0) return null;
  let date = localDate(afterAt);
  if (date < config.startDate) date = config.startDate;
  // At most seven dates to the next weekly slot after each of the 31 exclusions.
  for (let attempt = 0; attempt < 8 * (MAX_EXCLUSIONS + 2); attempt++) {
    if (date > (config.endDate ?? '9998-12-31')) return null;
    const exclusion = excluded(config, date);
    if (exclusion) {
      date = addScheduleDays(exclusion.endDate, 1);
      continue;
    }
    const weekday = ((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
    const candidates: ScheduledSlot[] = [];
    for (const slot of config.slots) {
      if (slot.weekday !== weekday) continue;
      const endDate = slot.endNextDay ? addScheduleDays(date, 1) : date;
      if (endDate !== date && slot.endTime !== '00:00' && excluded(config, endDate)) continue;
      const start = wallTime(date, slot.startTime);
      const end = wallTime(endDate, slot.endTime);
      // A review marker must never hide a real start at the same instant.
      const startAt = start.at + (start.invalid ? 1 : 0);
      if (startAt <= afterAt) continue;
      candidates.push({
        slot,
        date,
        startAt,
        endAt: Math.max(startAt + 60_000, end.at),
        invalidTime: start.invalid || end.invalid || end.at <= start.at,
      });
    }
    candidates.sort((a, b) => a.startAt - b.startAt || a.slot.id.localeCompare(b.slot.id));
    if (candidates[0]) return candidates[0];
    date = addScheduleDays(date, 1);
  }
  throw new Error('No se ha podido calcular el siguiente tramo. Revisa el horario.');
}
