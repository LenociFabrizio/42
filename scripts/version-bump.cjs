/**
 * version-bump.cjs
 * ------------------------------------------------------------
 * Incrementa la PATCH della versione in public/version.json e la
 * sincronizza in package.json. Eseguito ad ogni commit condiviso
 * (l'hook locale non è utilizzabile: core.hooksPath è gestito da
 * VaultRadar aziendale). Uso: `npm run version:bump`.
 * ------------------------------------------------------------
 */
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const verPath = path.join(root, 'public', 'version.json');
const cur = JSON.parse(fs.readFileSync(verPath, 'utf8'));
const [maj, min, pat] = String(cur.version || '0.0.0').split('.').map((n) => parseInt(n, 10) || 0);
const next = `${maj}.${min}.${pat + 1}`;
fs.writeFileSync(verPath, JSON.stringify({ version: next }) + '\n');

try {
  const pkgPath = path.join(root, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  pkg.version = next;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
} catch { /* package.json opzionale */ }

console.log('version ->', next);
