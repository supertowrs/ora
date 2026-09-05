import { describe, expect, it } from 'vitest';
import { escapeCsvCell, toCsv } from './reports';

describe('CSV for Spanish spreadsheets', () => {
  it('preserves semicolons, quotes, accents and embedded newlines as one quoted cell', () => {
    expect(toCsv([['José', 'Tienda; \"Centro\"', 'Primera\nsegunda', 90, null]])).toBe(
      '\uFEFF"José";"Tienda; ""Centro""";"Primera\nsegunda";"90";""\r\n',
    );
  });

  it('neutralizes spreadsheet formulas including whitespace-prefixed payloads', () => {
    for (const value of [
      '=1+1',
      '+SUM(1)',
      '-1+1',
      '@SUM(1)',
      '  =1+1',
      '\t=HYPERLINK(1)',
      '\r=1+1',
      '\n=1+1',
    ]) {
      expect(escapeCsvCell(value).startsWith('"\'')).toBe(true);
    }
    expect(escapeCsvCell(-5)).toBe('"-5"');
    expect(escapeCsvCell('Tienda Norte')).toBe('"Tienda Norte"');
  });
});
