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
    querySelectorAll(selector) {
      if (selector !== '[data-quartos]') return [];
      return Array.from(html.matchAll(/data-quartos="([12])"/g), match => {
        const key = '[data-quartos="' + match[1] + '"]';
        if (!nodes.has(key)) nodes.set(key, { ...element(), dataset: { quartos: match[1] } });
        return nodes.get(key);
      });
    },
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
    propostas, settle, estado: () => ctx.testSim.estado(), html: () => html, temSalvar: () => !!document.querySelector('#s-salvar'),
    input(selector, value) {
      const node = document.querySelector(selector);
      assert.ok(node, selector + ' deve existir');
      node.value = value; node.oninput();
    },
    async forma(value) {
      const node = document.querySelector('#s-forma');
      node.value = value; node.onchange({ target: node }); await settle();
    },
    async quartos(value) {
      const node = document.querySelectorAll('[data-quartos]').find(node => node.dataset.quartos === String(value));
      assert.ok(node, 'A opção de ' + value + ' quarto(s) deve existir');
      node.onclick(); await settle();
    },
    async tabela(value) {
      const node = document.querySelector('#s-tabela');
      assert.ok(node, 'O seletor de tabela deve existir');
      node.value = value; node.onchange({ target: node }); await settle();
    },
    async salvar() { await document.querySelector('#s-salvar').onclick(); await settle(); },
    async clicar(selector) { await document.querySelector(selector).onclick(); await settle(); },
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

test('reabrir e salvar preserva a versão decimal da nova proposta e o cálculo das antigas',async()=>{
 for(const arredondamento of ['decimal-v1',undefined]){
  const p={id:'p-arredondamento',cliente:'Teste de centavos',neg:150000.05,inp:{forma:'perso',entradaPct:20,finalPct:30,nParcelas:36,balQtde:5,balValor:10000,chavesMes:36,...(arredondamento?{arredondamento}:{})}};
  const s=simulador({propostas:[p]});
  await s.navegar('#/sim/u-403?editar=p-arredondamento');
  assert.match(s.html(),arredondamento?/45\.000,02/:/45\.000,01/);
  await s.salvar();
  assert.equal(s.propostas.length,1);assert.equal(s.propostas[0].neg,150000.05);
  assert.equal(s.propostas[0].inp.arredondamento,arredondamento);
 }
});

test('propostas v1 mantêm o mínimo contratado e o mês 48, sem travar propostas antigas',async()=>{
 for(const n of [36,48]){
  const minimo=n===36?30:20;
  const original={id:'p-regra',cliente:'Teste de regra',neg:373563.84,inp:{forma:'perso',regrasPlano:'36-48-v1',arredondamento:'decimal-v1',entradaPct:20,finalPct:minimo,nParcelas:n,balQtde:5,balValor:10000,chavesMes:n}};
  const s=simulador({propostas:[original]});await s.navegar('#/sim/u-403?editar=p-regra');
  s.input('#s-finpct','10');await s.salvar();
  assert.equal(s.propostas[0].inp.finalPct,minimo,'edição abaixo do piso não deve sobrescrever o registro');
  s.input('#s-finpct',String(minimo));
  if(n===48){s.input('#s-chaves','36');await s.salvar();assert.equal(s.propostas[0].inp.chavesMes,48);s.input('#s-chaves','48');}
  s.input('#s-cliente','Teste aprovado');await s.salvar();assert.equal(s.propostas[0].cliente,'Teste aprovado');
  await s.clicar('#s-diluir');await s.salvar();assert.equal(s.propostas[0].inp.finalPct,minimo);assert.equal(s.propostas[0].inp.balQtde,0);
  await s.clicar('#s-restaurar');await s.salvar();assert.equal(s.propostas[0].inp.finalPct,minimo);assert.equal(s.propostas[0].inp.balQtde,5);
 }
 const antigo={id:'p-legado',cliente:'Anterior',neg:373563.84,inp:{forma:'perso',entradaPct:20,finalPct:0,nParcelas:36,balQtde:0,chavesMes:36}};
 const s=simulador({propostas:[antigo]});await s.navegar('#/sim/u-403?editar=p-legado');await s.salvar();assert.equal(s.propostas[0].inp.finalPct,0);
});

test('propostas v2 preservam as seis escolhas ao salvar, reabrir e diluir os balões',async()=>{
 for(const [n,opcoes] of [[36,[10,20,30]],[48,[10,15,20]]])for(const finalPct of opcoes){
  const original={id:'p-escolha',cliente:'Teste de escolha',neg:373563.84,inp:{forma:'perso',regrasPlano:'36-48-v2',arredondamento:'decimal-v1',entradaPct:20,finalPct,nParcelas:n,balQtde:5,balValor:10000,chavesMes:n}};
  const s=simulador({propostas:[original]});await s.navegar('#/sim/u-403?editar=p-escolha');
  s.input('#s-cliente','Escolha preservada');await s.salvar();
  assert.equal(s.propostas[0].cliente,'Escolha preservada');assert.equal(s.propostas[0].inp.finalPct,finalPct);
  await s.navegar('#/home');await s.navegar('#/sim/u-403?editar=p-escolha');
  assert.equal(s.estado().inp.finalPct,finalPct);assert.equal(s.estado().inp.chavesMes,n);
  await s.clicar('#s-diluir');await s.salvar();
  assert.equal(s.propostas[0].inp.finalPct,finalPct);assert.equal(s.propostas[0].inp.balQtde,0);
  await s.clicar('#s-restaurar');await s.salvar();
  assert.equal(s.propostas[0].inp.finalPct,finalPct);assert.equal(s.propostas[0].inp.balQtde,5);
 }
});

test('propostas v2 bloqueiam percentual fora das opções e final antecipada em 48 vezes',async()=>{
 for(const n of [36,48]){
  const original={id:'p-escolha',cliente:'Original',neg:373563.84,inp:{forma:'perso',regrasPlano:'36-48-v2',arredondamento:'decimal-v1',entradaPct:20,finalPct:10,nParcelas:n,balQtde:5,balValor:10000,chavesMes:n}};
  const s=simulador({propostas:[original]});await s.navegar('#/sim/u-403?editar=p-escolha');
  s.input('#s-cliente','Não salvar');
  for(const pct of [0,5,n===36?15:30,40,50]){
   s.input('#s-finpct',String(pct));await s.salvar();
   assert.equal(s.propostas[0].cliente,'Original');assert.equal(s.propostas[0].inp.finalPct,10);
  }
  s.input('#s-finpct','10');
  if(n===48){s.input('#s-chaves','36');await s.salvar();assert.equal(s.propostas[0].cliente,'Original');s.input('#s-chaves','48');}
  s.input('#s-cliente','Válido');await s.salvar();assert.equal(s.propostas[0].cliente,'Válido');
 }
});

test('dois quartos salva o adicional uma vez, reabre o mesmo total e volta ao preço de um quarto', async () => {
  const s = simulador({ unidade: { precoBase: 373563.84, desconto: .1 }, cfg: { fotosTipo: { '03': 'planta-1q' }, fotosTipo2Quartos: { '03': 'planta-2q' } } });
  s.input('#s-cliente', 'Cliente de dois quartos');
  await s.quartos(2);
  assert.equal(s.estado().inp.cliente, 'Cliente de dois quartos', 'Trocar planta preserva o formulário');
  assert.match(s.html(), /data-fotoid="planta-2q"/);
  await s.salvar();
  const original = copy(s.propostas[0]), id = original.id;
  assert.equal(original.neg, 351207.46, 'Acrescenta 15 mil depois do desconto da base');
  assert.equal(original.quartos, 2);
  assert.equal(original.inp.quartos, 2);
  assert.equal(original.acrescimoQuartos, 15000);
  assert.equal(Math.round(original.valorBaseQuartos * 100), 33620746);
  assert.equal(original.fotoPlantaId, 'planta-2q');
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    await s.navegar('#/home');
    await s.navegar('#/sim/u-403?editar=' + encodeURIComponent(id));
    assert.equal(s.estado().inp.quartos, 2);
    await s.salvar();
    assert.equal(s.propostas.length, 1);
    assert.equal(s.propostas[0].neg, original.neg, 'Reabrir não aplica o adicional novamente');
  }
  await s.quartos(1);
  await s.salvar();
  assert.equal(s.propostas[0].id, id);
  assert.equal(s.propostas[0].neg, 336207.46);
  assert.equal(s.propostas[0].quartos, 1);
  assert.equal(s.propostas[0].acrescimoQuartos, 0);
  assert.equal(s.propostas[0].fotoPlantaId, 'planta-1q');
  await s.quartos(2);
  await s.salvar();
  assert.equal(s.propostas[0].neg, original.neg);
});

test('proposta legada conserva o preço salvo e ganha dois quartos somente quando selecionado', async () => {
  const original = { id: 'p-legada-quartos', unidadeId: 'u-403', unidade: '403', cliente: 'Cliente legado', neg: 271234.56, inp: { forma: '24x' } };
  const s = simulador({ propostas: [original], unidade: { precoBase: 400000 } });
  await s.navegar('#/sim/u-403?editar=' + original.id);
  assert.equal(s.estado().inp.quartos, 1);
  await s.salvar();
  assert.equal(s.propostas[0].neg, original.neg, 'A tabela atual não recalcula uma proposta antiga');
  await s.quartos(2);
  await s.salvar();
  assert.equal(s.propostas[0].neg, 286234.56);
  await s.quartos(1);
  await s.salvar();
  assert.equal(s.propostas[0].neg, original.neg);
});

test('trocar a versão da tabela preserva dois quartos e usa a nova base com um único adicional', async () => {
  const tabelas = [
    { key: 'atual', tabelaId: 'tb-atual', versao: 'v2', dataTabela: '01/11/2026', valorTabela: 300000, desconto: .1, neg: 270000 },
    { key: 'tabela:tb-antiga', tabelaId: 'tb-antiga', versao: 'v1', dataTabela: '01/10/2026', valorTabela: 280000, desconto: .1, neg: 252000 },
  ];
  const s = simulador({ unidade: { precoTabelaReferencia: {} }, api: async () => ({ tabelas }) });
  await s.settle();
  s.input('#s-cliente', 'Cliente de duas tabelas');
  await s.quartos(2);
  await s.salvar();
  assert.equal(s.propostas[0].neg, 285000);
  await s.tabela('tabela:tb-antiga');
  assert.equal(s.estado().inp.quartos, 2);
  await s.salvar();
  assert.equal(s.propostas[0].neg, 267000);
  assert.equal(s.propostas[0].tabela.tabelaId, 'tb-antiga');
  assert.equal(s.propostas[0].valorBaseQuartos, 252000);
  assert.equal(s.propostas[0].acrescimoQuartos, 15000);
  await s.navegar('#/home');
  await s.navegar('#/sim/u-403?editar=' + s.propostas[0].id);
  await s.salvar();
  assert.equal(s.propostas[0].neg, 267000);
  assert.equal(s.propostas[0].quartos, 2);
});
