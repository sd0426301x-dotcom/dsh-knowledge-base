(function () {
  'use strict';
  if (window.__DSH_KB_UI__) return;
  window.__DSH_KB_UI__ = true;

  var CAT_LABELS = {
    video: '视频与动画',
    creative: '提示词与模板',
    music: '音乐与练习',
    dev: '插件与开发',
    docs: '文档与笔记',
    misc: '临时与归档',
  };
  var EMOJI = {
    video: '🎬',
    music: '🎵',
    plugin: '🧩',
    doc: '📄',
    code: '⌘',
    folder: '📁',
    image: '🖼️',
    book: '📚',
  };
  var ICONS = {
    book: ['M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5z', 'M8 2v20', 'M11 7h5', 'M11 11h5'],
    plus: ['M12 5v14', 'M5 12h14'],
    search: ['M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z', 'M16.5 16.5 21 21'],
    refresh: ['M20 12a8 8 0 1 1-2.35-5.65', 'M20 4v4h-4'],
    close: ['M6 6l12 12', 'M18 6 6 18'],
    back: ['M19 12H5', 'M11 18l-6-6 6-6'],
    edit: ['M4 20h4L19 9l-4-4L4 16v4z', 'M13.5 6.5l4 4'],
    trash: ['M4 7h16', 'M9 7V4h6v3', 'M6 7l1 13h10l1-13', 'M10 11v6', 'M14 11v6'],
  };

  var state = {
    data: null,
    loading: false,
    error: null,
    cat: 'all',
    q: '',
    selected: null,
    draft: null,
    preview: null,
    saving: false,
    formError: '',
  };

  var overlay = null;
  var headerStats = null;
  var searchInput = null;
  var railEl = null;
  var mainEl = null;
  var launchButton = null;

  function e(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function button(cls, text, onClick) {
    var node = e('button', cls, text);
    node.type = 'button';
    if (onClick) node.addEventListener('click', onClick);
    return node;
  }

  function svgIcon(name, size) {
    var paths = ICONS[name] || ICONS.book;
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', String(size || 16));
    svg.setAttribute('height', String(size || 16));
    svg.setAttribute('aria-hidden', 'true');
    svg.style.display = 'block';
    svg.style.flex = '0 0 auto';
    paths.forEach(function (d) {
      var path = document.createElementNS(ns, 'path');
      path.setAttribute('d', d);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', 'currentColor');
      path.setAttribute('stroke-width', '1.7');
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('stroke-linejoin', 'round');
      svg.appendChild(path);
    });
    return svg;
  }

  function bytes(value) {
    var n = Number(value);
    if (!isFinite(n) || n <= 0) return '0 B';
    var units = ['B', 'KB', 'MB', 'GB', 'TB'];
    var i = 0;
    while (n >= 1024 && i < units.length - 1) {
      n /= 1024;
      i += 1;
    }
    return (n >= 100 || i === 0 ? Math.round(n) : n.toFixed(n >= 10 ? 1 : 2)) + ' ' + units[i];
  }

  function date(value) {
    var d = new Date(value);
    if (isNaN(d.getTime())) return value || '—';
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  async function request(path, options) {
    var response = await fetch(path, Object.assign({ cache: 'no-store' }, options || {}));
    var body = await response.json().catch(function () { return {}; });
    if (!response.ok) throw new Error(body.error || 'HTTP ' + response.status);
    return body;
  }

  function injectStyles() {
    if (document.getElementById('dsh-kb-styles')) return;
    var style = document.createElement('style');
    style.id = 'dsh-kb-styles';
    style.textContent = `
.kbv-launch { position: fixed; left: 0; top: 42%; transform: translateY(-50%); z-index: 2147482000; display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 64px; border: 1px solid var(--dsw-alias-border-l1); border-left: 0; border-radius: 0 9px 9px 0; background: var(--dsw-alias-bg-overlay); color: var(--dsw-alias-brand-primary); cursor: pointer; box-shadow: 0 2px 10px rgba(0,0,0,.12); }
.kbv-launch:hover { border-color: var(--dsw-alias-brand-primary); }
dialog.kbv-overlay { position: fixed; inset: 80px 140px 48px 72px; width: auto; height: auto; max-width: none; max-height: none; margin: 0; padding: 0; border: 1px solid var(--dsw-alias-border-l2); border-radius: 14px; background: var(--dsw-alias-bg-overlay); color: var(--dsw-alias-label-primary); font-size: 14px; line-height: 1.5; overflow: hidden; -webkit-app-region: no-drag; box-shadow: 0 24px 80px rgba(0,0,0,.32); }
dialog.kbv-overlay[open] { display: flex; flex-direction: column; }
dialog.kbv-overlay::backdrop { background: rgba(0,0,0,.28); }
.kbv-overlay *, .kbv-overlay *::before, .kbv-overlay *::after { box-sizing: border-box; }
.kbv-overlay button { font-family: inherit; }
.kbv-head { flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 16px 24px 13px; border-bottom: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); -webkit-app-region: no-drag; }
.kbv-head * { -webkit-app-region: no-drag; }
.kbv-brand { display: flex; align-items: center; gap: 10px; min-width: 0; }
.kbv-brand-icon { display: flex; align-items: center; justify-content: center; width: 36px; height: 36px; border-radius: 10px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-brand-primary); }
.kbv-brand h1 { margin: 0; font-size: 18px; font-weight: 650; letter-spacing: -.01em; }
.kbv-brand p { margin: 2px 0 0; font-size: 11px; color: var(--dsw-alias-label-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.kbv-tools { display: flex; align-items: center; gap: 7px; }
.kbv-search { display: flex; align-items: center; gap: 6px; width: 280px; height: 33px; padding: 0 9px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-secondary); }
.kbv-search:focus-within { border-color: var(--dsw-alias-brand-primary); }
.kbv-search input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; }
.kbv-new, .kbv-icon { display: inline-flex; align-items: center; justify-content: center; gap: 4px; height: 33px; padding: 0 9px; border: 1px solid var(--dsw-alias-brand-primary); border-radius: 8px; background: transparent; color: var(--dsw-alias-brand-primary); font-size: 12px; cursor: pointer; -webkit-app-region: no-drag; }
.kbv-close { display: inline-flex; align-items: center; height: 28px; padding: 0 10px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 7px; background: transparent; color: var(--dsw-alias-label-secondary); font-size: 11px; cursor: pointer; -webkit-app-region: no-drag; }
.kbv-close:hover { color: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-border-l2); }
.kbv-icon { width: 33px; padding: 0; border-color: var(--dsw-alias-border-l1); color: var(--dsw-alias-label-secondary); }
.kbv-icon:hover, .kbv-new:hover { background: var(--dsw-alias-bg-layer-2); }
.kbv-body { flex: 1; min-height: 0; display: grid; grid-template-columns: 210px minmax(0, 1fr); }
.kbv-rail { min-height: 0; overflow: auto; padding: 14px 10px 20px; border-right: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); }
.kbv-rail-label { padding: 0 8px 7px; font-size: 10px; letter-spacing: .08em; color: var(--dsw-alias-label-secondary); }
.kbv-rail button { display: flex; align-items: center; gap: 8px; width: 100%; height: 34px; padding: 0 8px; border: 0; border-radius: 7px; background: transparent; color: var(--dsw-alias-label-secondary); font-size: 12.5px; text-align: left; cursor: pointer; }
.kbv-rail button:hover, .kbv-rail button.is-active { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.kbv-rail button.is-active { font-weight: 600; }
.kbv-rail .kbv-count { margin-left: auto; font-size: 10px; font-variant-numeric: tabular-nums; }
.kbv-dot { width: 7px; height: 7px; flex: 0 0 auto; border-radius: 50%; background: var(--dsw-alias-state-idle-primary); }
.kbv-tone-brand { color: var(--dsw-alias-brand-primary); background: var(--dsw-alias-brand-primary); }
.kbv-tone-warn { color: var(--dsw-alias-state-warn-primary); background: var(--dsw-alias-state-warn-primary); }
.kbv-tone-success { color: var(--dsw-alias-state-success-primary); background: var(--dsw-alias-state-success-primary); }
.kbv-tone-muted { color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-label-secondary); }
.kbv-tone-idle { color: var(--dsw-alias-state-idle-primary); background: var(--dsw-alias-state-idle-primary); }
.kbv-rail-foot { margin-top: 16px; padding: 11px 8px 0; border-top: 1px solid var(--dsw-alias-border-l1); font-size: 10px; line-height: 1.6; color: var(--dsw-alias-label-secondary); }
.kbv-rail-add { display: flex; align-items: center; justify-content: center; width: calc(100% - 4px); height: 31px; margin: 4px 2px 0; border: 1px dashed var(--dsw-alias-border-l1); border-radius: 7px; background: transparent; color: var(--dsw-alias-label-secondary); font-size: 11px; cursor: pointer; }
.kbv-rail-add:hover { color: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-brand-primary); }
.kbv-cat-form { display: flex; flex-direction: column; gap: 5px; margin: 5px 2px 0; padding: 7px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 7px; background: var(--dsw-alias-bg-layer-1); }
.kbv-cat-form input { width: 100%; padding: 5px 7px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 5px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font: inherit; font-size: 11.5px; outline: none; }
.kbv-cat-form input:focus { border-color: var(--dsw-alias-brand-primary); }
.kbv-cat-form-actions { display: flex; gap: 5px; }
.kbv-cat-form-actions button { flex: 1; padding: 4px 6px; font-size: 10.5px; }
.kbv-cat-rename { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; width: 100%; margin-top: 4px; }
.kbv-cat-rename input { flex: 1; min-width: 120px; padding: 5px 7px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 5px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font: inherit; font-size: 11.5px; outline: none; }
.kbv-cat-rename input:focus { border-color: var(--dsw-alias-brand-primary); }
.kbv-main { min-width: 0; min-height: 0; overflow: auto; padding: 20px 24px 44px; }
.kbv-main-inner { max-width: 1120px; margin: 0 auto; }
.kbv-section { margin: 0 0 24px; }
.kbv-cat-bar { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; margin: 0 0 12px; padding: 6px 9px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); }
.kbv-cat-bar-label { margin-right: auto; font-size: 11px; font-weight: 600; color: var(--dsw-alias-label-secondary); }
.kbv-section-head { display: flex; align-items: center; gap: 8px; margin: 0 0 9px; }
.kbv-section-head h2 { margin: 0; font-size: 12.5px; font-weight: 600; }
.kbv-section-head span { font-size: 10px; color: var(--dsw-alias-label-secondary); }
.kbv-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 11px; }
.kbv-card { display: flex; flex-direction: column; gap: 6px; min-height: 164px; padding: 13px 14px 11px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); color: inherit; text-align: left; cursor: pointer; }
.kbv-card:hover { border-color: var(--dsw-alias-brand-primary); }
.kbv-card-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.kbv-card-emoji { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; border-radius: 8px; background: var(--dsw-alias-bg-layer-2); font-size: 15px; }
.kbv-card-date { font-size: 9.5px; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; }
.kbv-card-title { display: block; font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.kbv-card-kicker { display: block; margin-top: -3px; font-size: 10px; color: var(--dsw-alias-label-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.kbv-card-desc { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; flex: 1; font-size: 11.5px; line-height: 1.6; color: var(--dsw-alias-label-secondary); }
.kbv-card-foot { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 9.5px; color: var(--dsw-alias-label-secondary); }
.kbv-tag { display: inline-flex; max-width: 120px; padding: 1px 6px; border-radius: 999px; background: var(--dsw-alias-bg-layer-2); font-size: 9px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.kbv-back { display: inline-flex; align-items: center; gap: 5px; margin: 0 0 14px; padding: 3px 0; border: 0; background: transparent; color: var(--dsw-alias-label-secondary); font-size: 12px; cursor: pointer; }
.kbv-back:hover { color: var(--dsw-alias-label-primary); }
.kbv-detail { max-width: 840px; margin: 0 auto; }
.kbv-detail-head { display: flex; align-items: flex-start; gap: 12px; }
.kbv-detail-glyph { display: flex; align-items: center; justify-content: center; width: 44px; height: 44px; flex: 0 0 auto; border-radius: 11px; background: var(--dsw-alias-bg-layer-2); font-size: 21px; }
.kbv-detail-title { margin: 0; font-size: 22px; font-weight: 650; line-height: 1.25; }
.kbv-detail-kicker { margin-top: 3px; font-size: 11px; color: var(--dsw-alias-label-secondary); }
.kbv-chips { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 6px; }
.kbv-chip { display: inline-flex; padding: 2px 8px; border-radius: 999px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); font-size: 10px; }
.kbv-chip--accent { color: var(--dsw-alias-brand-primary); }
.kbv-actions { display: flex; flex-wrap: wrap; gap: 7px; margin: 14px 0; }
.kbv-secondary, .kbv-danger, .kbv-primary { display: inline-flex; align-items: center; gap: 5px; padding: 6px 10px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 7px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-secondary); font-size: 11.5px; cursor: pointer; }
.kbv-primary { border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-brand-primary); }
.kbv-danger { border-color: var(--dsw-alias-state-error-primary); color: var(--dsw-alias-state-error-primary); }
.kbv-secondary:hover, .kbv-primary:hover { border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-label-primary); }
.kbv-desc { margin: 12px 0; max-width: 72ch; font-size: 13px; line-height: 1.7; color: var(--dsw-alias-label-secondary); }
.kbv-tags { display: flex; flex-wrap: wrap; gap: 5px; margin: 0 0 14px; }
.kbv-note { margin: 0 0 16px; padding: 11px 13px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 9px; background: var(--dsw-alias-bg-layer-1); }
.kbv-note pre { margin: 0; font-family: inherit; font-size: 12px; line-height: 1.7; color: var(--dsw-alias-label-secondary); white-space: pre-wrap; word-break: break-word; }
.kbv-stats { display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); margin: 0 0 16px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 9px; overflow: hidden; background: var(--dsw-alias-bg-layer-1); }
.kbv-stat { padding: 10px 12px; border-left: 1px solid var(--dsw-alias-border-l1); }
.kbv-stat:first-child { border-left: 0; }
.kbv-stat b { display: block; font-size: 15px; font-weight: 600; font-variant-numeric: tabular-nums; }
.kbv-stat span { display: block; margin-top: 1px; font-size: 9.5px; color: var(--dsw-alias-label-secondary); }
.kbv-block { display: flex; align-items: center; gap: 5px; margin: 0 0 7px; font-size: 11px; font-weight: 600; color: var(--dsw-alias-label-secondary); }
.kbv-path { display: flex; align-items: flex-start; gap: 8px; margin: 0 0 16px; padding: 9px 11px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); }
.kbv-path code { flex: 1; min-width: 0; font-family: ui-monospace, Consolas, monospace; font-size: 10.5px; line-height: 1.6; color: var(--dsw-alias-label-secondary); white-space: pre-wrap; word-break: break-all; }
.kbv-copy { flex: 0 0 auto; padding: 3px 8px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 6px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-secondary); font-size: 10px; cursor: pointer; }
.kbv-files { margin: 0 0 16px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 9px; overflow: hidden; background: var(--dsw-alias-bg-layer-1); }
.kbv-file { display: flex; align-items: center; gap: 9px; width: 100%; padding: 8px 11px; border: 0; border-top: 1px solid var(--dsw-alias-border-l1); background: transparent; color: inherit; text-align: left; cursor: pointer; }
.kbv-file:first-child { border-top: 0; }
.kbv-file:hover { background: var(--dsw-alias-bg-layer-2); }
.kbv-file:disabled { cursor: default; }
.kbv-file-main { flex: 1; min-width: 0; }
.kbv-file-name { display: block; font-size: 11.5px; font-weight: 550; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.kbv-file-path { display: block; margin-top: 1px; font-family: ui-monospace, Consolas, monospace; font-size: 9px; color: var(--dsw-alias-label-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.kbv-file-meta { flex: 0 0 auto; font-size: 9.5px; color: var(--dsw-alias-label-secondary); }
.kbv-preview { margin: 0 0 16px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 9px; overflow: hidden; background: var(--dsw-alias-bg-layer-1); }
.kbv-preview-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 11px; border-bottom: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-2); font-size: 11px; }
.kbv-preview pre { max-height: 360px; overflow: auto; margin: 0; padding: 12px 14px; font-family: ui-monospace, Consolas, monospace; font-size: 10.5px; line-height: 1.7; color: var(--dsw-alias-label-secondary); white-space: pre-wrap; word-break: break-word; }
.kbv-preview img { display: block; max-width: 100%; max-height: 400px; margin: 0 auto; padding: 10px; object-fit: contain; }
.kbv-preview-state { padding: 24px 14px; text-align: center; font-size: 11px; color: var(--dsw-alias-label-secondary); }
.kbv-editor { max-width: 760px; margin: 0 auto; }
.kbv-editor h2 { margin: 0 0 3px; font-size: 21px; font-weight: 650; }
.kbv-editor-hint { margin: 0 0 16px; font-size: 10.5px; color: var(--dsw-alias-label-secondary); }
.kbv-field { display: flex; flex-direction: column; gap: 4px; margin: 0 0 11px; }
.kbv-field > span { font-size: 11px; font-weight: 600; color: var(--dsw-alias-label-secondary); }
.kbv-field input, .kbv-field select, .kbv-field textarea { width: 100%; padding: 7px 9px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 7px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; outline: none; }
.kbv-field input:focus, .kbv-field select:focus, .kbv-field textarea:focus { border-color: var(--dsw-alias-brand-primary); }
.kbv-field textarea { resize: vertical; line-height: 1.6; }
.kbv-field small { font-size: 9.5px; color: var(--dsw-alias-label-secondary); }
.kbv-error { margin: 0 0 10px; padding: 7px 9px; border: 1px solid var(--dsw-alias-state-error-primary); border-radius: 7px; color: var(--dsw-alias-state-error-primary); font-size: 11px; }
.kbv-form-actions { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 14px; }
.kbv-state { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; padding: 60px 20px; text-align: center; color: var(--dsw-alias-label-secondary); }
.kbv-state h2 { margin: 0; font-size: 15px; color: var(--dsw-alias-label-primary); font-weight: 600; }
.kbv-state p { margin: 0; max-width: 420px; font-size: 11.5px; line-height: 1.7; }
.kbv-spin { animation: kbv-spin 1s linear infinite; }
@keyframes kbv-spin { to { transform: rotate(360deg); } }
@media (max-width: 900px) {
  .kbv-head { flex-wrap: wrap; gap: 9px; padding: 12px 16px 10px; }
  .kbv-tools { width: 100%; }
  .kbv-search { flex: 1; width: auto; }
  .kbv-body { grid-template-columns: minmax(0,1fr); grid-template-rows: auto minmax(0,1fr); }
  .kbv-rail { display: flex; gap: 5px; overflow-x: auto; padding: 6px 10px; border-right: 0; border-bottom: 1px solid var(--dsw-alias-border-l1); }
  .kbv-rail-label, .kbv-rail-foot { display: none; }
  .kbv-rail button { width: auto; flex: 0 0 auto; padding: 0 9px; }
  .kbv-rail-add { width: auto; flex: 0 0 auto; height: 30px; padding: 0 10px; }
  .kbv-cat-form { width: 210px; }
  .kbv-main { padding: 14px 16px 36px; }
  .kbv-stats { grid-template-columns: minmax(0,1fr); }
  .kbv-stat { border-left: 0; border-top: 1px solid var(--dsw-alias-border-l1); }
  .kbv-stat:first-child { border-top: 0; }
}
@media (max-width: 700px) {
  dialog.kbv-overlay { inset: 12px; border-radius: 10px; }
}
@media (max-width: 560px) {
  .kbv-grid { grid-template-columns: minmax(0,1fr); }
  .kbv-new span { display: none; }
}
`;
    document.head.appendChild(style);
  }

  function toneOf(category) {
    if (category === 'video') return 'brand';
    if (category === 'creative') return 'warn';
    if (category === 'music') return 'success';
    if (category === 'docs') return 'muted';
    return 'idle';
  }

  function catLabel(id) {
    if (state.data) {
      var found = state.data.categories.find(function (category) { return category.id === id; });
      if (found && found.label) return found.label;
    }
    return CAT_LABELS[id] || id;
  }

  function itemIcon(item) {
    return EMOJI[item.type] || '📄';
  }

  function visibleItems() {
    if (!state.data) return [];
    var items = state.data.items;
    if (state.cat !== 'all') {
      items = items.filter(function (item) { return item.category === state.cat; });
    }
    var q = state.q.trim().toLowerCase();
    if (!q) return items;
    return items.filter(function (item) {
      var hay = [item.title, item.kicker, item.description, item.note, item.category]
        .concat(item.tags || [])
        .concat(item.paths || [])
        .join(' ')
        .toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }

  function categoryCount(id) {
    if (!state.data) return 0;
    return state.data.items.filter(function (item) { return item.category === id; }).length;
  }

  function startCategoryCreate() {
    if (!railEl || railEl.querySelector('.kbv-cat-form')) return;
    var form = e('div', 'kbv-cat-form');
    var input = e('input');
    input.placeholder = '新分类名称';
    var error = e('div', 'kbv-error');
    error.style.display = 'none';
    var actions = e('div', 'kbv-cat-form-actions');
    function cancel() {
      form.remove();
    }
    async function save() {
      var label = input.value.trim();
      if (!label) {
        error.textContent = '分类名称不能为空';
        error.style.display = 'block';
        input.focus();
        return;
      }
      try {
        var body = await request('/dsh-knowledge-base/entry', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'save-category', label: label }),
        });
        state.cat = body.id;
        await loadIndex(true);
        renderRail();
        renderMain();
      } catch (cause) {
        error.textContent = String(cause.message || cause);
        error.style.display = 'block';
      }
    }
    input.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') {
        event.preventDefault();
        save();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        cancel();
      }
    });
    actions.appendChild(button('kbv-primary', '保存', save));
    actions.appendChild(button('kbv-secondary', '取消', cancel));
    form.appendChild(input);
    form.appendChild(error);
    form.appendChild(actions);
    railEl.appendChild(form);
    input.focus();
  }

  function renderRail() {
    if (!railEl || !state.data) return;
    railEl.innerHTML = '';
    railEl.appendChild(e('div', 'kbv-rail-label', '分类'));
    var all = button('', null, function () {
      state.cat = 'all';
      state.selected = null;
      state.draft = null;
      state.preview = null;
      renderRail();
      renderMain();
    });
    if (state.cat === 'all') all.classList.add('is-active');
    all.appendChild(e('span', 'kbv-dot kbv-tone-brand'));
    all.appendChild(e('span', '', '全部'));
    all.appendChild(e('span', 'kbv-count', String(state.data.items.length)));
    railEl.appendChild(all);

    state.data.categories.forEach(function (category) {
      var count = categoryCount(category.id);
      if (count === 0 && !category.custom) return;
      var node = button('', null, function () {
        state.cat = category.id;
        state.selected = null;
        state.draft = null;
        state.preview = null;
        renderRail();
        renderMain();
      });
      if (state.cat === category.id) node.classList.add('is-active');
      node.appendChild(e('span', 'kbv-dot kbv-tone-' + (category.tone || toneOf(category.id))));
      node.appendChild(e('span', '', catLabel(category.id)));
      node.appendChild(e('span', 'kbv-count', String(count)));
      railEl.appendChild(node);
    });

    if (state.data.categoryEditing) {
      railEl.appendChild(button('kbv-rail-add', '＋ 新建分类', startCategoryCreate));
    }

    var foot = e('div', 'kbv-rail-foot');
    foot.appendChild(e('div', '', state.data.items.length + ' 个条目'));
    foot.appendChild(e('div', '', '数据来自本地工作区'));
    railEl.appendChild(foot);
  }

  function renderCard(item) {
    var card = button('kbv-card', null, function () {
      state.selected = item.id;
      state.draft = null;
      state.preview = null;
      renderMain();
    });
    var top = e('div', 'kbv-card-top');
    top.appendChild(e('span', 'kbv-card-emoji', itemIcon(item)));
    top.appendChild(e('span', 'kbv-card-date', date(item.stats && item.stats.updated)));
    card.appendChild(top);
    card.appendChild(e('span', 'kbv-card-title', item.title));
    if (item.kicker) card.appendChild(e('span', 'kbv-card-kicker', item.kicker));
    card.appendChild(e('span', 'kbv-card-desc', item.description || ''));
    var foot = e('div', 'kbv-card-foot');
    foot.appendChild(e('span', '', String((item.stats && item.stats.files) || 0) + (item.stats && item.stats.partial ? '+' : '') + ' 个文件'));
    foot.appendChild(e('span', '', bytes(item.stats && item.stats.bytes)));
    (item.tags || []).slice(0, 2).forEach(function (tag) {
      foot.appendChild(e('span', 'kbv-tag', tag));
    });
    card.appendChild(foot);
    return card;
  }

  function section(title, count, items) {
    var wrap = e('div', 'kbv-section');
    var head = e('div', 'kbv-section-head');
    head.appendChild(e('span', 'kbv-dot kbv-tone-brand'));
    head.appendChild(e('h2', '', title));
    head.appendChild(e('span', '', String(count)));
    wrap.appendChild(head);
    var grid = e('div', 'kbv-grid');
    items.forEach(function (item) { grid.appendChild(renderCard(item)); });
    wrap.appendChild(grid);
    return wrap;
  }

  function renderList() {
    var items = visibleItems();
    if (items.length === 0) {
      var empty = e('div', 'kbv-state');
      empty.appendChild(e('h2', '', '没有匹配的条目'));
      empty.appendChild(e('p', '', '换个关键词，或切回「全部」看看。'));
      mainEl.appendChild(empty);
      return;
    }
    if (state.q.trim()) {
      mainEl.appendChild(section('搜索结果', items.length, items));
      return;
    }
    if (state.cat !== 'all') {
      mainEl.appendChild(section(catLabel(state.cat), items.length, items));
      return;
    }
    state.data.categories.forEach(function (category) {
      var list = items.filter(function (item) { return item.category === category.id; });
      if (list.length === 0) return;
      mainEl.appendChild(section(catLabel(category.id), list.length, list));
    });
  }

  function renderPreview(item) {
    if (!state.preview) return null;
    var preview = state.preview;
    var wrap = e('div', 'kbv-preview');
    var head = e('div', 'kbv-preview-head');
    head.appendChild(e('span', '', '预览 · ' + preview.file.name));
    head.appendChild(button('kbv-copy', '关闭', function () {
      state.preview = null;
      renderMain();
    }));
    wrap.appendChild(head);
    if (preview.loading) {
      wrap.appendChild(e('div', 'kbv-preview-state', '正在读取文件…'));
    } else if (preview.error) {
      wrap.appendChild(e('div', 'kbv-preview-state', '读不到这个文件：' + preview.error));
    } else if (preview.mode === 'image') {
      var img = e('img');
      img.src = preview.src;
      img.alt = preview.file.name;
      wrap.appendChild(img);
    } else {
      var pre = e('pre', '', preview.text || '');
      wrap.appendChild(pre);
    }
    return wrap;
  }

  function renderFiles(item) {
    if (!item.files || item.files.length === 0) {
      mainEl.appendChild(e('div', 'kbv-state', '这个条目还没有可展示的核心文件。'));
      return;
    }
    var list = e('div', 'kbv-files');
    item.files.forEach(function (file) {
      var clickable = !!(file.previewable || file.image);
      var row = button('kbv-file', null, clickable ? function () { openFile(file); } : null);
      row.disabled = !clickable;
      row.appendChild(e('span', 'kbv-card-emoji', file.image ? '🖼️' : file.kind === 'output' ? '🎬' : '📄'));
      var main = e('span', 'kbv-file-main');
      main.appendChild(e('span', 'kbv-file-name', file.name));
      main.appendChild(e('span', 'kbv-file-path', file.path));
      row.appendChild(main);
      row.appendChild(e('span', 'kbv-file-meta', bytes(file.bytes)));
      list.appendChild(row);
    });
    mainEl.appendChild(list);
  }

  async function openFile(file) {
    state.preview = { file: file, loading: true };
    if (file.image) {
      state.preview = { file: file, mode: 'image', src: '/dsh-knowledge-base/raw?path=' + encodeURIComponent(file.path) };
      renderMain();
      return;
    }
    if (!file.previewable) {
      state.preview = { file: file, error: '这个文件不支持内嵌预览' };
      renderMain();
      return;
    }
    renderMain();
    try {
      var body = await request('/dsh-knowledge-base/file?path=' + encodeURIComponent(file.path));
      state.preview = { file: file, text: body.text || '', loading: false };
    } catch (error) {
      state.preview = { file: file, error: String(error.message || error) };
    }
    renderMain();
  }

  function renderDetail(item) {
    var wrap = e('div', 'kbv-detail');
    wrap.appendChild(button('kbv-back', '← 返回', function () {
      state.selected = null;
      state.preview = null;
      renderMain();
    }));
    var head = e('div', 'kbv-detail-head');
    head.appendChild(e('div', 'kbv-detail-glyph', itemIcon(item)));
    var titles = e('div');
    titles.appendChild(e('h1', 'kbv-detail-title', item.title));
    if (item.kicker) titles.appendChild(e('div', 'kbv-detail-kicker', item.kicker));
    var chips = e('div', 'kbv-chips');
    chips.appendChild(e('span', 'kbv-chip', catLabel(item.category)));
    if (item.builtin === false) chips.appendChild(e('span', 'kbv-chip kbv-chip--accent', '自定义'));
    if (item.edited) chips.appendChild(e('span', 'kbv-chip kbv-chip--accent', '已修改'));
    titles.appendChild(chips);
    head.appendChild(titles);
    wrap.appendChild(head);

    var actions = e('div', 'kbv-actions');
    actions.appendChild(button('kbv-secondary', '✎ 编辑', function () { startEdit(item); }));
    if (item.builtin === false) {
      actions.appendChild(button('kbv-danger', '删除', function () { deleteEntry(item); }));
    } else if (item.edited) {
      actions.appendChild(button('kbv-danger', '恢复默认', function () { deleteEntry(item); }));
    }
    wrap.appendChild(actions);

    wrap.appendChild(e('p', 'kbv-desc', item.description || ''));
    if (item.tags && item.tags.length) {
      var tags = e('div', 'kbv-tags');
      item.tags.forEach(function (tag) { tags.appendChild(e('span', 'kbv-tag', tag)); });
      wrap.appendChild(tags);
    }
    if (item.note) {
      var note = e('div', 'kbv-note');
      note.appendChild(e('div', 'kbv-block', '笔记'));
      note.appendChild(e('pre', '', item.note));
      wrap.appendChild(note);
    }

    var stats = e('div', 'kbv-stats');
    [['工程文件', String((item.stats && item.stats.files) || 0) + (item.stats && item.stats.partial ? '+' : '')], ['占用空间', bytes(item.stats && item.stats.bytes)], ['最近更新', date(item.stats && item.stats.updated)]].forEach(function (pair) {
      var cell = e('div', 'kbv-stat');
      cell.appendChild(e('b', '', pair[1]));
      cell.appendChild(e('span', '', pair[0]));
      stats.appendChild(cell);
    });
    wrap.appendChild(stats);

    wrap.appendChild(e('div', 'kbv-block', '位置'));
    var pathRow = e('div', 'kbv-path');
    var pathText = (item.paths || []).map(function (rel) {
      return (state.data.root + '\\' + rel.replace(/\//g, '\\'));
    }).join('\n') || '未关联工作区路径';
    pathRow.appendChild(e('code', '', pathText));
    if (item.paths && item.paths.length) {
      pathRow.appendChild(button('kbv-copy', '复制路径', function () {
        if (navigator.clipboard) navigator.clipboard.writeText(pathText).catch(function () {});
      }));
    }
    wrap.appendChild(pathRow);

    wrap.appendChild(e('div', 'kbv-block', '核心文件'));
    renderFilesInto(wrap, item);
    var preview = renderPreview(item);
    if (preview) wrap.appendChild(preview);
    wrap.appendChild(e('p', 'kbv-detail-kicker', '索引直接来自工作区；新增文件后点右上角刷新即可收录。'));
    mainEl.appendChild(wrap);
  }

  function renderFilesInto(wrap, item) {
    if (!item.files || item.files.length === 0) {
      wrap.appendChild(e('div', 'kbv-state', '这个条目还没有可展示的核心文件。'));
      return;
    }
    var list = e('div', 'kbv-files');
    item.files.forEach(function (file) {
      var clickable = !!(file.previewable || file.image);
      var row = button('kbv-file', null, clickable ? function () { openFile(file); } : null);
      row.disabled = !clickable;
      row.appendChild(e('span', 'kbv-card-emoji', file.image ? '🖼️' : file.kind === 'output' ? '🎬' : '📄'));
      var main = e('span', 'kbv-file-main');
      main.appendChild(e('span', 'kbv-file-name', file.name));
      main.appendChild(e('span', 'kbv-file-path', file.path));
      row.appendChild(main);
      row.appendChild(e('span', 'kbv-file-meta', bytes(file.bytes)));
      list.appendChild(row);
    });
    wrap.appendChild(list);
  }

  function field(label, control, hint) {
    var wrap = e('label', 'kbv-field');
    wrap.appendChild(e('span', '', label));
    wrap.appendChild(control);
    if (hint) wrap.appendChild(e('small', '', hint));
    return wrap;
  }

  function input(value, onInput, placeholder) {
    var node = e('input');
    node.value = value || '';
    node.placeholder = placeholder || '';
    node.addEventListener('input', function () { onInput(node.value); });
    return node;
  }

  function textarea(value, rows, onInput) {
    var node = e('textarea');
    node.rows = rows;
    node.value = value || '';
    node.addEventListener('input', function () { onInput(node.value); });
    return node;
  }

  function renderEditor() {
    var draft = state.draft;
    var wrap = e('div', 'kbv-editor');
    wrap.appendChild(button('kbv-back', '← 返回', function () {
      state.draft = null;
      state.formError = '';
      renderMain();
    }));
    wrap.appendChild(e('h2', '', draft.id ? '编辑条目' : '新建知识条目'));
    wrap.appendChild(e('p', 'kbv-editor-hint', '保存到工作区的 .knowledge-base\\entries.json，原文件不会改动。'));

    wrap.appendChild(field('标题', input(draft.title, function (v) { draft.title = v; }, '给这张卡片起个名字')));
    var select = e('select');
    state.data.categories.forEach(function (category) {
      var option = e('option', '', catLabel(category.id));
      option.value = category.id;
      if (category.id === draft.category) option.selected = true;
      select.appendChild(option);
    });
    select.addEventListener('change', function () { draft.category = select.value; });
    wrap.appendChild(field('分类', select));
    wrap.appendChild(field('说明', textarea(draft.description, 3, function (v) { draft.description = v; })));
    wrap.appendChild(field('标签', input(draft.tags, function (v) { draft.tags = v; }, 'DSH, 待办, 参考')));
    if (!draft.builtin) {
      wrap.appendChild(field('关联路径（可留空）', input(draft.path, function (v) { draft.path = v; }, '项目文件夹'), '工作区内的文件或文件夹'));
    }
    wrap.appendChild(field('笔记 / 正文', textarea(draft.note, 8, function (v) { draft.note = v; })));
    if (state.formError) wrap.appendChild(e('div', 'kbv-error', state.formError));

    var actions = e('div', 'kbv-form-actions');
    var save = button('kbv-primary', state.saving ? '保存中…' : '保存', saveDraft);
    save.disabled = state.saving;
    actions.appendChild(save);
    actions.appendChild(button('kbv-secondary', '取消', function () {
      state.draft = null;
      state.formError = '';
      renderMain();
    }));
    if (draft.id) {
      actions.appendChild(button('kbv-danger', draft.builtin ? '恢复默认' : '删除', function () {
        deleteEntry({ id: draft.id, builtin: draft.builtin });
      }));
    }
    wrap.appendChild(actions);
    mainEl.appendChild(wrap);
  }

  function startCreate() {
    state.draft = {
      id: '',
      title: '',
      category: state.cat === 'all' ? 'auto' : state.cat,
      description: '',
      tags: '',
      path: '',
      note: '',
      builtin: false,
    };
    state.selected = null;
    state.preview = null;
    state.formError = '';
    renderMain();
  }

  function startEdit(item) {
    state.draft = {
      id: item.id,
      title: item.title || '',
      category: item.category || 'misc',
      description: item.description || '',
      tags: (item.tags || []).join(', '),
      path: (item.paths || [])[0] || '',
      note: item.note || '',
      builtin: item.builtin !== false,
    };
    state.formError = '';
    state.preview = null;
    renderMain();
  }

  async function saveDraft() {
    var draft = state.draft;
    if (!draft) return;
    if (!draft.title.trim()) {
      state.formError = '标题不能为空';
      renderMain();
      return;
    }
    state.saving = true;
    state.formError = '';
    renderMain();
    try {
      var entry = {
        title: draft.title,
        category: draft.category,
        description: draft.description,
        tags: draft.tags,
        note: draft.note,
      };
      if (!draft.builtin) entry.path = draft.path;
      var body = await request('/dsh-knowledge-base/entry', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'save', id: draft.id || undefined, entry: entry }),
      });
      state.saving = false;
      state.draft = null;
      await loadIndex(true);
      state.selected = body.id || draft.id || null;
      if (body.autoCategory && body.category && body.category !== 'misc') state.cat = body.category;
      renderMain();
    } catch (error) {
      state.saving = false;
      state.formError = '保存失败：' + String(error.message || error);
      renderMain();
    }
  }

  async function deleteEntry(item) {
    var builtin = item.builtin !== false;
    if (!window.confirm(builtin ? '恢复成自动整理的默认内容？你写的笔记也会被清掉。' : '确定删除这个条目吗？')) return;
    try {
      await request('/dsh-knowledge-base/entry', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'delete', id: item.id }),
      });
      state.draft = null;
      state.selected = null;
      state.formError = '';
      await loadIndex(true);
      renderMain();
    } catch (error) {
      state.formError = '删除失败：' + String(error.message || error);
      renderMain();
    }
  }

  function showCategoryRename(bar, category) {
    if (bar.querySelector('.kbv-cat-rename')) return;
    var form = e('div', 'kbv-cat-rename');
    var input = e('input');
    input.value = catLabel(category.id);
    var error = e('div', 'kbv-error');
    error.style.display = 'none';
    var actions = e('div', 'kbv-cat-form-actions');
    function close() {
      form.remove();
    }
    async function save() {
      var label = input.value.trim();
      if (!label) {
        error.textContent = '分类名称不能为空';
        error.style.display = 'block';
        input.focus();
        return;
      }
      try {
        await request('/dsh-knowledge-base/entry', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'save-category', id: category.id, label: label }),
        });
        await loadIndex(true);
        renderMain();
      } catch (cause) {
        error.textContent = String(cause.message || cause);
        error.style.display = 'block';
      }
    }
    input.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') {
        event.preventDefault();
        save();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    });
    actions.appendChild(button('kbv-primary', '保存', save));
    actions.appendChild(button('kbv-secondary', '取消', close));
    form.appendChild(input);
    form.appendChild(error);
    form.appendChild(actions);
    bar.appendChild(form);
    input.focus();
    input.select();
  }

  async function deleteCategory(category) {
    if (!category.custom) return;
    if (!window.confirm('确定删除分类「' + catLabel(category.id) + '」吗？分类里还有条目时不能删。')) return;
    try {
      await request('/dsh-knowledge-base/entry', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'delete-category', id: category.id }),
      });
      state.cat = 'all';
      await loadIndex(true);
      renderMain();
    } catch (error) {
      window.alert('删除失败：' + String(error.message || error));
    }
  }

  function renderCategoryBar(inner) {
    var category = state.data.categories.find(function (entry) { return entry.id === state.cat; });
    if (!category) return;
    var bar = e('div', 'kbv-cat-bar');
    bar.appendChild(e('span', 'kbv-cat-bar-label', '分类：' + catLabel(category.id)));
    bar.appendChild(button('kbv-copy', '重命名分类', function () { showCategoryRename(bar, category); }));
    if (category.custom) bar.appendChild(button('kbv-copy', '删除分类', function () { deleteCategory(category); }));
    inner.appendChild(bar);
  }

  function renderMain() {
    if (!mainEl) return;
    mainEl.innerHTML = '';
    var inner = e('div', 'kbv-main-inner');
    mainEl.appendChild(inner);
    if (state.loading && !state.data) {
      var loading = e('div', 'kbv-state');
      loading.appendChild(e('h2', '', '正在整理工作区…'));
      loading.appendChild(e('p', '', '第一次打开会扫描各项目的文件数与大小，通常几秒钟。'));
      inner.appendChild(loading);
      return;
    }
    if (state.error && !state.data) {
      var failed = e('div', 'kbv-state');
      failed.appendChild(e('h2', '', '知识库暂时读不到'));
      failed.appendChild(e('p', '', String(state.error)));
      failed.appendChild(button('kbv-primary', '重试', function () { loadIndex(true); }));
      inner.appendChild(failed);
      return;
    }
    if (!state.data) return;
    if (state.draft) {
      renderEditorInto(inner);
      return;
    }
    if (state.selected) {
      var selected = state.data.items.find(function (item) { return item.id === state.selected; });
      if (selected) {
        renderDetailInto(inner, selected);
        return;
      }
      state.selected = null;
    }
    if (state.cat !== 'all') renderCategoryBar(inner);
    renderListInto(inner);
  }

  function renderEditorInto(inner) {
    var draft = state.draft;
    inner.appendChild(button('kbv-back', '← 返回', function () {
      state.draft = null;
      state.formError = '';
      renderMain();
    }));
    var wrap = e('div', 'kbv-editor');
    wrap.appendChild(e('h2', '', draft.id ? '编辑条目' : '新建知识条目'));
    wrap.appendChild(e('p', 'kbv-editor-hint', '只有标题是必填。分类默认自动判断；填了工作区下的文件夹路径，会按文件夹名自动建分类。'));
    wrap.appendChild(field('标题', input(draft.title, function (v) { draft.title = v; }, '给这张卡片起个名字')));
    if (!draft.builtin) {
      wrap.appendChild(field('关联路径（可选，自动分类用）', input(draft.path, function (v) { draft.path = v; }, '新项目文件夹或资料文件夹'), '工作区内的文件或文件夹；留空就按标题关键词归类'));
    }
    var select = e('select');
    if (draft.category !== 'auto' && !state.data.categories.some(function (category) { return category.id === draft.category; })) {
      draft.category = 'auto';
    }
    var autoOption = e('option', '', '自动分类（按路径/关键词）');
    autoOption.value = 'auto';
    if (draft.category === 'auto') autoOption.selected = true;
    select.appendChild(autoOption);
    state.data.categories.forEach(function (category) {
      var option = e('option', '', catLabel(category.id));
      option.value = category.id;
      if (category.id === draft.category) option.selected = true;
      select.appendChild(option);
    });
    select.addEventListener('change', function () { draft.category = select.value; });
    wrap.appendChild(field('分类', select));
    wrap.appendChild(field('说明（可选）', textarea(draft.description, 3, function (v) { draft.description = v; })));
    wrap.appendChild(field('标签（可选）', input(draft.tags, function (v) { draft.tags = v; }, 'DSH, 待办, 参考')));
    wrap.appendChild(field('笔记 / 正文（可选）', textarea(draft.note, 8, function (v) { draft.note = v; })));
    if (state.formError) wrap.appendChild(e('div', 'kbv-error', state.formError));
    var actions = e('div', 'kbv-form-actions');
    var save = button('kbv-primary', state.saving ? '保存中…' : '保存', saveDraft);
    save.disabled = state.saving;
    actions.appendChild(save);
    actions.appendChild(button('kbv-secondary', '取消', function () {
      state.draft = null;
      state.formError = '';
      renderMain();
    }));
    if (draft.id) {
      actions.appendChild(button('kbv-danger', draft.builtin ? '恢复默认' : '删除', function () {
        deleteEntry({ id: draft.id, builtin: draft.builtin });
      }));
    }
    wrap.appendChild(actions);
    inner.appendChild(wrap);
  }

  function renderDetailInto(inner, item) {
    inner.appendChild(button('kbv-back', '← 返回', function () {
      state.selected = null;
      state.preview = null;
      renderMain();
    }));
    var wrap = e('div', 'kbv-detail');
    var head = e('div', 'kbv-detail-head');
    head.appendChild(e('div', 'kbv-detail-glyph', itemIcon(item)));
    var titles = e('div');
    titles.appendChild(e('h1', 'kbv-detail-title', item.title));
    if (item.kicker) titles.appendChild(e('div', 'kbv-detail-kicker', item.kicker));
    var chips = e('div', 'kbv-chips');
    chips.appendChild(e('span', 'kbv-chip', catLabel(item.category)));
    if (item.builtin === false) chips.appendChild(e('span', 'kbv-chip kbv-chip--accent', '自定义'));
    if (item.edited) chips.appendChild(e('span', 'kbv-chip kbv-chip--accent', '已修改'));
    titles.appendChild(chips);
    head.appendChild(titles);
    wrap.appendChild(head);
    var actions = e('div', 'kbv-actions');
    actions.appendChild(button('kbv-secondary', '✎ 编辑', function () { startEdit(item); }));
    if (item.builtin === false) actions.appendChild(button('kbv-danger', '删除', function () { deleteEntry(item); }));
    else if (item.edited) actions.appendChild(button('kbv-danger', '恢复默认', function () { deleteEntry(item); }));
    wrap.appendChild(actions);
    if (state.formError) wrap.appendChild(e('div', 'kbv-error', state.formError));
    wrap.appendChild(e('p', 'kbv-desc', item.description || ''));
    if (item.tags && item.tags.length) {
      var tags = e('div', 'kbv-tags');
      item.tags.forEach(function (tag) { tags.appendChild(e('span', 'kbv-tag', tag)); });
      wrap.appendChild(tags);
    }
    if (item.note) {
      var note = e('div', 'kbv-note');
      note.appendChild(e('div', 'kbv-block', '笔记'));
      note.appendChild(e('pre', '', item.note));
      wrap.appendChild(note);
    }
    var stats = e('div', 'kbv-stats');
    [['工程文件', String((item.stats && item.stats.files) || 0) + (item.stats && item.stats.partial ? '+' : '')], ['占用空间', bytes(item.stats && item.stats.bytes)], ['最近更新', date(item.stats && item.stats.updated)]].forEach(function (pair) {
      var cell = e('div', 'kbv-stat');
      cell.appendChild(e('b', '', pair[1]));
      cell.appendChild(e('span', '', pair[0]));
      stats.appendChild(cell);
    });
    wrap.appendChild(stats);
    wrap.appendChild(e('div', 'kbv-block', '位置'));
    var pathRow = e('div', 'kbv-path');
    var pathText = (item.paths || []).map(function (rel) {
      return state.data.root + '\\' + rel.replace(/\//g, '\\');
    }).join('\n') || '未关联工作区路径';
    pathRow.appendChild(e('code', '', pathText));
    if (item.paths && item.paths.length) {
      pathRow.appendChild(button('kbv-copy', '复制路径', function () {
        if (navigator.clipboard) navigator.clipboard.writeText(pathText).catch(function () {});
      }));
    }
    wrap.appendChild(pathRow);
    wrap.appendChild(e('div', 'kbv-block', '核心文件'));
    renderFilesInto(wrap, item);
    var preview = renderPreview(item);
    if (preview) wrap.appendChild(preview);
    wrap.appendChild(e('p', 'kbv-detail-kicker', '索引直接来自工作区；新增文件后点右上角刷新即可收录。'));
    inner.appendChild(wrap);
  }

  function renderListInto(inner) {
    var items = visibleItems();
    if (items.length === 0) {
      var empty = e('div', 'kbv-state');
      empty.appendChild(e('h2', '', '没有匹配的条目'));
      empty.appendChild(e('p', '', '换个关键词，或切回「全部」看看。'));
      inner.appendChild(empty);
      return;
    }
    if (state.q.trim()) {
      inner.appendChild(section('搜索结果', items.length, items));
      return;
    }
    if (state.cat !== 'all') {
      inner.appendChild(section(catLabel(state.cat), items.length, items));
      return;
    }
    state.data.categories.forEach(function (category) {
      var list = items.filter(function (item) { return item.category === category.id; });
      if (list.length === 0) return;
      inner.appendChild(section(catLabel(category.id), list.length, list));
    });
  }

  async function loadIndex(force) {
    state.loading = true;
    state.error = null;
    renderMain();
    try {
      var data = await request('/dsh-knowledge-base/index' + (force ? '?refresh=1' : ''));
      state.data = data;
      state.loading = false;
      if (state.selected && !data.items.some(function (item) { return item.id === state.selected; })) state.selected = null;
      renderRail();
      renderMain();
      if (headerStats) {
        headerStats.textContent = data.root + ' · ' + data.items.length + ' 个条目 · 最后整理 ' + new Date(data.scannedAt).toLocaleTimeString();
      }
    } catch (error) {
      state.loading = false;
      state.error = String(error.message || error);
      renderMain();
    }
  }

  function openPanel() {
    if (!overlay) {
      overlay = e('dialog', 'kbv-overlay');
      var head = e('div', 'kbv-head');
      var brand = e('div', 'kbv-brand');
      var icon = e('span', 'kbv-brand-icon');
      icon.appendChild(svgIcon('book', 20));
      brand.appendChild(icon);
      var titles = e('div');
      titles.appendChild(e('h1', '', '知识库'));
      headerStats = e('p', '', '正在整理工作区…');
      titles.appendChild(headerStats);
      brand.appendChild(titles);
      head.appendChild(brand);
      var tools = e('div', 'kbv-tools');
      var search = e('label', 'kbv-search');
      search.appendChild(svgIcon('search', 14));
      searchInput = e('input');
      searchInput.placeholder = '搜索项目、文档、标签、笔记…';
      searchInput.addEventListener('input', function () {
        state.q = searchInput.value;
        renderMain();
      });
      search.appendChild(searchInput);
      tools.appendChild(search);
      var newButton = button('kbv-new', '＋ 新建', startCreate);
      tools.appendChild(newButton);
      tools.appendChild(button('kbv-icon', null, function () { loadIndex(true); }));
      tools.lastChild.appendChild(svgIcon('refresh', 15));
      var close = button('kbv-icon', null, closePanel);
      close.title = '关闭知识库';
      close.setAttribute('aria-label', '关闭知识库');
      close.appendChild(svgIcon('close', 15));
      tools.appendChild(close);
      head.appendChild(tools);
      var body = e('div', 'kbv-body');
      railEl = e('div', 'kbv-rail');
      mainEl = e('div', 'kbv-main');
      body.appendChild(railEl);
      body.appendChild(mainEl);
      overlay.appendChild(head);
      overlay.appendChild(body);
      document.body.appendChild(overlay);
      ['mousedown', 'pointerdown', 'touchstart', 'click'].forEach(function (type) {
        overlay.addEventListener(type, function (event) {
          event.stopPropagation();
        });
      });
      overlay.addEventListener('cancel', function (event) {
        event.preventDefault();
        closePanel();
      });
      overlay.addEventListener('close', function () {
        state.preview = null;
      });
    }
    if (!overlay.open) overlay.showModal();
    state.selected = null;
    state.draft = null;
    state.preview = null;
    state.formError = '';
    state.cat = 'all';
    state.q = '';
    if (searchInput) searchInput.value = '';
    loadIndex(true);
  }

  function closePanel() {
    if (overlay && overlay.open) overlay.close();
    state.preview = null;
  }

  function ensureSidebarRow() {
    var list = document.querySelector('[class*="panelList"]');
    if (!list) return false;
    if (list.getClientRects().length === 0) return false;
    if (document.getElementById('dsh-kb-side-row')) return true;
    var rows = Array.prototype.slice.call(list.querySelectorAll('button[class*="panelRow"]'));
    if (rows.length === 0) return false;
    var anchor = null;
    for (var i = 0; i < rows.length; i += 1) {
      var label = rows[i].getAttribute('aria-label') || rows[i].textContent || '';
      if (/插件|plugins?/i.test(label) && !/市场|market/i.test(label)) {
        anchor = rows[i];
        break;
      }
    }
    if (!anchor) anchor = rows[0];
    var row = anchor.cloneNode(true);
    row.id = 'dsh-kb-side-row';
    row.removeAttribute('aria-current');
    Array.prototype.slice.call(row.classList).forEach(function (name) {
      if (/panelActive/i.test(name)) row.classList.remove(name);
    });
    row.setAttribute('aria-label', '知识库');
    row.title = '知识库';
    var glyph = row.querySelector('[class*="panelGlyph"]');
    if (glyph) {
      glyph.innerHTML = '';
      glyph.appendChild(svgIcon('book', 16));
    } else {
      row.insertBefore(svgIcon('book', 16), row.firstChild);
    }
    var title = row.querySelector('[class*="panelTitle"]');
    if (title) title.textContent = '知识库';
    row.addEventListener('mousedown', function (event) {
      event.stopPropagation();
    });
    row.addEventListener('pointerdown', function (event) {
      event.stopPropagation();
    });
    row.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      openPanel();
    });
    var host = anchor;
    while (host.parentNode && host.parentNode !== list) host = host.parentNode;
    if (host.parentNode === list) list.insertBefore(row, host.nextSibling);
    else list.appendChild(row);
    return true;
  }

  var mountAttempts = 0;

  function mountButton() {
    if (ensureSidebarRow()) {
      var stale = document.getElementById('dsh-kb-launch');
      if (stale) stale.remove();
      return;
    }
    mountAttempts += 1;
    if (mountAttempts < 4) return;
    if (document.getElementById('dsh-kb-launch')) return;
    launchButton = button('kbv-launch', null, function (event) {
      event.stopPropagation();
      openPanel();
    });
    launchButton.id = 'dsh-kb-launch';
    launchButton.title = '知识库';
    launchButton.setAttribute('aria-label', '知识库');
    launchButton.appendChild(svgIcon('book', 19));
    document.body.appendChild(launchButton);
  }

  injectStyles();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountButton, { once: true });
  } else {
    mountButton();
  }
  setInterval(mountButton, 600);
})();
