import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ApiError } from '../src/http/errors.js';
import { parseInput } from '../src/http/validation.js';

const schema = z.object({
  name: z.string().min(1),
  settings: z.object({ serviceLevel: z.number().min(0).max(1) }),
});

describe('parseInput', () => {
  it('returns the typed value when valid', () => {
    const value = parseInput(schema, { name: 'Dec peak', settings: { serviceLevel: 0.9 } }, 'body');
    expect(value.settings.serviceLevel).toBe(0.9);
  });

  it('throws a validation_failed ApiError with field details when invalid', () => {
    try {
      parseInput(schema, { name: '', settings: { serviceLevel: 2 } }, 'body');
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      expect(apiErr.code).toBe('validation_failed');
      expect(apiErr.status).toBe(422);
      expect(apiErr.details.map((d) => d.path).sort()).toEqual([
        'body.name',
        'body.settings.serviceLevel',
      ]);
    }
  });

  it('reports a missing body at the root path', () => {
    try {
      parseInput(schema, undefined, 'body');
      expect.unreachable();
    } catch (err) {
      expect((err as ApiError).details[0]?.path).toBe('body');
    }
  });
});
