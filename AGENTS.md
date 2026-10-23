# Good Tables development

- Keep this repository root as the authoritative source project. Preserve Obsidian's native Markdown table editing, selection, context menus, and history.
- Communicate with the user in Korean. Public README and release notes may use English.
- If present, read `local-docs/작업 가이드.md` and record meaningful development changes in `local-docs/개발 진행사항.md`. Keep `local-docs/`, user notes, plugin settings, dependencies, and temporary QA output out of Git.
- Run the appropriate checks before finishing: `npm run lint`, `npm run build`, `npm test`, and `npm run format:check`. Do not claim that a remote review or GitHub Actions job passed unless it actually ran successfully.
- When changing the plugin version, update manifest.json, package.json, package-lock.json, and versions.json consistently and prepare fresh installation files and English release notes.
- At the end of every version change, remind the user to publish a **new GitHub Release** with a tag exactly matching manifest.json, and to attach **main.js, manifest.json, and styles.css individually as Release Assets**. Provide their paths. Body attachment links and a ZIP alone do not replace these assets.
- The user publishes to GitHub. Do not push, publish a release, or run a remote workflow without their authorization.
