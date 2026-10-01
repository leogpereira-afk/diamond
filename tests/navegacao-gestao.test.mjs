import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {source} from './helpers.mjs';
const context=vm.createContext({});vm.runInContext(source('navegacao.js'),context);const N=context.DiamondNavegacao;
test('menu gerencial não aparece para perfis sem gestão',()=>{
 assert.equal(N.html({allowed:false,isAdmin:true,hash:'#/admin/painel'}),'');
 const domo=N.html({allowed:true,hash:'#/proposta/p-1'});
 assert.match(domo,/#\/admin\/historico" aria-current="page"/);
 assert.match(domo,/#\/admin\/painel/);assert.doesNotMatch(domo,/#\/admin\/config/);
 const admin=N.html({allowed:true,isAdmin:true});assert.match(admin,/#\/admin\/config/);
});
test('fichas e filtros preservam destaque da área de origem',()=>{
 assert.equal(N.active('#/admin/painel?visao=retornos'),'painel');
 assert.equal(N.active('#/cliente/cliente-a?voltar=%23%2Fadmin%2Fpainel'),'clientes');
 assert.equal(N.active('#/conexoes/u-401'),'vendas');
});
test('retorno de consulta conserva filtros e recusa destino externo',()=>{
 const ctx=vm.createContext({window:{},location:{hash:'#/admin/painel?visao=compradores'},URLSearchParams});
 const code=source('app.js');vm.runInContext(code.slice(0,code.lastIndexOf("  window.addEventListener('hashchange'"))+';globalThis.nav={rotaRegistro,voltaRegistro};})();',ctx);
 const route=ctx.nav.rotaRegistro('conexoes','u-401');ctx.location.hash=route;
 assert.equal(ctx.nav.voltaRegistro('#/home'),'#/admin/painel?visao=compradores');
 ctx.location.hash='#/proposta/a?voltar=https%3A%2F%2Fevil.invalid';assert.equal(ctx.nav.voltaRegistro('#/home'),'#/home');
 ctx.location.hash='#/proposta/a?voltar=javascript%3Aalert(1)';assert.equal(ctx.nav.voltaRegistro('#/home'),'#/home');
});
