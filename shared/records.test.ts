import { describe, expect, it } from 'vitest';
import { recordsCsv, type RecordsCsvData } from './records';

// Read the exported document independently of the production CSV serializer.
function parseCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const text = csv.replace(/^\uFEFF/, '');
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (!quoted && (character === ';' || character === '\r' || character === '\n')) {
      row.push(cell);
      cell = '';
      if (character !== ';') {
        rows.push(row);
        row = [];
        if (character === '\r' && text[index + 1] === '\n') index += 1;
      }
    } else cell += character;
  }
  if (cell || row.length) rows.push([...row, cell]);
  return rows;
}

type CsvSession = RecordsCsvData['sessions'][number];

function session(overrides: Partial<CsvSession> = {}): CsvSession {
  return {
    _id: 'shift',
    employeeId: 'ana',
    storeId: 'centro',
    startAt: Date.parse('2026-09-05T07:00:17Z'),
    endAt: Date.parse('2026-09-05T08:00:43Z'),
    voided: false,
    source: 'clock',
    ...overrides,
  };
}

function data(overrides: Partial<RecordsCsvData> = {}): RecordsCsvData {
  return {
    sessions: [session()],
    employees: [{ _id: 'ana', name: 'Ana' }],
    stores: [{ _id: 'centro', name: 'Centro' }],
    corrections: [],
    ...overrides,
  };
}

const headers = [
  'Empleado',
  'Tienda',
  'Fecha entrada',
  'Entrada (Europe/Madrid)',
  'Fecha salida',
  'Salida (Europe/Madrid)',
  'Duración del tramo (segundos)',
  'Estado',
  'Origen',
];

describe('Records CSV download', () => {
  it('exports spreadsheet-readable text without splitting quoted names or executing formulas', () => {
    const csv = recordsCsv(
      data({
        sessions: [session(), session({ _id: 'other', employeeId: 'jose', storeId: 'sur' })],
        employees: [
          { _id: 'ana', name: 'Ana; "María"\nGarcía' },
          { _id: 'jose', name: '=HYPERLINK("https://example.com")' },
        ],
        stores: [
          { _id: 'centro', name: 'Belén; "Centro"' },
          { _id: 'sur', name: '  +SUM(1;2)' },
        ],
      }),
    );
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const rows = parseCsv(csv);
    expect(rows[0]).toEqual(headers);
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.length === 9)).toBe(true);
    expect(rows.slice(1).map((row) => row.slice(0, 2))).toEqual([
      ['Ana; "María"\nGarcía', 'Belén; "Centro"'],
      ['\'=HYPERLINK("https://example.com")', "'  +SUM(1;2)"],
    ]);
  });

  it('keeps a complete midnight and month-crossing shift in one row with exact seconds', () => {
    const rows = parseCsv(
      recordsCsv(
        data({
          sessions: [
            session({
              startAt: Date.parse('2026-09-30T21:59:47Z'),
              endAt: Date.parse('2026-09-30T22:00:28Z'),
            }),
          ],
        }),
      ),
    );
    expect(rows).toEqual([
      headers,
      [
        'Ana',
        'Centro',
        '2026-09-30',
        '23:59:47',
        '2026-10-01',
        '00:00:28',
        '41',
        'Completo',
        'Fichaje',
      ],
    ]);
  });

  it.each([
    ['2026-03-29', '01:59:50', '03:00:11'],
    ['2026-10-25', '02:59:50', '02:00:11'],
  ])('uses real elapsed seconds through the Madrid clock change on %s', (day, start, end) => {
    const rows = parseCsv(
      recordsCsv(
        data({
          sessions: [
            session({
              startAt: Date.parse(`${day}T00:59:50Z`),
              endAt: Date.parse(`${day}T01:00:11Z`),
            }),
          ],
        }),
      ),
    );
    expect(rows).toEqual([
      headers,
      ['Ana', 'Centro', day, start, day, end, '21', 'Completo', 'Fichaje'],
    ]);
  });

  it('distinguishes corrected clock entries from administrative origin and unfinished or voided states', () => {
    const rows = parseCsv(
      recordsCsv(
        data({
          sessions: [
            session({ _id: 'ordinary' }),
            session({ _id: 'corrected' }),
            session({ _id: 'added', source: 'correction' }),
            session({ _id: 'open', endAt: null }),
            session({ _id: 'voided', voided: true }),
            session({ _id: 'voided-open', voided: true, endAt: null }),
          ],
          corrections: ['corrected', 'added', 'open', 'voided', 'voided-open'].map((sessionId) => ({
            sessionId,
          })),
        }),
      ),
    );
    expect(rows.slice(1).map((row) => row.slice(4))).toEqual([
      ['2026-09-05', '10:00:43', '3626', 'Completo', 'Fichaje'],
      ['2026-09-05', '10:00:43', '3626', 'Corregido', 'Fichaje'],
      ['2026-09-05', '10:00:43', '3626', 'Corregido', 'Corrección'],
      ['', '', '', 'Sin cerrar', 'Fichaje'],
      ['2026-09-05', '10:00:43', '3626', 'Anulado', 'Fichaje'],
      ['', '', '', 'Anulado', 'Fichaje'],
    ]);
  });

  it('exports only the supplied shifts, ignoring moved history and unrelated employee or store options', () => {
    const selection = data({
      employees: [
        { _id: 'ana', name: 'Ana' },
        { _id: 'pepe', name: 'Pepe' },
      ],
      stores: [
        { _id: 'centro', name: 'Centro' },
        { _id: 'sur', name: 'Sur' },
      ],
      corrections: [{ sessionId: 'moved-outside-selection' }],
    });
    expect(parseCsv(recordsCsv(selection))).toEqual([
      headers,
      [
        'Ana',
        'Centro',
        '2026-09-05',
        '09:00:17',
        '2026-09-05',
        '10:00:43',
        '3626',
        'Completo',
        'Fichaje',
      ],
    ]);
    expect(parseCsv(recordsCsv({ ...selection, sessions: [] }))).toEqual([headers]);
  });
});
