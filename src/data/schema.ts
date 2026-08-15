/**
 * Shared schema types, built-in field constants, and value helpers.
 */

export type FieldType =
	| "string"
	| "number"
	| "boolean"
	| "date"
	| "tags"
	| "list"
	| "unknown";

export interface FieldInfo {
	/** Stable key: frontmatter key, or a `$`-prefixed built-in field. */
	name: string;
	/** Human friendly label for the UI. */
	label: string;
	type: FieldType;
	/** How many files have this field populated. */
	presentCount: number;
	/** Total files scanned. */
	fileCount: number;
}

export interface VaultRow {
	path: string;
	name: string;
	folder: string;
	ctime: number;
	mtime: number;
	size: number;
	tags: string[];
	values: Record<string, unknown>;
}

/** Built-in file fields (prefixed with `$` so they never collide with frontmatter keys). */
export const F_PATH = "$path";
export const F_NAME = "$name";
export const F_FOLDER = "$folder";
export const F_CTIME = "$ctime";
export const F_MTIME = "$mtime";
export const F_SIZE = "$size";
export const F_TAGS = "$tags";

export const BUILTIN_FIELDS = [F_PATH, F_NAME, F_FOLDER, F_CTIME, F_MTIME, F_SIZE, F_TAGS];

/** Special value field: count of files. */
export const COUNT_FIELD = "__count";

export function fieldLabel(name: string): string {
	switch (name) {
		case F_PATH:
			return "File · Path";
		case F_NAME:
			return "File · Name";
		case F_FOLDER:
			return "File · Folder";
		case F_CTIME:
			return "File · Created";
		case F_MTIME:
			return "File · Modified";
		case F_SIZE:
			return "File · Size (bytes)";
		case F_TAGS:
			return "File · Tags";
		case COUNT_FIELD:
			return "Count of files";
		default:
			return name;
	}
}

export function isBuiltin(field: string): boolean {
	return field.startsWith("$");
}

export function getFieldValue(row: VaultRow, field: string): unknown {
	switch (field) {
		case F_PATH:
			return row.path;
		case F_NAME:
			return row.name;
		case F_FOLDER:
			return row.folder;
		case F_CTIME:
			return row.ctime;
		case F_MTIME:
			return row.mtime;
		case F_SIZE:
			return row.size;
		case F_TAGS:
			return row.tags;
		default:
			return row.values[field];
	}
}

/** Render any value as a compact display string. */
export function displayValue(value: unknown): string {
	if (value === null || value === undefined) return "";
	if (Array.isArray(value)) return value.join(", ");
	if (typeof value === "boolean") return value ? "true" : "false";
	if (typeof value === "number") {
		if (!Number.isFinite(value)) return "";
		return String(value);
	}
	return String(value);
}

/** Compact number formatting: 1234 -> 1.2k, 3_200_000 -> 3.2M. */
export function formatNumber(n: number): string {
	if (n === null || n === undefined || Number.isNaN(n)) return "—";
	const abs = Math.abs(n);
	if (abs >= 1e6) return trimZeros(n / 1e6) + "M";
	if (abs >= 1e3) return trimZeros(n / 1e3) + "k";
	return trimZeros(n);
}

/** How many distinct display values a field has across the given rows. */
export function countDistinct(rows: VaultRow[], field: string): number {
	const seen = new Set<string>();
	for (const r of rows) {
		seen.add(displayValue(getFieldValue(r, field)));
	}
	return seen.size;
}

function trimZeros(n: number): string {
	if (Number.isInteger(n)) return String(n);
	return String(Math.round(n * 100) / 100);
}
