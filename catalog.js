/**
 * Curated catalog for the workspace knowledge base.
 *
 * The public build ships an empty `CURATED` list: every project, document, and
 * plugin is discovered from the workspace itself, so the plugin contains no
 * personal project names or paths. Add entries here only if you want a
 * hand-written title/summary for a specific project in your own copy.
 *
 * Paths are workspace-relative and use forward slashes.
 *
 * @typedef {'video'|'creative'|'music'|'dev'|'docs'|'misc'} CategoryId
 */

export const CATEGORIES = [
  { id: 'video', tone: 'brand', label: '视频与动画' },
  { id: 'creative', tone: 'warn', label: '提示词与模板' },
  { id: 'music', tone: 'success', label: '音乐与练习' },
  { id: 'dev', tone: 'idle', label: '插件与开发' },
  { id: 'docs', tone: 'muted', label: '文档与笔记' },
  { id: 'misc', tone: 'idle', label: '临时与归档' },
];

/**
 * @type {Array<{
 *   id: string, category: CategoryId, title: string, kicker?: string,
 *   description: string, type: 'video'|'music'|'plugin'|'doc'|'code'|'folder'|'image'|'book',
 *   tags: string[], order: number, paths: string[],
 *   files: Array<{ path: string, label?: string, kind?: string }>
 * }>}
 */
export const CURATED = [];
