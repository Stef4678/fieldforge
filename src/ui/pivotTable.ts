/**
 * Interactive pivot table with per-column heatmap coloring,
 * row/column totals, and click-to-open-note cells.
 */

import { PivotConfig, PivotResult } from "../data/pivot";
import { fieldLabel, formatNumber } from "../data/schema";
import { ChartColors, fillTip, renderEmpty } from "./charts";

export function renderPivotTable(
	container: HTMLElement,
	result: PivotResult,
	cfg: PivotConfig,
	colors: ChartColors,
	openFile: (path: string) => void,
): void {
	if (!result.sourceCount) {
		renderEmpty(container, "No files match the current filters.");
		return;
	}
	const { rowKeys, colKeys, matrix, counts, cellFiles, rowTotals, colTotals, grandTotal } = result;

	const wrap = container.createDiv({ cls: "ff-table-wrap" });
	const table = wrap.createEl("table", { cls: "ff-table" });

	// Header
	const thead = table.createEl("thead");
	const hr = thead.createEl("tr");
	hr.createEl("th", { cls: "ff-corner", text: cfg.rowField ? fieldLabel(cfg.rowField) : "Row" });
	for (const c of colKeys) hr.createEl("th", { cls: "ff-colhead", text: c });
	if (cfg.showColTotals) hr.createEl("th", { cls: "ff-colhead ff-total-head", text: "Total" });

	// Body
	const tbody = table.createEl("tbody");
	const maxByCol = colKeys.map((_, j) => Math.max(1, ...matrix.map((row) => row[j] ?? 0)));

	for (let i = 0; i < rowKeys.length; i++) {
		const tr = tbody.createEl("tr");
		tr.createEl("td", { cls: "ff-rowhead", text: rowKeys[i] });
		for (let j = 0; j < colKeys.length; j++) {
			const v = matrix[i][j];
			const count = counts[i][j];
			const files = cellFiles[i][j] ?? [];
			const td = tr.createEl("td", { cls: "ff-cell" });
			if (v === null) {
				td.setText("—");
				td.addClass("ff-cell-empty");
			} else {
				const alpha = 0.06 + 0.4 * (v / maxByCol[j]);
				td.style.background = `color-mix(in srgb, ${colors.accent} ${Math.round(alpha * 100)}%, transparent)`;
				td.setText(formatNumber(v));
			}
			if (files.length) {
				td.addClass("ff-cell-hasfiles");
				td.setAttr("data-count", String(count));
				td.addEventListener("mouseenter", () => {
					const tip = wrap.find(".ff-tooltip");
					if (!tip) return;
					fillTip(tip, [{ text: `${rowKeys[i]}${colKeys[j] ? " · " + colKeys[j] : ""}`, bold: true }]);
					for (const p of files.slice(0, 8)) {
						tip.createDiv({ cls: "ff-tip-file", text: p.split("/").pop() ?? p });
					}
					if (files.length > 8) {
						tip.createDiv({ cls: "ff-tip-more", text: `+ ${files.length - 8} more` });
					}
					tip.classList.add("is-visible");
				});
				td.addEventListener("mousemove", (e) => {
					const tip = wrap.find(".ff-tooltip");
					if (!tip) return;
					const parentRect = wrap.getBoundingClientRect();
					const r = tip.getBoundingClientRect();
					let left = e.clientX - parentRect.left - r.width / 2;
					let top = e.clientY - parentRect.top - r.height - 12;
					left = Math.max(6, Math.min(left, parentRect.width - r.width - 6));
					top = Math.max(6, top);
					tip.style.left = `${left}px`;
					tip.style.top = `${top}px`;
				});
				td.addEventListener("mouseleave", () => {
					wrap.find(".ff-tooltip")?.classList.remove("is-visible");
				});
				td.addEventListener("click", () => openFile(files[0]));
			}
		}
		if (cfg.showColTotals) {
			tr.createEl("td", { cls: "ff-cell ff-cell-total", text: formatNumber(rowTotals[i]) });
		}
	}

	// Column totals row
	if (cfg.showColTotals) {
		const tr = tbody.createEl("tr", { cls: "ff-total-row" });
		tr.createEl("td", { cls: "ff-rowhead", text: "Total" });
		for (let j = 0; j < colKeys.length; j++) {
			const cellTotal = colTotals[j];
			tr.createEl("td", {
				cls: "ff-cell ff-cell-total",
				text: cellTotal === null ? "—" : formatNumber(cellTotal),
			});
		}
		tr.createEl("td", {
			cls: "ff-cell ff-cell-grand",
			text: grandTotal === null ? "—" : formatNumber(grandTotal),
		});
	}

	// Shared tooltip element for the table
	wrap.createDiv({ cls: "ff-tooltip" });
}

/* ------------------------------------------------------------------ */
/* Export helpers                                                      */
/* ------------------------------------------------------------------ */

function escCsv(s: string): string {
	return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function pivotToMarkdown(result: PivotResult, cfg: PivotConfig): string {
	const { rowKeys, colKeys, matrix, colTotals, grandTotal, rowTotals } = result;
	const head = ["", ...colKeys, ...(cfg.showColTotals ? ["Total"] : [])];
	const lines = [head.join(" | "), head.map(() => "---").join(" | ")];
	rowKeys.forEach((rk, i) => {
		const cells = matrix[i].map((v) => (v === null ? "" : String(v)));
		const row = [rk, ...cells, ...(cfg.showColTotals ? [String(rowTotals[i])] : [])];
		lines.push(row.join(" | "));
	});
	if (cfg.showColTotals) {
		lines.push(
			[
				"Total",
				...colTotals.map((v) => (v === null ? "" : String(v))),
				grandTotal === null ? "" : String(grandTotal),
			].join(" | "),
		);
	}
	return lines.join("\n");
}

export function pivotToCSV(result: PivotResult, cfg: PivotConfig): string {
	const { rowKeys, colKeys, matrix, colTotals, grandTotal, rowTotals } = result;
	const rows: string[][] = [["", ...colKeys, ...(cfg.showColTotals ? ["Total"] : [])]];
	rowKeys.forEach((rk, i) => {
		const cells = matrix[i].map((v) => (v === null ? "" : String(v)));
		rows.push([rk, ...cells, ...(cfg.showColTotals ? [String(rowTotals[i])] : [])]);
	});
	if (cfg.showColTotals) {
		rows.push(["Total", ...colTotals.map((v) => (v === null ? "" : String(v))), grandTotal === null ? "" : String(grandTotal)]);
	}
	return rows.map((r) => r.map(escCsv).join(",")).join("\n");
}
