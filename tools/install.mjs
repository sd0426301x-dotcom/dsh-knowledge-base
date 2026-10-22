#!/usr/bin/env node
/**
 * Install the knowledge base bundle into the active DSH Desktop profile.
 *
 * It performs the two steps a local bundle needs:
 *   1. make the package resolvable from `<profile>/node_modules`;
 *   2. mount it, either through the profile's `dsh.profile.bundles` list (when
 *      the user already enabled it) or through a loader row in
 *      `<profile>/cordis.patch.yml`.
 *
 * It never writes into the DSH installation directory.
 *
 * Usage:
 *   node tools/install.mjs            install / refresh
 *   node tools/install.mjs --status   print current state
 *   node tools/install.mjs --dry-run  print planned changes
 *   node tools/install.mjs --uninstall
 */
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_NAME = 'dsh-workspace-kb';
const ROW_ID = 'knowledge-base';
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PATCH_ROW_RE = /- insert:\r?\n(?: {4}#[^\n]*\r?\n)? {4}- id: knowledge-base\r?\n {6}name: 'dsh-workspace-kb'\r?\n?/u;

function dshHome() {
  const configured = process.env.DSH_HOME;
  if (typeof configured === 'string' && configured.trim() !== '') return resolve(configured.trim());
  return join(homedir(), '.dsh');
}

function profileDirectory() {
  return resolve(process.env.DSH_PROFILE_DIR ?? join(dshHome(), 'profiles', 'desktop'));
}

function profileModules() {
  return join(profileDirectory(), 'node_modules');
}

function linkPath() {
  return join(profileModules(), 'dsh-workspace-kb');
}

function patchPath() {
  return join(profileDirectory(), 'cordis.patch.yml');
}

function safeRead(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

function bundleSelected() {
  try {
    const pkg = JSON.parse(safeRead(join(profileDirectory(), 'package.json')));
    const bundles = pkg?.dsh?.profile?.bundles;
    return Array.isArray(bundles) && bundles.includes(PACKAGE_NAME);
  } catch {
    return false;
  }
}

function linkStatus() {
  try {
    const target = readlinkSync(linkPath());
    return resolve(dirname(linkPath()), target).toLowerCase() === PACKAGE_ROOT.toLowerCase();
  } catch {
    return false;
  }
}

function patchBlock(stamp) {
  return [
    '- insert:',
    `    # dsh-workspace-kb: local workspace knowledge base (installed ${stamp})`,
    `    - id: ${ROW_ID}`,
    `      name: '${PACKAGE_NAME}'`,
    '',
  ].join('\n');
}

function patchInstalled(text) {
  return text.includes(`- id: ${ROW_ID}`) && text.includes(PACKAGE_NAME);
}

function ensureLink(dryRun) {
  const path = linkPath();
  if (!dryRun) mkdirSync(dirname(path), { recursive: true });
  if (existsSync(path)) {
    if (linkStatus()) return 'already-linked';
    const info = lstatSync(path);
    if (info.isSymbolicLink() || info.isDirectory()) {
      // A junction reports as a directory on Windows; only replace when it is
      // a link. A real directory is refused.
      let isLink = false;
      try {
        readlinkSync(path);
        isLink = true;
      } catch {
        isLink = false;
      }
      if (!isLink) throw new Error(`refusing to replace a real directory at ${path}`);
      if (!dryRun) rmSync(path, { recursive: true, force: true });
    } else {
      throw new Error(`refusing to replace a non-link at ${path}`);
    }
  }
  if (!dryRun) symlinkSync(PACKAGE_ROOT, path, 'junction');
  return 'linked';
}

function ensurePatchRow(dryRun) {
  if (bundleSelected()) return 'bundle-selected';
  const path = patchPath();
  const text = safeRead(path);
  if (patchInstalled(text)) return 'already-present';
  const withoutComments = text.replace(/^[ \t]*#.*$/gmu, '').trim();
  let base;
  if (withoutComments === '') {
    base = `${text.trimEnd()}${text.trim() === '' ? '' : '\n'}`;
  } else if (withoutComments === '[]' || withoutComments === '[ ]') {
    base = text.replace(/^[ \t]*\[[ \t]*\][ \t]*(?:#.*)?(?:\r?\n|$)/mu, '# []\n').trimEnd() + '\n';
  } else {
    base = text.trimEnd() + '\n\n';
  }
  const next = `${base}${patchBlock(new Date().toISOString())}`;
  if (!dryRun) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, next, 'utf8');
  }
  return 'installed';
}

function status() {
  console.log(`package:  ${PACKAGE_NAME}`);
  console.log(`root:     ${PACKAGE_ROOT}`);
  console.log(`profile:  ${profileDirectory()}`);
  console.log(`link:     ${linkStatus() ? 'ok' : existsSync(linkPath()) ? 'present but not this package' : 'missing'}`);
  console.log(`bundle:   ${bundleSelected() ? 'selected' : 'not selected'}`);
  console.log(`patch:    ${patchInstalled(safeRead(patchPath())) ? 'row present' : 'row missing'}`);
}

function install(dryRun) {
  const link = ensureLink(dryRun);
  const patch = ensurePatchRow(dryRun);
  console.log(`${dryRun ? '[dry-run] ' : ''}link: ${link}`);
  console.log(`${dryRun ? '[dry-run] ' : ''}mount: ${patch}`);
  console.log(dryRun ? 'No changes written.' : 'Done. Fully quit and reopen DSH Desktop, not just Ctrl+R.');
}

function uninstall(dryRun) {
  if (linkStatus()) {
    if (!dryRun) rmSync(linkPath(), { recursive: true, force: true });
    console.log(`${dryRun ? '[dry-run] ' : ''}removed link ${linkPath()}`);
  } else {
    console.log('link not present or not owned by this package');
  }
  const path = patchPath();
  const text = safeRead(path);
  if (PATCH_ROW_RE.test(text)) {
    if (!dryRun) writeFileSync(path, text.replace(PATCH_ROW_RE, ''), 'utf8');
    console.log(`${dryRun ? '[dry-run] ' : ''}removed patch row`);
  }
  if (bundleSelected()) {
    console.log('This profile also selects the package in dsh.profile.bundles.');
    console.log('Remove it there (or via the plugin manager) before restarting.');
  }
  console.log(dryRun ? 'No changes written.' : 'Uninstalled. Restart DSH Desktop.');
}

const args = process.argv.slice(2);
if (args.includes('--status')) status();
else if (args.includes('--uninstall')) uninstall(args.includes('--dry-run'));
else install(args.includes('--dry-run'));
