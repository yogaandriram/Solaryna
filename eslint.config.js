import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const CORE_IO_MESSAGE =
  'packages/core must stay free of I/O: inject clocks, prices, and clients as arguments instead.';

export default defineConfig(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
      '**/next-env.d.ts',
      'packages/db/migrations/**',
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      eqeqeq: ['error', 'always'],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    files: ['packages/core/src/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                'node:*',
                'fs',
                'fs/*',
                'path',
                'http',
                'https',
                'net',
                'child_process',
                'mysql2',
                'mysql2/*',
                'drizzle-orm',
                'drizzle-orm/*',
                'pino',
                'grammy',
                'fastify',
                '@solaryna/db',
                '@solaryna/db/*',
                '@solaryna/config',
              ],
              message: CORE_IO_MESSAGE,
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: CORE_IO_MESSAGE },
        { name: 'process', message: CORE_IO_MESSAGE },
        { name: 'setTimeout', message: CORE_IO_MESSAGE },
        { name: 'setInterval', message: CORE_IO_MESSAGE },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message: CORE_IO_MESSAGE,
        },
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: CORE_IO_MESSAGE,
        },
        {
          selector: "CallExpression[callee.object.name='Math'][callee.property.name='random']",
          message: CORE_IO_MESSAGE,
        },
      ],
    },
  },
  prettier,
);
