/**
 * FieldForge main view: header, controls sidebar, tab switcher, canvas.
 * Owns the pivot config and re-renders the active tab on every change.
 */

import { ItemView, Notice, Plugin, TFile, WorkspaceLeaf, debounce, setIcon } from "obsidian";
import { VaultScanner } from "./data/scanner";
import { DEFAULT_CONFIG, PivotConfig, buildPivot } from "./data/pivot";
import { COUNT_FIELD, FieldInfo, VaultRow, countDistinct, formatNumber } from "./data/schema";
import { ControlsApi, renderControls } from "./ui/controls";
import { renderPivotTable, pivotToCSV, pivotToMarkdown } from "./ui/pivotTable";
import { DataGridUI } from "./ui/dataGrid";
import {
	TrendBucket,
	readChartColors,
	renderBarChart,
	renderDonutChart,
	renderScatterChart,
	renderTrendChart,
} from "./ui/charts";

export const VIEW_TYPE_FIELD_FORGE = "fieldforge-view";

type TabId = "pivot" | "bar" | "scatter" | "trend" | "donut" | "data";

const TABS: { id: TabId; label: string; icon: string }[] = [
	{ id: "pivot", label: "Pivot", icon: "table-2" },
	{ id: "bar", label: "Bars", icon: "bar-chart" },
	{ id: "scatter", label: "Scatter", icon: "scatter-chart" },
	{ id: "trend", label: "Trend", icon: "line-chart" },
	{ id: "donut", label: "Donut", icon: "pie-chart" },
	{ id: "data", label: "Data", icon: "list" },
];

export class FieldForgeView extends ItemView {
	private plugin: Plugin;
	private scanner: VaultScanner;
	private root!: HTMLElement;
	private sidebarEl!: HTMLElement;
	private canvasEl!: HTMLElement;
	private statsEl!: HTMLElement;
	private tabEls = new Map<TabId, HTMLElement>();

	private rows: VaultRow[] = [];
	private fields: FieldInfo[] = [];
	private cfg: PivotConfig = { ...DEFAULT_CONFIG };
	private activeTab: TabId = "pivot";
	private scatterCfg = { x: "$mtime", y: "$size", color: "", trend: true };
	private trendCfg = { field: "$ctime", bucket: "day" as TrendBucket };
	private dataGrid: DataGridUI | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: Plugin) {
		super(leaf);
		this.plugin = plugin;
		this.scanner = new VaultScanner(plugin.app.vault, plugin.app.metadataCache);
	}

	getViewType(): string {
		return VIEW_TYPE_FIELD_FORGE;
	}

	getDisplayText(): string {
		return "FieldForge";
	}

	getIcon(): string {
		return "table-2";
	}

	async onOpen(): Promise<void> {
		this.root = this.contentEl.createDiv({ cls: "ff-root" });
		this.buildHeader();
		this.buildBody();
		this.registerEvents();
		this.refresh();
	}

	async onClose(): Promise<void> {
		// Everything is cleaned up by Obsidian (events unregistered, DOM removed).
	}

	/* ------------------------------------------------------------------ */
	/* Shell construction                                                  */
	/* ------------------------------------------------------------------ */

	private buildHeader(): void {
		const header = this.root.createDiv({ cls: "ff-header" });
		const logo = header.createDiv({ cls: "ff-logo" });
		logo.setText("FF");
		const titles = header.createDiv({ cls: "ff-titles" });
		titles.createDiv({ cls: "ff-title", text: "FieldForge" });
		titles.createDiv({ cls: "ff-subtitle", text: "Pivot your vault's properties — no queries needed" });
		const actions = header.createDiv({ cls: "ff-actions" });
		this.statsEl = actions.createSpan({ cls: "ff-header-stats" });

		const refreshBtn = actions.createEl("button", {
			cls: "ff-btn ff-btn-ghost ff-btn-icon-lg",
			attr: { title: "Rescan vault" },
		});
		setIcon(refreshBtn, "refresh-cw");
		refreshBtn.addEventListener("click", () => this.refresh());

		const mdBtn = actions.createEl("button", {
			cls: "ff-btn ff-btn-ghost ff-btn-icon-lg",
			attr: { title: "Copy current view as Markdown table" },
		});
		setIcon(mdBtn, "clipboard-copy");
		mdBtn.addEventListener("click", () => void this.copyAsMarkdown());

		const csvBtn = actions.createEl("button", {
			cls: "ff-btn ff-btn-ghost ff-btn-icon-lg",
			attr: { title: "Export CSV" },
		});
		setIcon(csvBtn, "download");
		csvBtn.addEventListener("click", () => this.exportCSV());
	}

	private buildBody(): void {
		const body = this.root.createDiv({ cls: "ff-body" });
		this.sidebarEl = body.createDiv({ cls: "ff-sidebar" });
		const main = body.createDiv({ cls: "ff-main" });
		const tabs = main.createDiv({ cls: "ff-tabs" });
		for (const t of TABS) {
			const tab = tabs.createEl("button", { cls: "ff-tab", attr: { "data-tab": t.id } });
			setIcon(tab.createSpan({ cls: "ff-tab-icon" }), t.icon);
			tab.createSpan({ text: t.label });
			tab.addEventListener("click", () => this.setTab(t.id));
			this.tabEls.set(t.id, tab);
		}
		this.canvasEl = main.createDiv({ cls: "ff-canvas" });
	}

	private registerEvents(): void {
		const refreshDebounced = debounce(() => this.refresh(), 700, true);
		this.registerEvent(this.app.metadataCache.on("changed", () => refreshDebounced()));
		this.registerEvent(this.app.metadataCache.on("deleted", () => refreshDebounced()));
		this.registerEvent(this.app.vault.on("create", () => refreshDebounced()));
		this.registerEvent(this.app.vault.on("delete", () => refreshDebounced()));
		this.registerEvent(this.app.vault.on("rename", () => refreshDebounced()));
	}

	/* ------------------------------------------------------------------ */
	/* State & rendering                                                   */
	/* ------------------------------------------------------------------ */

	private setTab(tab: TabId): void {
		this.activeTab = tab;
		for (const [id, el] of this.tabEls) {
			el.classList.toggle("is-active", id === tab);
		}
		this.render();
	}

	private refresh(): void {
		const { rows, fields } = this.scanner.scan();
		this.rows = rows;
		this.fields = fields;
		this.sanitizeCfg();
		this.renderControls();
		this.render();
	}

	private sanitizeCfg(): void {
		const names = new Set(this.fields.map((f) => f.name));
		if (!names.has(this.cfg.rowField)) this.cfg.rowField = "$folder";
		if (this.cfg.colField && !names.has(this.cfg.colField)) this.cfg.colField = null;
		if (this.cfg.valueField !== COUNT_FIELD && !names.has(this.cfg.valueField)) {
			this.cfg.valueField = COUNT_FIELD;
		}
		this.cfg.filters = this.cfg.filters.filter((f) => names.has(f.field));
		const info = this.fields.find((f) => f.name === this.cfg.valueField);
		if (
			this.cfg.valueField !== COUNT_FIELD &&
			info &&
			info.type !== "number" &&
			info.type !== "date" &&
			this.cfg.aggregation !== "count" &&
			this.cfg.aggregation !== "distinct"
		) {
			this.cfg.aggregation = "count";
		}
	}

	private renderControls(): void {
		const api: ControlsApi = {
			fields: this.fields,
			cfg: this.cfg,
			stats: { files: this.rows.length, fields: this.fields.length },
			colDistinct: this.cfg.colField ? countDistinct(this.rows, this.cfg.colField) : 0,
			onFieldChange: (update) => {
				Object.assign(this.cfg, update);
				this.render();
			},
			onAddFilter: () => {
				const field =
					this.fields.find((f) => f.type === "tags" || f.type === "string")?.name ?? this.fields[0]?.name ?? "";
				this.cfg.filters.push({ field, op: "eq", value: "" });
				this.renderControls();
				this.render();
			},
			onUpdateFilter: (i, update) => {
				Object.assign(this.cfg.filters[i], update);
				this.render();
			},
			onRemoveFilter: (i) => {
				this.cfg.filters.splice(i, 1);
				this.renderControls();
				this.render();
			},
			onRefresh: () => this.refresh(),
		};
		renderControls(this.sidebarEl, api);
	}

	private render(): void {
		const colors = readChartColors();
		this.statsEl.setText(`${formatNumber(this.rows.length)} files`);
		this.canvasEl.empty();

		if (this.activeTab === "scatter") this.renderScatterToolbar();
		if (this.activeTab === "trend") this.renderTrendToolbar();

		const result = buildPivot(this.rows, this.cfg);
		switch (this.activeTab) {
			case "pivot":
				renderPivotTable(this.canvasEl, result, this.cfg, colors, (p) => this.openFile(p));
				break;
			case "bar":
				renderBarChart(this.canvasEl, result, colors);
				break;
			case "scatter":
				renderScatterChart(
					this.canvasEl,
					this.rows,
					this.scatterCfg.x,
					this.scatterCfg.y,
					this.scatterCfg.color || null,
					this.scatterCfg.trend,
					colors,
				);
				break;
			case "trend":
				renderTrendChart(this.canvasEl, this.rows, this.trendCfg.field, this.trendCfg.bucket, colors);
				break;
			case "donut":
				renderDonutChart(this.canvasEl, result, colors);
				break;
			case "data":
				this.dataGrid = new DataGridUI(this.canvasEl, this.rows, this.fields, (p) => this.openFile(p));
				break;
		}
	}

	/* ------------------------------------------------------------------ */
	/* Tab toolbars                                                        */
	/* ------------------------------------------------------------------ */

	private scatterFields(): { value: string; label: string }[] {
		return this.fields
			.filter((f) => f.type === "number" || f.type === "date")
			.map((f) => ({ value: f.name, label: f.label }));
	}

	private renderScatterToolbar(): void {
		const bar = this.canvasEl.createDiv({ cls: "ff-toolbar" });
		const addSelect = (
			label: string,
			value: string,
			options: { value: string; label: string }[],
			onChange: (v: string) => void,
		): void => {
			bar.createSpan({ cls: "ff-toolbar-label", text: label });
			const sel = bar.createEl("select", { cls: "ff-select ff-select-sm" });
			for (const o of options) sel.createEl("option", { value: o.value, text: o.label });
			sel.value = value;
			sel.addEventListener("change", () => onChange(sel.value));
		};
		addSelect("X", this.scatterCfg.x, this.scatterFields(), (v) => {
			this.scatterCfg.x = v;
			this.render();
		});
		addSelect("Y", this.scatterCfg.y, this.scatterFields(), (v) => {
			this.scatterCfg.y = v;
			this.render();
		});
		const colorOpts = [{ value: "", label: "— color by —" }, ...this.fields.map((f) => ({ value: f.name, label: f.label }))];
		addSelect("Color", this.scatterCfg.color, colorOpts, (v) => {
			this.scatterCfg.color = v;
			this.render();
		});
		const check = bar.createDiv({ cls: "ff-check ff-check-inline" });
		const inp = check.createEl("input", { attr: { type: "checkbox" } });
		inp.checked = this.scatterCfg.trend;
		inp.addEventListener("change", () => {
			this.scatterCfg.trend = inp.checked;
			this.render();
		});
		check.createSpan({ text: "Trend line" });
	}

	private renderTrendToolbar(): void {
		const bar = this.canvasEl.createDiv({ cls: "ff-toolbar" });
		bar.createSpan({ cls: "ff-toolbar-label", text: "Time" });
		const opts = this.fields.filter((f) => f.type === "date").map((f) => ({ value: f.name, label: f.label }));
		const sel = bar.createEl("select", { cls: "ff-select ff-select-sm" });
		for (const o of opts) sel.createEl("option", { value: o.value, text: o.label });
		sel.value = this.trendCfg.field;
		sel.addEventListener("change", () => {
			this.trendCfg.field = sel.value;
			this.render();
		});
		const seg = bar.createDiv({ cls: "ff-seg ff-seg-sm" });
		for (const b of ["day", "week", "month"] as TrendBucket[]) {
			const btn = seg.createEl("button", { text: b });
			btn.classList.toggle("is-active", this.trendCfg.bucket === b);
			btn.addEventListener("click", () => {
				this.trendCfg.bucket = b;
				this.render();
			});
		}
	}

	/* ------------------------------------------------------------------ */
	/* Export & navigation                                                 */
	/* ------------------------------------------------------------------ */

	async copyAsMarkdown(): Promise<void> {
		const md = this.currentMarkdown();
		try {
			await navigator.clipboard.writeText(md);
			new Notice("FieldForge: Markdown table copied to clipboard.");
		} catch {
			new Notice("FieldForge: clipboard unavailable.");
		}
	}

	private currentMarkdown(): string {
		if (this.activeTab === "data" && this.dataGrid) return this.dataGrid.toMarkdown();
		return pivotToMarkdown(buildPivot(this.rows, this.cfg), this.cfg);
	}

	private exportCSV(): void {
		const isData = this.activeTab === "data" && this.dataGrid;
		const csv = isData ? this.dataGrid!.toCSV() : pivotToCSV(buildPivot(this.rows, this.cfg), this.cfg);
		const name = isData ? "fieldforge-data.csv" : "fieldforge-pivot.csv";
		try {
			const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
			const url = URL.createObjectURL(blob);
			const a = document.body.createEl("a", { attr: { href: url, download: name } });
			a.click();
			a.remove();
			URL.revokeObjectURL(url);
			new Notice("FieldForge: CSV exported.");
		} catch {
			void navigator.clipboard.writeText(csv).then(() => new Notice("FieldForge: CSV copied to clipboard."));
		}
	}

	private openFile(path: string): void {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (file instanceof TFile) {
			const leaf = this.app.workspace.getLeaf("tab");
			if (leaf) void leaf.openFile(file);
		}
	}
}
