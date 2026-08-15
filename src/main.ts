import { Notice, Plugin } from "obsidian";
import { FieldForgeView, VIEW_TYPE_FIELD_FORGE } from "./view";

export default class FieldForgePlugin extends Plugin {
	async onload() {
		this.registerView(VIEW_TYPE_FIELD_FORGE, (leaf) => new FieldForgeView(leaf, this));

		this.addRibbonIcon("table-2", "Open FieldForge — property explorer", () => {
			void this.activateView();
		});

		this.addCommand({
			id: "open-fieldforge",
			name: "Open FieldForge: property explorer",
			callback: () => {
				void this.activateView(false);
			},
		});

		this.addCommand({
			id: "open-fieldforge-sidebar",
			name: "Open FieldForge in right sidebar",
			callback: () => {
				void this.activateView(true);
			},
		});

		this.addCommand({
			id: "fieldforge-copy-markdown",
			name: "FieldForge: copy current view as Markdown table",
			checkCallback: (checking) => {
				const view = this.getView();
				if (!view) return false;
				if (!checking) void view.copyAsMarkdown();
				return true;
			},
		});
	}

	private getView(): FieldForgeView | null {
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_FIELD_FORGE);
		if (!leaves.length) return null;
		const view = leaves[0].view;
		return view instanceof FieldForgeView ? view : null;
	}

	async activateView(sidebar = false): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_FIELD_FORGE);
		if (existing.length > 0) {
			this.app.workspace.revealLeaf(existing[0]);
			return;
		}
		const leaf = sidebar
			? this.app.workspace.getRightLeaf(false)
			: this.app.workspace.getLeaf(true);
		if (!leaf) {
			new Notice("FieldForge: could not create a leaf.");
			return;
		}
		await leaf.setViewState({ type: VIEW_TYPE_FIELD_FORGE, active: true });
		this.app.workspace.revealLeaf(leaf);
	}

	onunload() {
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_FIELD_FORGE);
	}
}
