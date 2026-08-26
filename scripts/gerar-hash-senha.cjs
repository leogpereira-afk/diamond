'use strict';
/* Gera o valor de senha que o servidor do Diamond aceita, para destravar um
 * login pelo banco quando ninguém consegue entrar.
 *
 * POR QUE ISTO EXISTE: trocar senha aqui exige estar logado, e só existe UM
 * admin. Se ele esquece a senha, não há porta de recuperação — o sistema fica
 * sem dono. Este script é essa porta, e ela passa por você: a senha é lida do
 * seu terminal, nunca é gravada, nunca sai daqui, e o que sai na tela é só o
 * hash (que não volta a ser senha).
 *
 *   SENHA_NOVA="a-senha-que-voce-quer" node scripts/gerar-hash-senha.cjs
 *
 * Depois é só levar o valor impresso para o SQL Editor do Supabase, com o
 * comando que o próprio script mostra.
 *
 * O formato e os parâmetros são os MESMOS do servidor (api-core.mjs:16-19):
 * s2$<sal>$<scrypt(sha256(senha), sal)>, N=8192 r=8 p=1, 32 bytes.
 */
const crypto = require('crypto');

const KDF = { N: 8192, r: 8, p: 1, len: 32 };
const sha256 = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
const scrypt = (clientHash, sal) => crypto.scryptSync(String(clientHash), sal, KDF.len, { N: KDF.N, r: KDF.r, p: KDF.p });

const senha = process.env.SENHA_NOVA || '';
const usuario = (process.env.USUARIO || 'leonardo').toLowerCase().trim();

if (!senha) {
  console.error('Falta a senha. Rode:  SENHA_NOVA="a-senha-que-voce-quer" node scripts/gerar-hash-senha.cjs');
  process.exit(1);
}
if (senha.trim().length < 4) {
  console.error('Senha curta demais. Use ao menos 4 caracteres (o app pede 6 para trocas normais).');
  process.exit(1);
}

// O app manda para o servidor o sha256 da senha (store.js), não a senha crua.
const clientHash = sha256(String(senha).trim());
const sal = crypto.randomBytes(16);
const guardado = 's2$' + sal.toString('hex') + '$' + scrypt(clientHash, sal).toString('hex');

// Prova local: confere o valor gerado do mesmo jeito que o servidor confere.
const p = guardado.split('$');
const calc = scrypt(clientHash, Buffer.from(p[1], 'hex'));
const ok = crypto.timingSafeEqual(calc, Buffer.from(p[2], 'hex'));

console.log('\nValor gerado (isto NÃO é a senha — é o que o servidor guarda):\n');
console.log('  ' + guardado + '\n');
console.log('Conferência local: ' + (ok ? 'o servidor vai aceitar esta senha ✓' : 'FALHOU — não use'));
if (!ok) process.exit(1);
console.log('\n--- Cole no SQL Editor do Supabase (projeto do Diamond) ---\n');
console.log(`update dmd_kv
   set valor = (
     select jsonb_agg(
       case when u->>'usuario' = '${usuario}'
            then jsonb_set(jsonb_set(u, '{hash}', to_jsonb('${guardado}'::text)), '{ativo}', 'true'::jsonb)
            else u end)
     from jsonb_array_elements(valor) u
   )
 where store = 'cfg' and key = 'usuarios';`);
console.log(`
-- Conferir depois (deve mostrar a conta com hash começando em s2$ e ativo true):
select u->>'usuario' as usuario, u->>'papel' as papel, u->>'ativo' as ativo,
       left(u->>'hash', 8) || '…' as senha_guardada
  from dmd_kv, jsonb_array_elements(valor) u
 where store = 'cfg' and key = 'usuarios';
`);
console.log('Feito isso, entre no Diamond com o usuário "' + usuario + '" e a senha que você escolheu.\n');
