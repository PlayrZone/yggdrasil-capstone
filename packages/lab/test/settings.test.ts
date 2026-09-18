import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_MODEL,
  SettingsError,
  effectiveKey,
  effectiveModel,
  keyAtRest,
  migrateKeyAtRest,
  saveKey,
  savedModel,
  setSecretStore,
  type SecretStore,
} from '../src/main/settings.js';

/**
 * Stand-in for Electron's safeStorage. The ciphertext is deliberately NOT the
 * plaintext (reversed + tagged), so "the file must not contain the key" is a
 * real assertion rather than a formatting coincidence.
 */
function fakeStore(available = true): SecretStore & { calls: number } {
  return {
    calls: 0,
    isEncryptionAvailable: () => available,
    encryptString(plain: string) {
      this.calls++;
      return Buffer.from(`ENC:${[...plain].reverse().join('')}`, 'utf8');
    },
    decryptString(enc: Buffer) {
      const s = enc.toString('utf8');
      if (!s.startsWith('ENC:')) throw new Error('not our ciphertext');
      return [...s.slice(4)].reverse().join('');
    },
  };
}

// Never a real credential: the tests must not read or print one.
const FAKE_KEY = 'fw_unit_test_key_0123456789';
// Written with fromCharCode so no source file in the repo carries a raw control
// byte — git and grep classify such a file as binary and it stops being reviewable.
const NUL = String.fromCharCode(0);
const DEL = String.fromCharCode(0x7f);

describe('key at rest', () => {
  let home: string;
  let settingsFile: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'ygg-set-'));
    process.env['YGG_HOME'] = home;
    settingsFile = join(home, 'settings.json');
    vi.stubEnv('FIREWORKS_API_KEY', '');
    vi.stubEnv('FIREWORKS_MODEL', '');
    setSecretStore(null);
  });
  afterEach(() => {
    setSecretStore(null);
    vi.unstubAllEnvs();
    delete process.env['YGG_HOME'];
    rmSync(home, { recursive: true, force: true });
  });

  const fileText = (): string => readFileSync(settingsFile, 'utf8');

  it('encrypts the key and never writes it in the clear', () => {
    const store = fakeStore();
    setSecretStore(store);
    saveKey(FAKE_KEY);

    expect(store.calls).toBe(1);
    expect(fileText()).not.toContain(FAKE_KEY);
    expect(JSON.parse(fileText())).not.toHaveProperty('fireworksKey');
    expect(effectiveKey()).toBe(FAKE_KEY);
    expect(keyAtRest()).toBe('encrypted');
  });

  it('migrates a plaintext key written by an earlier version', () => {
    writeFileSync(settingsFile, JSON.stringify({ fireworksKey: FAKE_KEY, model: 'some/model' }));
    expect(keyAtRest()).toBe('plaintext');

    setSecretStore(fakeStore());
    expect(migrateKeyAtRest()).toBe(true);

    expect(fileText()).not.toContain(FAKE_KEY);
    expect(JSON.parse(fileText())).not.toHaveProperty('fireworksKey');
    expect(effectiveKey()).toBe(FAKE_KEY);
    expect(effectiveModel()).toBe('some/model');
    expect(keyAtRest()).toBe('encrypted');
    // Idempotent: a second run has nothing left to lift.
    expect(migrateKeyAtRest()).toBe(false);
  });

  /**
   * The legacy field used to be read through a 512-char bound, so an over-long
   * plaintext key was invisible to the migration: it stayed on disk in the clear
   * forever while keyAtRest() cheerfully reported 'none'.
   */
  it('migrates an over-long plaintext key instead of stranding it', () => {
    const long = `fw_${'k'.repeat(600)}`;
    writeFileSync(settingsFile, JSON.stringify({ fireworksKey: long }));
    expect(keyAtRest()).toBe('plaintext');

    setSecretStore(fakeStore());
    expect(migrateKeyAtRest()).toBe(true);
    expect(fileText()).not.toContain(long);
    expect(JSON.parse(fileText())).not.toHaveProperty('fireworksKey');
    expect(effectiveKey()).toBe(long);
    expect(keyAtRest()).toBe('encrypted');
  });

  it('scrubs a legacy value that is not a usable key at all', () => {
    const junk = 'x y'.repeat(50_000); // whitespace, and far past any key length
    writeFileSync(settingsFile, JSON.stringify({ fireworksKey: junk, model: 'keep/me' }));
    expect(keyAtRest()).toBe('plaintext');

    setSecretStore(fakeStore());
    expect(migrateKeyAtRest()).toBe(true);
    expect(fileText()).not.toContain(junk);
    expect(JSON.parse(fileText())).not.toHaveProperty('fireworksKey');
    expect(effectiveModel()).toBe('keep/me');
    expect(keyAtRest()).toBe('none');
    expect(effectiveKey()).toBeUndefined();
  });

  it('reports plaintext truthfully while it is still the only copy', () => {
    const long = `fw_${'k'.repeat(600)}`;
    writeFileSync(settingsFile, JSON.stringify({ fireworksKey: long }));
    setSecretStore(fakeStore(false));
    expect(migrateKeyAtRest()).toBe(false);
    expect(keyAtRest()).toBe('plaintext');
    expect(fileText()).toContain(long);
  });

  it('falls back to plaintext, visibly, when the OS cannot encrypt', () => {
    setSecretStore(fakeStore(false));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    saveKey(FAKE_KEY);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();

    expect(JSON.parse(fileText())).toMatchObject({ fireworksKey: FAKE_KEY });
    expect(keyAtRest()).toBe('plaintext');
    expect(effectiveKey()).toBe(FAKE_KEY);
    // ...and migration is a no-op until encryption becomes available.
    expect(migrateKeyAtRest()).toBe(false);
    setSecretStore(fakeStore(true));
    expect(migrateKeyAtRest()).toBe(true);
    expect(keyAtRest()).toBe('encrypted');
  });

  it('treats an undecryptable key as absent instead of crashing', () => {
    setSecretStore(fakeStore());
    saveKey(FAKE_KEY);
    const s = JSON.parse(fileText()) as Record<string, string>;
    writeFileSync(settingsFile, JSON.stringify({ ...s, fireworksKeyEnc: Buffer.from('garbage').toString('base64') }));

    expect(effectiveKey()).toBeUndefined();
    expect(keyAtRest()).toBe('none');
  });

  it('lets the environment win and reports it as such', () => {
    setSecretStore(fakeStore());
    saveKey(FAKE_KEY, 'saved/model');
    vi.stubEnv('FIREWORKS_API_KEY', 'fw_from_env');
    vi.stubEnv('FIREWORKS_MODEL', 'env/model');

    expect(effectiveKey()).toBe('fw_from_env');
    expect(effectiveModel()).toBe('env/model');
    expect(keyAtRest()).toBe('env');
    expect(savedModel()).toBe('saved/model');
  });

  it('rejects keys that cannot be API tokens', () => {
    setSecretStore(fakeStore());
    const bads: unknown[] = ['', '   ', 'has space', 'nl\nkey', 'tab\tkey', `nul${NUL}key`, `del${DEL}key`, 'ünïcödé', 'a'.repeat(4097), 42, null, undefined, {}, ['k']];
    for (const bad of bads) {
      expect(() => saveKey(bad), JSON.stringify(bad)).toThrow(SettingsError);
    }
    expect(existsSync(settingsFile)).toBe(false);
    expect(() => saveKey(FAKE_KEY, 'x'.repeat(201))).toThrow(SettingsError);
    expect(() => saveKey(FAKE_KEY, 123)).toThrow(SettingsError);
  });

  it('survives a corrupt or hostile settings file', () => {
    for (const junk of ['', 'not json', 'null', '[]', '"str"', '{"fireworksKey":123}', '{"model":{}}']) {
      writeFileSync(settingsFile, junk);
      expect(effectiveKey()).toBeUndefined();
      expect(effectiveModel()).toBe(DEFAULT_MODEL);
      expect(keyAtRest()).toBe('none');
      expect(savedModel()).toBeNull();
    }
  });

  it('refuses to parse an absurdly large settings file', () => {
    writeFileSync(settingsFile, JSON.stringify({ fireworksKey: FAKE_KEY, pad: 'p'.repeat(2 * 1024 * 1024) }));
    expect(effectiveKey()).toBeUndefined();
    expect(keyAtRest()).toBe('none');
  });

  it('writes the settings file owner-only where the platform supports it', () => {
    setSecretStore(fakeStore());
    saveKey(FAKE_KEY);
    const mode = statSync(settingsFile).mode & 0o777;
    // Windows does not model POSIX bits (the file lands 0o666 and the key's
    // protection there is DPAPI, not the mode); assert only where they are real.
    if (process.platform !== 'win32') expect(mode & 0o077).toBe(0);
    else expect(mode).toBeGreaterThan(0);
  });
});
