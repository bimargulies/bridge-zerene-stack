import esx from "eslint-plugin-es-x";
import tseslint from "typescript-eslint";

export default tseslint.config(
	{ ignores: ["dist/", "node_modules/", "eslint.config.js", "scripts/"] },
	...tseslint.configs.recommendedTypeChecked,
	{
		files: ["src/**/*.ts"],
		languageOptions: {
			parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
		},
		plugins: { "es-x": esx },
		// ExtendScript is ES3: flag newer runtime APIs, which tsc does not polyfill.
		settings: { "es-x": { aggressive: true } },
		rules: {
			...esx.configs["flat/restrict-to-es3"].rules,
			// tsc down-levels this syntax; check-generated.mjs proves the output parses as ES3.
			"es-x/no-block-scoped-variables": "off",
			// The Adobe DOM is only loosely typed here, on purpose.
			"@typescript-eslint/no-explicit-any": "off",
			"@typescript-eslint/no-unsafe-assignment": "off",
			"@typescript-eslint/no-unsafe-member-access": "off",
			"@typescript-eslint/no-unsafe-call": "off",
			"@typescript-eslint/no-unsafe-argument": "off",
			"@typescript-eslint/no-unsafe-return": "off",
			// Concatenating a caught error into a message is the idiom here.
			"@typescript-eslint/restrict-plus-operands": "off",
			// ES3 requires a binding in catch clauses; these two are called by name from scheduleTask strings.
			"@typescript-eslint/no-unused-vars": ["error", { caughtErrors: "none", varsIgnorePattern: "^(pollDngConverter|convertFolderNow)$" }],
		},
	},
	{
		files: ["src/globals.d.ts"],
		rules: { "es-x/no-classes": "off", "no-var": "off" },
	},
);
