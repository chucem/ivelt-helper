// ESLint for the extension (run by .github/workflows/check.yml): only rules that catch real
// mistakes, not style. The scripts share globals across files and with the forum's own code
// ($, phpbb, insert_text), so undefined and unused names aren't checked.
export default [
	{ ignores: ['extension/_metadata/**'] },
	{
		files: ['extension/**/*.js'],
		languageOptions: { ecmaVersion: 'latest', sourceType: 'script' },
		rules: {
			'no-dupe-keys': 'error',
			'no-dupe-args': 'error',
			'no-dupe-else-if': 'error',
			'no-duplicate-case': 'error',
			'no-unreachable': 'error',
			'no-unsafe-finally': 'error',
			'no-unsafe-negation': 'error',
			'no-self-assign': 'error',
			'no-const-assign': 'error',
			'no-func-assign': 'error',
			'no-import-assign': 'error',
			'no-cond-assign': 'error',
			'no-compare-neg-zero': 'error',
			'no-constant-binary-expression': 'error',
			'no-loss-of-precision': 'error',
			'no-sparse-arrays': 'error',
			'no-empty-character-class': 'error',
			'no-invalid-regexp': 'error',
			'no-debugger': 'error',
			'use-isnan': 'error',
			'valid-typeof': 'error',
			'getter-return': 'error'
		}
	}
];
