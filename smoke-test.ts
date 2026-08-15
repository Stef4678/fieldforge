// Quick engine smoke test (run: node smoke-test.ts) — verifies pivot math.
// Compile with: npx tsc smoke-test.ts --module commonjs --target es2018 --moduleResolution node --outDir .smoke --skipLibCheck && node .smoke/smoke-test.js
import { buildPivot, DEFAULT_CONFIG, type PivotConfig, type PivotResult } from "./src/data/pivot";
import { COUNT_FIELD, type VaultRow } from "./src/data/schema";

const rows: VaultRow[] = [
	{ path: "a.md", name: "a", folder: "/", ctime: 1, mtime: 1, size: 1, tags: [], values: { type: "Article", status: "Read", rating: 5, words: 100 } },
	{ path: "b.md", name: "b", folder: "/", ctime: 2, mtime: 2, size: 2, tags: [], values: { type: "Article", status: "Read", rating: 3, words: 200 } },
	{ path: "c.md", name: "c", folder: "/", ctime: 3, mtime: 3, size: 3, tags: [], values: { type: "Article", status: "Queue", rating: 4, words: 50 } },
	{ path: "d.md", name: "d", folder: "/", ctime: 4, mtime: 4, size: 4, tags: [], values: { type: "Book", status: "Read", rating: 5, words: 1000 } },
	{ path: "e.md", name: "e", folder: "/", ctime: 5, mtime: 5, size: 5, tags: [], values: { type: "Book", status: "Queue" } },
];

function assert(cond: boolean, msg: string): void {
	if (!cond) {
		console.error("FAIL:", msg);
		process.exit(1);
	}
}

function pivot(cfg: PivotConfig): { res: PivotResult; rowOf: (n: string) => number; colOf: (n: string) => number } {
	const res = buildPivot(rows, cfg);
	return { res, rowOf: (n) => res.rowKeys.indexOf(n), colOf: (n) => res.colKeys.indexOf(n) };
}

// 1) Count pivot: rows=type, cols=status
let { res, rowOf, colOf } = pivot({
	...DEFAULT_CONFIG,
	rowField: "type",
	colField: "status",
	valueField: COUNT_FIELD,
	aggregation: "count",
});
assert(rowOf("Article") === 0 && rowOf("Book") === 1, "rows sorted by count desc");
assert(colOf("Queue") === 0 && colOf("Read") === 1, "columns sorted alphabetically");
assert(res.matrix[rowOf("Article")][colOf("Read")] === 2, "Article×Read = 2");
assert(res.matrix[rowOf("Article")][colOf("Queue")] === 1, "Article×Queue = 1");
assert(res.matrix[rowOf("Book")][colOf("Read")] === 1, "Book×Read = 1");
assert(res.matrix[rowOf("Book")][colOf("Queue")] === 1, "Book×Queue = 1 (file e)");
assert(res.grandTotal === 5, "grand total 5");
assert(res.sourceCount === 5, "source count 5");

// 2) Sum aggregation on rating
({ res, rowOf, colOf } = pivot({ ...DEFAULT_CONFIG, rowField: "type", colField: "status", valueField: "rating", aggregation: "sum" }));
assert(res.matrix[rowOf("Article")][colOf("Read")] === 8, "Article×Read rating sum = 8");
assert(res.matrix[rowOf("Book")][colOf("Read")] === 5, "Book×Read rating sum = 5");
assert(res.rowTotals[rowOf("Article")] === 12, "Article total 12");
assert(res.grandTotal === 17, "grand 17");

// 3) Avg aggregation (rows sort by avg value → Book first)
({ res, rowOf, colOf } = pivot({ ...DEFAULT_CONFIG, rowField: "type", colField: "status", valueField: "rating", aggregation: "avg" }));
assert(res.rowKeys[0] === "Book", "Book (avg 5) sorts above Article (avg 4)");
assert(res.matrix[rowOf("Article")][colOf("Read")] === 4, "Article×Read avg = 4");
assert(res.matrix[rowOf("Book")][colOf("Queue")] === null, "Book×Queue avg = null (no rating)");

// 4) Filters: status = Read (case-insensitive)
({ res } = pivot({
	...DEFAULT_CONFIG,
	rowField: "type",
	colField: null,
	valueField: COUNT_FIELD,
	filters: [{ field: "status", op: "eq", value: "read" }],
}));
assert(res.sourceCount === 3, "filter eq read → 3 rows");
assert(res.grandTotal === 3, "filtered grand total 3");

// 5) Numeric filter gt
({ res } = pivot({
	...DEFAULT_CONFIG,
	rowField: "type",
	colField: null,
	valueField: COUNT_FIELD,
	filters: [{ field: "rating", op: "gt", value: "3" }],
}));
assert(res.sourceCount === 3, "rating > 3 → 3 rows (5,4,5)");

// 6) Exists filter — rows with a `words` value: a,b,c,d (e excluded)
({ res } = pivot({
	...DEFAULT_CONFIG,
	rowField: "$name",
	colField: null,
	valueField: COUNT_FIELD,
	filters: [{ field: "words", op: "exists", value: "" }],
}));
assert(res.sourceCount === 4, "words exists → 4 rows");
assert(res.rowKeys.includes("a") && res.rowKeys.includes("d"), "a and d present");
assert(!res.rowKeys.includes("e"), "e (no words) excluded");

// 7) Sort by value desc + limit
({ res } = pivot({ ...DEFAULT_CONFIG, rowField: "status", colField: null, valueField: COUNT_FIELD, sort: "value-desc", limitRows: 1 }));
assert(res.rowKeys.length === 1 && res.rowKeys[0] === "Read", "top row is Read (3)");

// 8) Cell file lists
({ res } = pivot({ ...DEFAULT_CONFIG, rowField: "type", colField: "status", valueField: COUNT_FIELD }));
const cf = res.cellFiles;
assert(cf[rowOf2(res, "Article")][res.colKeys.indexOf("Read")].join() === "a.md,b.md", "cell files a,b");
function rowOf2(r: PivotResult, n: string): number {
	return r.rowKeys.indexOf(n);
}

console.log("All pivot engine assertions passed ✓");
