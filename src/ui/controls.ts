/**
 * Left sidebar controls: field pickers, aggregation, filters, sort, totals.
 * Every interaction flows back through the api callbacks; the view re-renders.
 */

import { setIcon } from "obsidian";
import { Filter, FilterOp, PivotConfig, aggregationAllowed } from "../data/pivot";
import { COUNT_FIELD, FieldInfo, fieldLabel, formatNumber } from "../data/schema";

export interface ControlsApi {
	fields: FieldInfo[];
	cfg: PivotConfig;
	stats: { files: number; fields: number };
	/** Distinct display values for the currently selected Columns field. */
	colDistinct: number;
	onFieldChange(update: Partial<PivotConfig>): void;
	onAddFilter(): void;
	onUpdateFilter(index: number, update: Partial<Filter>): void;
	onRemoveFilter(index: number): void;
	onRefresh(): void;
}

const OP_LABELS: Record<FilterOp, string> = {
	eq: "=",
	neq: "≠",
	contains: "contains",
	gt: ">",
	lt: "<",
	exists: "exists",
	"not-exists": "is empty",
};

export function renderControls(container: HTMLElement, api: ControlsApi): void {
	container.empty();
	const { cfg, fields } = api;

	const makeFieldSelect = (
		parent: HTMLElement,
		current: string,
		onChange: (v: string) => void,
		opts?: { includeCount?: boolean; emptyLabel?: string },
	): HTMLSelectElement => {
		const sel = parent.createEl("select", { cls: "ff-select" });
		if (opts?.emptyLabel !== undefined) sel.createEl("option", { value: "", text: opts.emptyLabel });
		if (opts?.includeCount) sel.createEl("option", { value: COUNT_FIELD, text: "Count of files" });
		for (const f of fields) sel.createEl("option", { value: f.name, text: f.label });
		sel.value = current;
		sel.addEventListener("change", () => onChange(sel.value));
		return sel;
	};

	const section = (title: string, icon?: string): HTMLElement => {
		const s = container.createDiv({ cls: "ff-section" });
		const h = s.createDiv({ cls: "ff-section-title" });
		if (icon) setIcon(h.createSpan({ cls: "ff-section-icon" }), icon);
		h.createSpan({ text: title });
		return s;
	};

	/* ---------- Vault overview ---------- */
	const overview = section("Vault", "vault");
	const stats = overview.createDiv({ cls: "ff-stats" });
	const f1 = stats.createDiv({ cls: "ff-stat" });
	f1.createDiv({ cls: "ff-stat-value", text: formatNumber(api.stats.files) });
	f1.createDiv({ cls: "ff-stat-label", text: "files" });
	const f2 = stats.createDiv({ cls: "ff-stat" });
	f2.createDiv({ cls: "ff-stat-value", text: String(api.stats.fields) });
	f2.createDiv({ cls: "ff-stat-label", text: "properties" });
	const rescan = overview.createEl("button", { cls: "ff-btn ff-btn-ghost", text: "Rescan vault" });
	rescan.addEventListener("click", () => api.onRefresh());

	/* ---------- Rows ---------- */
	const rows = section("Rows", "rows-3");
	makeFieldSelect(rows, cfg.rowField, (v) => api.onFieldChange({ rowField: v }));

	/* ---------- Columns ---------- */
	const cols = section("Columns", "columns-3");
	makeFieldSelect(cols, cfg.colField ?? "", (v) => api.onFieldChange({ colField: v || null }), {
		emptyLabel: "— single column —",
	});
	if (cfg.colField && api.colDistinct > 12) {
		cols.createDiv({
			cls: "ff-hint",
			text: `⚠ “${fieldLabel(cfg.colField)}” has ${api.colDistinct} unique values — each becomes its own bar, so bars get thin and each file lands in its own column. Try “— single column —” or a field with fewer values.`,
		});
	}

	/* ---------- Values ---------- */
	const vals = section("Values", "sigma");
	const valueFieldInfo = fields.find((f) => f.name === cfg.valueField);
	const valueType = cfg.valueField === COUNT_FIELD ? "number" : (valueFieldInfo?.type ?? "unknown");
	makeFieldSelect(
		vals,
		cfg.valueField,
		(v) => {
			const info = fields.find((f) => f.name === v);
			const agg =
				info && info.type !== "number" && info.type !== "date" && v !== COUNT_FIELD && cfg.aggregation !== "count" && cfg.aggregation !== "distinct"
					? "count"
					: cfg.aggregation;
			api.onFieldChange({ valueField: v, aggregation: agg });
		},
		{ includeCount: true },
	);
	const seg = vals.createDiv({ cls: "ff-seg" });
	for (const agg of ["count", "sum", "avg", "min", "max", "distinct"] as const) {
		const b = seg.createEl("button", { text: agg });
		b.classList.toggle("is-active", cfg.aggregation === agg);
		b.disabled = !aggregationAllowed(agg, valueType);
		b.addEventListener("click", () => api.onFieldChange({ aggregation: agg }));
	}
	if (valueType !== "number" && valueType !== "date" && cfg.valueField !== COUNT_FIELD) {
		vals.createDiv({ cls: "ff-hint", text: "This property is text — only Count / Distinct apply." });
	}

	/* ---------- Filters ---------- */
	const flt = section("Filters", "filter");
	if (cfg.filters.length) {
		cfg.filters.forEach((f, i) => {
			const row = flt.createDiv({ cls: "ff-filter-row" });
			const sel = makeFieldSelect(row, f.field, (v) => api.onUpdateFilter(i, { field: v }));
			sel.addClass("ff-filter-field");
			const opSel = row.createEl("select", { cls: "ff-select ff-filter-op" });
			for (const op of Object.keys(OP_LABELS) as FilterOp[]) {
				opSel.createEl("option", { value: op, text: OP_LABELS[op] });
			}
			opSel.value = f.op;
			const valInput = row.createEl("input", {
				cls: "ff-input ff-filter-value",
				attr: { placeholder: "Value", type: "text" },
			});
			valInput.value = f.value;
			const needsValue = f.op !== "exists" && f.op !== "not-exists";
			valInput.toggleClass("ff-hidden", !needsValue);

			opSel.addEventListener("change", () => {
				valInput.toggleClass("ff-hidden", opSel.value === "exists" || opSel.value === "not-exists");
				api.onUpdateFilter(i, { op: opSel.value as FilterOp });
			});
			valInput.addEventListener("input", () => api.onUpdateFilter(i, { value: valInput.value }));
			const rm = row.createEl("button", { cls: "ff-btn ff-btn-icon" });
			setIcon(rm, "x");
			rm.addEventListener("click", () => api.onRemoveFilter(i));
		});
	}
	const add = flt.createEl("button", { cls: "ff-btn ff-btn-outline", text: "Add filter" });
	add.addEventListener("click", () => api.onAddFilter());

	/* ---------- Sort & limit ---------- */
	const sort = section("Sort & Limit", "arrow-down-up");
	const sortSel = sort.createEl("select", { cls: "ff-select" });
	for (const [v, label] of [
		["value-desc", "Biggest value first"],
		["value-asc", "Smallest value first"],
		["name-asc", "Name A → Z"],
		["name-desc", "Name Z → A"],
	] as [PivotConfig["sort"], string][]) {
		sortSel.createEl("option", { value: v, text: label });
	}
	sortSel.value = cfg.sort;
	sortSel.addEventListener("change", () => api.onFieldChange({ sort: sortSel.value as PivotConfig["sort"] }));
	const limitRow = sort.createDiv({ cls: "ff-inline" });
	limitRow.createSpan({ cls: "ff-label", text: "Rows" });
	const lim = limitRow.createEl("input", {
		cls: "ff-input ff-input-sm",
		attr: { type: "number", min: "3", max: "200", value: String(cfg.limitRows) },
	});
	lim.addEventListener("change", () => {
		const v = Math.min(200, Math.max(3, Number(lim.value) || 20));
		lim.value = String(v);
		api.onFieldChange({ limitRows: v });
	});

	/* ---------- Totals ---------- */
	const totals = section("Totals", "sum");
	const cb = (label: string, checked: boolean, onChange: (v: boolean) => void) => {
		const wrap = totals.createDiv({ cls: "ff-check" });
		const inp = wrap.createEl("input", { attr: { type: "checkbox" } });
		inp.checked = checked;
		inp.addEventListener("change", () => onChange(inp.checked));
		wrap.createSpan({ text: label });
	};
	cb("Row totals", cfg.showRowTotals, (v) => api.onFieldChange({ showRowTotals: v }));
	cb("Column totals", cfg.showColTotals, (v) => api.onFieldChange({ showColTotals: v }));

	container.createDiv({ cls: "ff-footer-hint", text: "Every change re-forges the view instantly. Click a cell to open its notes." });
}
