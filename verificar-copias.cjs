// Guarda: vagas-domain.js existe em DOIS lugares — a raiz (navegador e testes) e a
// pasta da função (servidor). Em 21/09/2026 editei só a raiz três vezes seguidas; o
// servidor ficou com a cópia velha e respondia "não é uma função" enquanto a tela,
// nova, parecia certa. As duas têm de ser idênticas byte a byte.
const fs=require('fs'),test=require('node:test'),assert=require('node:assert/strict');
test('a cópia de vagas-domain.js da função é idêntica à da raiz',()=>{
  const raiz=fs.readFileSync('vagas-domain.js','utf8'),funcao=fs.readFileSync('supabase/functions/dmd-api/vagas-domain.js','utf8');
  assert.equal(funcao,raiz,'as cópias divergem: rode  cp vagas-domain.js supabase/functions/dmd-api/vagas-domain.js  e publique a função');
});
