import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const server=readFileSync(new URL('../server.js',import.meta.url),'utf8');
test('preview routes require explicit opt-in',()=>assert.match(server,/process\.env\.FLOWPAY_ENABLE_REDESIGN_PREVIEW === '1'/));
test('preview only serves explicitly listed assets',()=>assert.match(server,/const previewAssets = new Map\(/));
test('production root still serves original index',()=>assert.match(server,/app\.get\('\/', \(_req, res\) => res\.sendFile\(path\.join\(__dirname, 'index\.html'\)\)\)/));
