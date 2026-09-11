// ESLint flat config — enforces CODING-STANDARDS.md. Type-aware rules need tsconfig.json.
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const SIZE_LIMITS = {
  'max-lines': ['error', { max: 250, skipBlankLines: true, skipComments: true }],
  'max-lines-per-function': ['error', { max: 40, skipBlankLines: true, skipComments: true }],
  complexity: ['error', 10],
  'max-depth': ['error', 3],
  'max-params': ['error', 4],
};

const NAMING = [
  'error',
  { selector: 'default', format: ['camelCase'], leadingUnderscore: 'forbid' },
  { selector: 'variable', format: ['camelCase', 'UPPER_CASE'] },
  { selector: 'import', format: ['camelCase', 'PascalCase'] },
  { selector: 'typeLike', format: ['PascalCase'] },
  { selector: 'interface', format: ['PascalCase'], custom: { regex: '^I[A-Z]', match: false } },
  { selector: 'classProperty', modifiers: ['static', 'readonly'], format: ['UPPER_CASE'] },
  // Wire formats (hook payloads, statusline JSON, cost-state) are snake_case — leave them alone.
  { selector: ['objectLiteralProperty', 'typeProperty'], format: null },
];

const FORBIDDEN_SYNTAX = [
  'error',
  { selector: 'ExportDefaultDeclaration', message: 'Named exports only (R11).' },
  {
    selector: 'TSEnumDeclaration',
    message: 'Use a union of string literals (R14, erasable syntax).',
  },
  {
    // Bare `exec(...)` / `execSync(...)` only. The member form used to be here too, as
    // `callee.property.name=/^(exec|execSync)$/`, and it matched every `regex.exec(...)` in the
    // repo — putting it in a straight fight with @typescript-eslint/prefer-regexp-exec, which
    // demands exactly that call. The import ban below covers the member form precisely and
    // cannot mistake a regex for a shell (SEC-PROC-1).
    selector: 'CallExpression[callee.name=/^(exec|execSync)$/]',
    message: 'Use spawn/execFile with an argument array (SEC-PROC-1).',
  },
  {
    selector: "Property[key.name='shell'][value.value=true]",
    message: 'shell: true is forbidden (SEC-PROC-1).',
  },
  {
    selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
    message: 'Render model text as text (SEC-UI-2).',
  },
];

// The dependency rule: domain knows nothing about the outside world (§2).
const DOMAIN_FORBIDDEN_IMPORTS = [
  'error',
  {
    patterns: [
      { group: ['node:*'], message: 'domain/ imports no Node built-ins.' },
      { group: ['ws', 'node-pty', 'yaml'], message: 'domain/ imports no infrastructure.' },
      {
        group: ['**/adapters/**', '**/http/**', '**/application/**'],
        message: 'Dependencies point inward.',
      },
    ],
  },
];

export default tseslint.config(
  { ignores: ['node_modules/', '.next/', 'coverage/', 'dist/', 'out/', 'src-tauri/', '**/*.d.ts'] },

  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  {
    languageOptions: {
      // Both projects, because the app compiles against the DOM and core/ must not
      // (tsconfig.app.json). The service only discovers `tsconfig.json`, so app/, middleware.ts
      // and next.config.ts would otherwise be parsed by no project and fail to lint at all.
      parserOptions: {
        project: ['./tsconfig.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.node },
    },
  },

  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      ...SIZE_LIMITS,
      'no-console': 'error',
      eqeqeq: ['error', 'always'],
      'no-restricted-syntax': FORBIDDEN_SYNTAX,
      // The real control, and alias-proof: the shell-string spawners cannot be imported at all,
      // however they are renamed. `spawn`, `execFile` and their sync forms take argument arrays
      // and stay allowed (SEC-PROC-1).
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'node:child_process',
              importNames: ['exec', 'execSync'],
              message: 'Use spawn/execFile with an argument array (SEC-PROC-1).',
            },
            {
              name: 'child_process',
              message: "Import 'node:child_process'; exec and execSync are banned (SEC-PROC-1).",
            },
          ],
        },
      ],
      '@typescript-eslint/naming-convention': NAMING,
      '@typescript-eslint/explicit-member-accessibility': [
        'error',
        { accessibility: 'explicit', overrides: { constructors: 'no-public' } },
      ],
      '@typescript-eslint/explicit-function-return-type': ['error', { allowExpressions: true }],
      '@typescript-eslint/member-ordering': 'error',
      '@typescript-eslint/prefer-readonly': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },

  { files: ['core/domain/**/*.ts'], rules: { 'no-restricted-imports': DOMAIN_FORBIDDEN_IMPORTS } },

  // React components are PascalCase functions — a framework convention the default camelCase rule
  // cannot express. Everything else in app/ keeps the project rules, including return types: a
  // component's type is part of its contract just like any other exported function's.
  {
    files: ['app/**/*.tsx'],
    rules: {
      '@typescript-eslint/naming-convention': [
        'error',
        ...NAMING.slice(1),
        { selector: 'function', format: ['camelCase', 'PascalCase'] },
      ],
    },
  },

  // A route handler's exports ARE the HTTP verbs — `export async function GET` is the framework's
  // only way to name a method, the same kind of convention that makes components PascalCase.
  {
    files: ['app/**/route.ts'],
    rules: {
      '@typescript-eslint/naming-convention': [
        'error',
        ...NAMING.slice(1),
        { selector: 'function', format: ['camelCase', 'UPPER_CASE'] },
      ],
    },
  },

  // Scripts and tests may print and may be longer; they still obey the OOP and security rules.
  {
    files: ['scripts/**/*.ts', 'tests/**/*.ts'],
    rules: { 'no-console': 'off', 'max-lines-per-function': 'off' },
  },

  // Framework files that must default-export.
  {
    files: [
      '*.config.ts',
      'app/**/page.tsx',
      'app/**/layout.tsx',
      'app/**/error.tsx',
      'app/**/not-found.tsx',
    ],
    rules: { 'no-restricted-syntax': ['error', ...FORBIDDEN_SYNTAX.slice(2)] },
  },

  // Playwright specs run IN a browser page via page.evaluate, so they legitimately mention
  // `document` and `window` while living outside the DOM TypeScript project.
  {
    files: ['tests/e2e/**/*.mjs'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },

  // Plain JS config files are not part of the TypeScript project.
  {
    files: ['**/*.mjs', '**/*.js'],
    ...tseslint.configs.disableTypeChecked,
    rules: { ...tseslint.configs.disableTypeChecked.rules, 'no-console': 'off' },
  },
);
