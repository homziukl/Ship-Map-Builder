#!/usr/bin/env node
// ============================================================
// Ship Map Builder — Build Script
// Concatenates modular source files into a single shipmap.user.js
// Usage: node build.js
// ============================================================

const fs = require('fs');
const path = require('path');

// === CONCATENATION ORDER ===
// header.js is special — placed BEFORE the IIFE wrapper.
// All other modules are concatenated inside the IIFE in this order.
const HEADER_FILE = 'header.js';

const MODULES = [
    { file: 'utils/constants.js',     label: 'CONSTANTS' },
    { file: 'utils/helpers.js',       label: 'HELPERS' },
    { file: 'utils/lifecycle.js',     label: 'LIFECYCLE' },
    { file: 'utils/match-index.js',   label: 'MATCH INDEX' },
    { file: 'utils/site-settings.js', label: 'SITE SETTINGS' },
    { file: 'state.js',              label: 'STATE' },
    { file: 'api/ssp.js',            label: 'SSP API' },
    { file: 'api/yms.js',            label: 'YMS API' },
    { file: 'api/vista.js',          label: 'VISTA API' },
    { file: 'api/stem.js',           label: 'STEM API' },
    { file: 'api/fmc.js',            label: 'FMC API' },
    { file: 'api/dockmaster.js',     label: 'DOCKMASTER API' },
    { file: 'api/relat.js',          label: 'RELAT API' },
    { file: 'views/map-manager.js',  label: 'MAP MANAGER' },
    { file: 'git-sync.js',           label: 'GIT SYNC' },
    { file: 'app.js',                label: 'APP' },
];

const OUTPUT_FILE = 'ship map builder.user.js';
const SEPARATOR = '// ============================================================';

// === VALIDATION ===
const baseDir = __dirname;
const allFiles = [HEADER_FILE, ...MODULES.map(m => m.file)];
const missing = allFiles.filter(f => !fs.existsSync(path.join(baseDir, f)));

if (missing.length > 0) {
    console.error('❌ BUILD FAILED — missing source files:');
    missing.forEach(f => console.error(`   • ${f}`));
    process.exit(1);
}

// === BUILD ===
const parts = [];

// 1. Header (outside IIFE)
const headerContent = fs.readFileSync(path.join(baseDir, HEADER_FILE), 'utf8').trimEnd();
parts.push(headerContent);
parts.push('');

// 2. IIFE open
parts.push('(function () {');
parts.push("'use strict';");
parts.push('');

// 3. Modules (inside IIFE)
for (const mod of MODULES) {
    const filePath = path.join(baseDir, mod.file);
    const content = fs.readFileSync(filePath, 'utf8').trimEnd();

    // Section separator comment
    parts.push(SEPARATOR);
    parts.push(`// ${mod.label} — source: ${mod.file}`);
    parts.push(SEPARATOR);
    parts.push(content);
    parts.push('');
}

// 4. IIFE close
parts.push('})();');

// === WRITE OUTPUT ===
const output = parts.join('\n');
const outputPath = path.join(baseDir, OUTPUT_FILE);
fs.writeFileSync(outputPath, output, 'utf8');

// === REPORT ===
const sizeKB = (Buffer.byteLength(output, 'utf8') / 1024).toFixed(1);
const lineCount = output.split('\n').length;
console.log('');
console.log('✅ BUILD SUCCESS');
console.log(`   Files:  ${allFiles.length} modules concatenated`);
console.log(`   Output: ${outputPath}`);
console.log(`   Size:   ${sizeKB} KB (${lineCount} lines)`);
console.log('');
