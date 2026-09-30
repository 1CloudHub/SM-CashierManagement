import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { REDACTED, createLogger, isSensitiveKey } from '../src/logger.js';

function capture() {
  const lines: string[] = [];
  return { lines, sink: (line: string) => lines.push(line) };
}

describe('structured logger', () => {
  it('writes one JSON line with level, time, msg and base fields', () => {
    const { lines, sink } = capture();
    const log = createLogger({
      sink,
      level: 'info',
      base: { service: 'lanewise-api', env: 'test' },
      now: () => new Date('2026-10-01T00:00:00.000Z'),
    });
    log.info('hello', { requestId: 'r1' });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] as string)).toEqual({
      level: 'info',
      time: '2026-10-01T00:00:00.000Z',
      msg: 'hello',
      service: 'lanewise-api',
      env: 'test',
      requestId: 'r1',
    });
  });

  it('drops entries below the configured level', () => {
    const { lines, sink } = capture();
    const log = createLogger({ sink, level: 'warn' });
    log.debug('d');
    log.info('i');
    log.warn('w');
    log.error('e');
    expect(lines.map((l) => (JSON.parse(l) as { level: string }).level)).toEqual(['warn', 'error']);
  });

  it('child loggers inherit and extend base fields', () => {
    const { lines, sink } = capture();
    const log = createLogger({ sink, base: { service: 's' } }).child({ requestId: 'abc' });
    log.info('x');
    expect(JSON.parse(lines[0] as string)).toMatchObject({ service: 's', requestId: 'abc' });
  });

  it('serialises errors without throwing and keeps name and message', () => {
    const { lines, sink } = capture();
    createLogger({ sink }).error('boom', { err: new TypeError('bad') });
    const entry = JSON.parse(lines[0] as string) as { err: { name: string; message: string } };
    expect(entry.err).toMatchObject({ name: 'TypeError', message: 'bad' });
  });

  it('survives circular structures', () => {
    const { lines, sink } = capture();
    const a: Record<string, unknown> = { name: 'a' };
    a.self = a;
    createLogger({ sink }).info('circular', { a });
    expect(() => JSON.parse(lines[0] as string)).not.toThrow();
  });

  it('never leaks values under sensitive keys, at any depth (property)', () => {
    const secret = 'S3CR3T-VALUE-DO-NOT-LOG';
    const sensitiveKey = fc.constantFrom(
      'authorization',
      'Authorization',
      'cookie',
      'password',
      'accessToken',
      'idToken',
      'secret',
      'x-api-key',
    );
    // Arbitrary nested object with the secret placed under a sensitive key somewhere.
    const nested: fc.Arbitrary<Record<string, unknown>> = fc.letrec<{ node: Record<string, unknown> }>(
      (tie) => ({
        node: fc.oneof(
          { depthSize: 'small' },
          sensitiveKey.map((k) => ({ [k]: secret })),
          fc.record({
            // Keys that are never sensitive, so the secret can only appear under a sensitive key.
            child: tie('node'),
            other: fc.integer(),
            list: fc.array(tie('node'), { maxLength: 2 }),
          }),
        ),
      }),
    ).node;

    fc.assert(
      fc.property(nested, (fields) => {
        const { lines, sink } = capture();
        createLogger({ sink }).info('msg', fields);
        expect(lines).toHaveLength(1);
        expect(lines[0]).not.toContain(secret);
        expect(lines[0] as string).not.toMatch(/\n/);
      }),
    );
  });

  it('classifies sensitive keys case-insensitively', () => {
    expect(isSensitiveKey('Authorization')).toBe(true);
    expect(isSensitiveKey('refresh_token')).toBe(true);
    expect(isSensitiveKey('requestId')).toBe(false);
    expect(REDACTED).toBe('[REDACTED]');
  });
});
