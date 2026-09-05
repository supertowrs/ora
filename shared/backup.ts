/** Browser-only encryption. The password and cleartext are never sent to a crypto service. */
export const BACKUP_FORMAT = 'ora-encrypted-backup';
export const BACKUP_VERSION = 1;
export const BACKUP_MIN_PASSWORD_LENGTH = 12;
export const MAX_BACKUP_BYTES = 64 * 1024 * 1024;
const ITERATIONS = 600_000;
const encoder = new TextEncoder();

interface BackupEnvelope {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  algorithm: 'AES-256-GCM';
  kdf: 'PBKDF2-SHA256';
  iterations: number;
  salt: string;
  iv: string;
  ciphertext: string;
}

function cryptoApi(): Crypto {
  if (!globalThis.crypto?.subtle)
    throw new Error(
      'Este navegador no permite cifrar copias. Abre Ora por HTTPS en un navegador actualizado.',
    );
  return globalThis.crypto;
}

function validatePassword(password: string): void {
  if (password.trim().length < BACKUP_MIN_PASSWORD_LENGTH)
    throw new Error(
      `La clave de la copia debe tener al menos ${BACKUP_MIN_PASSWORD_LENGTH} caracteres.`,
    );
  if (password.length > 1024) throw new Error('La clave de la copia es demasiado larga.');
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(binary);
}

function fromBase64(value: unknown, expectedLength?: number): Uint8Array<ArrayBuffer> {
  if (
    typeof value !== 'string' ||
    value.length > Math.ceil((MAX_BACKUP_BYTES + 16) / 3) * 4 ||
    value.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value)
  ) {
    throw new Error('El archivo de copia está dañado o tiene un formato no válido.');
  }
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
  } catch {
    throw new Error('El archivo de copia está dañado o tiene un formato no válido.');
  }
  if (expectedLength !== undefined && bytes.length !== expectedLength)
    throw new Error('El archivo de copia tiene parámetros de cifrado no válidos.');
  return bytes;
}

async function deriveKey(password: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const subtle = cryptoApi().subtle;
  const material = await subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

function authenticatedHeader(
  envelope: Omit<BackupEnvelope, 'ciphertext'>,
): Uint8Array<ArrayBuffer> {
  // Canonical field order authenticates both the ciphertext and its format parameters.
  return encoder.encode(
    JSON.stringify({
      format: envelope.format,
      version: envelope.version,
      algorithm: envelope.algorithm,
      kdf: envelope.kdf,
      iterations: envelope.iterations,
      salt: envelope.salt,
      iv: envelope.iv,
    }),
  );
}

export async function encryptBackup(data: unknown, password: string): Promise<string> {
  validatePassword(password);
  let json: string | undefined;
  try {
    json = JSON.stringify(data);
  } catch {
    throw new Error('Los datos de la copia no se pueden convertir a JSON.');
  }
  if (json === undefined) throw new Error('La copia no contiene datos válidos.');
  const plaintext = encoder.encode(json);
  if (plaintext.byteLength > MAX_BACKUP_BYTES)
    throw new Error(
      'La copia supera el límite de 64 MB. Contacta con la persona que mantiene Ora.',
    );
  const api = cryptoApi();
  const salt = api.getRandomValues(new Uint8Array(16));
  const iv = api.getRandomValues(new Uint8Array(12));
  const envelope: Omit<BackupEnvelope, 'ciphertext'> = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    algorithm: 'AES-256-GCM',
    kdf: 'PBKDF2-SHA256',
    iterations: ITERATIONS,
    salt: toBase64(salt),
    iv: toBase64(iv),
  };
  const key = await deriveKey(password, salt);
  const ciphertext = await api.subtle.encrypt(
    { name: 'AES-GCM', iv, tagLength: 128, additionalData: authenticatedHeader(envelope) },
    key,
    plaintext,
  );
  return JSON.stringify({ ...envelope, ciphertext: toBase64(new Uint8Array(ciphertext)) });
}

/** This validates the encrypted container. The restore backend must validate its own data schema. */
export async function decryptBackup(text: string, password: string): Promise<unknown> {
  validatePassword(password);
  if (text.length > Math.ceil((MAX_BACKUP_BYTES + 16) / 3) * 4 + 2048)
    throw new Error('El archivo de copia supera el tamaño admitido.');
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('El archivo no es una copia válida de Ora.');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('El archivo no es una copia válida de Ora.');
  const envelope = value as BackupEnvelope;
  if (
    envelope.format !== BACKUP_FORMAT ||
    envelope.version !== BACKUP_VERSION ||
    envelope.algorithm !== 'AES-256-GCM' ||
    envelope.kdf !== 'PBKDF2-SHA256' ||
    envelope.iterations !== ITERATIONS
  ) {
    throw new Error('El formato o la versión de esta copia no es compatible con Ora.');
  }
  const salt = fromBase64(envelope.salt, 16);
  const iv = fromBase64(envelope.iv, 12);
  const ciphertext = fromBase64(envelope.ciphertext);
  if (ciphertext.byteLength < 16) throw new Error('El archivo de copia está incompleto.');
  const key = await deriveKey(password, salt);
  let plaintext: ArrayBuffer;
  try {
    plaintext = await cryptoApi().subtle.decrypt(
      { name: 'AES-GCM', iv, tagLength: 128, additionalData: authenticatedHeader(envelope) },
      key,
      ciphertext,
    );
  } catch {
    throw new Error(
      'No se puede abrir la copia: la clave no es correcta o el archivo está dañado.',
    );
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plaintext)) as unknown;
  } catch {
    throw new Error('Los datos de la copia no son válidos.');
  }
}
