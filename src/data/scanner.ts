/**
 * Scans the vault's frontmatter (via the metadata cache — fast, no file reads)
 * and produces rows + a typed field catalog.
 */

import { MetadataCache, TFile, Vault } from "obsidian";
import {
	BUILTIN_FIELDS,
	F_CTIME,
	F_MTIME,
	F_NAME,
	F_PATH,
	F_SIZE,
	F_TAGS,
	F_FOLDER,
	FieldInfo,
	FieldType,
	VaultRow,
} from "./schema";

/** Keys that Obsidian injects into the frontmatter cache object. */
const SKIP_KEYS = new Set(["position", "source", "file"]);

export function inferType(value: unknown): FieldType {
	if (typeof value === "number") return "number";
	if (typeof value === "boolean") return "boolean";
	if (value instanceof Date) return "date";
	if (Array.isArray(value)) {
		if (value.length === 0) return "list";
		const inner = new Set(value.map((v) => inferType(v)));
		if (inner.size === 1 && inner.has("string")) return "tags";
		return "list";
	}
	if (typeof value === "string") {
		const t = value.trim();
		if (t === "") return "unknown";
		if (/^\d{4}-\d{1,2}-\d{1,2}([T\s].*)?$/.test(t)) return "date";
		const n = Number(t.replace(/[,$\s%]/g, ""));
		if (!Number.isNaN(n) && t !== "") return "number";
		return "string";
	}
	return "unknown";
}

function builtinType(field: string): FieldType {
	switch (field) {
		case F_CTIME:
		case F_MTIME:
			return "date";
		case F_SIZE:
			return "number";
		case F_TAGS:
			return "tags";
		default:
			return "string";
	}
}

export class VaultScanner {
	constructor(
		private vault: Vault,
		private metadataCache: MetadataCache,
	) {}

	scan(): { rows: VaultRow[]; fields: FieldInfo[] } {
		const files = this.vault.getMarkdownFiles();
		const rows: VaultRow[] = [];
		const present = new Map<string, number>();
		const typeVotes = new Map<string, Map<FieldType, number>>();

		for (const file of files) {
			const cache = this.metadataCache.getFileCache(file);
			const fm = (cache?.frontmatter ?? {}) as Record<string, unknown>;
			const values: Record<string, unknown> = {};
			for (const [key, value] of Object.entries(fm)) {
				if (SKIP_KEYS.has(key) || key.startsWith("_")) continue;
				values[key] = value;
				present.set(key, (present.get(key) ?? 0) + 1);
				const t = inferType(value);
				const votes = typeVotes.get(key) ?? new Map<FieldType, number>();
				votes.set(t, (votes.get(t) ?? 0) + 1);
				typeVotes.set(key, votes);
			}

			const tags = (cache?.tags ?? []).map((t) => t.tag.replace(/^#/, ""));

			const parentPath = file.parent ? file.parent.path : "";
			const folder = parentPath === "" || parentPath === "/" ? "(root)" : parentPath;

			rows.push({
				path: file.path,
				name: file.basename,
				folder,
				ctime: file.stat.ctime,
				mtime: file.stat.mtime,
				size: file.stat.size,
				tags,
				values,
			});
		}

		// Built-in fields first, in a fixed, useful order.
		const fields: FieldInfo[] = BUILTIN_FIELDS.map((b) => ({
			name: b,
			label: labelFor(b),
			type: builtinType(b),
			presentCount: rows.length,
			fileCount: rows.length,
		}));

		// Then frontmatter fields, most-populated first.
		const fmFields: FieldInfo[] = [];
		for (const [name, count] of present) {
			const votes = typeVotes.get(name) ?? new Map();
			let best: FieldType = "unknown";
			let bestN = -1;
			for (const [t, n] of votes) {
				if (n > bestN) {
					best = t;
					bestN = n;
				}
			}
			fmFields.push({
				name,
				label: labelFor(name),
				type: best,
				presentCount: count,
				fileCount: rows.length,
			});
		}
		fmFields.sort((a, b) => b.presentCount - a.presentCount || a.name.localeCompare(b.name));
		fields.push(...fmFields);

		return { rows, fields };
	}
}

function labelFor(name: string): string {
	// Prettify snake_case / camelCase keys for the pickers.
	const pretty = name
		.replace(/([a-z])([A-Z])/g, "$1 $2")
		.replace(/[_-]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	return pretty.charAt(0).toUpperCase() + pretty.slice(1);
}
