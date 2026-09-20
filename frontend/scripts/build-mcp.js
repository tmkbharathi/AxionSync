const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

const outDir = path.resolve(__dirname, '..', '..', 'packages', 'axionsync-mcp', 'bin');
fs.mkdirSync(outDir, { recursive: true });

esbuild.buildSync({
  entryPoints: [path.resolve(__dirname, '..', 'src', 'lib', 'mcp', 'cli.ts')],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  outfile: path.join(outDir, 'index.cjs'),
});

let content = fs.readFileSync(path.join(outDir, 'index.cjs'), 'utf8');
content = content.replace(/^(#![^\r\n]*[\r\n]+)+/, '');
content = '#!/usr/bin/env node\n' + content;
fs.writeFileSync(path.join(outDir, 'index.cjs'), content, 'utf8');

console.log('Successfully built standalone axionsync-mcp package into packages/axionsync-mcp/bin/index.cjs');
