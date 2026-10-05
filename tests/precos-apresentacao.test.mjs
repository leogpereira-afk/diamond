import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {source, copy} from './helpers.mjs';

function setup({cfg = {}, historico = [], erro = null} = {}) {
  const requests = [];
  const ctx = vm.createContext({window: {}, Date, STORE: {
    getCfg: () => cfg,
    api: async action => {
      requests.push(action);
      if (erro) throw erro;
      return {historico};
    },
  }});
  const code = source('precos.js'), end = code.lastIndexOf('})();');
  vm.runInContext(code.slice(0, end) + ';globalThis.apresentacao={registroAtual,dataRegistro,itensComparativo,numerarHistorico};' + code.slice(end), ctx);
  return {tools: ctx.apresentacao, mount: ctx.window.DiamondPrecos.mount, requests};
}

// Pequena superfície da apresentação: asserções verificam o conteúdo realmente
// montado, sem depender de bibliotecas de DOM ou reproduzir a lógica dos helpers.
function painel() {
  const nodes = new Map();
  const node = () => ({innerHTML: '', textContent: '', disabled: false, querySelectorAll: () => []});
  const el = {...node(), isConnected: true, querySelector(selector) {
    if (selector === 'form' || selector === '#precos-regularizar') return null;
    if (!nodes.has(selector)) nodes.set(selector, node());
    return nodes.get(selector);
  }};
  return {el, nodes};
}

const event = (id, version, extra = {}) => ({id, versaoNova: version, versaoAnterior: 'v1', percentual: 4, itens: [], ...extra});

test('registro atual usa o ID salvo mesmo diante de outra atualização com a mesma versão', () => {
  const {tools} = setup();
  const outro = {registro: event('outro', 'v2'), numero: 2};
  const certo = {registro: event('correto', 'v2'), numero: 1};
  assert.equal(tools.registroAtual({tabelaId: 'correto', versao: 'v2'}, [outro, certo]), certo);
  assert.equal(tools.registroAtual({tabelaId: 'ausente', versao: 'v2'}, [outro, certo]), undefined);
});

test('configuração antiga sem ID pode localizar a versão salva, mas não inventa outra', () => {
  const {tools} = setup(), atual = {registro: event('anterior', 'v2'), numero: 1};
  assert.equal(tools.registroAtual({versao: 'v2'}, [atual]), atual);
  assert.equal(tools.registroAtual({versao: 'v3'}, [atual]), undefined);
  assert.equal(tools.registroAtual({}, []), undefined);
});

test('data do registro usa Brasília inclusive quando o dia UTC é diferente', () => {
  const {tools} = setup();
  assert.deepEqual(copy(tools.dataRegistro({criadoEm: '2026-10-06T02:15:00Z'})), {data: '05/10/2026', hora: '23:15'});
  assert.deepEqual(copy(tools.dataRegistro({em: '2026-10-05T17:23:00Z'})), {data: '05/10/2026', hora: '14:23'});
});

test('registro ausente ou sem data válida não vira 1970, hoje nem data de configuração', () => {
  const {tools} = setup();
  for (const record of [null, undefined, {}, {criadoEm: null}, {criadoEm: ''}, {criadoEm: 'inválida'}, {em: 0}, {atualizadoEm: '2026-10-07T12:00:00Z'}, {dataTabela: '05/10/2026'}]) {
    assert.equal(tools.dataRegistro(record), null);
  }
});

test('comparativo filtra reajustadas e preservadas sem mudar a ordem ou os objetos salvos', () => {
  const {tools} = setup();
  const saved = {itens: [
    {unidade: '10', alterada: true, anterior: 10, novo: 11},
    {unidade: '401', alterada: false, corrigida: true, anterior: 20, novo: 20},
    {unidade: '2', alterada: true, anterior: 30, novo: 33},
    {id: '90', alterada: false, anterior: 50, novo: 50},
  ]};
  const before = copy(saved);
  saved.itens.forEach(Object.freeze); Object.freeze(saved.itens); Object.freeze(saved);
  const ids = items => Array.from(items, i => i.unidade || i.id);
  assert.deepEqual(ids(tools.itensComparativo(saved, 'todas')), ['2', '10', '90', '401']);
  assert.deepEqual(ids(tools.itensComparativo(saved, 'alteradas')), ['2', '10']);
  assert.deepEqual(ids(tools.itensComparativo(saved, 'preservadas')), ['90', '401']);
  assert.deepEqual(saved, before);
  assert.notEqual(tools.itensComparativo(saved), saved.itens);
  assert.equal(tools.itensComparativo(saved, 'alteradas')[0], saved.itens[2]);
  assert.deepEqual(Array.from(tools.itensComparativo({})), []);
});

test('numeração segue a sequência do registro e não a data declarada da tabela', () => {
  const {tools} = setup();
  const primeiro = event('primeiro', 'v2', {criadoEm: '2026-10-05T12:00:00Z', dataTabela: '01/12/2026'});
  const segundo = event('segundo', 'v3', {criadoEm: '2026-10-06T12:00:00Z', dataTabela: '01/01/2026'});
  const input = [segundo, null, primeiro], before = copy(input);
  assert.deepEqual(Array.from(tools.numerarHistorico(input), x => [x.registro.id, x.numero]), [['primeiro', 1], ['segundo', 2]]);
  assert.deepEqual(input, before);
});

test('histórico sem horário mantém sequência pelas versões numéricas salvas', () => {
  const {tools} = setup();
  const result = tools.numerarHistorico([event('dez', 'v10'), event('tres', 'v3'), event('dois', 'v2')]);
  assert.deepEqual(Array.from(result, x => [x.registro.id, x.numero]), [['dois', 1], ['tres', 2], ['dez', 3]]);
});

test('tela sem histórico mostra data desconhecida e faz somente consulta', async () => {
  const {mount, requests} = setup({cfg: {versao: 'v2', dataTabela: '05/10/2026', atualizadoEm: '2099-12-31T12:00:00Z'}});
  const {el, nodes} = painel(); mount(el); await new Promise(resolve => setImmediate(resolve));
  const registro = nodes.get('#precos-ultimo-registro').innerHTML;
  assert.match(registro, /Não informada/);
  assert.match(registro, /Sem data confirmada no histórico/);
  assert.doesNotMatch(registro, /2099|1970|31\/12/);
  assert.match(nodes.get('#precos-atual-reajuste').innerHTML, /Não registrado/);
  assert.match(nodes.get('#precos-historico-lista').innerHTML, /Ainda não há atualizações registradas/);
  assert.deepEqual(requests, ['precosHistorico']);
});

test('tela não atribui ao ID atual a data de outro registro com a mesma versão', async () => {
  const {mount} = setup({cfg: {tabelaId: 'correto', versao: 'v2'}, historico: [event('outro', 'v2', {criadoEm: '2026-10-05T12:00:00Z'})]});
  const {el, nodes} = painel(); mount(el); await new Promise(resolve => setImmediate(resolve));
  assert.match(nodes.get('#precos-ultimo-registro').innerHTML, /Não informada/);
  assert.match(nodes.get('#precos-atual-reajuste').innerHTML, /Não registrado/);
  assert.doesNotMatch(nodes.get('#precos-historico-lista').innerHTML, /precos-atual-tag/);
});

test('falha de consulta aparece como indisponibilidade, não como histórico vazio', async () => {
  const {mount} = setup({erro: Error('Sem conexão')});
  const {el, nodes} = painel(); mount(el); await new Promise(resolve => setImmediate(resolve));
  assert.match(nodes.get('#precos-historico-lista').innerHTML, /Não foi possível consultar o histórico/);
  assert.doesNotMatch(nodes.get('#precos-historico-lista').innerHTML, /Ainda não há/);
  assert.match(nodes.get('#precos-ultimo-registro').innerHTML, /Consulta indisponível/);
  assert.equal(nodes.get('#precos-recarregar').disabled, false);
});
