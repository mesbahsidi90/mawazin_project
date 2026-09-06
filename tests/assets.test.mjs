import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
test('every fixed DOM reference has an element; IDs are unique',()=>{
  const html=readFileSync('dist/index.html','utf8'), js=readFileSync('dist/app.js','utf8');
  const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
  assert.equal(new Set(ids).size,ids.length);
  for(const match of js.matchAll(/\$\(['"]#([^'"]+)['"]\)/g)) assert.ok(ids.includes(match[1]),match[1]);
  for(const match of html.matchAll(/(?:src|href)="\.\/([^"?]+)"/g)) assert.ok(existsSync('dist/'+match[1]),match[1]);
});
test('service worker never caches API or authentication routes',()=>{
  const sw=readFileSync('dist/sw.js','utf8');
  assert.ok(sw.includes('!SHELL.includes(url.pathname)'));
  assert.ok(!sw.includes("'/api/"));
  assert.ok(sw.includes("redirect:'error'"));
});
