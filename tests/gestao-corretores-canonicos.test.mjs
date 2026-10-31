import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function build(input, comCatalogo = true) {
  const context = vm.createContext({ Intl, Date });
  for (const file of ['gestao-domain.js', ...(comCatalogo ? ['corretores-domain.js'] : []), 'gestao-insights.js']) {
    vm.runInContext(fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8'), context);
  }
  return context.DiamondInsights.build(input);
}
const usuarios = [
  { usuario: 'domo', nome: 'Domo', papel: 'corretor', corretores: [{ nome: 'Leonardo' }] },
  { usuario: 'outra', nome: 'Outra Imobiliária', papel: 'corretor', corretores: [{ nome: 'Leonardo' }] },
];
const unidade = (id, nome, empresa, usuario) => ({ id, unidade: id, status: 'Vendido', clienteId: 'cliente-' + id, atualizadoEm: '2026-10-01', vendedorNome: nome, vendedorEmpresa: empresa, ...(usuario ? { vendedorUsuario: usuario } : {}) });
const condicao = (u, total) => ({ unidadeId: u.id, clienteId: u.clienteId, unidadeRevisao: u.atualizadoEm, total, entrada: total, permutas: [], parcelas: [], data: '2026-10-01' });

test('dashboard reúne grafias e empresa vazia/Domo no filtro e ranking sem alterar unidades', () => {
  const unidades = [unidade('101', 'leonardo', ''), unidade('102', 'LEONARDO', 'DOMO')];
  const antes = structuredClone(unidades);
  const input = { usuarios, unidades, condicoes: unidades.map((u, i) => condicao(u, 10000001 + i)), filtros: { corretor: 'Leonardo' } };
  const m = build(input);
  assert.equal(m.filtered.length, 2);
  assert.equal(new Set(m.rows.map(r => r.corretor)).size, 1);
  assert.equal(m.rows[0].corretor, 'Leonardo');
  assert.equal(m.rows[0].empresa, 'Domo');
  assert.equal(m.ranking.lista.length, 1);
  assert.equal(m.ranking.lista[0].nome, 'Leonardo');
  assert.equal(m.ranking.lista[0].vendas, 2);
  assert.equal(m.ranking.lista[0].total, 20000003);
  assert.equal(m.ranking.lista[0].cobertura, 2);
  assert.equal(build({ ...input, filtros: { corretor: 'leonardo' } }).filtered.length, 2);
  assert.deepEqual(unidades, antes);
});

test('corretores homônimos de equipes diferentes mantêm vendas e valores separados', () => {
  const unidades = [unidade('101', 'leonardo', ''), unidade('102', 'LEONARDO', 'Outra Imobiliária', 'outra')];
  const m = build({ usuarios, unidades, condicoes: [condicao(unidades[0], 10000001), condicao(unidades[1], 20000002)] });
  assert.equal(m.ranking.lista.length, 2);
  const domo = m.ranking.lista.find(r => r.empresa === 'Domo');
  const outra = m.ranking.lista.find(r => r.empresa === 'Outra Imobiliária');
  assert.ok(domo);
  assert.ok(outra);
  assert.equal(domo.nome, 'Leonardo');
  assert.equal(domo.vendas, 1);
  assert.equal(domo.total, 10000001);
  assert.equal(outra.nome, 'Leonardo');
  assert.equal(outra.vendas, 1);
  assert.equal(outra.total, 20000002);
});

test('modelo continua disponível quando carregado sem o módulo de catálogo', () => {
  const unidades = [unidade('101', 'Vendedor antigo', 'Equipe antiga')];
  const m = build({ unidades, condicoes: [condicao(unidades[0], 10000001)] }, false);
  assert.equal(m.ranking.lista[0].nome, 'Vendedor antigo');
  assert.equal(m.ranking.lista[0].empresa, 'Equipe antiga');
  assert.equal(m.total, 10000001);
});

test('equipes com mesmo nome mantêm identidade no ranking e no filtro por chave', () => {
  const usuarios = ['a', 'b'].map(usuario => ({ usuario, nome: 'Rede', papel: 'corretor', corretores: [{ nome: 'Ana' }] }));
  const unidades = [unidade('101', 'ana', 'Rede', 'a'), unidade('102', 'ANA', 'Rede', 'b')];
  const input = { usuarios, unidades, condicoes: [condicao(unidades[0], 10000001), condicao(unidades[1], 20000002)] };
  const m = build(input);
  assert.equal(m.ranking.lista.length, 2);
  assert.notEqual(m.rows[0].corretorChave, m.rows[1].corretorChave);
  const recorte = build({ ...input, filtros: { corretor: m.rows[1].corretorChave } });
  assert.equal(recorte.filtered.length, 1);
  assert.equal(recorte.filtered[0].u.id, '102');
  assert.equal(recorte.total, 20000002);
  assert.equal(recorte.ranking.lista[0].empresaUsuario, 'b');
});
