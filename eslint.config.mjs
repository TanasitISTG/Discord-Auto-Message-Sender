import js from '@eslint/js';
import prettierConfig from 'eslint-config-prettier';
import globals from 'globals';
import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import reactRefreshPlugin from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

const baseFiles = ['**/*.{js,cjs,mjs,ts,cts,mts,tsx}'];
const tsFiles = ['**/*.{ts,cts,mts,tsx}'];
const commonJsFiles = ['**/*.{js,cjs}'];
const mjsFiles = ['**/*.mjs'];
const ignoredPaths = [
    'node_modules/**',
    'dist/**',
    'coverage/**',
    'src-tauri/target/**',
    'src-tauri/gen/**',
    'src-tauri/resources/sidecar/**',
    'src/desktop/contracts.ts',
];
const testGlobals = {
    ...globals.node,
    ...globals.browser,
    describe: 'readonly',
    it: 'readonly',
    test: 'readonly',
    expect: 'readonly',
    beforeEach: 'readonly',
    afterEach: 'readonly',
    beforeAll: 'readonly',
    afterAll: 'readonly',
    vi: 'readonly',
};

export default tseslint.config(
    {
        ignores: ignoredPaths,
    },
    {
        files: baseFiles,
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
        },
    },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        files: ['app/src/**/*.{ts,tsx}'],
        plugins: {
            react: reactPlugin,
            'react-hooks': reactHooksPlugin,
            'react-refresh': reactRefreshPlugin,
        },
        languageOptions: {
            globals: globals.browser,
            parserOptions: {
                ecmaFeatures: {
                    jsx: true,
                },
            },
        },
        settings: {
            react: {
                version: 'detect',
            },
        },
        rules: {
            ...reactPlugin.configs.recommended.rules,
            ...reactHooksPlugin.configs.recommended.rules,
            'react/react-in-jsx-scope': 'off',
            'react/prop-types': 'off',
            'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
        },
    },
    {
        files: ['app/src/components/ui/**/*.{ts,tsx}'],
        rules: {
            'react-refresh/only-export-components': 'off',
        },
    },
    {
        files: ['src/**/*.{ts,mts,cts}', 'scripts/**/*.{ts,js,mjs,cjs}'],
        languageOptions: {
            globals: globals.node,
        },
    },
    {
        files: ['test/**/*.{ts,tsx}'],
        languageOptions: {
            globals: testGlobals,
        },
    },
    {
        files: tsFiles,
        rules: {
            '@typescript-eslint/no-unused-vars': [
                'error',
                {
                    argsIgnorePattern: '^_',
                    varsIgnorePattern: '^_',
                    caughtErrorsIgnorePattern: '^_',
                },
            ],
            '@typescript-eslint/no-explicit-any': 'off',
            'no-console': 'off',
        },
    },
    {
        files: commonJsFiles,
        languageOptions: {
            sourceType: 'commonjs',
            globals: globals.node,
        },
        rules: {
            '@typescript-eslint/no-require-imports': 'off',
            'no-unused-vars': [
                'error',
                {
                    argsIgnorePattern: '^_',
                    varsIgnorePattern: '^_',
                    caughtErrorsIgnorePattern: '^_',
                },
            ],
            'no-console': 'off',
        },
    },
    {
        files: mjsFiles,
        languageOptions: {
            sourceType: 'module',
            globals: globals.node,
        },
        rules: {
            'no-unused-vars': [
                'error',
                {
                    argsIgnorePattern: '^_',
                    varsIgnorePattern: '^_',
                    caughtErrorsIgnorePattern: '^_',
                },
            ],
            'no-console': 'off',
        },
    },
    prettierConfig,
);
