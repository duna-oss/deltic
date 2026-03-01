// @ts-check

import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import {globalIgnores} from 'eslint/config';

export default tseslint.config(
    eslint.configs.recommended,
    tseslint.configs.recommended,
    {
        files: ['./packages/**/*.ts', './*.config.*'],
        ignores: ['docs/**/*'],
        rules: {
            '@typescript-eslint/method-signature-style': 'off',
            '@typescript-eslint/no-unused-vars': 'off',
            '@typescript-eslint/no-empty-object-type': 'off',
            '@typescript-eslint/no-explicit-any': 'off',
            'object-curly-spacing': ['error', 'never'],
            quotes: [
                'error',
                'single',
                {
                    allowTemplateLiterals: false,
                    avoidEscape: true,
                },
            ],
            semi: ['error', 'always'],
        },
    },
    globalIgnores(['**/dist', 'docs/**/*']),
);
