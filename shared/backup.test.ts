import { describe, expect, it } from 'vitest';
import { decryptBackup, encryptBackup } from './backup';

const password = 'una clave larga para la copia';
const source = {
  formatVersion: 1,
  employees: [{ name: 'María', id: 'uno' }],
  sessions: [{ startAt: 1788602400000, endAt: null }],
  corrections: [],
};

describe('encrypted functional backup', () => {
  it('round-trips full data and uses a different salt and nonce on every export', async () => {
    const first = await encryptBackup(source, password);
    const second = await encryptBackup(source, password);
    expect(first).not.toContain('María');
    expect(JSON.parse(first).salt).not.toBe(JSON.parse(second).salt);
    expect(JSON.parse(first).iv).not.toBe(JSON.parse(second).iv);
    expect(await decryptBackup(first, password)).toEqual(source);
  });

  it('rejects wrong passwords and modified ciphertext', async () => {
    const encrypted = await encryptBackup(source, password);
    await expect(decryptBackup(encrypted, 'otra clave muy diferente')).rejects.toThrow(
      /clave no es correcta|dañado/,
    );
    const tampered = JSON.parse(encrypted);
    tampered.ciphertext =
      (tampered.ciphertext[0] === 'A' ? 'B' : 'A') + tampered.ciphertext.slice(1);
    await expect(decryptBackup(JSON.stringify(tampered), password)).rejects.toThrow(
      /clave no es correcta|dañado/,
    );
  });

  it('rejects bad formats or expensive untrusted derivation parameters before decrypting', async () => {
    await expect(encryptBackup(source, 'short')).rejects.toThrow(/12 caracteres/);
    await expect(decryptBackup('not json', password)).rejects.toThrow(/válida/);
    const encrypted = JSON.parse(await encryptBackup(source, password));
    await expect(
      decryptBackup(JSON.stringify({ ...encrypted, version: 2 }), password),
    ).rejects.toThrow(/no es compatible/);
    await expect(
      decryptBackup(JSON.stringify({ ...encrypted, iterations: 9_999_999_999 }), password),
    ).rejects.toThrow(/no es compatible/);
    await expect(
      decryptBackup(JSON.stringify({ ...encrypted, salt: '!!!' }), password),
    ).rejects.toThrow(/dañado/);
    await expect(
      decryptBackup(JSON.stringify({ ...encrypted, iv: 'AA==' }), password),
    ).rejects.toThrow(/parámetros/);
  });

  it('handles an archive larger than a megabyte without a base64 regex stack overflow', async () => {
    const archive = { text: 'registro-horario'.repeat(90_000) };
    expect(await decryptBackup(await encryptBackup(archive, password), password)).toEqual(archive);
  });
});
