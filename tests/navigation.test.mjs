import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {source} from './helpers.mjs';

function appFixture({propostas = [], leads = [], envios = [], unidade = {id:'u-1',unidade:'401',status:'Vendido',precoBase:999999}} = {}) {
  const nodes = new Map();
  const node = () => ({innerHTML:'',textContent:'',style:{},dataset:{},classList:{add(){},remove(){}},querySelectorAll:()=>[],setAttribute(){},addEventListener(){},remove(){}});
  const get = k => { if(!nodes.has(k)) nodes.set(k,node()); return nodes.get(k); };
  const STORE = {getCfg:()=>({}),getUser:()=>({usuario:'domo',nome:'Domo',papel:'corretor',ehMaster:true,temSenhaEquipe:true,corretorAtivo:{nome:'Teste'}}),isAdmin:()=>false,podeVerPainel:()=>true,getPropostas:()=>propostas,getLeads:()=>leads,getUnidades:()=>[unidade],unidadePorId:id=>id===unidade.id?unidade:null,listEnvios:async()=>envios};
  const context = vm.createContext({window:{P_URL:'https://example.invalid/p'},document:{body:node(),querySelector:get,querySelectorAll:()=>[],createElement:node},location:{hash:'#/proposta/p-antiga'},STORE,URLSearchParams,Date,Math});
  const code = source('app.js');
  vm.runInContext(code.slice(0,code.lastIndexOf("  window.addEventListener('hashchange'"))+`;globalThis.audit={vProposta:typeof vProposta==='function'?vProposta:null,clienteReferencias:typeof clienteReferencias==='function'?clienteReferencias:null,crmResumo,renderTeste:()=>{renderTopo=()=>{};vProposta=id=>globalThis.escolhida=id;render();}};})();`,context);
  return {api:context.audit,nodes,STORE,context};
}

test('historico consulta proposta vendida com preco, cliente e condicoes originais sem salvar',async()=>{
  const p={id:'p-antiga',unidadeId:'u-1',unidade:'401',cliente:'Cliente original',corretor:'Corretor original',neg:270000.45,forma:'scp',criadoEm:'2026-07-20T15:00:00Z',inp:{desc10:true,p12:true}};
  const f=appFixture({propostas:[p],envios:[{id:'pp-123',propostaId:p.id,numero:7,em:p.criadoEm}]});
  assert.equal(typeof f.api.vProposta,'function');
  await f.api.vProposta(p.id);
  const html=[...f.nodes.values()].map(n=>n.innerHTML).join(' ');
  assert.match(html,/Cliente original/);assert.match(html,/Corretor original/);assert.match(html,/270\.000,45/);
  assert.match(html,/SCP/);assert.match(html,/12 parcelas/);assert.match(html,/preview=1/);
  assert.doesNotMatch(html,/999\.999|Unidade indisponível/);
  assert.equal(f.STORE.getPropostas()[0],p);
});

test('conexoes de cliente usam identificadores e nao juntam homonimos',()=>{
  const a={id:'lead-a',cliente:'Ana'},b={id:'lead-b',cliente:'Ana'};
  const pa={id:'p-a',leadId:a.id,cliente:'Ana'},pb={id:'p-b',cliente:'Ana'},pc={id:'p-c',cliente:'Ana'};
  const f=appFixture({propostas:[pa,pb,pc],leads:[a,b],envios:[{id:'pp-b',leadId:b.id,propostaId:pb.id}]});
  assert.equal(typeof f.api.clienteReferencias,'function');
  assert.deepEqual(Array.from(f.api.clienteReferencias(a,f.STORE.getPropostas(),[{id:'pp-b',leadId:b.id,propostaId:pb.id}]).propostas,p=>p.id),['p-a']);
});

test('indicador do CRM conta clientes fechados sem chamar propostas de vendas',()=>{
  const f=appFixture();
  const html=f.api.crmResumo([{id:'lead-a',cliente:'Ana',estagio:'fechado',unidade:'401'}]);
  assert.match(html,/Clientes fechados/);assert.doesNotMatch(html,/Propostas fechadas|unidade vendida/);
});

test('endereco antigo do historico abre a proposta original para Domo',()=>{
  const f=appFixture();f.context.location.hash='#/sim/u-1?p=p-antiga';
  f.api.renderTeste();assert.equal(f.context.escolhida,'p-antiga');
});

test('perfil cliente continua impedido de consultar propostas internas',()=>{
  const f=appFixture();f.STORE.getUser=()=>({papel:'cliente'});
  f.api.renderTeste();assert.equal(f.context.escolhida,undefined);assert.equal(f.context.location.hash,'#/home');
});

test('proposta ausente nao cai em simulacao nova',async()=>{
  const f=appFixture();await f.api.vProposta('p-ausente');
  assert.match(f.nodes.get('#app').innerHTML,/Proposta não localizada/);
  assert.doesNotMatch(f.nodes.get('#app').innerHTML,/Valor registrado|Enviar proposta/);
});

test('falha na consulta de vinculos oferece tentativa em vez de dizer que nao existem',async()=>{
  const f=appFixture({propostas:[{id:'p-antiga',unidadeId:'u-1',neg:200000,forma:'avista'}]});
  f.STORE.listEnvios=async()=>{throw Error('Conexão indisponível');};
  await f.api.vProposta('p-antiga');
  assert.match(f.nodes.get('#registro-conexoes').innerHTML,/Tentar novamente/);
  assert.doesNotMatch(f.nodes.get('#registro-conexoes').innerHTML,/Nenhum envio/);
});
