#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const {execSync} = require('child_process');

function log(...args) { console.log('[generate-latest]', ...args); }

const root = path.resolve(__dirname, '..');
const distDir = path.join(root, 'dist');
const latestDir = path.join(distDir, 'latest');

function getVersion() {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));
  return pkg.version;
}

function ensureDir(dir) { if (!fs.existsSync(dir)) fs.mkdirSync(dir, {recursive: true}); }
function clearDirExcept(dir, keepNames = []) {
  ensureDir(dir);
  const entries = fs.readdirSync(dir, {withFileTypes: true});
  const keepSet = new Set(keepNames);
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (keepSet.has(entry.name)) continue;
    if (entry.isDirectory()) {
      fs.rmSync(full, {recursive: true, force: true});
    } else {
      fs.rmSync(full, {force: true});
    }
  }
}

function main() {
  const version = getVersion();
  ensureDir(distDir);
  // Preserve README.md in dist/latest when cleaning
  clearDirExcept(latestDir, ['README.md']);
  ensureDir(latestDir);

  // Find artifacts by name convention
  const macArm = `CheckoutProxy-${version}-arm64.dmg`;
  const macX64 = `CheckoutProxy-${version}-x64.dmg`;
  const winX64 = `CheckoutProxy-${version}-x64.exe`;
  const artifacts = [macArm, macX64, winX64];

  artifacts.forEach(name => {
    const src = path.join(distDir, name);
    if (!fs.existsSync(src)) {
      log('Missing artifact', src);
    } else {
      const dst = path.join(latestDir, name);
      fs.copyFileSync(src, dst);
      log('Copied', name, 'to dist/latest');
    }
  });

  // Generate latest.json
  const latestJson = {
    version,
    files: artifacts,
    buildDate: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(distDir, 'latest.json'), JSON.stringify(latestJson, null, 2));
  log('Generated latest.json');

  // Stage files to git
  try {
    execSync('git add dist/latest dist/latest.json', {cwd: root, stdio: 'inherit'});
    log('Staged latest artifacts to git');
  } catch (e) {
    log('git add failed', e.message);
  }
}

main();
