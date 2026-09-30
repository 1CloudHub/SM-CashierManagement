// ESLint flat config for @lanewise/domain (pure TypeScript, no runtime I/O).
// Mirrors infra/eslint.config.mjs, plus purity guards for src/.
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', '**/*.js', '**/*.d.ts'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.mjs'],
    languageOptions: { globals: globals.node },
  },
  {
    // The domain must stay pure: no I/O, no clocks, no ambient randomness.
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: ['node:*', 'fs', 'path', 'http', 'https', 'child_process', 'os', 'net'] },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Use the seeded PRNG (src/demo/prng.ts).' },
        { object: 'Date', property: 'now', message: 'Domain functions take dates as inputs.' },
      ],
    },
  },
);
