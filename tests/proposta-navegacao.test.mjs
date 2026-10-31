import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { source, copy } from './helpers.mjs';

function simulador(options = {}) {
  let html = '', clock = 1800000000000;
  const nodes = new Map(), listeners = new Map(), propostas = copy(options.propostas || []);
  const element = () => ({
    innerHTML: '', textContent: '', value: '', disabled: false, isConnected: true,
    parentElement: { querySelector: () => ({ textContent: '' }) },
  });
  const app = element();
  Object.defineProperty(app, 'innerHTML', {
    get: () => html,
    set: value => {
      html = value;
      for (const node of nodes.values()) node.isConnected = false;
      nodes.clear();
    },
  });
  const document = {
    querySelector(selector) {
      if (selector === '#app') return app;
      if (selector === '#s-fotobtn' || !selector.startsWith('#')) return null;
      const id = selector.slice(1);
      const contents = [html, ...Array.from(nodes.values(), node => node.innerHTML)].join('');
      if (!contents.includes('id="' + id + '"')) return null;
      if (!nodes.has(selector)) nodes.set(selector, element());
      return nodes.get(selector);
    },
    querySelectorAll: () => [],
  };
  const unidade = { id: 'u-403', unidade: '403', area: 45, andar: 4, status: 'Disponível', precoBase: 300000, ...options.unidade };
  const ctx = vm.createContext({
    document, location: { hash: '#/sim/u-403' }, Math, URLSearchParams,
    Date: class extends Date { static now() { return clock++; } },
    window: { addEventListener: (name, callback) => listeners.set(name, callback), scrollTo() {} },
    STORE: {
      getCfg: () => ({ versao: 'v1', dataTabela: '01/07/2026', corretagem: 0.05, quemPaga: 'Construtora', ...options.cfg }),
      unidadePorId: () => unidade,
      getUser: () => ({ papel: 'admin', nome: 'Administrador', usuario: 'admin' }),
      getUsuarios: () => [], isAdmin: () => true, getPropostas: () => propostas,
      api: options.api || (async () => ({ historico: [] })), filaGet: () => [], trySync: async () => {}, status: () => ({ estado: 'ok' }),
      salvarProposta: p => {
        const saved = copy(p), index = propostas.findIndex(x => x.id === p.id);
        if (index >= 0) propostas[index] = saved; else propostas.push(saved);
        return saved;
      },
    },
  });
  vm.runInContext(source('plano.js'), ctx);
  vm.runInContext(source('proposta-domain.js'), ctx);
  const code = source('app.js');
  const start = code.lastIndexOf("  window.addEventListener('hashchange'");
  const end = code.indexOf("  document.addEventListener('click'", start);
  assert.ok(start > 0 && end > start, 'Carrega o listener real de navegação do aplicativo');
  // A superfície DOM cobre apenas os controles do simulador. O roteamento
  // periférico é reduzido, mas a limpeza de estado usa o listener de produção.
  vm.runInContext(code.slice(0, start) + `
    ativarFotos = () => {};
    toast = () => {};
    render = () => {
      _sujo = false;
      const [path, query] = location.hash.split('?');
      if (path.startsWith('#/sim/')) vSim(path.slice(6), new URLSearchParams(query || '').get('editar'));
      else app().innerHTML = '<p>Outra página</p>';
    };
    globalThis.testSim = { abrir: () => render(), estado: () => sim };
  ` + code.slice(start, end) + '})();', ctx);
  ctx.testSim.abrir();
  const settle = async () => { await Promise.resolve(); await Promise.resolve(); };
  return {
    propostas, settle, estado: () => ctx.testSim.estado(), temSalvar: () => !!document.querySelector('#s-salvar'),
    input(selector, value) {
      const node = document.querySelector(selector);
      assert.ok(node, selector + ' deve existir');
      node.value = value; node.oninput();
    },
    async forma(value) {
      const node = document.querySelector('#s-forma');
      node.value = value; node.onchange({ target: node }); await settle();
    },
    async salvar() { await document.querySelector('#s-salvar').onclick(); await settle(); },
    async navegar(hash) { ctx.location.hash = hash; listeners.get('hashchange')(); await settle(); },
  };
}

test('editar e redesenhar depois de salvar mantém o registro e as condições da proposta corrente', async () => {
  const s = simulador();
  s.input('#s-cliente', 'Cliente A');
  await s.salvar();
  const id = s.propostas[0].id;
  s.input('#s-finpct', '0');
  await s.forma('24x');
  assert.equal(s.estado().propostaId, id);
  assert.equal(s.estado().inp.cliente, 'Cliente A');
  assert.equal(s.estado().inp.finalPct, 0);
  await s.salvar();
  assert.equal(s.propostas.length, 1);
  assert.equal(s.propostas[0].id, id);
  assert.equal(s.propostas[0].forma, '24x');
});

test('sair e abrir Nova proposta da mesma unidade cria registro distinto e preserva o anterior', async () => {
  const s = simulador();
  s.input('#s-cliente', 'Cliente A');
  await s.salvar();
  const original = copy(s.propostas[0]);
  await s.navegar('#/conexoes/u-403');
  await s.navegar('#/sim/u-403');
  assert.equal(s.estado().inp.cliente, '', 'Nova proposta deve iniciar sem o cliente anterior');
  assert.equal(s.estado().propostaId, null, 'Nova proposta não reutiliza o ID já salvo');
  s.input('#s-cliente', 'Cliente B');
  await s.salvar();
  assert.equal(s.propostas.length, 2);
  assert.deepEqual(s.propostas[0], original);
  assert.equal(s.propostas[1].cliente, 'Cliente B');
  assert.notEqual(s.propostas[1].id, original.id);
});

test('rota explícita de edição reabre o registro salvo e mantém seu ID ao salvar', async () => {
  const s = simulador();
  s.input('#s-cliente', 'Cliente A');
  await s.salvar();
  const id = s.propostas[0].id;
  await s.navegar('#/home');
  await s.navegar('#/sim/u-403?editar=' + encodeURIComponent(id));
  assert.equal(s.estado().inp.cliente, 'Cliente A');
  assert.equal(s.estado().propostaId, id);
  s.input('#s-cliente', 'Cliente A atualizado');
  await s.salvar();
  assert.equal(s.propostas.length, 1);
  assert.equal(s.propostas[0].id, id);
  assert.equal(s.propostas[0].cliente, 'Cliente A atualizado');
});

test('edição de proposta ausente não abre formulário novo com o ID antigo', async () => {
  const s = simulador();
  await s.navegar('#/sim/u-403?editar=registro-ainda-nao-carregado');
  assert.equal(s.temSalvar(), false);
  assert.equal(s.estado(), null);
  assert.equal(s.propostas.length, 0);
});

test('nova proposta espera a referência conferida e só então permite salvar o preço correto', async () => {
  let responder; const chamadas=[];
  const s=simulador({cfg:{tabelaId:'tb2',versao:'v2',dataTabela:'01/10/2026'},
    unidade:{precoBase:93000,desconto:.07,precoVersao:'tb2',precoTabelaReferencia:{modelo:1,tabelaId:null,versao:'v1',dataTabela:'01/09/2026',precoBase:100000,fonte:'Fonte sintética',conferidoEm:'2026-10-01T12:00:00.000Z'}},
    api:(action,dados)=>{chamadas.push({action,dados});return new Promise(resolve=>{responder=resolve;});}});
  assert.equal(s.estado().tabela,undefined);
  s.input('#s-cliente','Cliente de teste');await s.salvar();assert.equal(s.propostas.length,0);
  assert.equal(chamadas[0].action,'vendasCondicoes');assert.equal(chamadas[0].dados.unidadeId,'u-403');
  responder({tabelas:[{key:'atual',tabelaId:'tb2',versao:'v2',dataTabela:'01/10/2026',valorTabela:104000,desconto:.07,neg:96720}]});await s.settle();
  assert.equal(s.estado().tabela.valorTabela,104000);assert.equal(s.estado().inp.cliente,'Cliente de teste');
  await s.forma('24x');await s.salvar();assert.equal(s.propostas.length,1);assert.equal(s.propostas[0].neg,96720);
});

test('carregar referência nova não reescreve preço de proposta salva', async () => {
  const s=simulador({cfg:{tabelaId:'tb2',versao:'v2',dataTabela:'01/10/2026'},
    unidade:{precoBase:93000,precoVersao:'tb2',precoTabelaReferencia:{modelo:1,tabelaId:null,versao:'v1',dataTabela:'01/09/2026',precoBase:100000,fonte:'Fonte sintética',conferidoEm:'2026-10-01T12:00:00.000Z'}},
    propostas:[{id:'p-anterior',cliente:'Cliente anterior',neg:90000,inp:{forma:'24x'},tabela:{versao:'v0',dataTabela:'01/08/2026',neg:90000}}],
    api:async()=>({tabelas:[{key:'atual',versao:'v2',neg:104000,valorTabela:104000}]})});
  await s.navegar('#/sim/u-403?editar=p-anterior');await s.settle();assert.equal(s.estado().tabela.neg,90000);await s.salvar();assert.equal(s.propostas[0].neg,90000);assert.equal(s.propostas[0].tabela.versao,'v0');
});
