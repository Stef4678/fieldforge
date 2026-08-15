/**
 * The pivot engine: filter rows, bucket them by row/column field keys,
 * aggregate a value field, and produce a matrix ready for tables & charts.
 */

import { COUNT_FIELD, FieldType, VaultRow, displayValue, getFieldValue } from "./schema";

export type Aggregation = "count" | "sum" | "avg" | "min" | "max" | "distinct";
export type SortMode = "value-desc" | "value-asc" | "name-asc" | "name-desc";
export type FilterOp = "eq" | "neq" | "contains" | "gt" | "lt" | "exists" | "not-exists";

export interface Filter {
	field: string;
	op: FilterOp;
	value: string;
}

export interface PivotConfig {
	rowField: string;
	colField: string | null;
	valueField: string;
	aggregation: Aggregation;
	filters: Filter[];
	sort: SortMode;
	limitRows: number;
	showRowTotals: boolean;
	showColTotals: boolean;
}

export interface PivotResult {
	rowKeys: string[];
	colKeys: string[];
	/** matrix[row][col] — aggregated value or null when no numeric data. */
	matrix: (number | null)[][];
	/** Number of source files in each cell. */
	counts: number[][];
	/** File paths per cell (for tooltips / jump-to-note). */
	cellFiles: string[][][];
	rowTotals: number[];
	colTotals: (number | null)[];
	grandTotal: number | null;
	sourceCount: number;
	rowFieldType: FieldType;
	colFieldType: FieldType | null;
}

export const DEFAULT_CONFIG: PivotConfig = {
	rowField: "$folder",
	colField: null,
	valueField: COUNT_FIELD,
	aggregation: "count",
	filters: [],
	sort: "value-desc",
	limitRows: 20,
	showRowTotals: true,
	showColTotals: true,
};

const NO_KEY = "(none)";

function keyOf(value: unknown, type: FieldType): string {
	if (value === null || value === undefined) return NO_KEY;
	if (Array.isArray(value)) {
		const joined = value.map((v) => displayValue(v)).filter(Boolean).join(", ");
		return joined || NO_KEY;
	}
	if (typeof value === "boolean") return value ? "true" : "false";
	if (type === "date") {
		// Normalize timestamps and ISO date strings to YYYY-MM-DD so
		// each day/week is one group instead of one group per timestamp.
		const d = typeof value === "number" ? new Date(value) : new Date(String(value));
		if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
	}
	const s = displayValue(value);
	if (s === "/" || s === "") return "(root)";
	return s || NO_KEY;
}

function keyRank(key: string, type: FieldType): number {
	if (type === "number") return parseFloat(key) || 0;
	if (type === "date") {
		const t = Date.parse(key);
		return Number.isNaN(t) ? 0 : t;
	}
	return Number.NaN;
}

function compareKeys(a: string, b: string, type: FieldType): number {
	const ra = keyRank(a, type);
	const rb = keyRank(b, type);
	if (!Number.isNaN(ra) && !Number.isNaN(rb)) return ra - rb;
	return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

export function numericOf(row: VaultRow, valueField: string): number | null {
	if (valueField === COUNT_FIELD) return 1;
	const v = getFieldValue(row, valueField);
	if (typeof v === "number") return Number.isFinite(v) ? v : null;
	if (typeof v === "string") {
		const n = Number(v.replace(/[,$%\s]/g, ""));
		return Number.isNaN(n) ? null : n;
	}
	if (typeof v === "boolean") return v ? 1 : 0;
	return null;
}

type AggFn = (vals: number[]) => number | null;

const AGG_FNS: Record<Aggregation, AggFn> = {
	count: (vals) => vals.length,
	sum: (vals) => (vals.length ? vals.reduce((a, b) => a + b, 0) : null),
	avg: (vals) => (vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null),
	min: (vals) => (vals.length ? Math.min(...vals) : null),
	max: (vals) => (vals.length ? Math.max(...vals) : null),
	distinct: (vals) => new Set(vals).size,
};

function matchesFilter(row: VaultRow, f: Filter): boolean {
	const raw = getFieldValue(row, f.field);
	const str = displayValue(raw);
	const hasValue = raw !== null && raw !== undefined && str !== "";
	switch (f.op) {
		case "eq":
			return str.toLowerCase() === f.value.trim().toLowerCase();
		case "neq":
			return str.toLowerCase() !== f.value.trim().toLowerCase();
		case "contains":
			return str.toLowerCase().includes(f.value.trim().toLowerCase());
		case "gt":
		case "lt": {
			const n = Number(f.value);
			if (Number.isNaN(n)) return true; // invalid filter value: don't exclude
			const v = numericOf(row, f.field);
			if (v === null) return false;
			return f.op === "gt" ? v > n : v < n;
		}
		case "exists":
			return hasValue;
		case "not-exists":
			return !hasValue;
		default:
			return true;
	}
}

export function applyFilters(rows: VaultRow[], filters: Filter[]): VaultRow[] {
	if (!filters.length) return rows;
	return rows.filter((r) => filters.every((f) => matchesFilter(r, f)));
}

export function buildPivot(rows: VaultRow[], cfg: PivotConfig): PivotResult {
	const filtered = applyFilters(rows, cfg.filters);

	const rowType = inferRowType(filtered, cfg.rowField);
	const colType = cfg.colField ? inferRowType(filtered, cfg.colField) : null;

	// Bucket rows by row key.
	const rowBuckets = new Map<string, VaultRow[]>();
	for (const r of filtered) {
		const key = keyOf(getFieldValue(r, cfg.rowField), rowType);
		const bucket = rowBuckets.get(key);
		if (bucket) bucket.push(r);
		else rowBuckets.set(key, [r]);
	}

	// Collect column keys.
	const colSet = new Set<string>();
	if (cfg.colField) {
		for (const r of filtered) {
			colSet.add(keyOf(getFieldValue(r, cfg.colField), colType!));
		}
	}

	let rowKeys = [...rowBuckets.keys()];
	let colKeys = [...colSet];

	// Sort row keys.
	const valueOfRow = (key: string): number => {
		const bucket = rowBuckets.get(key)!;
		return aggregateBucket(bucket, cfg).value ?? -Infinity;
	};
	switch (cfg.sort) {
		case "name-asc":
			rowKeys.sort((a, b) => compareKeys(a, b, rowType));
			break;
		case "name-desc":
			rowKeys.sort((a, b) => compareKeys(b, a, rowType));
			break;
		case "value-asc":
			rowKeys.sort((a, b) => valueOfRow(a) - valueOfRow(b));
			break;
		case "value-desc":
		default:
			rowKeys.sort((a, b) => valueOfRow(b) - valueOfRow(a));
			break;
	}
	if (cfg.limitRows > 0 && rowKeys.length > cfg.limitRows) {
		rowKeys = rowKeys.slice(0, cfg.limitRows);
	}

	// Sort column keys by their natural order.
	colKeys.sort((a, b) => compareKeys(a, b, colType ?? "string"));

	// Aggregate each cell.
	const matrix: (number | null)[][] = [];
	const counts: number[][] = [];
	const cellFiles: string[][][] = [];
	const rowTotals: number[] = [];
	const colTotals: (number | null)[] = colKeys.map(() => null);
	const colVals: number[][] = colKeys.map(() => []);
	const allVals: number[] = [];

	for (let i = 0; i < rowKeys.length; i++) {
		const bucket = rowBuckets.get(rowKeys[i])!;
		const { value: rowTotal, vals: rowAll } = aggregateBucket(bucket, cfg);
		rowTotals.push(rowTotal ?? 0);
		allVals.push(...rowAll);

		matrix.push([]);
		counts.push([]);
		cellFiles.push([]);

		for (let j = 0; j < colKeys.length; j++) {
			const cellRows = cfg.colField
				? bucket.filter(
						(r) =>
							keyOf(getFieldValue(r, cfg.colField!), colType!) === colKeys[j],
					)
				: bucket;
			const agg = aggregateBucket(cellRows, cfg);
			matrix[i].push(agg.value);
			counts[i].push(cellRows.length);
			cellFiles[i].push(cellRows.slice(0, 200).map((r) => r.path));
			if (agg.value !== null) {
				colVals[j].push(...agg.vals);
			}
		}
	}

	for (let j = 0; j < colKeys.length; j++) {
		colTotals[j] = AGG_FNS[cfg.aggregation](colVals[j]);
	}

	const grandTotal = AGG_FNS[cfg.aggregation](allVals);

	return {
		rowKeys,
		colKeys,
		matrix,
		counts,
		cellFiles,
		rowTotals,
		colTotals,
		grandTotal,
		sourceCount: filtered.length,
		rowFieldType: rowType,
		colFieldType: colType,
	};
}

function aggregateBucket(
	rows: VaultRow[],
	cfg: PivotConfig,
): { value: number | null; vals: number[] } {
	const vals: number[] = [];
	for (const r of rows) {
		const n = numericOf(r, cfg.valueField);
		if (n !== null) vals.push(n);
	}
	return { value: AGG_FNS[cfg.aggregation](vals), vals };
}

function inferRowType(rows: VaultRow[], field: string): FieldType {
	// Look at up to 40 rows to guess the dominant type.
	const votes = new Map<FieldType, number>();
	let scanned = 0;
	for (const r of rows) {
		const v = getFieldValue(r, field);
		if (v === null || v === undefined) continue;
		const t = guessType(v);
		votes.set(t, (votes.get(t) ?? 0) + 1);
		if (++scanned >= 40) break;
	}
	let best: FieldType = "string";
	let bestN = -1;
	for (const [t, n] of votes) {
		if (n > bestN) {
			best = t;
			bestN = n;
		}
	}
	return best;
}

function guessType(value: unknown): FieldType {
	if (typeof value === "number") return "number";
	if (typeof value === "boolean") return "boolean";
	if (Array.isArray(value)) return "tags";
	if (typeof value === "string") {
		const t = value.trim();
		if (/^\d{4}-\d{1,2}-\d{1,2}/.test(t)) return "date";
		const n = Number(t.replace(/[,$%\s]/g, ""));
		if (t !== "" && !Number.isNaN(n)) return "number";
	}
	return "string";
}

/** Should the aggregation be constrained to count? */
export function aggregationAllowed(agg: Aggregation, fieldType: FieldType): boolean {
	if (agg === "count") return true;
	if (agg === "distinct") return true;
	return fieldType === "number" || fieldType === "date";
}
