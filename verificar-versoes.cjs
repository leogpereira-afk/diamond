// Guarda: a versão das URLs (?v=N) tem de bater com o cache do service worker
// (diamond-pages-vN). Divergir faz a tela nova carregar arquivo velho — 21/09/2026.
const fs=require('fs'),test=require('node:test'),assert=require('node:assert/strict');
test('?v= do index/sw bate com a versão do cache do service worker',()=>{
  const sw=fs.readFileSync('sw.js','utf8'),html=fs.readFileSync('index.html','utf8');
  const cache=sw.match(/diamond-pages-v(\d+)/)[1];
  const versoes=new Set([...sw.matchAll(/\?v=(\d+)/g),...html.matchAll(/\?v=(\d+)/g)].map(m=>m[1]));
  assert.deepEqual([...versoes],[cache],'URLs em ?v='+[...versoes].join('/')+' mas cache em v'+cache);
});
