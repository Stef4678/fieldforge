// ESLint flat config mirroring the Obsidian community review rules.
import tsparser from "@typescript-eslint/parser";
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
	...obsidianmd.configs.recommended,
	{
		files: ["**/*.ts"],
		languageOptions: {
			parser: tsparser,
			parserOptions: { project: "./tsconfig.json" },
		},
		rules: {
			// Treat known proper nouns as brands/acronyms so UI strings
			// keep their intended capitalization.
			"obsidianmd/ui/sentence-case": [
				"warn",
				{ brands: ["FieldForge", "Markdown"], acronyms: ["MD", "CSV"] },
			],
		},
	},
	{
		ignores: ["main.js", "node_modules/", "preview.html", ".npm-cache/"],
	},
]);
