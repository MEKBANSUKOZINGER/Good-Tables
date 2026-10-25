# Development

Good Tables extends Obsidian's native Markdown tables. Keep its original table editing, selection, menus, and history intact.

## Build

Use Node.js 24 to match the release workflow. Obsidian supplies the runtime APIs; project dependencies are for development and testing.

```sh
npm ci
npm run lint
npm run format:check
npm run build
npm test
npm run package
```

- `npm run dev` watches the source.
- `npm run package` creates `release/good-tables/` with `main.js`, `manifest.json`, and `styles.css`.
- Build GitHub's automatic source archives before installing them.

## Install a local build

Run from the repository root:

```sh
node scripts/install-local.mjs "<vault-path>" --enable
```

This copies the three files into `<vault>/.obsidian/plugins/good-tables/`. Only `--enable` appends the ID to the enabled-plugin list; the script does not change restricted mode. Reload the plugin or Obsidian afterward.

## Automated and live checks

`npm test` exercises parsing, metadata, calculations, formatting, rendering, cleanup, and interaction behavior. `npm run lint` uses the official Obsidian ESLint rules.

The live scripts intentionally reset and edit only the generated `qa-vault/Good Tables QA.md` note. Generate it in a development vault, open it in Obsidian, and install the current build first:

```sh
node scripts/prepare-qa.mjs "<vault-path>"
node scripts/obsidian-cli.mjs "<vault-name>" eval tests/live-qa.js
```

The CLI wrapper targets Windows installations and requires Obsidian's enabled official CLI. Set `OBSIDIAN_CLI` for a nonstandard installation. Keep Obsidian in the foreground to avoid background timer throttling; `globalThis.goodTablesQADelay` adjusts waits in scripts that support it.

Run the following scripts separately against that generated note:

| Script                        | Coverage                                                                                         |
| ----------------------------- | ------------------------------------------------------------------------------------------------ |
| `tests/live-qa.js`            | Core creation, display, colors, merges, clipboard, settings, and history.                        |
| `tests/native-qa.js`          | Native selection/menu compatibility and scoped Fileclass filtering.                              |
| `tests/focus-qa.js`           | Selection boundaries and submenu hover behavior.                                                 |
| `tests/movement-qa.js`        | Row/column moves, duplicate values, and style identity.                                          |
| `tests/stability-qa.js`       | Layout frames, inline diagonal continuity, and saved-format order.                               |
| `tests/menu-color-qa.js`      | Applicable menu actions and color previews.                                                      |
| `tests/settings-qa.js`        | Real settings UI, validation, saved formats, and favorites.                                      |
| `tests/integration-qa.js`     | Native emphasis, exclusive styles, value formats, colors, and rating width.                      |
| `tests/theme-menu-qa.js`      | Theme foreground priority and conditional original-value actions.                                |
| `tests/title-structure-qa.js` | Blank-table row/column insertion, title identity, Tab growth, header weight, and native history. |
| `tests/clear-format-qa.js`    | Native Clear formatting, value/color cleanup, scoped selection, structure, and undo/redo.        |
| `tests/merge-fit-qa.js`       | Automatic merged-cell height, wrapping, async content, and undo/redo.                            |
| `tests/lifecycle-qa.js`       | Disable/enable cleanup, source preservation, and settings restoration.                           |

Settings checks restore their original values. Lifecycle QA temporarily disables and re-enables the plugin. Use a development vault and the generated note for these checks.

## Release files

1. Match `manifest.json`, `package.json`, the root and package entries in `package-lock.json`, and `versions.json`.
2. Run the build and checks above.
3. Publish a new GitHub Release with a tag **exactly matching the manifest version**, such as `1.0.1`.
4. Attach **main.js**, **manifest.json**, and **styles.css individually as Release Assets**. A ZIP or links in the body do not replace them.

For build provenance, run **Build and attest release assets** in GitHub Actions after uploading the source. It builds, checks, attests, and uploads the three files as an artifact. Extract that artifact and attach those exact files to the Release; editing them changes their hashes. The workflow does not publish a Release.

Keep user notes, plugin settings, dependency directories, QA output, development profiles, and local work documents out of Git and Release Assets.

## Documentation media

The English and Korean READMEs share the logo and six media files under `assets/readme/`. Keep the relative image paths in sync when renaming files, and commit that directory with both READMEs. GIFs are stored as their original animated files. These documentation assets are separate from the three plugin installation files. Existing relative links in this document are interpreted from the repository root when they are commands or filesystem paths.
