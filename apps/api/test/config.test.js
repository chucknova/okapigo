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

  it('rejects a database URL that is not PostgreSQL', () => {
    expect(() => loadConfig({ ...valid, DATABASE_URL: 'mysql://localhost/db' })).toThrow(
      /DATABASE_URL/,
    );
  });
});
