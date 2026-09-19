import { afterEach, describe, expect, it } from 'vitest';
import { evalBackend } from '../src/llm.js';

/**
 * The eval gates change nothing, but against a configured Fireworks model one
 * run of the fidelity battery is 48 completions of a paid endpoint. The gate is
 * what stands between "read-only" and a bill.
 *
 * Nothing here contacts a network: the refusal path never builds a request, and
 * the allowed path only constructs the backend object.
 */
describe('paid-backend gate for the eval tools', () => {
  const had = process.env['FIREWORKS_API_KEY'];
  const hadModel = process.env['FIREWORKS_MODEL'];
  afterEach(() => {
    if (had === undefined) delete process.env['FIREWORKS_API_KEY'];
    else process.env['FIREWORKS_API_KEY'] = had;
    if (hadModel === undefined) delete process.env['FIREWORKS_MODEL'];
    else process.env['FIREWORKS_MODEL'] = hadModel;
  });

  it('scores the offline mock when no key is configured, at no cost', () => {
    delete process.env['FIREWORKS_API_KEY'];
    const choice = evalBackend(48, undefined);
    expect(choice.paid).toBe(false);
    expect(choice.backend!.modelId).toBe('mock/reflex-policy');
    expect(choice.refusal).toBeUndefined();
  });

  it('refuses a keyed lab that did not ask to pay, and says what it would have cost', () => {
    process.env['FIREWORKS_API_KEY'] = 'not-a-real-key';
    process.env['FIREWORKS_MODEL'] = 'accounts/fireworks/models/test-model';
    const choice = evalBackend(48, undefined);
    expect(choice.backend).toBeNull();
    expect(choice.paid).toBe(true);
    expect(choice.refusal).toContain('48 completions');
    expect(choice.refusal).toContain('allowPaid');
    expect(choice.refusal).toContain('test-model');
    // `allowPaid: false` is still a refusal — only an explicit true opens it.
    expect(evalBackend(48, false).backend).toBeNull();
  });

  it('opens the paid model only on an explicit allowPaid', () => {
    process.env['FIREWORKS_API_KEY'] = 'not-a-real-key';
    process.env['FIREWORKS_MODEL'] = 'accounts/fireworks/models/test-model';
    const choice = evalBackend(48, true);
    expect(choice.paid).toBe(true);
    expect(choice.backend!.modelId).toBe('accounts/fireworks/models/test-model');
  });
});
