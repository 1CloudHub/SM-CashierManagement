// ESLint flat config for @lanewise/matching (TypeScript, Node/ESM).
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
);
