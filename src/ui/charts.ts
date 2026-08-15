/**
 * Dependency-free SVG chart renderers, themed from Obsidian CSS variables.
 * Bar (grouped), scatter (+ trend line), time-series area, and donut.
 */

import { PivotResult, numericOf } from "../data/pivot";
import { VaultRow, displayValue, formatNumber, getFieldValue } from "../data/schema";

export interface ChartColors {
	accent: string;
	palette: string[];
	text: string;
	muted: string;
	grid: string;
}

export function readChartColors(): ChartColors {
	const cs = getComputedStyle(document.body);
	const accent = (cs.getPropertyValue("--interactive-accent") || "#7c6cf0").trim();
	const text = (cs.getPropertyValue("--text-normal") || "#d8d8d8").trim();
	const muted = (cs.getPropertyValue("--text-muted") || "#9a9a9a").trim();
	const grid = (cs.getPropertyValue("--background-modifier-border") || "rgba(128,128,128,.3)").trim();
	const palette: string[] = [accent];
	const base = hueOf(accent);
	for (let i = 1; i < 10; i++) {
		palette.push(`hsl(${Math.round((base + i * 137.5) % 360)} 72% 58%)`);
	}
	return { accent, palette, text, muted, grid };
}

function hueOf(color: string): number {
	const hex = color.match(/^#?([0-9a-f]{6})$/i);
	if (hex) {
		const n = parseInt(hex[1], 16);
		const r = (n >> 16) & 255;
		const g = (n >> 8) & 255;
		const b = n & 255;
		const max = Math.max(r, g, b);
		const min = Math.min(r, g, b);
		if (max === min) return 250;
		const d = max - min;
		let h: number;
		if (max === r) h = ((g - b) / d) % 6;
		else if (max === g) h = (b - r) / d + 2;
		else h = (r - g) / d + 4;
		h *= 60;
		return h < 0 ? h + 360 : h;
	}
	const hsl = color.match(/hsl\(\s*([\d.]+)/i);
	if (hsl) return parseFloat(hsl[1]);
	return 250;
}

function svgRoot(parent: HTMLElement, width: number, height: number): SVGElement {
	const svg = parent.createSvg("svg", { cls: "ff-svg" });
	svg.setAttribute("width", String(width));
	svg.setAttribute("height", String(height));
	return svg;
}

function svgEl(tag: string, attrs: Record<string, string | number>, parent: Element): SVGElement {
	const el = parent.createSvg(tag as keyof SVGElementTagNameMap);
	for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
	return el;
}

function makeTooltip(container: HTMLElement): HTMLElement {
	return container.createDiv({ cls: "ff-tooltip" });
}

function showTip(tip: HTMLElement, clientX: number, clientY: number): void {
	tip.classList.add("is-visible");
	const parentRect = tip.parentElement!.getBoundingClientRect();
	const r = tip.getBoundingClientRect();
	const x = clientX - parentRect.left;
	const y = clientY - parentRect.top;
	let left = x - r.width / 2;
	let top = y - r.height - 12;
	left = Math.max(6, Math.min(left, parentRect.width - r.width - 6));
	top = Math.max(6, top);
	tip.style.left = `${left}px`;
	tip.style.top = `${top}px`;
}

/** Fill a tooltip with plain-text lines (no innerHTML). */
export function fillTip(tip: HTMLElement, lines: { text: string; bold?: boolean; cls?: string }[]): void {
	tip.empty();
	for (const line of lines) {
		const d = tip.createDiv({ cls: line.cls ?? "" });
		if (line.bold) d.addClass("ff-tip-bold");
		d.textContent = line.text;
	}
}

function hideTip(tip: HTMLElement): void {
	tip.classList.remove("is-visible");
}

function truncate(s: string, n: number): string {
	return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

/** Decide how many x-axis labels can fit in `slotSize` px per category.
 *  Returns how often to show a label and how many chars each may keep. */
function computeLabelStride(count: number, slotSize: number): { stride: number; maxChars: number } {
	const estChar = 6.4; // average px per char at 11px font
	const maxChars = Math.max(4, Math.floor((slotSize - 10) / estChar));
	if (maxChars >= 8) return { stride: 1, maxChars };
	return { stride: Math.max(1, Math.ceil((8 * estChar + 10) / slotSize)), maxChars: 8 };
}

function niceTicks(min: number, max: number, count = 5): number[] {
	if (min === max) {
		min -= 1;
		max += 1;
	}
	const range = max - min;
	const step = niceStep(range / Math.max(1, count - 1));
	const start = Math.floor(min / step) * step;
	const ticks: number[] = [];
	for (let v = start; v <= max + step * 1e-6; v += step) {
		ticks.push(Math.abs(v) < 1e-9 ? 0 : Math.round(v * 1e6) / 1e6);
	}
	return ticks;
}

function niceStep(raw: number): number {
	const mag = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1e-9))));
	const norm = raw / mag;
	const s = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
	return s * mag;
}

export function renderEmpty(container: HTMLElement, message: string): void {
	const empty = container.createDiv({ cls: "ff-empty" });
	empty.createDiv({ cls: "ff-empty-icon", text: "✦" });
	empty.createDiv({ cls: "ff-empty-text", text: message });
}

/** Small status line under charts: what exactly is being plotted. */
export function chartCaption(parent: HTMLElement, result: PivotResult): void {
	const cap = parent.createDiv({ cls: "ff-chart-caption" });
	const groups = result.rowKeys.length;
	const files = result.sourceCount;
	cap.createSpan({ text: `${groups} group${groups === 1 ? "" : "s"} · ${files} file${files === 1 ? "" : "s"}` });
	const allNone = groups === 1 && result.rowKeys[0] === "(none)";
	if (allNone) {
		cap.createSpan({
			cls: "ff-warn",
			text: " ⚠ Everything lands in “(none)” — the rows property is missing from your notes; pick a different field in the sidebar.",
		});
	}
}

function legendHtml(parent: HTMLElement, items: { label: string; idx: number }[]): void {
	const wrap = parent.createDiv({ cls: "ff-chart-legend" });
	for (const it of items) {
		const item = wrap.createDiv({ cls: "ff-legend-item" });
		item.createSpan({ cls: `ff-legend-dot ff-c${it.idx % 10}` });
		item.createSpan({ text: it.label });
	}
}

/** CSS custom properties for the chart palette (used by .ff-c0..9 classes). */
function paletteProps(colors: ChartColors): Record<string, string> {
	const props: Record<string, string> = {};
	for (let i = 0; i < colors.palette.length; i++) {
		props[`--ff-c${i}`] = colors.palette[i];
	}
	return props;
}

/* ------------------------------------------------------------------ */
/* Bar chart                                                           */
/* ------------------------------------------------------------------ */

export function renderBarChart(container: HTMLElement, result: PivotResult, colors: ChartColors): void {
	if (!result.sourceCount) {
		renderEmpty(container, "No files match the current filters.");
		return;
	}
	const { rowKeys, colKeys, matrix, counts, rowTotals } = result;
	const nCols = Math.max(1, colKeys.length);
	const isSingle = nCols === 1;
	// Cap the chart so it fits the viewport: shrink group spacing when
	// there are many groups, instead of growing the SVG endlessly.
	const fitW = Math.max(28, (900 - 80) / rowKeys.length);
	const groupW = Math.min(isSingle ? 58 : Math.max(34, 26 + nCols * 26), fitW);
	const width = Math.max(560, 80 + rowKeys.length * groupW);
	const height = 320;
	const padL = 56;
	// Extra right padding so the last label is never clipped and stays
	// visually centered under its bar.
	const padR = 60;
	const padT = 26;
	const padB = 52;
	const plotH = height - padT - padB;
	let rawMax = 0;
	for (const row of matrix) {
		for (const v of row) {
			if (v !== null && v > rawMax) rawMax = v;
		}
	}
	for (const t of rowTotals) {
		if (t > rawMax) rawMax = t;
	}
	if (rawMax <= 0) {
		renderEmpty(container, "All values are empty (0) — pick a different Value field or loosen your filters.");
		return;
	}
	const maxVal = Math.max(1, rawMax);
	const ticks = niceTicks(0, maxVal, 5);
	const top = ticks[ticks.length - 1];

	const wrap = container.createDiv({ cls: "ff-chart-wrap" });
	wrap.setCssProps(paletteProps(colors));
	const svg = svgRoot(wrap, width, height);
	const tip = makeTooltip(wrap);

	for (const t of ticks) {
		const y = padT + (1 - t / top) * plotH;
		svgEl("line", { x1: padL, x2: width - padR, y1: y, y2: y, stroke: colors.grid, "stroke-width": 1 }, svg);
		const lbl = svgEl("text", { x: padL - 8, y: y + 4, "text-anchor": "end", fill: colors.muted, "font-size": 11 }, svg);
		lbl.textContent = formatNumber(t);
	}

	const plotW = width - padL - padR;
	const gW = plotW / rowKeys.length;
	const barW = isSingle ? Math.min(44, gW * 0.5) : Math.min(20, (gW * 0.72) / nCols);
	const labelStride = computeLabelStride(rowKeys.length, gW);

	rowKeys.forEach((rk, i) => {
		const gx = padL + i * gW;
		// Labels stay horizontal and centered under their bar group.
		// In grouped charts, center on the value-weighted centroid of the
		// non-empty bars, so e.g. "(root)" (one bar among many columns)
		// sits directly under its actual bar.
		const showLabel = i % labelStride.stride === 0 || i === rowKeys.length - 1;
		if (showLabel) {
			let weight = 0;
			let centroid = 0;
			for (let j = 0; j < nCols; j++) {
				const v = matrix[i][j] ?? 0;
				if (v > 0) {
					const bx = gx + gW / 2 - (barW * nCols) / 2 + j * barW + barW / 2;
					weight += v;
					centroid += v * bx;
				}
			}
			const labelX = weight > 0 ? centroid / weight : gx + gW / 2;
			const clamped = Math.min(Math.max(labelX, gx + 12), gx + gW - 12);
			const xLbl = svgEl("text", { x: clamped, y: height - padB + 14, "text-anchor": "middle", fill: colors.muted, "font-size": 11 }, svg);
			xLbl.textContent = truncate(rk, labelStride.maxChars);
			xLbl.setAttribute("title", rk);
		}

		for (let j = 0; j < nCols; j++) {
			const v = matrix[i][j] ?? 0;
			const h = (v / maxVal) * plotH;
			const x = gx + gW / 2 - (barW * nCols) / 2 + j * barW;
			const y = height - padB - h;
			const bar = svgEl(
				"rect",
				{
					x,
					y,
					width: barW,
					height: Math.max(0, h),
					rx: Math.min(4, barW / 2),
				},
				svg,
			);
			bar.addClass("ff-bar", `ff-c${j % colors.palette.length}`);
			const colName = colKeys[j] ?? "All";
			const count = counts[i]?.[j] ?? 0;
			bar.addEventListener("mouseenter", (e) => {
				fillTip(tip, [
					{ text: rk, bold: true },
					{ text: `${colName}: ${formatNumber(v)}${count > 0 ? ` · ${count} file(s)` : ""}` },
				]);
				showTip(tip, e.clientX, e.clientY);
			});
			bar.addEventListener("mousemove", (e) => {
				tip.classList.add("is-visible");
				const parentRect = wrap.getBoundingClientRect();
				const r = tip.getBoundingClientRect();
				let left = e.clientX - parentRect.left - r.width / 2;
				let top = e.clientY - parentRect.top - r.height - 12;
				left = Math.max(6, Math.min(left, parentRect.width - r.width - 6));
				top = Math.max(6, top);
				tip.style.left = `${left}px`;
				tip.style.top = `${top}px`;
			});
			bar.addEventListener("mouseleave", () => hideTip(tip));

			if (barW >= 20 && h > 20) {
				const lbl = svgEl("text", { x: x + barW / 2, y: y - 6, "text-anchor": "middle", fill: colors.text, "font-size": 10, "font-weight": 600 }, svg);
				lbl.textContent = formatNumber(v);
			}
		}
	});

	if (!isSingle) {
		legendHtml(wrap, colKeys.map((k, j) => ({ label: k, idx: j })));
	}
	chartCaption(wrap, result);
}

/* ------------------------------------------------------------------ */
/* Scatter chart (+ trend line)                                        */
/* ------------------------------------------------------------------ */

interface Point {
	x: number;
	y: number;
	cat: string;
	name: string;
}

export function renderScatterChart(
	container: HTMLElement,
	rows: VaultRow[],
	xField: string,
	yField: string,
	colorField: string | null,
	showTrend: boolean,
	colors: ChartColors,
): void {
	if (!rows.length) {
		renderEmpty(container, "No files to plot. Check the filters.");
		return;
	}
	const valid: Point[] = [];
	for (const r of rows) {
		const x = numericOf(r, xField);
		const y = numericOf(r, yField);
		if (x === null || y === null) continue;
		valid.push({
			x,
			y,
			cat: colorField ? displayValue(getFieldValue(r, colorField)) || "(none)" : "",
			name: r.name,
		});
	}
	if (valid.length < 2) {
		renderEmpty(container, "Need at least two numeric points. Pick numeric X and Y fields.");
		return;
	}

	let minX = Math.min(...valid.map((p) => p.x));
	let maxX = Math.max(...valid.map((p) => p.x));
	let minY = Math.min(...valid.map((p) => p.y));
	let maxY = Math.max(...valid.map((p) => p.y));
	const padRange = (min: number, max: number): [number, number] => {
		if (min === max) {
			const d = Math.max(1, Math.abs(min) * 0.1);
			return [min - d, max + d];
		}
		const d = (max - min) * 0.08;
		return [min - d, max + d];
	};
	[minX, maxX] = padRange(minX, maxX);
	[minY, maxY] = padRange(minY, maxY);

	const width = 640;
	const height = 420;
	const padL = 56;
	const padR = 20;
	const padT = 24;
	const padB = 56;
	const plotW = width - padL - padR;
	const plotH = height - padT - padB;

	const wrap = container.createDiv({ cls: "ff-chart-wrap" });
	wrap.setCssProps(paletteProps(colors));
	const svg = svgRoot(wrap, width, height);
	const tip = makeTooltip(wrap);

	const xTicks = niceTicks(minX, maxX, 6);
	const yTicks = niceTicks(minY, maxY, 6);
	const sx = (v: number) => padL + ((v - minX) / (maxX - minX)) * plotW;
	const sy = (v: number) => padT + (1 - (v - minY) / (maxY - minY)) * plotH;

	for (const t of yTicks) {
		const y = sy(t);
		svgEl("line", { x1: padL, x2: width - padR, y1: y, y2: y, stroke: colors.grid, "stroke-width": 1 }, svg);
		const lbl = svgEl("text", { x: padL - 8, y: y + 4, "text-anchor": "end", fill: colors.muted, "font-size": 11 }, svg);
		lbl.textContent = formatNumber(t);
	}
	for (const t of xTicks) {
		const x = sx(t);
		const lbl = svgEl("text", { x, y: height - padB + 20, "text-anchor": "middle", fill: colors.muted, "font-size": 11 }, svg);
		lbl.textContent = formatNumber(t);
	}

	if (showTrend) {
		const n = valid.length;
		const mx = valid.reduce((a, p) => a + p.x, 0) / n;
		const my = valid.reduce((a, p) => a + p.y, 0) / n;
		let num = 0;
		let den = 0;
		for (const p of valid) {
			num += (p.x - mx) * (p.y - my);
			den += (p.x - mx) * (p.x - mx);
		}
		if (den > 0) {
			const slope = num / den;
			const intercept = my - slope * mx;
			const x1 = minX;
			const x2 = maxX;
			const line = svgEl("line", { x1: sx(x1), y1: sy(slope * x1 + intercept), x2: sx(x2), y2: sy(slope * x2 + intercept), stroke: colors.muted, "stroke-width": 1.5, "stroke-dasharray": "6 4" }, svg);
			line.classList.add("ff-trend-line");
			const r2 = correlation2(valid);
			const lbl = svgEl("text", { x: width - padR, y: padT - 6, "text-anchor": "end", fill: colors.muted, "font-size": 11 }, svg);
			lbl.textContent = `trend  r² = ${r2.toFixed(2)}`;
		}
	}

	const catColors = new Map<string, number>();
	if (colorField) {
		valid.forEach((p) => {
			if (!catColors.has(p.cat)) catColors.set(p.cat, catColors.size % colors.palette.length);
		});
	}

	for (const p of valid) {
		const colorIdx = colorField ? (catColors.get(p.cat) ?? 0) : 0;
		const circle = svgEl("circle", { cx: sx(p.x), cy: sy(p.y), r: 5.5, stroke: "var(--background-primary)", "stroke-width": 1.5 }, svg);
		circle.addClass("ff-point", `ff-c${colorIdx}`);
		circle.addEventListener("mouseenter", (e) => {
			circle.setAttribute("r", "8");
			const lines: { text: string; bold?: boolean }[] = [
				{ text: p.name, bold: true },
				{ text: `${xField}: ${formatNumber(p.x)}` },
				{ text: `${yField}: ${formatNumber(p.y)}` },
			];
			if (p.cat && colorField) lines.push({ text: `${colorField}: ${p.cat}` });
			fillTip(tip, lines);
			showTip(tip, e.clientX, e.clientY);
		});
		circle.addEventListener("mousemove", (e) => {
			tip.classList.add("is-visible");
			const parentRect = wrap.getBoundingClientRect();
			const r = tip.getBoundingClientRect();
			let left = e.clientX - parentRect.left - r.width / 2;
			let top = e.clientY - parentRect.top - r.height - 12;
			left = Math.max(6, Math.min(left, parentRect.width - r.width - 6));
			top = Math.max(6, top);
			tip.style.left = `${left}px`;
			tip.style.top = `${top}px`;
		});
		circle.addEventListener("mouseleave", () => {
			circle.setAttribute("r", "5.5");
			hideTip(tip);
		});
	}

	if (colorField && catColors.size > 0) {
		legendHtml(wrap, [...catColors.entries()].map(([label, idx]) => ({ label, idx })));
	}
}

function correlation2(pts: Point[]): number {
	const n = pts.length;
	const mx = pts.reduce((a, p) => a + p.x, 0) / n;
	const my = pts.reduce((a, p) => a + p.y, 0) / n;
	let num = 0;
	let dx = 0;
	let dy = 0;
	for (const p of pts) {
		num += (p.x - mx) * (p.y - my);
		dx += (p.x - mx) * (p.x - mx);
		dy += (p.y - my) * (p.y - my);
	}
	if (dx === 0 || dy === 0) return 0;
	const r = num / Math.sqrt(dx * dy);
	return r * r;
}

/* ------------------------------------------------------------------ */
/* Trend (time-series area chart)                                      */
/* ------------------------------------------------------------------ */

export type TrendBucket = "day" | "week" | "month";

export function renderTrendChart(
	container: HTMLElement,
	rows: VaultRow[],
	timeField: string,
	bucket: TrendBucket,
	colors: ChartColors,
): void {
	const counts = new Map<string, number>();
	for (const r of rows) {
		const t = timeValue(r, timeField);
		if (t === null) continue;
		const key = bucketKey(t, bucket);
		counts.set(key, (counts.get(key) ?? 0) + 1);
	}
	if (counts.size < 2) {
		renderEmpty(container, "Not enough dated files to draw a trend. Pick a date field with spread-out values.");
		return;
	}

	const keys = [...counts.keys()].sort();
	const values = keys.map((k) => counts.get(k)!);
	const maxVal = Math.max(...values);

	// Cap width for the same viewport-fit reason as the bar chart.
	const width = Math.max(560, Math.min(keys.length * 46 + 80, 960));
	const height = 320;
	const padL = 46;
	const padR = 14;
	const padT = 26;
	const padB = 46;
	const plotW = width - padL - padR;
	const plotH = height - padT - padB;

	const wrap = container.createDiv({ cls: "ff-chart-wrap" });
	wrap.setCssProps(paletteProps(colors));
	const svg = svgRoot(wrap, width, height);
	const tip = makeTooltip(wrap);

	const ticks = niceTicks(0, maxVal, 4);
	const top = ticks[ticks.length - 1];
	for (const t of ticks) {
		const y = padT + (1 - t / top) * plotH;
		svgEl("line", { x1: padL, x2: width - padR, y1: y, y2: y, stroke: colors.grid, "stroke-width": 1 }, svg);
		const lbl = svgEl("text", { x: padL - 8, y: y + 4, "text-anchor": "end", fill: colors.muted, "font-size": 11 }, svg);
		lbl.textContent = String(t);
	}

	const step = plotW / Math.max(1, keys.length - 1);
	const px = (i: number) => padL + i * step;
	const py = (v: number) => padT + (1 - v / maxVal) * plotH;
	const labelStride = computeLabelStride(keys.length, step);

	// Area fill
	const defs = svgEl("defs", {}, svg);
	const grad = svgEl("linearGradient", { id: "ff-trend-grad", x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
	svgEl("stop", { offset: "0%", "stop-color": colors.accent, "stop-opacity": 0.45 }, grad);
	svgEl("stop", { offset: "100%", "stop-color": colors.accent, "stop-opacity": 0.02 }, grad);

	const areaPath = keys
		.map((k, i) => `${i === 0 ? "M" : "L"}${px(i)},${py(counts.get(k)!)}`)
		.join(" ");
	const area = svgEl("path", { d: `${areaPath} L${padL + step * (keys.length - 1)},${padT + plotH} L${padL},${padT + plotH} Z`, fill: "url(#ff-trend-grad)", class: "ff-area" }, svg);

	// Line
	const linePath = keys.map((k, i) => `${i === 0 ? "M" : "L"}${px(i)},${py(counts.get(k)!)}`).join(" ");
	const line = svgEl("path", { d: linePath, fill: "none", stroke: colors.accent, "stroke-width": 2.5, "stroke-linecap": "round", "stroke-linejoin": "round", class: "ff-line" }, svg);

	// Points + labels
	keys.forEach((k, i) => {
		const v = counts.get(k)!;
		const cx = px(i);
		const cy = py(v);
		const dot = svgEl("circle", { cx, cy, r: 4, fill: colors.accent, stroke: "var(--background-primary)", "stroke-width": 1.5, class: "ff-point" }, svg);
		dot.addEventListener("mouseenter", (e) => {
			fillTip(tip, [{ text: k, bold: true }, { text: `${v} file(s)` }]);
			showTip(tip, e.clientX, e.clientY);
		});
		dot.addEventListener("mousemove", (e) => {
			tip.classList.add("is-visible");
			const parentRect = wrap.getBoundingClientRect();
			const r = tip.getBoundingClientRect();
			let left = e.clientX - parentRect.left - r.width / 2;
			let top = e.clientY - parentRect.top - r.height - 12;
			left = Math.max(6, Math.min(left, parentRect.width - r.width - 6));
			top = Math.max(6, top);
			tip.style.left = `${left}px`;
			tip.style.top = `${top}px`;
		});
		dot.addEventListener("mouseleave", () => hideTip(tip));

		const lbl = svgEl("text", { x: cx, y: cy - 10, "text-anchor": "middle", fill: colors.text, "font-size": 10, "font-weight": 600 }, svg);
		lbl.textContent = String(v);

		if (i % labelStride.stride === 0 || i === keys.length - 1) {
			const xLbl = svgEl("text", { x: cx, y: height - padB + 20, "text-anchor": "middle", fill: colors.muted, "font-size": 10 }, svg);
			xLbl.textContent = truncate(k, labelStride.maxChars);
			xLbl.setAttribute("title", k);
		}
	});

	void area;
	void line;
}

function timeValue(row: VaultRow, field: string): number | null {
	const v = getFieldValue(row, field);
	if (typeof v === "number") return Number.isFinite(v) ? v : null;
	if (typeof v === "string") {
		const t = Date.parse(v);
		return Number.isNaN(t) ? null : t;
	}
	return null;
}

function bucketKey(t: number, bucket: TrendBucket): string {
	const d = new Date(t);
	if (bucket === "month") return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
	if (bucket === "week") {
		const day = (d.getDay() + 6) % 7; // Monday = 0
		const monday = new Date(d);
		monday.setDate(d.getDate() - day);
		return `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, "0")}-${String(monday.getDate()).padStart(2, "0")}`;
	}
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/* ------------------------------------------------------------------ */
/* Donut chart                                                         */
/* ------------------------------------------------------------------ */

export function renderDonutChart(container: HTMLElement, result: PivotResult, colors: ChartColors): void {
	if (!result.sourceCount) {
		renderEmpty(container, "No files match the current filters.");
		return;
	}
	const slices = result.rowKeys.map((k, i) => ({ key: k, value: result.rowTotals[i] ?? 0 }));
	const total = slices.reduce((a, s) => a + s.value, 0);
	if (total <= 0) {
		renderEmpty(container, "Nothing to slice — totals are empty.");
		return;
	}

	const wrap = container.createDiv({ cls: "ff-donut-wrap" });
	wrap.setCssProps(paletteProps(colors));
	const size = 240;
	const cx = size / 2;
	const cy = size / 2;
	const r = 84;
	const stroke = 36;
	const C = 2 * Math.PI * r;

	const svg = svgRoot(wrap, size, size);
	const group = svgEl("g", { transform: `rotate(-90 ${cx} ${cy})` }, svg);

	let offset = 0;
	slices.forEach((s, i) => {
		const frac = s.value / total;
		const dash = Math.max(0.5, frac * C - 1.5);
		const seg = svgEl(
			"circle",
			{
				cx,
				cy,
				r,
				fill: "none",
				"stroke-width": stroke,
				"stroke-dasharray": `${dash} ${C - dash}`,
				"stroke-dashoffset": -offset,
				class: `ff-donut-seg ff-c${i % colors.palette.length}`,
			},
			group,
		);
		seg.addEventListener("mouseenter", (e) => {
			fillTip(tipFor(wrap), [
				{ text: s.key, bold: true },
				{ text: `${formatNumber(s.value)} · ${(frac * 100).toFixed(1)}%` },
			]);
			showTip(tipFor(wrap), e.clientX, e.clientY);
		});
		seg.addEventListener("mousemove", (e) => {
			const tip = tipFor(wrap);
			tip.classList.add("is-visible");
			const parentRect = wrap.getBoundingClientRect();
			const r2 = tip.getBoundingClientRect();
			let left = e.clientX - parentRect.left - r2.width / 2;
			let top = e.clientY - parentRect.top - r2.height - 12;
			left = Math.max(6, Math.min(left, parentRect.width - r2.width - 6));
			top = Math.max(6, top);
			tip.style.left = `${left}px`;
			tip.style.top = `${top}px`;
		});
		seg.addEventListener("mouseleave", () => hideTip(tipFor(wrap)));
		offset += frac * C;
	});

	// Center label
	const center = svgEl("text", { x: cx, y: cy + 6, "text-anchor": "middle", fill: colors.text, "font-size": 26, "font-weight": 700 }, svg);
	center.textContent = formatNumber(total);
	const centerSub = svgEl("text", { x: cx, y: cy + 24, "text-anchor": "middle", fill: colors.muted, "font-size": 11 }, svg);
	centerSub.textContent = "Files";

	// Legend
	legendHtml(
		wrap,
		slices.map((s, i) => ({
			label: `${s.key} — ${formatNumber(s.value)} (${((s.value / total) * 100).toFixed(1)}%)`,
			idx: i,
		})),
	);
	chartCaption(wrap, result);
}

const tips = new WeakMap<HTMLElement, HTMLElement>();
function tipFor(container: HTMLElement): HTMLElement {
	let tip = tips.get(container);
	if (!tip) {
		tip = makeTooltip(container);
		tips.set(container, tip);
	}
	return tip;
}
