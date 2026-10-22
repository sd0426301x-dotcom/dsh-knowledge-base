# Changelog

## 1.0.1

- Renamed the package to `dsh-workspace-kb` to avoid the unrelated npm package `dsh-knowledge-base`.
- Installer and bundle patch now use the unique package name.

## 1.0.0

- Sidebar entry under the Plugins row, with a bookmark fallback when the sidebar is collapsed.
- Search, category filtering, detail view, file previews, and a large modal panel.
- Create/edit/delete knowledge entries and notes, persisted to `<workspace>/.knowledge-base/entries.json`.
- Automatic classification by workspace folder, keywords, and short titles.
- Custom categories: create, rename, delete empty ones.
- Automatic plugin cards for `<workspace>/插件/*` and `<workspace>/plugins/*`.
- Local-only; no network calls or telemetry.
