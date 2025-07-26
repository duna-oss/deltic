// @ts-check

import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import {globalIgnores} from 'eslint/config';

export default tseslint.config(
    eslint.configs.recommended,
    tseslint.configs.recommended,
    {
        files: ['./packages/**/*.ts', './*.config.*'],
        rules: {
            '@typescript-eslint/no-explicit-any': 'off',
            'object-curly-spacing': [
                'error',
                'never'
            ],
            'quotes': [
                'error',
                'single',
                {
                    'allowTemplateLiterals': false,
                    'avoidEscape': true
                }
            ],
            'semi': [
                'error',
                'always'
            ],
        },
    },
    globalIgnores(['**/dist']),
);