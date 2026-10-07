import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { source, copy, backend, store } from './helpers.mjs';

const context = vm.createContext({ window: {} });
vm.runInContext(source('proposta-domain.js'), context);
vm.runInContext(source('plano.js'), context);
const { tabelas, diluir, comissao } = context.window.DiamondProposta;
const unidade = { id: 'u-403', unidade: '403', precoBase: 324480, precoVersao: 'tabela-3', desconto: 0.05 };
const cfg = { tabelaId: 'tabela-3', versao: 'v3', dataTabela: '07/10/2026', reajuste: 0 };
const primeira = {
  id: 'tabela-2', versaoAnterior: 'v1', versaoNova: 'v2', dataTabela: '05/10/2026',
  cfgAntes: { versao: 'v1', dataTabela: '01/07/2026', reajuste: 0.04 },
  cfgDepois: { tabelaId: 'tabela-2', versao: 'v2', dataTabela: '05/10/2026', reajuste: 0 },
  origem: 'regularizacao_legado',
  itens: [{ id: 'u-403', unidade: '403', anterior: 300000, novo: 312000, exibidoAntes: 312000, desconto: 0.1 }],
};
const segunda = {
  id: 'tabela-3', versaoAnterior: 'v2', versaoNova: 'v3', dataTabela: '07/10/2026',
  cfgAntes: { tabelaId: 'tabela-2', versao: 'v2', dataTabela: '05/10/2026' },
  cfgDepois: cfg,
  itens: [{ id: 'u-403', unidade: '403', anterior: 312000, novo: 324480, desconto: 0.05 }],
};

test('oferece atual, histórico e tabela inicial reconstruída com preço e desconto da época', () => {
  const rows = tabelas(unidade, cfg, [segunda, primeira]);
  assert.deepEqual(Array.from(rows, x => [x.key, x.versao, x.valorTabela, x.desconto, x.neg]), [
    ['atual', 'v3', 324480, 0.05, 308256],
    ['tabela:tabela-2', 'v2', 312000, 0.1, 280800],
    ['versao:["v1","01/07/2026"]', 'v1', 300000, 0.1, 270000],
  ]);
  assert.equal(rows[2].origem, 'reconstruida');
  assert.match(rows[2].observacao, /reconstruída/);
  assert.equal(rows[2].tabelaId, null);
});

test('preço materializado ignora multiplicador legado e unidade antiga ainda aplica reajuste', () => {
  assert.equal(tabelas(unidade, { ...cfg, reajuste: 0.04 })[0].valorTabela, 324480);
  assert.equal(tabelas({ ...unidade, precoBase: 300000, precoVersao: undefined }, { reajuste: 0.04 })[0].valorTabela, 312000);
});

test('regularização usa o preço base anterior, nunca o valor exibido com reajuste antigo', () => {
  const rows = tabelas(unidade, cfg, [primeira]);
  assert.equal(rows.find(x => x.versao === 'v1').valorTabela, 300000);
  const preservada = { ...primeira, itens: [{ ...primeira.itens[0], novo: 300000, status: 'Vendido' }] };
  assert.equal(tabelas(unidade, cfg, [preservada]).find(x => x.versao === 'v2').valorTabela, 300000);
});

test('identifica tabela por ID e não confunde IDs diferentes com mesma versão e data', () => {
  const repetida = copy(primeira);
  const outra = { ...copy(primeira), id: 'outra', cfgDepois: { ...primeira.cfgDepois, tabelaId: 'outra' } };
  const rows = tabelas(unidade, cfg, [primeira, repetida, outra]);
  assert.equal(rows.length, 4);
  assert.deepEqual(Array.from(rows.filter(x => x.versao === 'v2'), x => x.tabelaId), ['tabela-2', 'outra']);
});

test('versão sem ID deduplica por versão e data, sem esconder outra data', () => {
  const outroAntes = { ...copy(primeira), cfgAntes: { versao: 'v1', dataTabela: '02/07/2026' } };
  const rows = tabelas(unidade, cfg, [primeira, copy(primeira), outroAntes]);
  assert.deepEqual(Array.from(rows.filter(x => x.versao === 'v1'), x => x.dataTabela), ['01/07/2026', '02/07/2026']);
  const atualSemId = { versao: 'v2', dataTabela: '05/10/2026' };
  assert.equal(tabelas({ ...unidade, precoVersao: undefined }, atualSemId, [primeira]).filter(x => x.versao === 'v2').length, 1);
});

test('não inventa preço histórico para unidade ausente ou de outro ID', () => {
  const outraUnidade = { ...unidade, id: 'u-outra' };
  assert.equal(tabelas(outraUnidade, cfg, [primeira, segunda]).length, 1);
  assert.deepEqual(copy(tabelas(null, cfg, [primeira])), []);
  assert.deepEqual(copy(tabelas({ id: 'sem-preco' }, cfg, [primeira])), []);
});

test('omite preços e descontos inválidos, preservando zero explicitamente registrado', () => {
  for (const precoBase of [null, undefined, '', 'abc', Infinity, NaN, -1, {}, true]) {
    assert.equal(tabelas({ ...unidade, precoBase }, cfg).length, 0);
  }
  for (const desconto of ['abc', Infinity, NaN, -0.1, 1.1, {}]) {
    assert.equal(tabelas({ ...unidade, desconto }, cfg).length, 0);
  }
  assert.equal(tabelas({ ...unidade, precoBase: 0, desconto: 0 }, cfg)[0].neg, 0);
  for (const novo of [null, undefined, '', NaN, Infinity, -1]) {
    const invalid = { ...primeira, itens: [{ ...primeira.itens[0], novo }] };
    assert.equal(tabelas(unidade, cfg, [invalid]).some(x => x.versao === 'v2'), false);
  }
});

test('seleção é snapshot sem mutar configuração, unidade ou histórico', () => {
  const u = copy(unidade), c = copy(cfg), hist = copy([segunda, primeira]);
  const before = copy({ u, c, hist });
  const rows = tabelas(u, c, hist);
  rows[0].neg = 1; rows[1].versao = 'alterada';
  assert.deepEqual({ u, c, hist }, before);
  u.precoBase = 999; hist[1].itens[0].novo = 999;
  assert.equal(rows[0].valorTabela, 324480);
  assert.equal(rows[1].valorTabela, 312000);
});

test('diluição preserva entrada, prazo e valor total e elimina final e balões do cronograma', () => {
  const inp = { forma: 'perso', entradaPct: 20, finalPct: 40, nParcelas: 30, balQtde: 5, balValor: 10000, balPrimeiro: 6, balIntervalo: 6, chavesMes: 36, cliente: 'Teste' };
  const changed = diluir(inp);
  const plano = context.window.PLANO.calc({ ...changed, neg: 300000, entradaPct: changed.entradaPct / 100, finalPct: changed.finalPct / 100, dataProposta: new Date('2026-10-07T12:00:00') });
  assert.equal(changed.entradaPct, 20); assert.equal(changed.nParcelas, 30); assert.equal(changed.cliente, 'Teste');
  assert.equal(inp.finalPct, 40); assert.equal(inp.balQtde, 5); assert.notEqual(changed, inp);
  assert.equal(plano.ent, 60000); assert.equal(plano.vParc, 8000); assert.equal(plano.totalNominal, 300000);
  assert.equal(plano.fecha, true); assert.equal(plano.fin, 0); assert.equal(plano.balQtde, 0);
  assert.ok(plano.cronograma.every(linha => !linha.chaves && !linha.balao));
});

test('diluição rejeita prazo inválido e pode ser repetida sem mudar condições', () => {
  for (const nParcelas of [undefined, null, '', 'x', 0, -1, 0.5, 2.5, Infinity, NaN, true]) {
    assert.throws(() => diluir({ nParcelas }), /parcelas mensais/);
  }
  const uma = diluir({ forma: '24x', nParcelas: 24, entradaPct: 25 });
  assert.equal(uma.forma, 'perso');
  assert.deepEqual(copy(diluir(uma)), copy(uma));
});

test('comissão usa condições salvas e sem comissão zera dedução sem mudar preço negociado', () => {
  const cfgAtual = { corretagem: 0.06, quemPaga: 'Construtora' };
  assert.deepEqual(copy(comissao({}, cfgAtual, 300000)), { percentual: 6, valor: 18000, quemPaga: 'Construtora', liquido: 282000 });
  assert.deepEqual(copy(comissao({ corretagemPct: 5, quemPagaCorretagem: 'Construtora' }, cfgAtual, 300000)), { percentual: 5, valor: 15000, quemPaga: 'Construtora', liquido: 285000 });
  assert.deepEqual(copy(comissao({ semComissao: true, corretagemPct: 5 }, cfgAtual, 300000)), { percentual: 0, valor: 0, quemPaga: 'Construtora', liquido: 300000 });
  assert.equal(comissao({ corretagemPct: 0 }, cfgAtual, 300000).valor, 0);
});

test('comissão paga pelo comprador não reduz o líquido da construtora', () => {
  const inp = { corretagemPct: 5, quemPagaCorretagem: 'Comprador' };
  assert.deepEqual(copy(comissao(inp, { corretagem: 0.06, quemPaga: 'Construtora' }, 300000)), { percentual: 5, valor: 15000, quemPaga: 'Comprador', liquido: 300000 });
  assert.deepEqual(inp, { corretagemPct: 5, quemPagaCorretagem: 'Comprador' });
});

test('comissão recusa valores financeiros não finitos e percentuais fora da faixa', () => {
  for (const neg of [undefined, null, '', -1, NaN, Infinity]) assert.throws(() => comissao({}, {}, neg), /Valor negociado inválido/);
  for (const corretagemPct of [-1, 101, NaN, Infinity, 'x']) assert.throws(() => comissao({ corretagemPct }, {}, 300000), /Percentual de comissão inválido/);
  assert.equal(comissao({}, {}, 0).liquido, 0);
});

test('snapshot, diluição e comissão atravessam armazenamento local e backend sem perder autoria', async () => {
  const tabela = copy(tabelas(unidade, cfg, [primeira]).find(x => x.versao === 'v2'));
  const inp = { ...copy(diluir({ forma: 'perso', nParcelas: 30, entradaPct: 20, finalPct: 40, balQtde: 5, balValor: 10000 })), semComissao: true, corretagemPct: 5, quemPagaCorretagem: 'Construtora' };
  const proposta = { id: 'p-precos', unidadeId: unidade.id, cliente: 'Teste', corretor: 'Teste', corretorUsuario: 'domo', neg: tabela.neg, tabela, inp };
  const b = backend();
  const saved = await b.request('upsertProposta', { proposta });
  assert.equal(saved.status, 200); assert.equal(saved.ok, true);
  const reread = (await b.request('listPropostas')).propostas[0];
  assert.deepEqual(reread.tabela, tabela); assert.deepEqual(reread.inp, inp);
  assert.equal(reread.corretorUsuario, 'domo'); assert.equal(reread.neg, 280800);
  const { s, mem } = store(async () => ({ ok: true, json: async () => ({ ok: true }) }));
  s.salvarProposta(proposta);
  const local = JSON.parse(mem.get('dv_propostas'))[0];
  assert.deepEqual(local.tabela, tabela); assert.deepEqual(local.inp, inp);
});
