/**
 * Raw data grid: searchable, field-chip column toggles,
 * click-to-open, CSV + Markdown export.
 */

import { FieldInfo, VaultRow, displayValue, formatNumber, getFieldValue } from "../data/schema";
import { renderEmpty } from "./charts";

export class DataGridUI {
	private visibleFields: Set<string>;
	private search = "";
	private shown = 200;
	private bodyEl: HTMLElement;
	private chipBarEl: HTMLElement;
	private countEl: HTMLElement;
	private openFile: (path: string) => void;

	constructor(
		private container: HTMLElement,
		private rows: VaultRow[],
		private fields: FieldInfo[],
		openFile: (path: string) => void,
	) {
		this.openFile = openFile;
		this.visibleFields = new Set(
			this.fields
				.filter((f) => f.presentCount > 0)
				.slice(0, 8)
				.map((f) => f.name),
		);
		this.bodyEl = container.createDiv({ cls: "ff-grid" });
		this.chipBarEl = container.createDiv({ cls: "ff-chipbar" });
		this.countEl = container.createDiv({ cls: "ff-grid-count" });
		this.buildToolbar();
		this.render();
	}

	private buildToolbar(): void {
		const toolbar = this.container.createDiv({ cls: "ff-grid-toolbar" });
		const search = toolbar.createEl("input", {
			cls: "ff-input ff-grid-search",
			attr: { placeholder: "Search files…", type: "search" },
		});
		search.addEventListener("input", () => {
			this.search = search.value.trim().toLowerCase();
			this.shown = 200;
			this.render();
		});

		const csvBtn = toolbar.createEl("button", { cls: "ff-btn ff-btn-outline", text: "Export CSV" });
		csvBtn.addEventListener("click", () => this.download("fieldforge-data.csv", this.toCSV()));
		const mdBtn = toolbar.createEl("button", { cls: "ff-btn ff-btn-outline", text: "Copy MD" });
		mdBtn.addEventListener("click", () => void this.copyText(this.toMarkdown()));

		this.container.insertBefore(toolbar, this.chipBarEl);
	}

	private render(): void {
		this.chipBarEl.empty();
		for (const f of this.fields) {
			const chip = this.chipBarEl.createEl("button", {
				cls: "ff-chip",
				text: `${f.label} · ${f.presentCount}`,
			});
			chip.classList.toggle("is-on", this.visibleFields.has(f.name));
			chip.addEventListener("click", () => {
				if (this.visibleFields.has(f.name)) this.visibleFields.delete(f.name);
				else this.visibleFields.add(f.name);
				this.render();
			});
		}

		const cols = [...this.visibleFields];
		const filtered = this.search
			? this.rows.filter((r) =>
					cols.some((c) => displayValue(getFieldValue(r, c)).toLowerCase().includes(this.search)),
				)
			: this.rows;
		const slice = filtered.slice(0, this.shown);

		this.countEl.setText(`${filtered.length} of ${this.rows.length} files · ${cols.length} columns`);
		this.bodyEl.empty();

		if (!slice.length) {
			renderEmpty(this.bodyEl, "No files match your search.");
			return;
		}

		const table = this.bodyEl.createEl("table", { cls: "ff-table ff-grid-table" });
		const thead = table.createEl("thead");
		const hr = thead.createEl("tr");
		for (const c of cols) hr.createEl("th", { text: this.fields.find((f) => f.name === c)?.label ?? c });
		const tbody = table.createEl("tbody");
		for (const row of slice) {
			const tr = tbody.createEl("tr");
			tr.addClass("ff-grid-row");
			for (const c of cols) {
				const field = this.fields.find((f) => f.name === c);
				const raw = getFieldValue(row, c);
				let text = displayValue(raw);
				if (field?.type === "date" && typeof raw === "number") {
					const d = new Date(raw);
					if (!Number.isNaN(d.getTime())) text = d.toLocaleDateString();
				} else if (field?.type === "number" && typeof raw === "number") {
					text = formatNumber(raw);
				}
				tr.createEl("td", { text });
			}
			tr.addEventListener("click", () => this.openFile(row.path));
		}

		if (filtered.length > this.shown) {
			const more = this.bodyEl.createEl("button", { cls: "ff-btn ff-btn-ghost ff-more", text: `Show ${Math.min(500, filtered.length - this.shown)} more` });
			more.addEventListener("click", () => {
				this.shown += 500;
				this.render();
			});
		}
	}

	private visibleRows(): VaultRow[] {
		const cols = [...this.visibleFields];
		if (!this.search) return this.rows;
		return this.rows.filter((r) =>
			cols.some((c) => displayValue(getFieldValue(r, c)).toLowerCase().includes(this.search)),
		);
	}

	toCSV(): string {
		const cols = [...this.visibleFields];
		const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
		const lines = [cols.map((c) => esc(this.fields.find((f) => f.name === c)?.label ?? c)).join(",")];
		for (const row of this.visibleRows()) {
			lines.push(cols.map((c) => esc(displayValue(getFieldValue(row, c)))).join(","));
		}
		return lines.join("\n");
	}

	toMarkdown(): string {
		const cols = [...this.visibleFields];
		const head = cols.map((c) => this.fields.find((f) => f.name === c)?.label ?? c);
		const lines = [head.join(" | "), head.map(() => "---").join(" | ")];
		for (const row of this.visibleRows()) {
			lines.push(cols.map((c) => displayValue(getFieldValue(row, c)).replace(/\|/g, "\\|")).join(" | "));
		}
		return lines.join("\n");
	}

	private download(filename: string, content: string): void {
		try {
			const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
			const url = URL.createObjectURL(blob);
			const a = document.createElement("a");
			a.href = url;
			a.download = filename;
			a.click();
			URL.revokeObjectURL(url);
		} catch {
			void this.copyText(content);
		}
	}

	private async copyText(text: string): Promise<void> {
		try {
			await navigator.clipboard.writeText(text);
			// eslint-disable-next-line no-console
		} catch (e) {
			console.error("FieldForge: clipboard failed", e);
		}
	}
}
