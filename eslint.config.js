// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import importX from 'eslint-plugin-import-x';
import globals from 'globals';

const OTHER_PACKAGES = ['core', 'render', 'io', 'tracking', 'audio'];

// パッケージから参照してよいのは @app/schema と @app/contracts だけ（カード01）
/** @param {string[]} allowed */
function onlyAllow(allowed) {
  return {
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: ['@app/*', ...allowed.map((name) => `!@app/${name}`)],
            message: `このパッケージから参照してよいのは ${allowed.length ? allowed.map((n) => '@app/' + n).join(' と ') : '（なし）'} だけ`,
          },
          {
            group: ['**/apps/desktop/**'],
            message: 'パッケージから apps/desktop は参照できない',
          },
        ],
      },
    ],
  };
}

export default tseslint.config(
  {
    ignores: [
      'files/**',
      '**/node_modules/**',
      '**/dist/**',
      '**/target/**',
      '.cache/**',
      '.pnpm-store/**',
      'projects/**',
      'fixtures/scripts/build-desktop-character.ts',
      'apps/desktop/src-tauri/gen/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { 'import-x': importX },
    settings: {
      'import-x/resolver-next': [importX.createNodeResolver({ extensions: ['.ts', '.tsx', '.js', '.mjs', '.json'] })],
    },
    rules: {
      // ほかのパッケージの中を相対パスで覗くのを禁止する（@app/... で参照する）
      'import-x/no-relative-packages': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  { files: ['packages/schema/**'], rules: onlyAllow([]) },
  { files: ['packages/contracts/**'], rules: onlyAllow(['schema']) },
  {
    files: OTHER_PACKAGES.map((name) => `packages/${name}/**`),
    rules: onlyAllow(['schema', 'contracts']),
  },
  // パッケージのテストは fixtures（テスト用の素材）も参照してよい
  {
    files: ['packages/*/src/**/*.test.ts', 'packages/*/src/**/*.test.tsx'],
    ignores: ['packages/schema/**', 'packages/contracts/**'],
    rules: onlyAllow(['schema', 'contracts', 'fixtures']),
  },
  // core は DOM に依存しない（型だけは contracts から入ってくるので、値として使うものを止める）
  {
    files: ['packages/core/**'],
    rules: {
      'no-restricted-globals': [
        'error',
        ...['window', 'document', 'navigator', 'localStorage', 'requestAnimationFrame', 'createImageBitmap'].map(
          (name) => ({ name, message: 'core は DOM に依存しない' }),
        ),
      ],
    },
  },
);
