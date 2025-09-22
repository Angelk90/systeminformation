const fs = require('fs');
const path = require('path');
const terser = require('terser');

const libFolder = path.join(__dirname, 'lib');
const fallbackFolder = __dirname;
const outputFile = path.join(__dirname, 'lib_combined.js');
const outputFileMin = path.join(__dirname, 'lib_combined.min.js');
const rangesPath = path.join(__dirname, 'lib_ranges.json');

if (!fs.existsSync(rangesPath)) {
  console.error('Impossibile trovare lib_ranges.json in', rangesPath);
  process.exit(1);
}

let rawRanges = JSON.parse(fs.readFileSync(rangesPath, 'utf8'));

function isRelativeRequire(reqPath) {
  return reqPath.startsWith('./') || reqPath.startsWith('../');
}

function resolveFilePath(file) {
  let p = path.join(libFolder, file);
  if (fs.existsSync(p)) return p;
  p = path.join(fallbackFolder, file);
  if (fs.existsSync(p)) return p;
  return null;
}

const ranges = {};
for (const [file, value] of Object.entries(rawRanges)) {
  if (Array.isArray(value)) {
    ranges[file] = { line: value, replace: [] };
  } else {
    ranges[file] = { line: value.line, replace: value.replace || [] };
  }
}

let combinedContent = '';

for (const [file, spec] of Object.entries(ranges)) {
  const [start, end] = spec.line;
  const replaceVars = Array.isArray(spec.replace) ? spec.replace : [];

  const filePath = resolveFilePath(file);
  if (!filePath) {
    console.warn(`File ${file} non trovato, skip.`);
    continue;
  }

  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split(/\r?\n/);
  const slice = lines.slice(Math.max(0, start - 1), Math.min(lines.length, end));
  let sliceText = slice.join('\n');

  for (const v of replaceVars) {
    const reqLineRegex = new RegExp(
      "^\\s*(?:const|let|var)\\s+" + v + "\\s*=\\s*require\\([^)]*\\)\\s*;?\\s*$",
      'gm'
    );
    sliceText = sliceText.replace(reqLineRegex, '');

    const dotRegex = new RegExp("\\b" + v + "\\.", 'g');
    sliceText = sliceText.replace(dotRegex, '');
  }

  if (file === 'filesystem.js') {
    combinedContent += `const execPromiseSave = promisifySave(require('child_process').exec);\n\n`;
  }
  if (file === 'system.js') {
    combinedContent += `const execPromise = promisify(require('child_process').exec);\n\n`;
  }
  if (file === 'bluetoothVendors.js') {
    sliceText = sliceText.replace(/^\s*module\.exports\s*=\s*{/, 'const bluetoothVendors = {');
  }
  if (file === 'battery.js') {
    sliceText = sliceText.replace(
      /^\s*module\.exports\s*=\s*function\s*\([^)]*\)\s*\{?/m,
      '\nfunction battery(callback) {'
    );
  }

  combinedContent += `// --- ${file} ---\n`;
  combinedContent += sliceText + '\n\n';
}

const header = `'use strict';

const lib_version = "5.27.10"
const os = require('os');
const spawn = require('child_process').spawn;
const exec = require('child_process').exec;
const execSync = require('child_process').execSync;
const path = require('path');
const fs = require('fs');
const util = require('util');

let _platform = process.platform;

const _linux = (_platform === 'linux' || _platform === 'android');
const _darwin = (_platform === 'darwin');
const _windows = (_platform === 'win32');
const _freebsd = (_platform === 'freebsd');
const _openbsd = (_platform === 'openbsd');
const _netbsd = (_platform === 'netbsd');
const _sunos = (_platform === 'sunos');

let _nvidiaSmiPath = '';

`;

(async () => {
  const finalContent = header + combinedContent;

  fs.writeFileSync(outputFile, finalContent, 'utf8');
  console.log('File combinato scritto in', outputFile);

  try {
    const result = await terser.minify(finalContent, {
      compress: true,
      mangle: true
    });
    fs.writeFileSync(outputFileMin, result.code, 'utf8');
    console.log('File minificato scritto in', outputFileMin);
  } catch (err) {
    console.error('Errore durante la minificazione con terser:', err);
  }
})();