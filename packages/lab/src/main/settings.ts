import { chmodSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { yggHome } from '@yggdrasil/home';

/**
 * Where the Fireworks key lives at rest. The key is never sent to the renderer
 * and — from this version on — never written to disk in the clear while
 * Electron can encrypt it: `safeStorage` binds the ciphertext to the OS user
 * (DPAPI on Windows, Keychain on macOS, libsecret/kwallet on Linux).
 *
 * `safeStorage` only works after `app.whenReady()`, and pulling `electron` into
 * this module would make it unloadable in a unit test, so main injects the
 * capability instead of this module importing it.
 */
export interface SecretStore {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

/** How the effective key is being held — surfaced to the UI, never the key itself. */
export type KeyAtRest = 'none' | 'env' | 'encrypted' | 'plaintext';

export const DEFAULT_MODEL = 'accounts/fireworks/models/gpt-oss-120b';

const MAX_KEY_CHARS = 4096;
const MAX_MODEL_CHARS = 200;
/** A settings file larger than this is not settings; refuse to parse it. */
const MAX_SETTINGS_BYTES = 1024 * 1024;
/** An API token is opaque printable ASCII: no space, no control characters, no unicode. */
const PRINTABLE_ASCII = /^[!-~]+$/;

interface Settings {
  /** base64 of safeStorage.encryptString — the only form written when encryption is available. */
  fireworksKeyEnc?: string;
  /**
   * Legacy / fallback plaintext. Read with NO length bound on purpose: a value
   * we refuse to look at is a value we can never erase, and an earlier version
   * may have written anything here. `savedKey` decides separately whether it is
   * usable as a key; `migrateKeyAtRest` gets it off the disk either way.
   */
  fireworksKey?: string;
  model?: string;
}

let store: SecretStore | null = null;

/** Main calls this once, after app.whenReady(). Tests inject a fake. */
export function setSecretStore(s: SecretStore | null): void {
  store = s;
}

function settingsPath(): string {
  return join(yggHome(), 'settings.json');
}

function str(v: unknown, max: number): string | undefined {
  return typeof v === 'string' && v.length > 0 && v.length <= max ? v : undefined;
}

function loadSettings(): Settings {
  let parsed: unknown;
  try {
    const path = settingsPath();
    if (statSync(path).size > MAX_SETTINGS_BYTES) return {};
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return {};
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
  const o = parsed as Record<string, unknown>;
  const enc = str(o['fireworksKeyEnc'], 8192);
  const plain = o['fireworksKey'];
  const model = str(o['model'], MAX_MODEL_CHARS);
  return {
    ...(enc ? { fireworksKeyEnc: enc } : {}),
    ...(typeof plain === 'string' && plain.length > 0 ? { fireworksKey: plain } : {}),
    ...(model ? { model } : {}),
  };
}

function writeSettings(s: Settings): void {
  const path = settingsPath();
  writeFileSync(path, JSON.stringify(s, null, 2), { mode: 0o600 });
  try {
    // `mode` only applies when the file is created. On Windows this is a no-op
    // — NTFS ignores POSIX bits (the file ends up 0o666) — so on that platform
    // the key's protection is safeStorage/DPAPI, not the file permissions.
    chmodSync(path, 0o600);
  } catch {
    /* not all filesystems support it */
  }
}

function canEncrypt(): boolean {
  try {
    return !!store?.isEncryptionAvailable();
  } catch {
    return false;
  }
}

function decrypt(enc: string): string | undefined {
  if (!store) return undefined;
  try {
    const plain = store.decryptString(Buffer.from(enc, 'base64'));
    return plain.length > 0 && plain.length <= MAX_KEY_CHARS ? plain : undefined;
  } catch {
    // Wrong OS user, a reinstalled keyring, a corrupt file: treat as "no key"
    // rather than crashing main. The user can paste the key again.
    return undefined;
  }
}

/** Reject anything that is not a plausible opaque API token. */
function validKey(key: unknown): key is string {
  if (typeof key !== 'string') return false;
  const k = key.trim();
  return k.length > 0 && k.length <= MAX_KEY_CHARS && PRINTABLE_ASCII.test(k);
}

/**
 * Migrate a key an earlier version wrote in the clear. Called at startup, once
 * the secret store is injected.
 *
 * Whatever sits in the legacy field leaves the disk: a usable key is re-written
 * encrypted, anything else (corrupt, truncated, absurdly long) is erased. The
 * earlier version of this refused to even read an over-long value, so the
 * cleartext stayed on disk forever while `keyAtRest()` reported 'none'.
 * Returns true when the file changed. Still a no-op when the platform cannot
 * encrypt — there the plaintext is the only copy, and `keyAtRest()` says so.
 */
export function migrateKeyAtRest(): boolean {
  const s = loadSettings();
  const legacy = s.fireworksKey;
  if (legacy === undefined || !canEncrypt()) return false;
  delete s.fireworksKey;
  if (validKey(legacy)) {
    try {
      s.fireworksKeyEnc = store!.encryptString(legacy.trim()).toString('base64');
    } catch {
      return false; // fail closed: leave the file as it was rather than lose the key
    }
  }
  writeSettings(s);
  return true;
}

export class SettingsError extends Error {}

/**
 * Persist the key, encrypted when the platform allows it. When it does not, the
 * fallback is explicit rather than silent: the key goes in as plaintext, the
 * file records nothing else, `keyAtRest()` reports 'plaintext' to the UI, and
 * main logs a warning. Refusing to store it at all would only push users back
 * to a shell env var, which is no better.
 */
export function saveKey(key: unknown, model?: unknown): void {
  if (!validKey(key)) throw new SettingsError('BAD_API_KEY');
  const modelId = model === undefined ? undefined : str(model, MAX_MODEL_CHARS);
  if (model !== undefined && !modelId) throw new SettingsError('BAD_MODEL');
  const trimmed = key.trim();
  const s = loadSettings();
  if (modelId) s.model = modelId;
  if (canEncrypt()) {
    s.fireworksKeyEnc = store!.encryptString(trimmed).toString('base64');
    delete s.fireworksKey;
  } else {
    s.fireworksKey = trimmed;
    delete s.fireworksKeyEnc;
    // eslint-disable-next-line no-console
    console.warn('[yggdrasil] OS encryption unavailable — the API key is stored in plaintext in settings.json.');
  }
  writeSettings(s);
}

function savedKey(): string | undefined {
  const s = loadSettings();
  if (s.fireworksKeyEnc) return decrypt(s.fireworksKeyEnc);
  return validKey(s.fireworksKey) ? s.fireworksKey.trim() : undefined;
}

/** Effective key: env wins over the saved settings file. Never leaves main. */
export function effectiveKey(): string | undefined {
  return process.env['FIREWORKS_API_KEY'] || savedKey() || undefined;
}

export function effectiveModel(): string {
  return process.env['FIREWORKS_MODEL'] || loadSettings().model || DEFAULT_MODEL;
}

/** The saved model id, or null — for the settings UI. */
export function savedModel(): string | null {
  return loadSettings().model ?? null;
}

/**
 * What the UI is told. 'plaintext' whenever the legacy field holds anything at
 * all, usable key or not: the honest answer to "is there cleartext on disk?".
 */
export function keyAtRest(): KeyAtRest {
  if (process.env['FIREWORKS_API_KEY']) return 'env';
  const s = loadSettings();
  if (s.fireworksKey !== undefined) return 'plaintext';
  if (s.fireworksKeyEnc) return decrypt(s.fireworksKeyEnc) ? 'encrypted' : 'none';
  return 'none';
}
