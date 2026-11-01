import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {source} from './helpers.mjs';

function preparar(visao='caixa'){
 const calls={build:0,render:[],wire:[]};
 const ctx=vm.createContext({Intl,Date,URLSearchParams,location:{hash:'#/admin/painel?visao='+visao+'&de=2026-10-01&tipo=loja'},STORE:{getUsuarios:()=>[],getCfg:()=>({})}});ctx.window=ctx;
 ctx.DiamondInsights={build:()=>{calls.build++;throw Error('Motor comercial não deve calcular o caixa');}};
 ctx.DiamondCaixa={render:x=>{calls.render.push(x);return '<div id="cx-root">Caixa sintético</div>';},wire:(...args)=>calls.wire.push(args)};
 vm.runInContext(source('gestao-painel.js'),ctx);
 const x={visao,unidades:[],condicoes:[{permutas:[null]}],leads:[],conditionsOk:true,unitsOk:true,leadsOk:true,coverage:'',model:{}};
 return {ctx,calls,x};
}
test('Caixa tem rota própria e não herda filtros comerciais nem cálculo legado',()=>{
 const {ctx,calls,x}=preparar(),html=ctx.DiamondPainel.render(x);
 assert.equal(calls.build,0);assert.equal(calls.render[0],x);assert.match(html,/<h1>Caixa<\/h1>/);assert.match(html,/class="di-tab on"[^>]*>Caixa<\/a>/);assert.doesNotMatch(html,/id="di-filters"/);
 const host={querySelector:()=>null,querySelectorAll:()=>[]},reload=()=>{};ctx.DiamondPainel.wire(host,reload);assert.equal(calls.wire[0][0],host);
});
test('falha de estoque impede tela vazia com números falsos',()=>{
 const {ctx,calls,x}=preparar();x.unitsOk=false;const html=ctx.DiamondPainel.render(x);assert.equal(calls.render.length,0);assert.match(html,/Estoque indisponível/);
});
test('carregador reconhece a rota do caixa e conserva estados de consulta',async()=>{
 let rendered;const host={isConnected:true,innerHTML:'',querySelector:()=>null};
 const store={podeVerPainel:()=>true,getUser:()=>({}),getPropostas:()=>[],status:()=>({}),listEnvios:async()=>[],api:async action=>({reservasPainel:{unidades:[],pedidos:[]},listLeads:{leads:[]},listPropostas:{propostas:[]},vendasCondicoes:{condicoes:[]}}[action])};
 const ctx=vm.createContext({Intl,Date,URLSearchParams,location:{hash:'#/admin/painel?visao=caixa'},document:{querySelector:()=>host,body:{classList:{remove(){},add(){}}}},STORE:store});ctx.window=ctx;
 vm.runInContext(source('gestao-domain.js'),ctx);ctx.DiamondPainel={render:x=>{rendered=x;return 'caixa';},wire:()=>{}};vm.runInContext(source('gestao.js'),ctx);ctx.DiamondGestao.render();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(rendered.visao,'caixa');assert.equal(rendered.leadsOk,true);assert.equal(rendered.conditionsOk,true);assert.equal(host.innerHTML,'caixa');
});
test('shell inclui domínio, interface e estilo de caixa na mesma versão',()=>{
 const html=source('index.html'),sw=source('sw.js'),version=sw.match(/diamond-pages-v(\d+)/)[1];
 for(const f of ['caixa-domain.js','caixa.js','caixa.css']){assert.ok(html.includes(f+'?v='+version));assert.ok(sw.includes(f+'?v='+version));}
 assert.ok(html.indexOf('src="caixa-domain.js')<html.indexOf('src="caixa.js'));assert.ok(html.indexOf('src="caixa.js')<html.indexOf('src="gestao-painel.js'));
});
