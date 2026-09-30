import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  API_ERROR_CODES,
  AUDIT_ACTIONS,
  HTTP_STATUS_BY_ERROR_CODE,
  isApiErrorCode,
  provenanceOf,
} from '../src/index.js';

describe('provenanceOf (foundation for P18 demo-data isolation)', () => {
  it('classifies a record set as synthetic, real, mixed or empty', () => {
    fc.assert(
      fc.property(fc.array(fc.record({ synthetic: fc.boolean() }), { maxLength: 30 }), (records) => {
        const result = provenanceOf(records);
        const synth = records.filter((r) => r.synthetic).length;
        if (records.length === 0) expect(result).toBe('empty');
        else if (synth === records.length) expect(result).toBe('synthetic');
        else if (synth === 0) expect(result).toBe('real');
        else expect(result).toBe('mixed');
      }),
    );
  });

  it('adding a record of the other kind to a pure set always makes it mixed', () => {
    fc.assert(
      fc.property(fc.boolean(), fc.integer({ min: 1, max: 20 }), (synthetic, n) => {
        const pure = Array.from({ length: n }, () => ({ synthetic }));
        expect(provenanceOf([...pure, { synthetic: !synthetic }])).toBe('mixed');
      }),
    );
  });
});

describe('API error model', () => {
  it('maps every error code to a 4xx/5xx HTTP status', () => {
    for (const code of API_ERROR_CODES) {
      const status = HTTP_STATUS_BY_ERROR_CODE[code];
      expect(status).toBeGreaterThanOrEqual(400);
      expect(status).toBeLessThan(600);
    }
    expect(HTTP_STATUS_BY_ERROR_CODE.internal_error).toBe(500);
    expect(HTTP_STATUS_BY_ERROR_CODE.forbidden).toBe(403);
  });

  it('isApiErrorCode accepts exactly the known codes (property)', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        expect(isApiErrorCode(s)).toBe((API_ERROR_CODES as readonly string[]).includes(s));
      }),
    );
  });
});

describe('audit actions', () => {
  it('cover every auditable action named by P7', () => {
    expect(AUDIT_ACTIONS).toEqual([
      'create',
      'edit',
      'submit',
      'decision',
      'publish',
      'ingestion',
      'export',
      'role_change',
    ]);
  });
});
