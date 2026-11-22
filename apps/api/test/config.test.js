/**
 * Tests for config validation: bad environment variables must fail fast and clearly.
 */
import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config.js';

const valid = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  AUTH_SECRET: 'x'.repeat(32),
};

describe('loadConfig', () => {
  it('accepts a valid environment and fills in defaults', () => {
    const config = loadConfig(valid);

    expect(config.API_PORT).toBe(4000); // default
    expect(config.NODE_ENV).toBe('development'); // default
  });

  it('turns the port string from the environment into a number', () => {
    expect(loadConfig({ ...valid, API_PORT: '5050' }).API_PORT).toBe(5050);
  });

  it('fails with a message naming the missing variable', () => {
    expect(() => loadConfig({ REDIS_URL: valid.REDIS_URL })).toThrow(/DATABASE_URL/);
  });

  it('rejects a short AUTH_SECRET', () => {
    expect(() => loadConfig({ ...valid, AUTH_SECRET: 'too-short' })).toThrow(/AUTH_SECRET/);
  });

  describe('payments and key safety', () => {
    it('defaults to the simulator, and an empty key counts as "not set"', () => {
      const config = loadConfig({ ...valid, PAYSTACK_SECRET_KEY: '', PAYSTACK_PUBLIC_KEY: '' });
      expect(config.PAYMENT_PROVIDER).toBe('simulator');
      expect(config.PAYSTACK_SECRET_KEY).toBeUndefined();
    });

    it('REFUSES TO START with a live secret or public key', () => {
      expect(() => loadConfig({ ...valid, PAYSTACK_SECRET_KEY: 'sk_live_abc123' })).toThrow(
        /LIVE key refused/,
      );
      expect(() => loadConfig({ ...valid, PAYSTACK_PUBLIC_KEY: 'pk_live_abc123' })).toThrow(
        /LIVE key refused/,
      );
    });

    it('accepts test keys', () => {
      const config = loadConfig({
        ...valid,
        PAYMENT_PROVIDER: 'paystack',
        PAYSTACK_SECRET_KEY: 'sk_test_abc123',
        PAYSTACK_PUBLIC_KEY: 'pk_test_abc123',
      });
      expect(config.PAYMENT_PROVIDER).toBe('paystack');
    });

    it('refuses Paystack mode without a key', () => {
      expect(() => loadConfig({ ...valid, PAYMENT_PROVIDER: 'paystack' })).toThrow(
        /needs PAYSTACK_SECRET_KEY/,
      );
    });
  });

  it('rejects a database URL that is not PostgreSQL', () => {
    expect(() => loadConfig({ ...valid, DATABASE_URL: 'mysql://localhost/db' })).toThrow(
      /DATABASE_URL/,
    );
  });
});

describe('WhatsApp (stage 13c-3)', () => {
  it('is optional; half a set-up is refused at start, naming what’s missing', () => {
    expect(loadConfig({ ...valid }).WHATSAPP_ACCESS_TOKEN).toBeUndefined();
    expect(loadConfig({ ...valid }).WHATSAPP_GRAPH_VERSION).toBe('v23.0');
    expect(() => loadConfig({ ...valid, WHATSAPP_ACCESS_TOKEN: 'EAA' + 'x'.repeat(40) })).toThrow(
      /WHATSAPP_ACCESS_TOKEN needs WHATSAPP_APP_SECRET and WHATSAPP_VERIFY_TOKEN/,
    );
    const ok = loadConfig({
      ...valid,
      WHATSAPP_ACCESS_TOKEN: 'EAA' + 'x'.repeat(40),
      WHATSAPP_APP_SECRET: 'a'.repeat(32),
      WHATSAPP_VERIFY_TOKEN: 'v'.repeat(24),
    });
    expect(ok.WHATSAPP_APP_SECRET).toBe('a'.repeat(32));
    expect(() => loadConfig({ ...valid, WHATSAPP_GRAPH_VERSION: 'latest' })).toThrow();
  });
});

describe('the AI companion (stage 18a)', () => {
  it('the fake and a $10 cap by default; Claude needs a key; the key must look like one', () => {
    const d = loadConfig({ ...valid });
    expect(d.AI_PROVIDER).toBe('fake');
    expect(d.AI_MONTHLY_CAP_USD).toBe(10);
    expect(d.ANTHROPIC_API_KEY).toBeUndefined();
    expect(() => loadConfig({ ...valid, AI_PROVIDER: 'anthropic' })).toThrow(
      /AI_PROVIDER=anthropic needs ANTHROPIC_API_KEY/,
    );
    const ok = loadConfig({
      ...valid,
      AI_PROVIDER: 'anthropic',
      ANTHROPIC_API_KEY: 'sk-ant-test-abc_123',
      AI_MONTHLY_CAP_USD: '15',
    });
    expect(ok.AI_MONTHLY_CAP_USD).toBe(15);
    expect(() => loadConfig({ ...valid, ANTHROPIC_API_KEY: 'sk-proj-abc' })).toThrow(
      /must be an Anthropic API key/,
    );
    expect(() => loadConfig({ ...valid, AI_MONTHLY_CAP_USD: '0' })).toThrow();
    expect(() => loadConfig({ ...valid, AI_MONTHLY_CAP_USD: '500' })).toThrow();
  });
});
