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
