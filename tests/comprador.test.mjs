import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {source} from './helpers.mjs';
const code=source('app.js'),ctx=vm.createContext({window:{},STORE:{},Date,Math});
vm.runInContext(code.slice(0,code.lastIndexOf("  window.addEventListener('hashchange'"))+';globalThis.comprador=compradorVenda;})();',ctx);
const u={id:'u-401',unidade:'401',status:'Vendido'};
test('comprador explícito, sem confundir vendedor ou interessado',()=>{
 assert.equal(ctx.comprador({...u,compradorNome:'Maria',vendedorNome:'João'},[]),'Maria');
 assert.equal(ctx.comprador(u,[{unidade:'401',cliente:'Interessado',estagio:'proposta'}]),'Não informado');
 assert.equal(ctx.comprador({...u,status:'Disponível',compradorNome:'Antigo'},[]),'—');
});
test('CRM fechado com vínculo exato e conflito explícito',()=>{
 const l={unidade:'401',cliente:'Ana',estagio:'fechado'};
 assert.equal(ctx.comprador(u,[l]),'Ana');
 assert.equal(ctx.comprador(u,[l,{...l,cliente:'Bruno'}]),'Conferir compradores no CRM');
 assert.equal(ctx.comprador(u,[{...l,unidadeId:'u-402'}]),'Não informado');
});
import {backend} from './helpers.mjs';
test('compradores internos nunca saem no espelho de clientes',async()=>{
 const b=backend();b.table('unidades').set('u-2',{id:'u-2',unidade:'2',status:'Vendido',compradorNome:'Privado',compradorFonte:{arquivo:'privado'}});
 const cli=await b.request('list',{},'cliente');assert.equal(cli.unidades.find(u=>u.id==='u-2').compradorNome,undefined);
 assert.equal((await b.request('list',{},'domo')).unidades.find(u=>u.id==='u-2').compradorNome,'Privado');
});
test('cliente e corretor comum não abrem vagas internas',async()=>{
 const b=backend();assert.equal((await b.request('vagas',{operacao:'carregar'},'cliente')).status,403);
 b.table('cfg').get('usuarios').push({usuario:'corretor',hash:'fake',papel:'corretor',ativo:true});
 assert.equal((await b.request('vagas',{operacao:'carregar'},'corretor')).status,403);
});
test('cliente vinculado aparece por id e atualiza o nome sem inferir compra',()=>{
 assert.equal(ctx.comprador({...u,status:'Disponível',clienteId:'lead-1',clienteVinculadoNome:'Anterior'},[{id:'lead-1',cliente:'Atualizado'}]),'Atualizado');
 assert.equal(ctx.comprador({...u,clienteId:'lead-1',clienteVinculadoNome:'Confirmado'},[]),'Confirmado');
});
const vctx=vm.createContext({window:{},STORE:{},Date,Math});
vm.runInContext(code.slice(0,code.lastIndexOf("  window.addEventListener('hashchange'"))+';globalThis.vagas=vagasDaUnidade;})();',vctx);
test('vaga vinculada usa apartamento exato, decisão efetiva e alerta de múltiplos vínculos',()=>{
 const vagas=[{codigo:'V01',apartamento:'Apto 401'},{codigo:'V02',apartamento:'Apto 1401'},{codigo:'V03',apartamento:'Apto 402',alertas:['Conferir'],origem:{vinculos:[{apartamento:'Apto 401'}]}},{codigo:'V04',apartamento:'Apto 402',alertas:[],origem:{vinculos:[{apartamento:'Apto 401'}]}}];
 assert.deepEqual(Array.from(vctx.vagas(u,vagas),v=>v.codigo),['V01','V03']);
 assert.equal(vctx.vagas({unidade:'999'},vagas).length,0);
});
