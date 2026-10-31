import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = name => fs.readFileSync(new URL('../' + name, import.meta.url), 'utf8');
const unidade = (id, status, extra = {}) => ({ id, unidade: id, andar: 1, status, precoBase: 100, clienteId: 'c-' + id, atualizadoEm: 'rev-' + id, ...extra });
const apartamentos = [unidade('101', 'Disponível'), unidade('102', 'Reservado'), unidade('103', 'Vendido')];
const loja = status => unidade('loja', status, { unidade: ' LOJA ', andar: 0, precoBase: 500 });
const condicao = u => ({ unidadeId: u.id, clienteId: u.clienteId, unidadeRevisao: u.atualizadoEm, total: 10001, entrada: 1, permutas: [{ descricao: 'Bem sintético', valor: 2000 }], parcelas: [{ valor: 4000, quantidade: 2 }], data: '2026-10-01' });

function painel(unidades, query = 'visao=resumo', options = {}) {
  let exportHandler, exported;
  const ctx = vm.createContext({ Intl, Date, URLSearchParams, location: { hash: '#/admin/painel?' + query }, STORE: { getUsuarios: () => [], getCfg: () => ({}) }, Blob: class { constructor(parts) { exported = parts.join(''); } }, URL: { createObjectURL: () => 'blob:synthetic', revokeObjectURL() {} }, document: { createElement: () => ({ click() {} }) }, setTimeout: () => {} });
  ctx.window = ctx;
  for (const file of ['gestao-domain.js', 'gestao-insights.js', 'gestao-painel.js']) vm.runInContext(source(file), ctx);
  const x = { unidades, condicoes: unidades.filter(u => u.status === 'Vendido').map(condicao), leads: [], historico: [], visao: new URLSearchParams(query).get('visao'), conditionsOk: true, unitsOk: true, coverage: '', model: { retornosCRM: [], pedidos: [], retornosEnvios: [] }, ...options };
  const html = ctx.DiamondPainel.render(x);
  return { html, m: x.insights, exportCSV() { ctx.DiamondPainel.wire({ querySelector: selector => selector === '#di-export' ? { addEventListener: (_, fn) => { exportHandler = fn; } } : null, querySelectorAll: () => [] }, () => {}); exportHandler(); return exported; } };
}

test('adicionar loja em qualquer situação não altera contagem nem percentuais de apartamentos', () => {
  const baseline = painel(apartamentos).m.apartamentos;
  for (const status of ['Disponível', 'Reservado', 'Vendido']) {
    const { m } = painel([...apartamentos, loja(status)]);
    assert.equal(m.apartamentos.total, 3);
    assert.equal(m.apartamentos.percentualVendido, 100 / 3);
    assert.equal(m.apartamentos.percentualVendido, baseline.percentualVendido);
    for (const key of ['vendidas', 'disponiveis', 'reservadas']) assert.equal(m.apartamentos[key].length, baseline[key].length);
    assert.equal(m.lojas.total, 1);
    assert.equal(m.filtered.length, 4);
    assert.equal(m.vendas.length, status === 'Vendido' ? 2 : 1);
    assert.equal(m.total, status === 'Vendido' ? 20002 : 10001);
    assert.equal(m.entrada + m.permuta + m.parcelado, m.total);
  }
});

test('loja sem preço não altera potencial nem cobertura dos apartamentos', () => {
  const { m } = painel([...apartamentos, { ...loja('Disponível'), precoBase: null }]);
  assert.equal(m.apartamentos.potencial, 10000);
  assert.equal(m.apartamentos.semPreco, 0);
  assert.equal(m.semPreco, 1);
  assert.equal(m.disponiveis.length, 2);
});

test('gráfico e indicadores de apartamentos navegam para recorte sem loja', () => {
  const { html } = painel([...apartamentos, loja('Vendido'), unidade('104', 'Em análise')]);
  const chart = html.match(/<ul class="di-stocklist">([\s\S]*?)<\/ul>/)?.[1];
  assert.ok(chart);
  const hrefs = [...chart.matchAll(/href="([^"]+)"/g)].map(m => m[1].replaceAll('&amp;', '&'));
  assert.equal(hrefs.length, 4);
  for (const href of hrefs) {
    const query = new URLSearchParams(href.split('?')[1]);
    assert.equal(query.get('tipo'), 'apartamento');
    const recorte = painel([...apartamentos, loja('Vendido'), unidade('104', 'Em análise')], query.toString()).m;
    assert.ok(recorte.filtered.every(r => r.tipo === 'apartamento'));
  }
  assert.match(html, /Apartamentos vendidos[\s\S]*?<strong>1<\/strong>[\s\S]*?25% dos apartamentos/);
  assert.match(html, /Loja comercial/);
  assert.match(html, /tipo=loja/);
});

test('filtro de loja e estoque sem apartamentos não inventam percentual', () => {
  for (const unidades of [[loja('Vendido')], [...apartamentos, loja('Vendido')]]) {
    for (const visao of ['resumo', 'estoque']) {
      const { html, m } = painel(unidades, 'visao=' + visao + '&tipo=loja');
      assert.equal(m.apartamentos.total, 0);
      assert.equal(m.apartamentos.percentualVendido, null);
      assert.equal(m.lojas.total, 1);
      assert.doesNotMatch(html, /class="di-stocklist"/);
      assert.doesNotMatch(html.replace(/<[^>]*>/g, ''), /100%|NaN|Infinity/);
      assert.match(html, /Loja comercial/);
      assert.match(html, /Valor vendido/);
      assert.equal(m.total, 10001);
    }
  }
  const empty = painel([]);
  assert.equal(empty.m.apartamentos.percentualVendido, null);
  assert.match(empty.html, /Nenhum apartamento neste recorte/);
});

test('período filtra vendas de apartamentos sem excluir loja dos valores globais', () => {
  const { m } = painel([...apartamentos, loja('Vendido')], 'visao=resumo&de=2026-10-02');
  assert.equal(m.apartamentos.vendas.length, 0);
  assert.equal(m.apartamentos.vendidas.length, 1);
  assert.equal(m.apartamentos.total, 3);
  assert.equal(m.apartamentos.percentualVendido, 100 / 3);
  assert.equal(m.total, 0);
  assert.equal(m.lojas.total, 1);
});

test('listas e CSV mantêm loja e apartamentos nos recortes globais', () => {
  const unidades = [...apartamentos, loja('Vendido')];
  for (const visao of ['vendas', 'estoque', 'compradores']) {
    const panel = painel(unidades, 'visao=' + visao);
    assert.match(panel.html, /LOJA/);
    const csv = panel.exportCSV();
    assert.match(csv, /" LOJA "/);
    assert.match(csv, /"103"/);
    assert.match(csv, /"100.01"/);
  }
  const { m } = painel(unidades, 'visao=estoque&tipo=apartamento');
  assert.equal(m.filtered.length, 3);
  assert.equal(m.lojas.total, 0);
});

test('falha na consulta da loja não apresenta valor de tabela como venda', () => {
  const { html } = painel([loja('Vendido')], 'visao=resumo&tipo=loja', { conditionsOk: false, condicoes: [] });
  const block = html.match(/<section class="di-card di-shop">([\s\S]*?)<\/section>/)?.[1];
  assert.match(block, /Base cadastrada/);
  assert.match(block, /Valor vendido<\/span><strong>Não consultado/);
  assert.doesNotMatch(html, /Estoque de apartamentos/);
});

test('loja vendida não transforma apartamento disponível em venda; recorte vazio permanece explícito', () => {
  const { m, html } = painel([apartamentos[0], loja('Vendido')]);
  assert.equal(m.apartamentos.percentualVendido, 0);
  assert.equal(m.apartamentos.vendas.length, 0);
  assert.match(html, /0% dos apartamentos neste recorte/);
  assert.equal(m.total, 10001);
  const emptyShop = painel([loja('Vendido')], 'visao=estoque&tipo=loja&status=Disponível');
  assert.match(emptyShop.html, /Nenhuma loja neste recorte/);
  assert.doesNotMatch(emptyShop.html, /Disponibilidade dos apartamentos|class="di-stocklist"/);
});

test('permuta integral aparece como pagamento, preservando composição e total', () => {
  const u = apartamentos[2], total = 12345678;
  const { m, html } = painel([u], 'visao=resumo', { condicoes: [{ ...condicao(u), total, entrada: 0, parcelas: [], permutas: [{ descricao: 'Imóvel sintético', valor: total }] }] });
  assert.equal(m.total, total);
  assert.equal(m.permuta, total);
  assert.equal(m.entrada + m.parcelado, 0);
  assert.equal(m.saldoAInformar, 0);
  assert.match(html, /1 venda com permuta na composição do pagamento/);
  assert.doesNotMatch(html, /bens na composição da entrada/);
});

test('loja distingue tabela vigente, preço da reserva e base cadastrada da venda', () => {
  for (const [status, label] of [['Disponível','Tabela atual'],['Reservado','Preço da reserva'],['Vendido','Base cadastrada']]) {
    const {html} = painel([{...loja(status), precoBase:500, desconto:.1}], 'visao=resumo&tipo=loja');
    const block = html.match(/<section class="di-card di-shop">([\s\S]*?)<\/section>/)?.[1];
    assert.ok(block.includes(label));
    assert.match(block, status === 'Vendido' ? /500,00/ : /450,00/);
    if (status !== 'Disponível') assert.doesNotMatch(block, /Tabela atual/);
  }
});
