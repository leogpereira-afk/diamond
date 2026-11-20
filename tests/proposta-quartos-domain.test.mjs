import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { source, copy, backend, store } from './helpers.mjs';

const context = vm.createContext({ window: {} });
vm.runInContext(source('proposta-domain.js'), context);
vm.runInContext(source('plano.js'), context);
const { quartos, adicionalQuartos, valorComQuartos, fotoPlanta } = context.window.DiamondProposta;
const unidade = Object.freeze({ id: 'u-teste', unidade: '403', precoBase: 373563.84, desconto: 0.1, fotoId: 'individual-1' });
const cfg = Object.freeze({ fotosTipo: Object.freeze({ '03': 'tipo-1', LOJA: 'loja' }), fotosTipo2Quartos: Object.freeze({ '03': 'tipo-2', LOJA: 'nao-usar' }) });

test('propostas antigas permanecem com um quarto e escolha explícita permite dois', () => {
  for (const valor of [undefined, null, '', 0, 1, '1', true, false, {}, [], 3, '02', '2 quartos']) {
    assert.equal(quartos(unidade, valor), 1);
    assert.equal(adicionalQuartos(unidade, valor), 0);
  }
  for (const valor of [2, '2']) {
    assert.equal(quartos(unidade, valor), 2);
    assert.equal(adicionalQuartos(unidade, valor), 15000);
  }
});

test('acrescenta quinze mil após o desconto, sem alterar a base ou acumular trocas', () => {
  const baseNegociada = unidade.precoBase * (1 - unidade.desconto);
  assert.equal(valorComQuartos(baseNegociada, unidade, 1), 336207.46);
  assert.equal(valorComQuartos(baseNegociada, unidade, 2), 351207.46);
  for (const escolha of [2, 1, 2, 2, 1]) {
    assert.equal(valorComQuartos(baseNegociada, unidade, escolha), escolha === 2 ? 351207.46 : 336207.46);
  }
  assert.equal(unidade.precoBase, 373563.84);
  assert.equal(unidade.desconto, 0.1);
  assert.equal(valorComQuartos('373563.84', unidade, 2), 388563.84);
  assert.equal(valorComQuartos(1.005, unidade, 1), 1.01);
});

test('loja nunca recebe quartos, adicional ou a planta de apartamento', () => {
  for (const nome of ['LOJA', 'loja', ' Loja ']) {
    const loja = { unidade: nome, fotoId: 'foto-loja' };
    assert.equal(quartos(loja, 2), 0);
    assert.equal(adicionalQuartos(loja, 2), 0);
    assert.equal(valorComQuartos(600000.25, loja, 2), 600000.25);
    assert.equal(fotoPlanta(loja, cfg, 2), 'loja');
  }
});

test('preços inválidos ou fora da precisão monetária segura são recusados', () => {
  for (const base of [undefined, null, '', ' ', 'abc', true, false, {}, [], NaN, Infinity, -Infinity, -1, Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => valorComQuartos(base, unidade, 2), /Valor negociado inválido/);
  }
  assert.equal(valorComQuartos(0, unidade, 1), 0);
  assert.equal(valorComQuartos(0, unidade, 2), 15000);
});

test('planta de dois quartos usa o seu próprio cadastro por final e nunca a foto antiga', () => {
  assert.equal(fotoPlanta(unidade, cfg), 'tipo-1');
  assert.equal(fotoPlanta(unidade, cfg, 2), 'tipo-2');
  assert.equal(fotoPlanta({ ...unidade, unidade: '903' }, cfg, 2), 'tipo-2');
  assert.equal(fotoPlanta(unidade, {}, 1), 'individual-1');
  assert.equal(fotoPlanta(unidade, {}, 2), '');
  assert.equal(fotoPlanta(unidade, { fotosTipo: cfg.fotosTipo }, 2), '');
  assert.equal(fotoPlanta({ ...unidade, unidade: '404' }, cfg, 2), '');
  assert.equal(fotoPlanta(unidade, null, 2), '');
  assert.equal(fotoPlanta(null, cfg, 2), '');
});

test('todos os prazos distribuem o total com adicional e fecham em centavos', () => {
  for (const nParcelas of [12, 24, 36, 48]) {
    for (const escolha of [1, 2]) {
      const neg = valorComQuartos(unidade.precoBase, unidade, escolha);
      const plano = context.window.PLANO.calc({ arredondamento: 'decimal-v1', neg, forma: 'perso', entradaPct: .2, finalPct: .1, nParcelas, balQtde: 0, chavesMes: nParcelas, correcaoMensal: 0, dataProposta: new Date('2026-11-19T12:00:00Z'), diaVenc: 10 });
      assert.equal(plano.fecha, true);
      assert.equal(Math.round(plano.totalNominal * 100), Math.round(neg * 100));
    }
  }
});

test('escolha e adicional atravessam armazenamento local e servidor sem mudar proposta legada', async () => {
  const proposta = { id: 'p-quartos', unidadeId: unidade.id, unidade: unidade.unidade, cliente: 'Cliente de teste', corretor: 'Teste', corretorUsuario: 'domo', quartos: 2, adicionalQuartos: 15000, neg: valorComQuartos(unidade.precoBase, unidade, 2), inp: { quartos: 2, forma: 'perso', nParcelas: 36 } };
  const b = backend();
  const saved = await b.request('upsertProposta', { proposta });
  assert.equal(saved.ok, true);
  const reread = (await b.request('listPropostas')).propostas.find(p => p.id === proposta.id);
  assert.equal(reread.quartos, 2);
  assert.equal(reread.adicionalQuartos, 15000);
  assert.equal(reread.neg, 388563.84);
  const { s, mem } = store(async () => ({ ok: true, json: async () => ({ ok: true }) }));
  s.salvarProposta(proposta);
  const local = JSON.parse(mem.get('dv_propostas'))[0];
  assert.deepEqual(local.inp, copy(proposta.inp));
  assert.equal(local.quartos, 2);
  assert.equal(local.adicionalQuartos, 15000);
  assert.equal(quartos(unidade, {}.quartos), 1);
});
