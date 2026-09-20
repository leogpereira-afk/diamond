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
