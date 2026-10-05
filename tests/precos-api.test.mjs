import test from 'node:test';
import assert from 'node:assert/strict';
import { backend, copy, source } from './helpers.mjs';

const args = { percentual: 4, dataTabela: '05/10/2026', modo: 'reajustar' };
const op = n => `precos-operacao-${String(n).padStart(8, '0')}`;
function prepararBackend(options = {}) {
  const b = backend(options);
  b.table('cfg').set('cfg', { versao: 'v1', dataTabela: '01/07/2026', reajuste: 0, empTitulo: 'Diamond', corretorGeralHash: 'SEGREDO', atualizadoEm: '2026-10-01T00:00:00Z' });
  b.table('unidades').get('u-1').desconto = 0.05;
  b.table('unidades').get('u-2').precoBase = 350000.4375;
  b.table('unidades').set('u-3', { id: 'u-3', unidade: '3', status: 'Reservado', precoBase: 410123.45, desconto: 0.1, reserva: { cliente: 'NOME PRIVADO', telefone: 'TELEFONE PRIVADO' }, vendedorNome: 'CORRETOR PRIVADO' });
  b.table('unidades').set('u-4', { id: 'u-4', unidade: '4', status: 'Disponível', precoBase: 0 });
  return b;
}
const previa = async (b, a = args) => { const r = await b.request('precosPrevia', a, 'admin'); assert.equal(r.status, 200, r.erro); return r.previa; };
const aplicar = async (b, n = 1, a = args, p) => b.request('precosAplicar', { ...a, token: (p || await previa(b, a)).token, operacaoId: op(n) }, 'admin');
const negocios = u => { const { precoVersao, atualizadoEm, atualizadoPor, ...resto } = u; return resto; };

test('prévia é somente leitura, completa, sem dados de clientes nem credenciais', async () => {
  const b = prepararBackend(), antes = copy([...b.table('unidades')]), cfg = copy(b.table('cfg').get('cfg'));
  const p = await previa(b);
  assert.equal(p.versaoNova, 'v2'); assert.equal(p.qtdAlteradas, 1); assert.equal(p.qtdPreservadas, 3);
  assert.equal(p.itens[0].novo, 312000); assert.equal(p.itens[0].desconto, .05);
  assert.doesNotMatch(JSON.stringify(p), /PRIVADO|SEGREDO|senha|corretorGeralHash/);
  assert.deepEqual([...b.table('unidades')], antes); assert.deepEqual(b.table('cfg').get('cfg'), cfg); assert.equal(b.table('precos_historico').size, 0);
});
test('aplica só disponíveis, preserva desconto/negócios, cria nova versão e comparação', async () => {
  const b = prepararBackend(), vendida = copy(b.table('unidades').get('u-2')), reservada = copy(b.table('unidades').get('u-3'));
  const r = await aplicar(b);
  assert.equal(r.status, 200, r.erro); assert.equal(r.cfg.versao, 'v2'); assert.equal(r.cfg.dataTabela, args.dataTabela); assert.equal(r.cfg.reajuste, 0); assert.equal(r.cfg.corretorGeralHash, undefined);
  assert.equal(b.table('unidades').get('u-1').precoBase, 312000); assert.equal(b.table('unidades').get('u-1').desconto, .05);
  assert.deepEqual(negocios(b.table('unidades').get('u-2')), vendida); assert.deepEqual(negocios(b.table('unidades').get('u-3')), reservada);
  assert.ok(r.unidades.every(u => u.precoVersao === op(1)));
  const h = (await b.request('precosHistorico', {}, 'admin')).historico;
  assert.equal(h.length, 1); assert.equal(h[0].itens[0].anterior, 300000); assert.equal(h[0].itens[0].novo, 312000);
  assert.equal(h[0].por, 'admin'); assert.ok(h[0].criadoEm); assert.equal(h[0].solicitacaoHash, undefined); assert.doesNotMatch(JSON.stringify(h), /PRIVADO|SEGREDO/);
});
test('regulariza os 4% antigos uma só vez e corrige exibição de vendidas/reservadas', async () => {
  const b = prepararBackend(); b.table('cfg').get('cfg').reajuste = .04;
  assert.equal((await b.request('precosPrevia', args, 'admin')).status, 409);
  const a = { ...args, modo: 'regularizar' }, p = await previa(b, a);
  assert.equal(p.qtdCorrigidas, 2); assert.equal(p.itens[0].exibidoAntes, p.itens[0].novo);
  const r = await aplicar(b, 1, a, p); assert.equal(r.status, 200, r.erro);
  assert.equal(b.table('unidades').get('u-1').precoBase, 312000);
  assert.equal(b.table('unidades').get('u-2').precoBase, 350000.4375); assert.equal(b.table('unidades').get('u-3').precoBase, 410123.45);
  assert.equal(r.historico.origem, 'regularizacao_legado'); assert.match(r.historico.observacao, /reconstruída/);
  const repetida = await aplicar(b, 1, a, p); assert.equal(repetida.status, 200); assert.equal(repetida.repetida, true); assert.equal(b.table('precos_historico').size, 1);
  assert.equal((await b.request('precosPrevia', a, 'admin')).status, 409);
});
test('histórico mantém frações de centavo existentes e arredonda só o novo preço disponível', async () => {
  const b = prepararBackend(); b.table('unidades').get('u-1').precoBase = 100.0049;
  const p = await previa(b); const disp = p.itens.find(u => u.id === 'u-1'), vend = p.itens.find(u => u.id === 'u-2');
  assert.equal(disp.anterior, 100.0049); assert.equal(disp.novo, 104.01); assert.equal(vend.anterior, 350000.4375); assert.equal(vend.novo, vend.anterior);
  const r = await aplicar(b, 1, args, p); assert.equal(r.status, 200); assert.equal(r.historico.itens.find(u => u.id === 'u-2').novo, b.table('unidades').get('u-2').precoBase);
});
test('reajuste futuro compõe sobre preço materializado e reserva preserva preço', async () => {
  const b = prepararBackend(); await aplicar(b);
  const old = copy(b.table('unidades').get('u-1')); b.table('unidades').set('u-1', { ...old, status: 'Reservado' });
  const r = await aplicar(b, 2); assert.equal(r.status, 200); assert.equal(r.cfg.versao, 'v3'); assert.equal(b.table('unidades').get('u-1').precoBase, 312000);
  b.table('unidades').get('u-1').status = 'Disponível';
  assert.equal((await aplicar(b, 3)).status, 200); assert.equal(b.table('unidades').get('u-1').precoBase, 324480);
});
test('todos os endpoints de preços exigem administrador', async () => {
  const b = prepararBackend();
  for (const user of ['domo', 'cliente', null]) for (const action of ['precosPrevia', 'precosAplicar', 'precosHistorico']) assert.equal((await b.request(action, args, user)).status, 403);
});
test('recusa percentuais/datas inválidos e token alterado sem gravar', async () => {
  const b = prepararBackend();
  for (const percentual of [-1, 0, '', null, 'abc', 1001]) assert.equal((await b.request('precosPrevia', { ...args, percentual }, 'admin')).status, 400);
  for (const dataTabela of ['31/02/2026', '2026-10-05', '05/13/2026', '']) assert.equal((await b.request('precosPrevia', { ...args, dataTabela }, 'admin')).status, 400);
  assert.equal((await b.request('precosAplicar', { ...args, token: 'a'.repeat(64), operacaoId: op(1) }, 'admin')).status, 409);
  assert.equal(b.table('precos_historico').size, 0);
});
test('prévia fica obsoleta se preço, desconto, status ou configuração mudar', async () => {
  for (const alterar of [b => b.table('unidades').get('u-1').precoBase++, b => b.table('unidades').get('u-1').desconto = .1, b => b.table('unidades').get('u-1').status = 'Vendido', b => b.table('cfg').get('cfg').empTitulo = 'Novo']) {
    const b = prepararBackend(), p = await previa(b); alterar(b);
    assert.equal((await aplicar(b, 1, args, p)).status, 409); assert.equal(b.table('precos_historico').size, 0); assert.equal(b.table('cfg').get('cfg').versao, 'v1');
  }
});
test('CAS detecta venda concorrente entre prévia revalidada e transação', async () => {
  const b = prepararBackend({ beforePrecoCommit: ({ table }) => { table('unidades').get('u-1').status = 'Vendido'; } });
  const r = await aplicar(b); assert.equal(r.status, 409); assert.equal(b.table('unidades').get('u-1').precoBase, 300000); assert.equal(b.table('cfg').get('cfg').versao, 'v1'); assert.equal(b.table('precos_historico').size, 0);
});
test('falha no commit não deixa preços, config ou histórico parcialmente gravados', async () => {
  const b = prepararBackend({ failPrecoCommit: true }), antes = copy([...b.table('unidades')]), cfg = copy(b.table('cfg').get('cfg'));
  assert.equal((await aplicar(b)).status, 503); assert.deepEqual([...b.table('unidades')], antes); assert.deepEqual(b.table('cfg').get('cfg'), cfg); assert.equal(b.table('precos_historico').size, 0);
});
test('duas confirmações concorrentes não duplicam aumento nem histórico', async () => {
  const b = prepararBackend(), p = await previa(b);
  const r = await Promise.all([aplicar(b, 1, args, p), aplicar(b, 2, args, p)]);
  assert.equal(r.filter(x => x.status === 200).length, 1); assert.equal(r.filter(x => x.status === 409).length, 1); assert.equal(b.table('precos_historico').size, 1); assert.equal(b.table('unidades').get('u-1').precoBase, 312000);
});
test('mesmo ID concorrente é idempotente; mesmo ID com outro percentual é recusado', async () => {
  const b = prepararBackend(), p = await previa(b);
  const r = await Promise.all([aplicar(b, 1, args, p), aplicar(b, 1, args, p)]); assert.ok(r.every(x => x.status === 200)); assert.equal(b.table('precos_historico').size, 1);
  assert.equal((await aplicar(b, 1, { ...args, percentual: 5 }, p)).status, 409);
});
test('config/foto obsoleta não restaura multiplicador nem versão e não revela senha', async () => {
  const b = prepararBackend(), antiga = copy(b.table('cfg').get('cfg')); await aplicar(b);
  const r = await b.request('setCfg', { cfg: { ...antiga, reajuste: .04, fotosTipo: { '01': 'foto-nova' } } }, 'admin');
  assert.equal(r.status, 200, r.erro); assert.equal(r.cfg.versao, 'v2'); assert.equal(r.cfg.reajuste, 0); assert.equal(r.cfg.tabelaId, op(1)); assert.equal(r.cfg.fotosTipo['01'], 'foto-nova'); assert.equal(r.cfg.corretorGeralHash, undefined); assert.equal(b.table('cfg').get('cfg').corretorGeralHash, 'SEGREDO');
});
test('CAS de configuração impede que uma gravação em voo desfaça nova tabela', async () => {
  const b = prepararBackend({ beforeCfgCommit: ({ table }) => { table('cfg').get('cfg').tabelaId = 'outra-versao'; table('cfg').get('cfg').versao = 'v9'; } });
  assert.equal((await b.request('setCfg', { cfg: { empTitulo: 'Novo' } }, 'admin')).status, 409); assert.equal(b.table('cfg').get('cfg').versao, 'v9');
});
test('upsert financeiro antigo devolve servidor mesmo com relógio futuro; edição geral funciona', async () => {
  const b = prepararBackend(), antiga = copy(b.table('unidades').get('u-1')); await aplicar(b);
  const r = await b.request('upsert', { unidade: { ...antiga, atualizadoEm: '2099-01-01T00:00:00Z' } }, 'admin');
  assert.equal(r.status, 200); assert.equal(r.conflito, true); assert.equal(r.servidor.precoBase, 312000); assert.equal(b.table('unidades').get('u-1').precoBase, 312000);
  const atual = copy(r.servidor); const geral = await b.request('upsert', { unidade: { ...atual, precoVersao: 'versao-antiga', obs: 'Observação nova', atualizadoEm: '2099-01-01T00:00:00Z' } }, 'admin');
  assert.equal(geral.status, 200); assert.equal(geral.unidade.obs, 'Observação nova'); assert.equal(geral.unidade.precoVersao, op(1));
});
test('unidade nova recebe a tabela atual, preservando preço informado e compatibilidade de criação', async () => {
  const b = prepararBackend(); await aplicar(b);
  const r = await b.request('upsert', { unidade: { unidade: '999', status: 'Disponível', precoBase: 420123.45, desconto: .05, precoVersao: 'forjada' } }, 'admin');
  assert.equal(r.status, 200, r.erro); assert.equal(r.unidade.id, 'u-999'); assert.equal(r.unidade.precoVersao, op(1)); assert.equal(r.unidade.precoBase, 420123.45);
  assert.ok((await b.request('list', {}, 'admin')).unidades.every(u => u.precoVersao === op(1)));
  const novoReajuste = await aplicar(b, 2); assert.equal(novoReajuste.status, 200); assert.equal(b.table('unidades').get('u-999').precoBase, 436928.39);
  const antiga = prepararBackend(); const novo = await antiga.request('upsert', { unidade: { unidade: '999', status: 'Disponível', precoBase: 300000, precoVersao: 'forjada' } }, 'admin');
  assert.equal(novo.status, 200); assert.equal(novo.unidade.precoVersao, undefined);
});
test('duas criações concorrentes da mesma unidade não sobrescrevem a vencedora', async () => {
  const b = prepararBackend(); await aplicar(b);
  const r = await Promise.all([300000, 400000].map(precoBase => b.request('upsert', { unidade: { unidade: '999', status: 'Disponível', precoBase } }, 'admin')));
  assert.equal(r.filter(x => x.ok).length, 1); assert.equal(r.filter(x => x.conflito).length, 1);
  const servidor = r.find(x => x.conflito).servidor; assert.equal(servidor.precoVersao, op(1)); assert.deepEqual(servidor, b.table('unidades').get('u-999'));
});
test('migração restringe RPCs ao servidor e mantém histórico no backup', () => {
  const sql = source('supabase/migrations/202610051300_tabelas_precos.sql');
  assert.match(sql, /for update/); assert.match(sql, /grant execute on function public\.dmd_precos_aplicar\([^;]+ to service_role/); assert.match(sql, /revoke all on function public\.dmd_precos_aplicar\([^;]+ from public,anon,authenticated/);
  assert.match(source('supabase/functions/dmd-api/api-core.mjs'), /const ORDEM = \[[^\]]*'precos_historico'/);
});
