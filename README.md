# Review Reminder

A sidebar dashboard plugin for [Obsidian](https://obsidian.md) that shows notes due for review — grouped by urgency — with built-in **spaced repetition**.

![Obsidian](https://img.shields.io/badge/Obsidian-v1.0+-blue?logo=obsidian)
![License](https://img.shields.io/github/license/imadjalloul/obsidian-review-reminder)

---

## Features

- **📋 Sidebar dashboard** — Notes grouped into 4 urgency buckets:
  - 🔴 **Overdue** — past due date
  - 🟠 **Due Today**
  - 🟡 **Upcoming** — within configurable threshold
  - 🟢 **Later** — further out
- **✅ Mark as Reviewed** — Click to advance through spaced repetition levels. The plugin auto-calculates the next review date and updates your frontmatter.
- **⚙️ Fully customizable** — Configure property names, intervals, and thresholds in settings.
- **📊 Status bar** — Shows overdue and today counts at a glance.
- **🔔 Startup notification** — Optional notice when Obsidian opens with overdue notes.
- **🎨 Dark & light mode** — Styled with native Obsidian CSS variables.

## How It Works

Add two frontmatter properties to any note:

```yaml
---
review_next: 2025-03-01
review_freq: 0
---
```

| Property | Type | Description |
|---|---|---|
| `review_next` | Date (`YYYY-MM-DD`) | When this note should next be reviewed |
| `review_freq` | Integer | Current review level (0 = new, increments on each review) |

> **Note:** Property names are fully customizable in Settings.

## Spaced Repetition Schedule

The default schedule (customizable in Settings):

| After Level | Wait (days) | Cumulative Day |
|---|---|---|
| 0 (New) | 1 | Day 1 |
| 1 (1st pass) | 6 | Day 7 |
| 2 (2nd pass) | 9 | Day 16 |
| 3 (3rd pass) | 19 | Day 35 |
| 4+ (Evergreen) | 75 | ~Day 110 |

You can define your own intervals as a comma-separated list in Settings, e.g. `1, 3, 7, 14, 30, 60`.

## Installation

### From Obsidian Community Plugins (recommended)
1. Open **Settings → Community Plugins → Browse**
2. Search for **"Review Reminder"**
3. Click **Install**, then **Enable**

### Manual Installation
1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/imadjalloul/obsidian-review-reminder/releases/latest)
2. Create a folder: `.obsidian/plugins/review-reminder/`
3. Place the files inside
4. Restart Obsidian → enable the plugin in Settings

## Usage

1. **Open the Review Queue** — Click the 📅 calendar-clock icon in the left ribbon, or use `Ctrl/Cmd+P` → "Open Review Queue"
2. **Browse your notes** — Notes are grouped by urgency with color-coded headers
3. **Mark as reviewed** — Click the ✅ button on any note card to advance it to the next level
4. **Choose an interval** — Use the spaced repetition suggestion or pick a custom interval

## Settings

| Setting | Default | Description |
|---|---|---|
| Date property | `review_next` | Frontmatter property for the review date |
| Frequency property | `review_freq` | Frontmatter property for the review level |
| Intervals | `1, 6, 9, 19, 75` | Comma-separated days between review levels |
| Upcoming threshold | `7` days | How many days ahead counts as "upcoming" |
| Startup notification | `On` | Show a notice on startup if notes are overdue |

## Support

If you find this plugin useful, consider supporting development:

☕ [Buy Me a Coffee](https://ko-fi.com/imadjalloul)

## License

[MIT](./LICENSE)
