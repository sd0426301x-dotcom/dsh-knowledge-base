/**
 * Host half of the workspace knowledge base.
 *
 * It performs one bounded scan of the top level of the workspace, enriches the
 * curated entries from catalog.js with real counts/sizes/timestamps, and serves
 * the result to the Client panel. It also serves a small, root-confined text
 * preview endpoint and a raster-image endpoint so the panel can show documents
 * and stills without exposing arbitrary filesystem paths to the browser.
 *
 * The scan intentionally skips build output, dependency caches, and frame
 * dumps: those are the bulk of the gigabytes in this workspace but not the
 * knowledge a reader wants to browse. Key output files are still surfaced
 * explicitly from the curated catalog.
 */
import { randomUUID } from 'node:crypto';
import { createReadStream, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { mkdir, open, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATEGORIES, CURATED } from './catalog.js';

const DEFAULT_ROOT = '';
const CACHE_MS = 60_000;
const GLOBAL_SCAN_MS = 20_000;
const ITEM_SCAN_MS = 5_000;
const MAX_FILES = 6_000;
const MAX_PREVIEW_BYTES = 512 * 1024;
const MAX_PREVIEW_LINES = 260;
const STORE_DIR = '.knowledge-base';
const STORE_NAME = 'entries.json';
const MAX_BODY_BYTES = 1_000_000;

const SKIP_NAMES = new Set([
  'node_modules',
  '.git',
  '.npm-cache',
  '.tmp',
  '.cache',
  '.next',
  'out',
  'dist',
  '__pycache__',
  'qa-frames',
  'verify-frames',
  '.chrome-qa',
  '_internal',
  STORE_DIR,
]);

const TEXT_EXT = new Set([
  '.md', '.txt', '.json', '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
  '.py', '.css', '.html', '.yml', '.yaml', '.toml', '.bat', '.cmd', '.log', '.csv',
]);

const IMAGE_MIME = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif'],
]);

const AUTO_RULES = [
  ['creative', ['提示词', 'prompt', '模板', '色彩', '运镜', '创作', '文案', '剧本']],
  ['video', ['视频', 'mv', '短片', '动画', '电影', '剪辑', '渲染', 'remotion', '成片', '镜头']],
  ['music', ['音乐', '口琴', '歌曲', '音频', '乐谱', '练习', 'bpm', '伴奏', '旋律']],
  ['dev', ['插件', '代码', '脚本', '工具', 'sdk', 'api', '开发', '程序', '配置', 'dsh', '部署']],
  ['docs', ['文档', '笔记', '说明', '教程', '指南', 'readme', '资料', '手册', '学习']],
  ['misc', ['临时', '归档', '测试', 'temp', '草稿']],
];

const CURATED_BY_TOP = new Map();
for (const entry of CURATED) {
  for (const rel of entry.paths) {
    const top = rel.split('/')[0];
    if (!CURATED_BY_TOP.has(top)) CURATED_BY_TOP.set(top, entry.category);
  }
}

/** The HTTP carrier is acquired lazily; the plugin can activate before it. */
export const inject = [];

/** Cordis plugin name. */
export const name = 'knowledge-base';

/**
 * Harness home for the activation beacon, matching the other local plugins.
 * @returns {string}
 */
function dshHome() {
  const configured = process.env.DSH_HOME;
  if (typeof configured === 'string' && configured.trim()) return resolve(configured.trim());
  return join(homedir(), '.dsh');
}

/**
 * Best-effort proof that the Host half activated plus the client graph rows it
 * sees. Diagnostics must never stop the panel from working.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {string} root
 */
function writeBeacon(ctx, root) {
  try {
    const graph = ctx.get('clientModules')?.graph?.();
    const payload = {
      version: 1,
      activatedAt: new Date().toISOString(),
      root,
      routes: [
        '/dsh-knowledge-base/index',
        '/dsh-knowledge-base/file',
        '/dsh-knowledge-base/raw',
        '/dsh-knowledge-base/entry',
        '/dsh-knowledge-base/ui.js',
      ],
      clientGraphRev: graph?.rev ?? null,
      clientGraphEntries: Array.isArray(graph?.entries) ? graph.entries.map((entry) => entry.id) : null,
    };
    mkdirSync(dshHome(), { recursive: true });
    writeFileSync(join(dshHome(), 'knowledge-base-status.json'), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  } catch {
    /* best effort */
  }
}

/**
 * Resolve the configured workspace root.
 * @param {unknown} config
 * @param {import('@deepseek-ai/cordis').Context|undefined} ctx
 * @returns {string}
 */
function resolveRoot(config, ctx) {
  if (config && typeof config === 'object' && typeof config.root === 'string' && config.root.trim()) {
    return resolve(config.root.trim());
  }
  const fromEnv = process.env.DSH_KB_ROOT;
  if (typeof fromEnv === 'string' && fromEnv.trim()) return resolve(fromEnv.trim());
  const defaultDirectory = ctx?.get?.('workingDirectory')?.defaultDirectory;
  if (typeof defaultDirectory === 'string' && defaultDirectory.trim()) return resolve(defaultDirectory.trim());
  if (DEFAULT_ROOT) return resolve(DEFAULT_ROOT);
  throw new Error('找不到工作区。请设置 DSH_KB_ROOT，或在插件行配置 root。');
}

/**
 * Resolve a workspace-relative path and refuse anything outside the root.
 * @param {string} root
 * @param {string} candidate
 * @returns {string|null}
 */
function resolveInside(root, candidate) {
  if (typeof candidate !== 'string' || candidate.trim() === '') return null;
  const absolute = resolve(root, candidate);
  const rel = relative(root, absolute);
  if (rel === '') return absolute;
  if (rel.startsWith('..') || isAbsolute(rel)) return null;
  return absolute;
}

/** @param {string} root */
function storeFile(root) {
  return join(root, STORE_DIR, STORE_NAME);
}

/** @returns {{version:number, overrides:Record<string,object>, custom:object[], categories:object[], categoryLabels:Record<string,string>}} */
function emptyStore() {
  return { version: 1, overrides: {}, custom: [], categories: [], categoryLabels: {} };
}

/** @param {unknown} value @param {number} max */
function cleanText(value, max) {
  if (typeof value !== 'string') return '';
  return value.replace(/\r\n/g, '\n').trim().slice(0, max);
}

/** @param {unknown} value */
function cleanTags(value) {
  const source = Array.isArray(value) ? value : String(value ?? '').split(/[,，]/);
  const seen = new Set();
  const tags = [];
  for (const item of source) {
    const tag = cleanText(item, 40).replace(/\s+/g, ' ');
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
    if (tags.length >= 12) break;
  }
  return tags;
}

/** @param {unknown} value */
function cleanCategory(value) {
  if (CATEGORIES.some((category) => category.id === value)) return value;
  if (typeof value === 'string' && value.startsWith('cat:')) return value;
  return 'misc';
}

/**
 * Validate a user-supplied workspace path; returns '' for an empty field.
 * @param {string} root
 * @param {unknown} value
 */
function cleanWorkspacePath(root, value) {
  const text = cleanText(value, 300).replace(/\\/g, '/').replace(/^\/+/, '');
  if (!text) return '';
  const absolute = resolveInside(root, text);
  if (!absolute) throw new Error('路径必须位于当前工作区内');
  const rel = relative(root, absolute).replace(/\\/g, '/');
  return rel === '.' ? '' : rel;
}

/**
 * Read and normalize the on-disk store. Malformed data falls back to an empty
 * store instead of breaking the whole panel.
 * @param {unknown} data
 * @param {string} root
 */
function normalizeStore(data, root) {
  const out = emptyStore();
  if (!data || typeof data !== 'object') return out;

  if (Array.isArray(data.categories)) {
    for (const raw of data.categories) {
      if (!raw || typeof raw !== 'object') continue;
      const label = cleanText(raw.label, 40);
      if (!label) continue;
      const id = typeof raw.id === 'string' && raw.id.startsWith('cat:') ? raw.id : `cat:${randomUUID()}`;
      if (out.categories.some((category) => category.id === id || category.label === label)) continue;
      out.categories.push({ id, label });
      if (out.categories.length >= 50) break;
    }
  }

  if (data.categoryLabels && typeof data.categoryLabels === 'object' && !Array.isArray(data.categoryLabels)) {
    for (const [id, rawLabel] of Object.entries(data.categoryLabels)) {
      const label = cleanText(rawLabel, 40);
      if (!label) continue;
      if (!CATEGORIES.some((category) => category.id === id) && !out.categories.some((category) => category.id === id)) continue;
      out.categoryLabels[id] = label;
    }
  }

  if (data.overrides && typeof data.overrides === 'object' && !Array.isArray(data.overrides)) {
    for (const [id, raw] of Object.entries(data.overrides)) {
      if (typeof id !== 'string' || !id || !raw || typeof raw !== 'object') continue;
      const override = {};
      if (typeof raw.title === 'string') override.title = cleanText(raw.title, 120);
      if (typeof raw.category === 'string') override.category = cleanCategory(raw.category);
      if (typeof raw.description === 'string') override.description = cleanText(raw.description, 2000);
      if (raw.tags !== undefined) override.tags = cleanTags(raw.tags);
      if (typeof raw.note === 'string') override.note = cleanText(raw.note, 20000);
      if (Object.keys(override).length > 0) out.overrides[id] = override;
    }
  }

  if (Array.isArray(data.custom)) {
    for (const raw of data.custom) {
      if (!raw || typeof raw !== 'object') continue;
      const title = cleanText(raw.title, 120);
      if (!title) continue;
      let path = '';
      try {
        path = cleanWorkspacePath(root, raw.path);
      } catch {
        path = '';
      }
      out.custom.push({
        id: typeof raw.id === 'string' && raw.id.startsWith('custom:') ? raw.id : `custom:${randomUUID()}`,
        title,
        category: cleanCategory(raw.category),
        description: cleanText(raw.description, 2000),
        tags: cleanTags(raw.tags),
        path,
        note: cleanText(raw.note, 20000),
        createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString(),
        updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
      });
    }
  }

  return out;
}

/**
 * Effective categories: built-ins with optional label overrides, then custom
 * categories. `custom` tells the UI whether a category can be deleted.
 * @param {ReturnType<typeof emptyStore>} store
 */
function effectiveCategories(store) {
  return [
    ...CATEGORIES.map((category) => ({
      ...category,
      label: store.categoryLabels[category.id] || category.label,
      custom: false,
    })),
    ...store.categories.map((category) => ({
      id: category.id,
      label: category.label,
      tone: 'idle',
      custom: true,
    })),
  ];
}

/**
 * Find a category by label, or create one from the label. Used by automatic
 * classification when a new project folder has no matching category.
 * @param {ReturnType<typeof emptyStore>} store
 * @param {string} label
 */
function ensureCategoryLabel(store, label) {
  const wanted = label.toLowerCase();
  const existing = effectiveCategories(store).find((category) => category.label.toLowerCase() === wanted);
  if (existing) return { id: existing.id, label: existing.label, created: false };
  if (store.categories.length >= 50) return { id: 'misc', label: '临时与归档', created: false };
  const id = `cat:${randomUUID()}`;
  store.categories.push({ id, label });
  return { id, label, created: true };
}

/**
 * Resolve an entry's category automatically. A new top-level project folder
 * gets a category named after that folder; known projects map to their curated
 * category; otherwise title/description/tags/path keywords choose a built-in.
 * @param {string} root
 * @param {ReturnType<typeof emptyStore>} store
 * @param {object} data
 */
async function autoCategory(root, store, data) {
  let path = '';
  try {
    path = cleanWorkspacePath(root, data.path);
  } catch {
    path = '';
  }
  const top = path.split('/')[0];
  if (top) {
    const known = CURATED_BY_TOP.get(top);
    if (known) return { id: known, created: false };
    if (top === '插件' || top === 'plugins') return { id: 'dev', created: false };
    try {
      const info = await stat(join(root, top));
      if (info.isDirectory()) {
        if (await isPluginDirectory(join(root, top))) return { id: 'dev', created: false };
        return ensureCategoryLabel(store, top);
      }
    } catch {
      /* missing path falls through to keyword matching */
    }
  }
  const text = [
    data.title,
    data.description,
    Array.isArray(data.tags) ? data.tags.join(' ') : data.tags,
    data.note,
    path,
  ].join(' ').toLowerCase();
  for (const [category, words] of AUTO_RULES) {
    if (words.some((word) => text.includes(word))) return { id: category, created: false };
  }
  const titleLabel = String(data.title || '')
    .split(/[·•|｜/\\—–:：-]/)[0]
    .replace(/^(新建|关于|知识|我的)/, '')
    .trim();
  if (titleLabel.length >= 2 && titleLabel.length <= 16) {
    return ensureCategoryLabel(store, titleLabel);
  }
  return { id: 'misc', created: false };
}

/** Cache keyed by absolute store path, invalidated by mtime/size. */
const storeCache = new Map();

/** @param {string} root */
async function readStore(root) {
  const file = storeFile(root);
  let info;
  try {
    info = await stat(file);
  } catch {
    return emptyStore();
  }
  const cached = storeCache.get(file);
  if (cached && cached.mtimeMs === info.mtimeMs && cached.size === info.size) return cached.data;
  try {
    const text = await readFile(file, 'utf8');
    const data = normalizeStore(JSON.parse(text), root);
    storeCache.set(file, { mtimeMs: info.mtimeMs, size: info.size, data });
    return data;
  } catch {
    return emptyStore();
  }
}

/** @param {string} root @param {ReturnType<typeof emptyStore>} store */
async function writeStore(root, store) {
  const file = storeFile(root);
  await mkdir(join(root, STORE_DIR), { recursive: true });
  const body = `${JSON.stringify(store, null, 2)}\n`;
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, body, 'utf8');
  try {
    await rename(temp, file);
  } catch {
    try {
      await unlink(file);
    } catch {
      /* the target may not exist yet */
    }
    await rename(temp, file);
  }
  storeCache.delete(file);
}

/**
 * Apply a saved override to one discovered item. The original catalog stays
 * untouched, so a later release can still change the defaults.
 * @param {object} item
 * @param {object|undefined} override
 */
function applyOverride(item, override) {
  if (!override) return item;
  if (typeof override.title === 'string' && override.title) item.title = override.title;
  if (typeof override.category === 'string') item.category = override.category;
  if (typeof override.description === 'string') item.description = override.description;
  if (Array.isArray(override.tags)) item.tags = override.tags;
  if (typeof override.note === 'string') item.note = override.note;
  item.edited = true;
  return item;
}

/**
 * Shape one user-created entry into the same item model as the discovered ones.
 * @param {string} root
 * @param {object} custom
 */
async function buildCustomItem(root, custom) {
  let stats = { files: 0, bytes: 0, updated: custom.updatedAt, partial: false };
  let files = [];
  let paths = [];
  let type = 'doc';
  if (custom.path) {
    const abs = resolveInside(root, custom.path);
    if (abs) {
      const piece = await scanPath(abs, Date.now() + ITEM_SCAN_MS);
      if (piece) {
        stats = piece;
        paths = [custom.path];
        let info;
        try {
          info = await stat(abs);
        } catch {
          info = undefined;
        }
        if (info?.isFile()) {
          const file = await describeFile(root, { path: custom.path });
          if (file) files = [file];
          type = file?.image ? 'image' : file?.kind === 'output' ? 'video' : 'doc';
        } else {
          type = 'folder';
        }
      }
    }
  }
  return {
    id: custom.id,
    category: cleanCategory(custom.category),
    title: custom.title,
    kicker: '自定义条目',
    description: custom.description || '自己添加的知识条目，还没有写说明。',
    type,
    tags: Array.isArray(custom.tags) ? custom.tags : [],
    order: 0,
    paths,
    stats,
    files,
    note: custom.note || '',
    builtin: false,
    editable: true,
    createdAt: custom.createdAt,
    updatedAt: custom.updatedAt,
  };
}

/** @param {string} ext */
function kindOf(ext) {
  if (ext === '.md' || ext === '.txt' || ext === '.log') return 'doc';
  if (IMAGE_MIME.has(ext)) return 'image';
  if (ext === '.mp4' || ext === '.mov' || ext === '.webm' || ext === '.mkv') return 'output';
  if (ext === '.exe' || ext === '.msi') return 'exe';
  if (ext === '.json' || ext === '.yml' || ext === '.yaml' || ext === '.toml' || ext === '.bat' || ext === '.cmd') return 'config';
  if (TEXT_EXT.has(ext)) return 'source';
  return 'other';
}

/**
 * Recursively measure one path without descending into build output.
 * @param {string} abs
 * @param {number} deadline
 * @returns {Promise<{files:number,bytes:number,updated:string,partial:boolean}|null>}
 */
async function scanPath(abs, deadline) {
  let info;
  try {
    info = await stat(abs);
  } catch {
    return null;
  }
  if (info.isFile()) {
    return {
      files: 1,
      bytes: info.size,
      updated: info.mtime.toISOString(),
      partial: false,
    };
  }
  if (!info.isDirectory()) return null;

  let files = 0;
  let bytes = 0;
  let updated = info.mtimeMs;
  let partial = false;
  const stack = [abs];

  while (stack.length > 0) {
    if (files >= MAX_FILES || Date.now() > deadline) {
      partial = true;
      break;
    }
    const dir = stack.pop();
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (SKIP_NAMES.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      let fileInfo;
      try {
        fileInfo = await stat(full);
      } catch {
        continue;
      }
      files += 1;
      bytes += fileInfo.size;
      if (fileInfo.mtimeMs > updated) updated = fileInfo.mtimeMs;
      if (files >= MAX_FILES) {
        partial = true;
        break;
      }
    }
  }

  return { files, bytes, updated: new Date(updated).toISOString(), partial };
}

/**
 * Combine stats for every existing path of one curated entry.
 * @param {string} root
 * @param {string[]} paths
 * @param {number} deadline
 */
async function aggregate(root, paths, deadline) {
  let files = 0;
  let bytes = 0;
  let updated = 0;
  let partial = false;
  let found = 0;
  for (const rel of paths) {
    const abs = resolveInside(root, rel);
    if (!abs) continue;
    const piece = await scanPath(abs, deadline);
    if (!piece) continue;
    found += 1;
    files += piece.files;
    bytes += piece.bytes;
    partial = partial || piece.partial;
    const time = Date.parse(piece.updated);
    if (Number.isFinite(time) && time > updated) updated = time;
  }
  if (found === 0) return null;
  return {
    files,
    bytes,
    updated: new Date(updated || Date.now()).toISOString(),
    partial,
  };
}

/**
 * Describe one curated key file, if it still exists.
 * @param {string} root
 * @param {{path:string,label?:string,kind?:string}} spec
 */
async function describeFile(root, spec) {
  const abs = resolveInside(root, spec.path);
  if (!abs) return null;
  let info;
  try {
    info = await stat(abs);
  } catch {
    return null;
  }
  if (!info.isFile()) return null;
  const ext = extname(abs).toLowerCase();
  return {
    name: spec.label || basename(abs),
    path: spec.path,
    kind: spec.kind || kindOf(ext),
    bytes: info.size,
    updated: info.mtime.toISOString(),
    previewable: TEXT_EXT.has(ext),
    image: IMAGE_MIME.has(ext),
  };
}

/** Strip the lightest Markdown decorations for a one-line summary. @param {string} value */
function plain(value) {
  return value
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[`*_~>#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract a title and first real paragraph from a Markdown document.
 * @param {string} text
 */
function summarizeMarkdown(text) {
  const lines = text.replace(/\r/g, '').split('\n');
  let title = '';
  let summary = '';
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('```') || line.startsWith('|') || line.startsWith('---')) continue;
    if (!title && /^#\s+/.test(line)) {
      title = plain(line.replace(/^#\s+/, ''));
      continue;
    }
    if (!summary && !/^#{1,6}\s/.test(line) && !/^([-*+]|\d+\.)\s/.test(line) && !line.startsWith('>')) {
      summary = plain(line);
      break;
    }
  }
  return { title, summary: summary.slice(0, 140) };
}

/**
 * Read at most the first MAX_PREVIEW_BYTES of a UTF-8 text file.
 * @param {string} abs
 */
async function readPreview(abs) {
  const info = await stat(abs);
  if (!info.isFile()) throw new Error('不是一个文件');
  const length = Math.min(info.size, MAX_PREVIEW_BYTES);
  const buffer = Buffer.alloc(length);
  const handle = await open(abs, 'r');
  try {
    await handle.read(buffer, 0, length, 0);
  } finally {
    await handle.close();
  }
  let text = buffer.toString('utf8');
  if (buffer.length < info.size) text = text.replace(/\uFFFD+$/u, '');
  if (text.includes('\u0000')) throw new Error('不是文本文件');
  const lines = text.split(/\r?\n/);
  const visible = lines.slice(0, MAX_PREVIEW_LINES);
  return {
    text: visible.join('\n'),
    shownLines: visible.length,
    truncated: info.size > MAX_PREVIEW_BYTES || lines.length > MAX_PREVIEW_LINES,
    bytes: info.size,
  };
}

/**
 * Whether a directory is a Harness/Cordis plugin package.
 * @param {string} abs
 */
async function isPluginDirectory(abs) {
  try {
    const text = await readFile(join(abs, 'package.json'), 'utf8');
    const pkg = JSON.parse(text);
    if (pkg && pkg.dsh && (pkg.dsh.bundle || pkg.dsh.client)) return true;
    if (pkg && pkg.cordis) return true;
  } catch {
    /* not a package */
  }
  try {
    const info = await stat(join(abs, 'cordis.patch.yml'));
    return info.isFile();
  } catch {
    return false;
  }
}

/**
 * Build one card for a plugin folder, using package.json and its README.
 * @param {string} root
 * @param {string} rel
 * @param {number} deadline
 */
async function buildPluginItem(root, rel, deadline) {
  const abs = resolveInside(root, rel);
  if (!abs) return null;
  const stats = await scanPath(abs, deadline);
  if (!stats) return null;
  let pkg = {};
  try {
    pkg = JSON.parse(await readFile(join(abs, 'package.json'), 'utf8'));
  } catch {
    pkg = {};
  }
  const files = [];
  let title = cleanText(pkg.displayName || pkg.name || basename(abs), 120) || basename(abs);
  let description = cleanText(pkg.description, 500);
  let children = [];
  try {
    children = await readdir(abs, { withFileTypes: true });
  } catch {
    children = [];
  }
  const readme = children.find((child) => child.isFile() && /^(readme|说明)/i.test(child.name) && /\.(md|txt)$/i.test(child.name));
  if (readme) {
    const readmeRel = `${rel}/${readme.name}`;
    const file = await describeFile(root, { path: readmeRel, kind: 'doc' });
    if (file) files.push(file);
    try {
      const preview = await readPreview(join(abs, readme.name));
      const summary = summarizeMarkdown(preview.text);
      if (summary.title) title = summary.title;
      if (!description && summary.summary) description = summary.summary;
    } catch {
      /* keep package metadata */
    }
  }
  for (const name of ['package.json', 'cordis.patch.yml', 'index.js', 'lib/index.js']) {
    const file = await describeFile(root, { path: `${rel}/${name}`, kind: name.endsWith('.json') ? 'config' : 'source' });
    if (file && !files.some((entry) => entry.path === file.path)) files.push(file);
  }
  return {
    id: `plugin:${rel}`,
    category: 'dev',
    title,
    kicker: pkg.version ? `插件 · v${pkg.version}` : '本地插件',
    description: description || '本地 DSH 插件，点开可以查看它的说明和核心文件。',
    type: 'plugin',
    tags: ['插件', pkg.name].filter(Boolean),
    order: 20,
    paths: [rel],
    stats,
    files,
    builtin: true,
    editable: true,
    note: '',
  };
}

/**
 * Build the complete index.
 * @param {string} root
 */
async function buildIndex(root) {
  const store = await readStore(root);
  const top = await readdir(root, { withFileTypes: true });
  const topNames = new Set(top.map((entry) => entry.name));
  const claimed = new Set();
  const deadline = Date.now() + GLOBAL_SCAN_MS;
  const items = [];

  for (const entry of CURATED) {
    const existingPaths = entry.paths.filter((rel) => topNames.has(rel.split('/')[0]));
    if (existingPaths.length === 0) continue;
    for (const rel of existingPaths) claimed.add(rel.split('/')[0]);
    const perItemDeadline = Math.min(deadline, Date.now() + ITEM_SCAN_MS);
    const stats = await aggregate(root, existingPaths, perItemDeadline);
    if (!stats) continue;

    const files = [];
    for (const spec of entry.files || []) {
      const file = await describeFile(root, spec);
      if (file) files.push(file);
    }
    const newest = Math.max(Date.parse(stats.updated), ...files.map((file) => Date.parse(file.updated)));
    items.push({
      id: entry.id,
      category: entry.category,
      title: entry.title,
      kicker: entry.kicker || '',
      description: entry.description,
      type: entry.type,
      tags: entry.tags || [],
      order: entry.order,
      paths: existingPaths,
      stats: {
        files: stats.files,
        bytes: stats.bytes,
        updated: new Date(Number.isFinite(newest) ? newest : Date.now()).toISOString(),
        partial: stats.partial,
      },
      files,
    });
  }

  // Anything new at the top level still shows up, so the panel never silently
  // loses a project the user adds after this catalog was written.
  for (const entry of top) {
    if (claimed.has(entry.name) || entry.name === STORE_DIR) continue;
    const rel = entry.name;
    const abs = resolveInside(root, rel);
    if (!abs) continue;
    const perItemDeadline = Math.min(deadline, Date.now() + ITEM_SCAN_MS);
    const stats = await scanPath(abs, perItemDeadline);
    if (!stats) continue;

    const ext = extname(rel).toLowerCase();
    const isDirectory = entry.isDirectory();
    let title = isDirectory ? rel : basename(rel, ext) || rel;
    let description = isDirectory
      ? '工作区里还没有写说明的目录，点开可以查看里面的核心文件。'
      : '工作区里还没有写说明的文件。';
    const files = [];

    if (!isDirectory) {
      const file = await describeFile(root, { path: rel, kind: kindOf(ext) });
      if (file) files.push(file);
      if (TEXT_EXT.has(ext)) {
        try {
          const preview = await readPreview(abs);
          const summary = summarizeMarkdown(preview.text);
          if (summary.title) title = summary.title;
          if (summary.summary) description = summary.summary;
        } catch {
          /* leave the generic description */
        }
      }
    } else {
      let children = [];
      try {
        children = await readdir(abs, { withFileTypes: true });
      } catch {
        children = [];
      }
      const readme = children.find((child) => child.isFile() && /^(readme|说明)/i.test(child.name) && /\.(md|txt)$/i.test(child.name));
      if (readme) {
        const readmeRel = `${rel}/${readme.name}`;
        const file = await describeFile(root, { path: readmeRel, kind: 'doc' });
        if (file) files.push(file);
        try {
          const preview = await readPreview(join(abs, readme.name));
          const summary = summarizeMarkdown(preview.text);
          if (summary.title) title = summary.title;
          if (summary.summary) description = summary.summary;
        } catch {
          /* leave the generic description */
        }
      }
    }

    let category = isDirectory ? 'misc' : (TEXT_EXT.has(ext) ? 'docs' : 'misc');
    let type = isDirectory ? 'folder' : (IMAGE_MIME.has(ext) ? 'image' : (TEXT_EXT.has(ext) ? 'doc' : 'folder'));
    let tags = ['自动发现'];
    if (isDirectory && await isPluginDirectory(abs)) {
      category = 'dev';
      type = 'plugin';
      tags = ['自动发现', '插件'];
    }

    items.push({
      id: `auto:${rel}`,
      category,
      title,
      kicker: rel,
      description,
      type,
      tags,
      order: 99,
      paths: [rel],
      stats,
      files,
    });
  }

  // Every local plugin under 插件/ or plugins/ gets its own card, so a newly
  // created plugin shows up automatically in 插件与开发 after a refresh.
  for (const folder of ['插件', 'plugins']) {
    const pluginsRoot = join(root, folder);
    let pluginEntries = [];
    try {
      pluginEntries = await readdir(pluginsRoot, { withFileTypes: true });
    } catch {
      pluginEntries = [];
    }
    for (const entry of pluginEntries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const rel = `${folder}/${entry.name}`;
      if (items.some((item) => item.paths.includes(rel))) continue;
      const item = await buildPluginItem(root, rel, Math.min(deadline, Date.now() + ITEM_SCAN_MS));
      if (item) items.push(item);
    }
  }

  for (const item of items) {
    item.builtin = true;
    item.editable = true;
    if (typeof item.note !== 'string') item.note = '';
    applyOverride(item, store.overrides[item.id]);
  }
  for (const custom of store.custom) {
    items.push(await buildCustomItem(root, custom));
  }

  const categories = effectiveCategories(store);
  const categoryIds = new Set(categories.map((category) => category.id));
  for (const item of items) {
    if (!categoryIds.has(item.category)) item.category = 'misc';
  }

  const order = new Map(categories.map((category, index) => [category.id, index]));
  items.sort((a, b) => {
    const left = order.get(a.category) ?? 99;
    const right = order.get(b.category) ?? 99;
    if (left !== right) return left - right;
    if (a.order !== b.order) return a.order - b.order;
    return a.title.localeCompare(b.title, 'zh-Hans-CN');
  });

  return {
    root,
    scannedAt: new Date().toISOString(),
    storage: join(STORE_DIR, STORE_NAME),
    categoryEditing: true,
    categories,
    items,
  };
}

/** @param {import('node:http').ServerResponse} res @param {number} status @param {unknown} body */
function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

/** @param {unknown} error */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Read one JSON request body with a hard size bound.
 * @param {import('node:http').IncomingMessage} req
 */
async function readJsonBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) throw new Error('请求体过大');
    chunks.push(chunk);
  }
  if (total === 0) return {};
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('请求体必须是 JSON 对象');
  return value;
}

/**
 * Create, update, reset, or delete one knowledge entry.
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {string} root
 */
async function handleEntry(req, res, root) {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: '只接受 POST' });
    return;
  }
  const body = await readJsonBody(req);
  const action = body.action;
  const id = typeof body.id === 'string' ? body.id : '';
  const store = await readStore(root);

  if (action === 'save-category') {
    const label = cleanText(body.label, 40);
    if (!label) throw new Error('分类名称不能为空');
    const isBuiltin = CATEGORIES.some((category) => category.id === id);
    const categoryId = isBuiltin || id.startsWith('cat:') ? id : `cat:${randomUUID()}`;
    const duplicate = effectiveCategories(store).some(
      (category) => category.id !== categoryId && category.label === label,
    );
    if (duplicate) throw new Error('已经有同名分类了');
    if (isBuiltin) {
      store.categoryLabels[categoryId] = label;
    } else {
      const existing = store.categories.find((category) => category.id === categoryId);
      if (existing) existing.label = label;
      else store.categories.push({ id: categoryId, label });
    }
    await writeStore(root, store);
    sendJson(res, 200, { ok: true, id: categoryId, label });
    return;
  }

  if (action === 'delete-category') {
    if (!id.startsWith('cat:')) throw new Error('只能删除自定义分类');
    const used = store.custom.some((entry) => entry.category === id) ||
      Object.values(store.overrides).some((override) => override.category === id);
    if (used) throw new Error('这个分类下还有条目，先把条目移到别的分类');
    const before = store.categories.length;
    store.categories = store.categories.filter((category) => category.id !== id);
    if (store.categories.length === before) throw new Error('找不到这个分类');
    await writeStore(root, store);
    sendJson(res, 200, { ok: true, id });
    return;
  }

  if (action === 'delete' || action === 'reset') {
    if (!id) throw new Error('缺少条目 id');
    if (id.startsWith('custom:')) {
      const before = store.custom.length;
      store.custom = store.custom.filter((entry) => entry.id !== id);
      if (store.custom.length === before) throw new Error('找不到这个自定义条目');
    } else {
      delete store.overrides[id];
    }
    await writeStore(root, store);
    sendJson(res, 200, { ok: true, id });
    return;
  }

  if (action !== 'save') throw new Error('未知操作');
  const data = body.entry && typeof body.entry === 'object' && !Array.isArray(body.entry) ? body.entry : body;
  const title = cleanText(data.title, 120);
  if (!title) throw new Error('标题不能为空');
  let category = cleanCategory(data.category);
  let autoCategoryUsed = false;
  if (!data.category || data.category === 'auto') {
    const resolved = await autoCategory(root, store, data);
    category = resolved.id;
    autoCategoryUsed = true;
  }
  const categoryLabel = effectiveCategories(store).find((entry) => entry.id === category)?.label || category;
  const description = cleanText(data.description, 2000);
  const tags = cleanTags(data.tags);
  const note = cleanText(data.note, 20000);
  const now = new Date().toISOString();

  if (id.startsWith('custom:')) {
    const target = store.custom.find((entry) => entry.id === id);
    if (!target) throw new Error('找不到这个自定义条目');
    target.title = title;
    target.category = category;
    target.description = description;
    target.tags = tags;
    target.note = note;
    target.updatedAt = now;
    if (Object.prototype.hasOwnProperty.call(data, 'path')) {
      target.path = cleanWorkspacePath(root, data.path);
    }
    await writeStore(root, store);
    sendJson(res, 200, { ok: true, id, category, categoryLabel, autoCategory: autoCategoryUsed });
    return;
  }

  if (id) {
    store.overrides[id] = { title, category, description, tags, note };
    await writeStore(root, store);
    sendJson(res, 200, { ok: true, id, category, categoryLabel, autoCategory: autoCategoryUsed });
    return;
  }

  const newId = `custom:${randomUUID()}`;
  store.custom.push({
    id: newId,
    title,
    category,
    description,
    tags,
    path: cleanWorkspacePath(root, data.path),
    note,
    createdAt: now,
    updatedAt: now,
  });
  await writeStore(root, store);
  sendJson(res, 200, { ok: true, id: newId, category, categoryLabel, autoCategory: autoCategoryUsed });
}

/**
 * Inject the standalone page script at the end of the document. It runs after
 * the app shell, adds a sidebar button, and opens the panel as an overlay. This
 * deliberately bypasses the client module boot graph: on this desktop build a
 * late graph edge is visible in `__DSH_BOOT__` but is not part of the manifest
 * the loader already captured, so a client-module entry never activates.
 * @param {string} html
 * @param {string} uiPath
 */
function injectUiScript(html, uiPath) {
  if (html.includes('data-dsh-kb-ui')) return html;
  let rev = 'kb-1';
  try {
    const info = statSync(uiPath);
    rev = `kb-${info.mtimeMs}-${info.size}`;
  } catch {
    /* stable fallback */
  }
  const tag = `<script data-dsh-kb-ui="1" defer src="/dsh-knowledge-base/ui.js?rev=${encodeURIComponent(rev)}"></script>`;
  return html.includes('</body>') ? html.replace('</body>', `${tag}</body>`) : `${html}${tag}`;
}


/**
 * Install the Host half.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {{root?: string}|undefined} config
 */
export function apply(ctx, config) {
  const root = resolveRoot(config, ctx);
  const uiPath = fileURLToPath(new URL('./ui.js', import.meta.url));
  writeBeacon(ctx, root);
  const cache = { at: 0, data: null, inflight: null };

  /**
   * @param {boolean} force
   * @returns {Promise<unknown>}
   */
  const readIndex = (force) => {
    const fresh = cache.data && Date.now() - cache.at < CACHE_MS;
    if (!force && fresh) return Promise.resolve(cache.data);
    if (cache.inflight) return cache.inflight;
    cache.inflight = buildIndex(root)
      .then((data) => {
        cache.at = Date.now();
        cache.data = data;
        return data;
      })
      .finally(() => {
        cache.inflight = null;
      });
    return cache.inflight;
  };

  ctx.inject(['webServer'], (hostCtx) => {
    hostCtx.effect(() => {
      const offIndex = hostCtx.webServer.register({
      kind: 'exact',
      path: '/dsh-knowledge-base/index',
      handler: async (req, res) => {
        try {
          const url = new URL(req.url || '/', 'http://127.0.0.1');
          const force = url.searchParams.get('refresh') === '1';
          const data = await readIndex(force);
          sendJson(res, 200, data);
        } catch (error) {
          sendJson(res, 500, { error: messageOf(error) });
        }
      },
    });

    const offFile = hostCtx.webServer.register({
      kind: 'exact',
      path: '/dsh-knowledge-base/file',
      handler: async (req, res) => {
        try {
          const url = new URL(req.url || '/', 'http://127.0.0.1');
          const rel = url.searchParams.get('path');
          if (!rel) {
            sendJson(res, 400, { error: '缺少 path 参数' });
            return;
          }
          const abs = resolveInside(root, rel);
          if (!abs) {
            sendJson(res, 403, { error: '路径不在工作区内' });
            return;
          }
          const ext = extname(abs).toLowerCase();
          if (!TEXT_EXT.has(ext)) {
            sendJson(res, 415, { error: '这个文件不支持文本预览' });
            return;
          }
          const preview = await readPreview(abs);
          sendJson(res, 200, { path: rel, ...preview });
        } catch (error) {
          sendJson(res, 500, { error: messageOf(error) });
        }
      },
    });

    const offRaw = hostCtx.webServer.register({
      kind: 'exact',
      path: '/dsh-knowledge-base/raw',
      handler: async (req, res) => {
        try {
          const url = new URL(req.url || '/', 'http://127.0.0.1');
          const rel = url.searchParams.get('path');
          if (!rel) {
            sendJson(res, 400, { error: '缺少 path 参数' });
            return;
          }
          const abs = resolveInside(root, rel);
          if (!abs) {
            sendJson(res, 403, { error: '路径不在工作区内' });
            return;
          }
          const mime = IMAGE_MIME.get(extname(abs).toLowerCase());
          if (!mime) {
            sendJson(res, 415, { error: '只支持预览图片' });
            return;
          }
          const info = await stat(abs);
          if (!info.isFile()) {
            sendJson(res, 404, { error: '文件不存在' });
            return;
          }
          res.writeHead(200, {
            'content-type': mime,
            'content-length': info.size,
            'cache-control': 'private, max-age=60',
            'x-content-type-options': 'nosniff',
          });
          createReadStream(abs).on('error', () => res.destroy()).pipe(res);
        } catch (error) {
          sendJson(res, 500, { error: messageOf(error) });
        }
      },
    });

    const offEntry = hostCtx.webServer.register({
      kind: 'exact',
      path: '/dsh-knowledge-base/entry',
      handler: async (req, res) => {
        try {
          cache.at = 0;
          cache.data = null;
          await handleEntry(req, res, root);
        } catch (error) {
          sendJson(res, 500, { error: messageOf(error) });
        }
      },
    });

    const offUi = hostCtx.webServer.register({
      kind: 'exact',
      path: '/dsh-knowledge-base/ui.js',
      handler: (req, res) => {
        try {
          const info = statSync(uiPath);
          res.writeHead(200, {
            'content-type': 'text/javascript; charset=utf-8',
            'content-length': info.size,
            'cache-control': 'no-store',
            'x-content-type-options': 'nosniff',
          });
          createReadStream(uiPath).on('error', () => res.destroy()).pipe(res);
        } catch (error) {
          sendJson(res, 500, { error: messageOf(error) });
        }
      },
    });

    const offTap = hostCtx.webServer.tapIndex((html) => injectUiScript(html, uiPath));

      return () => {
        offIndex();
        offFile();
        offRaw();
        offEntry();
        offUi();
        offTap();
      };
    }, 'knowledge-base: workspace index routes');
  });
}
