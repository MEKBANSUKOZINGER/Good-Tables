# Good Tables

Good Tables adds presentation and editing tools to Obsidian's native Markdown tables. It supports existing tables without replacing the native table editor.

Desktop only. Version **0.2.0** requires Obsidian **1.14.4 or later**. [한국어 안내](README.ko.md) · [Changelog](CHANGELOG.md).

## Features

- Create a table at the cursor from a command, ribbon button, or user-assigned hotkey. Specify the total number of rows and columns.
- Select rectangular ranges by dragging, or use Obsidian's original row and column handles. Good Tables reads those native ranges and adds no numbered selectors.
- Set multiple title rows and columns, with configurable colors and reversible underlying styles.
- Apply percentage, calculated percentage, horizontal bar, date, date/time, time, rating, and prefix/suffix formats. Edit the original values with the native editor.
- Choose background and text colors from a visible saturation/brightness surface and hue strip, with synchronized HEX/RGB fields, document colors, and six shared favorite colors. Saved custom formats appear individually in the format menu and its order settings.
- Merge a rectangular range while retaining every original cell. Unmerge to restore hidden contents and styles. Double-click a merged cell to edit its anchor.
- Split the first cell diagonally and type directly into its lower-left and upper-right fields, including multiple lines. Turning the diagonal off concatenates the lower and upper values without a space.
- Add/delete rows and columns, resize them by dragging edges or entering sizes, and paste tab-separated cell ranges.
- Undo and redo document edits using Obsidian's history. Settings update existing tables immediately.
- Follow Obsidian's English/Korean language, or override it in settings. Other languages fall back to English.

Good Tables preserves the native menu for selected ranges, ordinary cells and focused cell editors, then appends its own entries after a separator. Native formatting, alignment, clipboard actions and other plugins' entries keep their order. Native table clipboard data is handled by Obsidian.

Version 0.1.3 synchronizes formatting metadata within native editing transactions. Consecutive row/column moves carry formats, colors, dimensions and title assignments, and native undo/redo restores them together. Observed native movement disambiguates identical rows and blank columns. A move that splits a merge unmerges only that region; moving the diagonal cell away from the first corner clears its first-cell-only diagonal display while preserving its raw text and styles.

Version 0.2.0 reuses table decoration across updates and applies changes before the next paint, avoiding temporary loss of dimensions and formatting. Focused-cell context menus wait for Obsidian's asynchronous native menu. **New table defaults** contains only rows, columns, and the diagonal switch; other table options are under **Table settings**, including editable title background/text HEX values.

## Install

Download `main.js`, `manifest.json`, and `styles.css` from a [GitHub release](https://github.com/MEKBANSUKOZINGER/Good-Tables/releases), or build them locally. Copy all three files into `<vault>/.obsidian/plugins/good-tables/`. Reload Obsidian and enable **Good Tables** in Community plugins. The optional `good-tables-0.2.0.zip` contains the same files inside a `good-tables/` folder; GitHub's automatic source archives require building first.

The creation command is **Good Tables: Create table**. Assign its hotkey in Obsidian's Hotkeys settings. No hotkey is assigned automatically.

## Storage and compatibility

Cell contents remain a normal Markdown table, including hidden originals underneath merges. Extended presentation is stored immediately after the table as a block of unused Markdown reference definitions, separated from the table by a blank line. Each definition starts with `[good-tables-` and has a `good-tables:` destination. These definitions are hidden in standard Markdown reading views; Good Tables also conceals its own metadata in Live Preview. Source mode exposes the complete source.

Keep the reference block with its table when copying or moving it. Disabling the plugin removes its presentation layers and leaves the ordinary table and its raw contents. A first-use dialog and an unload notice explain the display change.

Native table context-menu items remain available alongside Good Tables items. Native Tab navigation and ordinary editing remain in Obsidian's editor. Merged anchors use an additional editing dialog. Diagonal fields are edited in place, with IME composition, multiline input, and Obsidian undo/redo support.

Unambiguous external row/column edits carry styles with their original cells. If simultaneous structural changes cannot be mapped reliably, the plugin preserves the stored information, stops applying it, and offers an explicit reset command. Undo the structural edit or use **Reset Good Tables information for this table**; a reset is itself undoable. Corrupt or unsupported metadata is never silently overwritten.

## Calculation rules

- Numeric input accepts plain signed integers and decimals. Commas, units, percentages, exponent notation, and nonfinite numbers are rejected.
- Calculated percentages exclude titles, blank cells, invalid values, and covered cells of a merge. Percentage formats reject negative inputs. A later negative edit displays `(!NUM)` until corrected.
- Bars shift negative data by the minimum, then divide by the sum of the shifted values. A zero sum produces zero-length bars and 0%.
- Date/time accepts exactly 8/12/4 digits and substitutes the configured tokens without calendar validation.
- Ratings preserve exact halves, round other fractions to integers, and clamp to the configured maximum. Above 10, they use `★ X N` with an integer count.

## Development

```sh
npm ci
npm run lint
npm run build
npm test
npm run package
```

`npm run dev` watches the source. `npm run package` creates an installable `release/good-tables/` folder. Runtime dependencies are provided by Obsidian; only development dependencies are installed here.

To install a local build:

```sh
node scripts/install-local.mjs "<vault-path>" --enable
```

This copies the three plugin files and, only with `--enable`, appends the plugin ID to the existing enabled-plugin list. Reload the plugin/app afterward. It does not change restricted mode.

For optional live QA, generate the `qa-vault/Good Tables QA.md` note with `node scripts/prepare-qa.mjs`, open that generated note in Obsidian, install the current build, and run:

```sh
node scripts/obsidian-cli.mjs "<vault-name>" eval tests/live-qa.js
```

The live QA script intentionally resets and edits only that generated QA note. It requires Obsidian's enabled official CLI. On nonstandard installations, set `OBSIDIAN_CLI` to the CLI executable path. The additional `tests/focus-qa.js`, `tests/native-qa.js`, `tests/movement-qa.js`, `tests/settings-qa.js`, and `tests/stability-qa.js` scripts use the same generated QA note; open it before running each script. The CLI wrapper targets Windows installations.

No user notes, development profiles, dependency directories, or local plugin settings belong in a GitHub release.

## License

[MIT](LICENSE) · Copyright (c) 2026 MEKBANSUKOZINGER.

## Privacy and permissions

Good Tables runs locally and makes no network requests or telemetry uploads. It reads table contents and writes Markdown changes and presentation metadata through Obsidian's editor. Settings are stored through Obsidian's plugin data API.

**Clipboard access:** choosing **Copy original values** writes the selected cells' raw values as tab-separated text to the system clipboard. The paste dialog and the multi-cell paste handler distribute user-provided tab/newline-separated text into cells. The plugin does not read clipboard contents in the background. Obsidian's native table clipboard data remains handled by Obsidian.

## Release verification

Run `npm run lint` to check source against the official Obsidian ESLint rules. The development-only Moment override updates the official lint tool's transitive dependency; it is not bundled into the plugin.

The manually triggered **Build and attest release assets** workflow builds and tests the selected branch or tag, generates GitHub provenance attestations, and provides the three installation files as a workflow artifact. To keep the attestations valid, upload those exact extracted files as the release assets. The workflow does not create or publish a release.

For every version update, publish a new GitHub Release with a tag exactly matching `manifest.json` and attach **main.js**, **manifest.json**, and **styles.css** individually.

For a repository outside the vault, generate the QA note with `node scripts/prepare-qa.mjs "<vault-path>"`. Run live QA with Obsidian in the foreground; background timer throttling can delay the UI. The optional `globalThis.goodTablesQADelay` value adjusts waits in the table QA scripts. Use `tests/settings-qa.js` to check the actual settings window; it restores settings after the checks.
