import { useState } from 'react';
import { useMutation } from 'convex/react';
import { Copy, Plus, Trash2 } from 'lucide-react';
import { api } from '../../convex/_generated/api';
import type { Doc, Id } from '../../convex/_generated/dataModel';
import { MAX_EXCLUSIONS, MAX_SLOTS_PER_DAY } from '../../shared/schedules';
import { localDate } from '../../shared/time';
import type { Employee, Store } from '../types';
import { Field, Form, Modal, Notice } from './ui';

const weekdays = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

type Slot = Omit<Doc<'schedules'>['slots'][number], 'storeId'> & {
  storeId: Id<'stores'> | '';
};
type Exclusion = { id: string; startDate: string; endDate: string };

function timeMinutes(value: string) {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

export function ScheduleForm({
  employee,
  schedule,
  stores,
  onClose,
  onSaved,
}: {
  employee: Employee;
  schedule: Doc<'schedules'> | null;
  stores: Store[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const save = useMutation(api.schedules.save);
  const [expectedRevision] = useState(schedule?.revision);
  const [enabled, setEnabled] = useState(schedule?.enabled ?? false);
  const [startDate, setStartDate] = useState(schedule?.startDate ?? localDate(Date.now()));
  const [endDate, setEndDate] = useState(schedule?.endDate ?? '');
  const [slots, setSlots] = useState<Slot[]>(schedule?.slots ?? []);
  const [exclusions, setExclusions] = useState<Exclusion[]>(() =>
    (schedule?.exclusions ?? []).map((item) => ({ ...item, id: crypto.randomUUID() })),
  );
  const [saving, setSaving] = useState(false);
  const [copyMessage, setCopyMessage] = useState('');
  const stale = expectedRevision !== schedule?.revision;
  const activeStores = stores.filter((store) => store.active);
  const durations = slots.map(
    (slot) =>
      timeMinutes(slot.endTime) + (slot.endNextDay ? 1440 : 0) - timeMinutes(slot.startTime),
  );
  const weeklyMinutes = durations.every((duration) => duration > 0 && duration <= 1440)
    ? durations.reduce((total, duration) => total + duration, 0)
    : null;

  function updateSlot(id: string, patch: Partial<Omit<Slot, 'id' | 'weekday'>>) {
    setSlots((current) => current.map((slot) => (slot.id === id ? { ...slot, ...patch } : slot)));
  }

  function addSlot(weekday: number) {
    setSlots((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        weekday,
        startTime: '',
        endTime: '',
        endNextDay: false,
        storeId: activeStores[0]?._id ?? '',
      },
    ]);
  }

  function copyMonday() {
    setSlots((current) => {
      const monday = current.filter((slot) => slot.weekday === 1);
      return [
        ...current.filter((slot) => slot.weekday === 1 || slot.weekday >= 6),
        ...[2, 3, 4, 5].flatMap((weekday) =>
          monday.map((slot) => ({ ...slot, weekday, id: crypto.randomUUID() })),
        ),
      ];
    });
    setCopyMessage(
      'Los tramos del lunes se han copiado de martes a viernes. Guarda para aplicarlos.',
    );
  }

  return (
    <Modal title="Fichaje automático" wide onClose={onClose}>
      <p className="muted">
        {employee.name}. Define las entradas y salidas de cada día, aunque no abra la app.
      </p>
      <Form
        className="schedule-form"
        submitLabel="Guardar horario"
        onCancel={onClose}
        onSubmit={async () => {
          if (stale)
            throw new Error('El horario ha cambiado. Cierra y vuelve a abrirlo antes de guardar.');
          const savedSlots = slots.map((slot) => {
            if (!slot.storeId) throw new Error('Elige una tienda para cada tramo.');
            return { ...slot, storeId: slot.storeId };
          });
          setSaving(true);
          try {
            await save({
              employeeId: employee._id,
              enabled,
              startDate,
              endDate: endDate || null,
              slots: savedSlots,
              exclusions: exclusions.map(({ startDate, endDate }) => ({ startDate, endDate })),
              ...(expectedRevision === undefined ? {} : { expectedRevision }),
            });
            onSaved();
          } finally {
            setSaving(false);
          }
        }}
      >
        {schedule?.enabled && schedule.restoredPaused && (
          <Notice kind="info">
            Horario pausado tras la recuperación. Revisa los tramos abiertos antes de guardar para
            reactivarlo.
          </Notice>
        )}
        <fieldset className="schedule-fields" disabled={saving}>
          <label className="checkbox-field schedule-enabled">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
            />
            <span>
              Activar fichaje automático
              <small>Solo se aplica con acceso habilitado y un periodo laboral vigente.</small>
            </span>
          </label>
          <div className="field-row">
            <Field label="Aplicar desde">
              <input
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
                required
              />
            </Field>
            <Field label="Hasta (opcional)">
              <input
                type="date"
                value={endDate}
                min={startDate}
                onChange={(event) => setEndDate(event.target.value)}
              />
            </Field>
          </div>
          <p className="help-text schedule-help">
            Horas de Sevilla. Los cambios se aplican a las próximas entradas; no completan días
            anteriores. Un tramo ya iniciado conserva su salida prevista.
          </p>
          <div className="schedule-week-heading">
            <h3>Semana habitual</h3>
            <span className="schedule-total">
              {weeklyMinutes === null
                ? 'Completa las horas para ver el total'
                : `${Math.floor(weeklyMinutes / 60)} h ${String(weeklyMinutes % 60).padStart(2, '0')} min / semana`}
            </span>
          </div>
          <div className="schedule-days">
            {weekdays.map((name, index) => {
              const weekday = index + 1;
              const daySlots = slots.filter((slot) => slot.weekday === weekday);
              return (
                <fieldset className="schedule-day" key={name}>
                  <legend>{name}</legend>
                  <div className="schedule-day-heading">
                    <span className="schedule-day-summary">
                      {daySlots.length
                        ? `${daySlots.length} ${daySlots.length === 1 ? 'tramo' : 'tramos'}`
                        : 'Sin tramos'}
                    </span>
                    <button
                      type="button"
                      className="button secondary small-button"
                      disabled={daySlots.length >= MAX_SLOTS_PER_DAY || !activeStores.length}
                      aria-label={`Añadir tramo al ${name.toLocaleLowerCase('es')}`}
                      onClick={() => addSlot(weekday)}
                    >
                      <Plus size={16} /> Añadir tramo
                    </button>
                  </div>
                  {daySlots.map((slot, slotIndex) => (
                    <div className="schedule-slot" key={slot.id}>
                      <div className="schedule-slot-fields">
                        <Field label="Entrada">
                          <input
                            type="time"
                            step="60"
                            value={slot.startTime}
                            aria-label={`${name}, tramo ${slotIndex + 1}, entrada`}
                            onChange={(event) =>
                              updateSlot(slot.id, { startTime: event.target.value })
                            }
                            required
                          />
                        </Field>
                        <Field label="Salida">
                          <input
                            type="time"
                            step="60"
                            value={slot.endTime}
                            aria-label={`${name}, tramo ${slotIndex + 1}, salida`}
                            onChange={(event) =>
                              updateSlot(slot.id, { endTime: event.target.value })
                            }
                            required
                          />
                        </Field>
                        <Field label="Tienda">
                          <select
                            value={slot.storeId}
                            aria-label={`${name}, tramo ${slotIndex + 1}, tienda`}
                            onChange={(event) =>
                              updateSlot(slot.id, { storeId: event.target.value as Id<'stores'> })
                            }
                            required
                          >
                            <option value="">Elige tienda</option>
                            {stores
                              .filter((store) => store.active || store._id === slot.storeId)
                              .map((store) => (
                                <option key={store._id} value={store._id} disabled={!store.active}>
                                  {store.name}
                                  {store.active ? '' : ' (inactiva)'}
                                </option>
                              ))}
                          </select>
                        </Field>
                      </div>
                      <div className="schedule-slot-actions">
                        <label className="checkbox-field">
                          <input
                            type="checkbox"
                            checked={slot.endNextDay}
                            aria-label={`${name}, tramo ${slotIndex + 1}, salida al día siguiente`}
                            onChange={(event) =>
                              updateSlot(slot.id, { endNextDay: event.target.checked })
                            }
                          />
                          <span>La salida es al día siguiente</span>
                        </label>
                        <button
                          type="button"
                          className="button secondary small-button"
                          aria-label={`Eliminar tramo ${slotIndex + 1} del ${name.toLocaleLowerCase('es')}`}
                          onClick={() =>
                            setSlots((current) => current.filter((item) => item.id !== slot.id))
                          }
                        >
                          <Trash2 size={15} /> Eliminar
                        </button>
                      </div>
                    </div>
                  ))}
                  {weekday === 1 && daySlots.length > 0 && (
                    <div className="schedule-copy">
                      <button
                        type="button"
                        className="button secondary small-button"
                        onClick={copyMonday}
                      >
                        <Copy size={15} /> Copiar lunes a martes–viernes
                      </button>
                      <p className="help-text">Sustituye los tramos de esos cuatro días.</p>
                    </div>
                  )}
                </fieldset>
              );
            })}
          </div>
          {copyMessage && <Notice kind="success">{copyMessage}</Notice>}
          {!activeStores.length && <Notice>Activa una tienda antes de añadir tramos.</Notice>}
          <p className="help-text schedule-help">
            Los días sin tramos quedan libres. Este horario no cambia las horas contratadas.
          </p>
          <section className="schedule-exclusions" aria-labelledby="schedule-exclusions-title">
            <div className="schedule-week-heading">
              <h3 id="schedule-exclusions-title">Fechas sin fichaje</h3>
              <button
                type="button"
                className="button secondary small-button"
                disabled={exclusions.length >= MAX_EXCLUSIONS}
                onClick={() =>
                  setExclusions((current) => [
                    ...current,
                    { id: crypto.randomUUID(), startDate: '', endDate: '' },
                  ])
                }
              >
                <Plus size={16} /> Añadir fechas
              </button>
            </div>
            <p className="help-text">
              Excluye ausencias, festivos o cierres. Ambos días están incluidos.
            </p>
            {exclusions.map((exclusion, index) => (
              <div className="schedule-exclusion" key={exclusion.id}>
                <div className="field-row">
                  <Field label="Desde">
                    <input
                      type="date"
                      value={exclusion.startDate}
                      aria-label={`Exclusión ${index + 1}, desde`}
                      onChange={(event) =>
                        setExclusions((current) =>
                          current.map((item) =>
                            item.id === exclusion.id
                              ? { ...item, startDate: event.target.value }
                              : item,
                          ),
                        )
                      }
                      required
                    />
                  </Field>
                  <Field label="Hasta">
                    <input
                      type="date"
                      value={exclusion.endDate}
                      min={exclusion.startDate}
                      aria-label={`Exclusión ${index + 1}, hasta`}
                      onChange={(event) =>
                        setExclusions((current) =>
                          current.map((item) =>
                            item.id === exclusion.id
                              ? { ...item, endDate: event.target.value }
                              : item,
                          ),
                        )
                      }
                      required
                    />
                  </Field>
                </div>
                <button
                  type="button"
                  className="button secondary small-button"
                  aria-label={`Eliminar exclusión ${index + 1}`}
                  onClick={() =>
                    setExclusions((current) => current.filter((item) => item.id !== exclusion.id))
                  }
                >
                  <Trash2 size={15} /> Eliminar fechas
                </button>
              </div>
            ))}
          </section>
        </fieldset>
        {stale && (
          <Notice>
            El horario ha cambiado desde que lo abriste. Cierra y vuelve a abrirlo para cargar la
            última versión.
          </Notice>
        )}
      </Form>
    </Modal>
  );
}
