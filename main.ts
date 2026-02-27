import {
    App,
    ItemView,
    Modal,
    Notice,
    Plugin,
    PluginSettingTab,
    Setting,
    TFile,
    WorkspaceLeaf,
    setIcon,
} from "obsidian";

/* ───────────────────────── constants ───────────────────────── */

const VIEW_TYPE = "review-reminder-view";

const SR_LABELS: Record<number, string> = {
    0: "New",
    1: "1st pass",
    2: "2nd pass",
    3: "3rd pass",
    4: "4th pass",
    5: "Evergreen",
};

/* ───────────────────── settings interface ───────────────────── */

interface ReviewReminderSettings {
    /** Frontmatter property that holds the next review date */
    dateProperty: string;
    /** Frontmatter property that holds the current review level */
    freqProperty: string;
    /** Days threshold for the "upcoming" bucket */
    upcomingDays: number;
    /**
     * Spaced-repetition intervals: comma-separated list of day counts.
     * Index 0 = interval after level 0, index 1 = after level 1, etc.
     * The last value repeats for all higher levels (evergreen).
     */
    intervals: string;
    /** Show a notice on startup when there are overdue notes */
    notifyOnStartup: boolean;
}

const DEFAULT_SETTINGS: ReviewReminderSettings = {
    dateProperty: "review_next",
    freqProperty: "review_freq",
    upcomingDays: 7,
    intervals: "1, 6, 9, 19, 75",
    notifyOnStartup: true,
};

/* ───────────── parse the interval string ────────────── */

function parseIntervals(raw: string): number[] {
    return raw
        .split(",")
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => !isNaN(n) && n > 0);
}

function getInterval(intervals: number[], level: number): number {
    if (intervals.length === 0) return 1;
    return level < intervals.length
        ? intervals[level]
        : intervals[intervals.length - 1];
}

/* ───────────────── helper types & functions ─────────────────── */

interface ReviewNote {
    file: TFile;
    title: string;
    reviewNext: Date;
    reviewFreq: number;
    tags: string[];
    daysUntil: number;
}

type Bucket = "overdue" | "today" | "upcoming" | "later";

function toDateString(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

function stripTime(d: Date): Date {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function daysBetween(a: Date, b: Date): number {
    return Math.round((b.getTime() - a.getTime()) / 86400000);
}

function relativeLabel(days: number): string {
    if (days < -1) return `${Math.abs(days)} days overdue`;
    if (days === -1) return "1 day overdue";
    if (days === 0) return "Today";
    if (days === 1) return "Tomorrow";
    return `in ${days} days`;
}

function levelLabel(freq: number): string {
    return SR_LABELS[freq] ?? `Level ${freq}`;
}

/* ════════════════════════════════════════════════════════════════
   PLUGIN
   ════════════════════════════════════════════════════════════════ */

export default class ReviewReminderPlugin extends Plugin {
    settings: ReviewReminderSettings = DEFAULT_SETTINGS;
    private statusBarEl: HTMLElement | null = null;
    private notes: ReviewNote[] = [];

    async onload() {
        await this.loadSettings();
        this.addSettingTab(new ReviewReminderSettingTab(this.app, this));

        this.registerView(VIEW_TYPE, (leaf) => new ReviewSidebarView(leaf, this));

        this.addRibbonIcon("calendar-clock", "Review reminder", () => {
            void this.activateView();
        });

        this.statusBarEl = this.addStatusBarItem();
        this.statusBarEl.addClass("review-reminder-status");

        this.addCommand({
            id: "open-review-queue",
            name: "Open review queue",
            callback: () => void this.activateView(),
        });

        this.addCommand({
            id: "refresh-review-queue",
            name: "Refresh review queue",
            callback: () => this.refresh(),
        });

        this.registerEvent(
            this.app.metadataCache.on("resolved", () => {
                this.refresh();
            })
        );

        this.app.workspace.onLayoutReady(() => {
            this.refresh();
            if (this.settings.notifyOnStartup) {
                this.startupNotice();
            }
        });
    }

    /* ── settings ── */

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
        this.refresh();
    }

    /* ── data ── */

    scanVault(): ReviewNote[] {
        const today = stripTime(new Date());
        const notes: ReviewNote[] = [];
        const dateProp = this.settings.dateProperty;
        const freqProp = this.settings.freqProperty;

        for (const file of this.app.vault.getMarkdownFiles()) {
            const cache = this.app.metadataCache.getFileCache(file);
            if (!cache?.frontmatter) continue;

            const raw = cache.frontmatter[dateProp];
            if (!raw) continue;

            const reviewNext = stripTime(new Date(String(raw)));
            if (isNaN(reviewNext.getTime())) continue;

            const reviewFreq = Number(cache.frontmatter[freqProp] ?? 0);
            const tags: string[] = (cache.frontmatter["tags"] ?? []).map(String);

            notes.push({
                file,
                title: file.basename,
                reviewNext,
                reviewFreq,
                tags,
                daysUntil: daysBetween(today, reviewNext),
            });
        }

        notes.sort((a, b) => a.daysUntil - b.daysUntil);
        return notes;
    }

    bucketize(notes: ReviewNote[]): Record<Bucket, ReviewNote[]> {
        const threshold = this.settings.upcomingDays;
        const buckets: Record<Bucket, ReviewNote[]> = {
            overdue: [],
            today: [],
            upcoming: [],
            later: [],
        };
        for (const n of notes) {
            if (n.daysUntil < 0) buckets.overdue.push(n);
            else if (n.daysUntil === 0) buckets.today.push(n);
            else if (n.daysUntil <= threshold) buckets.upcoming.push(n);
            else buckets.later.push(n);
        }
        return buckets;
    }

    /* ── actions ── */

    refresh() {
        this.notes = this.scanVault();
        this.updateStatusBar();
        for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
            (leaf.view as ReviewSidebarView).renderView();
        }
    }

    private updateStatusBar() {
        if (!this.statusBarEl) return;
        const buckets = this.bucketize(this.notes);
        const overdue = buckets.overdue.length;
        const today = buckets.today.length;
        const parts: string[] = [];
        if (overdue) parts.push(`🔴 ${overdue} overdue`);
        if (today) parts.push(`🟠 ${today} today`);
        if (!parts.length) parts.push("✅ No reviews due");
        this.statusBarEl.setText(parts.join("  ·  "));
    }

    private startupNotice() {
        const buckets = this.bucketize(this.notes);
        const n = buckets.overdue.length;
        if (n > 0) {
            new Notice(`📋 Review Reminder: You have ${n} overdue note${n > 1 ? "s" : ""}!`, 8000);
        }
    }

    async activateView() {
        const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE);
        if (existing.length) {
            this.app.workspace.revealLeaf(existing[0]);
            return;
        }
        const leaf = this.app.workspace.getRightLeaf(false);
        if (leaf) {
            await leaf.setViewState({ type: VIEW_TYPE, active: true });
            this.app.workspace.revealLeaf(leaf);
        }
    }

    markReviewed(note: ReviewNote) {
        new ReviewModal(this.app, this, note).open();
    }

    async applyReview(note: ReviewNote, nextDate: Date, newFreq: number) {
        const dateProp = this.settings.dateProperty;
        const freqProp = this.settings.freqProperty;
        await this.app.fileManager.processFrontMatter(note.file, (fm) => {
            fm[freqProp] = newFreq;
            fm[dateProp] = toDateString(nextDate);
        });
        new Notice(`✅ Next review: ${toDateString(nextDate)}  (${levelLabel(newFreq)})`);
        this.refresh();
    }
}

/* ════════════════════════════════════════════════════════════════
   SETTINGS TAB
   ════════════════════════════════════════════════════════════════ */

class ReviewReminderSettingTab extends PluginSettingTab {
    plugin: ReviewReminderPlugin;

    constructor(app: App, plugin: ReviewReminderPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        new Setting(containerEl).setName("Review reminder").setHeading();

        /* ── Property names ── */
        new Setting(containerEl).setName("Frontmatter properties").setHeading();

        new Setting(containerEl)
            .setName("Date property")
            .setDesc("The frontmatter property that stores the next review date (YYYY-MM-DD).")
            .addText((text) =>
                text
                    .setPlaceholder("review_next")
                    .setValue(this.plugin.settings.dateProperty)
                    .onChange(async (value) => {
                        this.plugin.settings.dateProperty = value.trim() || "review_next";
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("Frequency / level property")
            .setDesc("The frontmatter property that stores the current review level (integer).")
            .addText((text) =>
                text
                    .setPlaceholder("review_freq")
                    .setValue(this.plugin.settings.freqProperty)
                    .onChange(async (value) => {
                        this.plugin.settings.freqProperty = value.trim() || "review_freq";
                        await this.plugin.saveSettings();
                    })
            );

        /* ── Spaced repetition ── */
        new Setting(containerEl).setName("Spaced repetition").setHeading();

        new Setting(containerEl)
            .setName("Intervals (days)")
            .setDesc(
                "Comma-separated list of intervals. Index 0 = days after new note, " +
                "1 = after 1st pass, etc. The last value repeats for all higher levels."
            )
            .addText((text) =>
                text
                    .setPlaceholder("1, 6, 9, 19, 75")
                    .setValue(this.plugin.settings.intervals)
                    .onChange(async (value) => {
                        this.plugin.settings.intervals = value;
                        await this.plugin.saveSettings();
                    })
            );

        // Preview
        const previewEl = containerEl.createDiv({ cls: "rr-settings-preview" });
        const intervals = parseIntervals(this.plugin.settings.intervals);
        previewEl.createEl("strong", { text: "Schedule preview:" });
        const ul = previewEl.createEl("ul");
        for (let i = 0; i < Math.min(intervals.length + 1, 8); i++) {
            const days = getInterval(intervals, i);
            ul.createEl("li", {
                text: `${levelLabel(i)} → next review in ${days} day${days > 1 ? "s" : ""}`,
            });
        }

        /* ── Display ── */
        new Setting(containerEl).setName("Display").setHeading();

        new Setting(containerEl)
            .setName("Upcoming threshold (days)")
            .setDesc("Notes due within this many days appear in the 'Upcoming' section.")
            .addSlider((slider) =>
                slider
                    .setLimits(1, 30, 1)
                    .setValue(this.plugin.settings.upcomingDays)
                    .setDynamicTooltip()
                    .onChange(async (value) => {
                        this.plugin.settings.upcomingDays = value;
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("Startup notification")
            .setDesc("Show a notice when Obsidian starts if you have overdue notes.")
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.notifyOnStartup)
                    .onChange(async (value) => {
                        this.plugin.settings.notifyOnStartup = value;
                        await this.plugin.saveSettings();
                    })
            );
    }
}

/* ════════════════════════════════════════════════════════════════
   SIDEBAR VIEW
   ════════════════════════════════════════════════════════════════ */

class ReviewSidebarView extends ItemView {
    private plugin: ReviewReminderPlugin;

    constructor(leaf: WorkspaceLeaf, plugin: ReviewReminderPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType(): string {
        return VIEW_TYPE;
    }
    getDisplayText(): string {
        return "Review reminder";
    }
    getIcon(): string {
        return "calendar-clock";
    }

    onOpen() {
        this.renderView();
        return Promise.resolve();
    }

    renderView() {
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.addClass("review-reminder-container");

        const header = container.createDiv({ cls: "rr-header" });
        header.createEl("h4", { text: "📋 Review queue" });

        const refreshBtn = header.createEl("button", {
            cls: "rr-refresh-btn",
            attr: { "aria-label": "Refresh" },
        });
        setIcon(refreshBtn, "refresh-cw");
        refreshBtn.addEventListener("click", () => this.plugin.refresh());

        const notes = this.plugin.scanVault();
        const buckets = this.plugin.bucketize(notes);

        if (notes.length === 0) {
            const dateProp = this.plugin.settings.dateProperty;
            container.createDiv({
                cls: "rr-empty",
                text: `No notes with "${dateProp}" property found.`,
            });
            return;
        }

        const threshold = this.plugin.settings.upcomingDays;
        const sections: { key: Bucket; label: string; emoji: string; cls: string }[] = [
            { key: "overdue", label: "Overdue", emoji: "🔴", cls: "rr-overdue" },
            { key: "today", label: "Due today", emoji: "🟠", cls: "rr-today" },
            { key: "upcoming", label: `Upcoming (${threshold}d)`, emoji: "🟡", cls: "rr-upcoming" },
            { key: "later", label: "Later", emoji: "🟢", cls: "rr-later" },
        ];

        for (const sec of sections) {
            const items = buckets[sec.key];
            if (items.length === 0) continue;

            const sectionEl = container.createDiv({ cls: `rr-section ${sec.cls}` });

            const sectionHeader = sectionEl.createDiv({ cls: "rr-section-header" });
            sectionHeader.createSpan({ text: `${sec.emoji} ${sec.label}` });
            sectionHeader.createSpan({ cls: "rr-badge", text: String(items.length) });

            const listEl = sectionEl.createDiv({ cls: "rr-list" });
            let collapsed = sec.key === "later";
            if (collapsed) listEl.addClass("rr-collapsed");

            sectionHeader.addEventListener("click", () => {
                collapsed = !collapsed;
                listEl.toggleClass("rr-collapsed", collapsed);
            });

            for (const note of items) {
                const card = listEl.createDiv({ cls: "rr-card" });

                const row = card.createDiv({ cls: "rr-card-row" });
                const info = row.createDiv({ cls: "rr-card-info" });
                info.createDiv({ cls: "rr-card-title", text: note.title });

                const meta = info.createDiv({ cls: "rr-card-meta" });
                meta.createSpan({ cls: "rr-relative-date", text: relativeLabel(note.daysUntil) });
                meta.createSpan({ cls: "rr-level", text: levelLabel(note.reviewFreq) });

                if (note.tags.length > 0) {
                    const tagsEl = card.createDiv({ cls: "rr-card-tags" });
                    for (const t of note.tags.slice(0, 4)) {
                        tagsEl.createSpan({ cls: "rr-tag", text: `#${t}` });
                    }
                    if (note.tags.length > 4) {
                        tagsEl.createSpan({ cls: "rr-tag rr-tag-more", text: `+${note.tags.length - 4}` });
                    }
                }

                card.addEventListener("click", (e) => {
                    if ((e.target as HTMLElement).closest(".rr-review-btn")) return;
                    void this.app.workspace.getLeaf(false).openFile(note.file);
                });

                const btn = row.createEl("button", {
                    cls: "rr-review-btn",
                    attr: { "aria-label": "Mark as reviewed" },
                });
                setIcon(btn, "check-circle");
                btn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    void this.plugin.markReviewed(note);
                });
            }
        }
    }
}

/* ════════════════════════════════════════════════════════════════
   REVIEW MODAL
   ════════════════════════════════════════════════════════════════ */

class ReviewModal extends Modal {
    private plugin: ReviewReminderPlugin;
    private note: ReviewNote;

    constructor(app: App, plugin: ReviewReminderPlugin, note: ReviewNote) {
        super(app);
        this.plugin = plugin;
        this.note = note;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.addClass("rr-modal");

        contentEl.createEl("h3", { text: "✅ Mark as reviewed" });
        contentEl.createEl("p", {
            cls: "rr-modal-note-title",
            text: this.note.title,
        });

        const currentFreq = this.note.reviewFreq;
        const newFreq = currentFreq + 1;
        const intervals = parseIntervals(this.plugin.settings.intervals);
        const interval = getInterval(intervals, currentFreq);
        const nextDate = new Date();
        nextDate.setDate(nextDate.getDate() + interval);

        const progressEl = contentEl.createDiv({ cls: "rr-modal-progress" });
        progressEl.createSpan({ cls: "rr-modal-level-old", text: levelLabel(currentFreq) });
        progressEl.createSpan({ cls: "rr-modal-arrow", text: " → " });
        progressEl.createSpan({ cls: "rr-modal-level-new", text: levelLabel(newFreq) });

        const infoEl = contentEl.createDiv({ cls: "rr-modal-info" });
        infoEl.createDiv({ text: `Next review in ${interval} days` });
        infoEl.createDiv({
            cls: "rr-modal-date",
            text: `📅 ${toDateString(nextDate)}`,
        });

        contentEl.createDiv({ cls: "rr-modal-quick-label", text: "Or pick a custom interval:" });

        const quickRow = contentEl.createDiv({ cls: "rr-modal-quick-row" });
        const quickOptions = [
            { label: "1d", days: 1 },
            { label: "3d", days: 3 },
            { label: "1w", days: 7 },
            { label: "2w", days: 14 },
            { label: "1m", days: 30 },
            { label: "3m", days: 90 },
        ];

        for (const opt of quickOptions) {
            const btn = quickRow.createEl("button", {
                cls: "rr-quick-btn",
                text: opt.label,
            });
            btn.addEventListener("click", () => {
                const customDate = new Date();
                customDate.setDate(customDate.getDate() + opt.days);
                void this.plugin.applyReview(this.note, customDate, newFreq);
                this.close();
            });
        }

        const actions = contentEl.createDiv({ cls: "rr-modal-actions" });
        const confirmBtn = actions.createEl("button", {
            cls: "rr-confirm-btn",
            text: `✅ Confirm (${interval} days)`,
        });
        confirmBtn.addEventListener("click", () => {
            void this.plugin.applyReview(this.note, nextDate, newFreq);
            this.close();
        });

        const cancelBtn = actions.createEl("button", {
            cls: "rr-cancel-btn",
            text: "Cancel",
        });
        cancelBtn.addEventListener("click", () => this.close());
    }

    onClose() {
        this.contentEl.empty();
    }
}
