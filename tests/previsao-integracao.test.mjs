import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {source} from './helpers.mjs';
import {criarServidorPrevisao} from './serve-previsao-preview.mjs';

function painel(visao='previsao',options={}){
  const calls={render:[],wire:[]};
  const ctx=vm.createContext({Intl,Date,URLSearchParams,location:{hash:'#/admin/painel?visao='+visao+'&status=Reservado&tipo=loja&busca=ausente'},STORE:{getUsuarios:()=>[],getCfg:()=>({})}});
  ctx.window=ctx;
  ctx.DiamondPrevisao={render:x=>{calls.render.push(x);return '<section id="forecast-synthetic">Previsão sintética</section>';},wire:(...args)=>calls.wire.push(args)};
  for(const file of ['gestao-domain.js','gestao-insights.js','gestao-painel.js'])vm.runInContext(source(file),ctx);
  const {b}=criarServidorPrevisao();
  const x={visao,unidades:[...b.table('unidades').values()],condicoes:[...b.table('vendas_condicoes').values()],leads:[...b.table('leads').values()],historico:[],conditionsOk:true,unitsOk:true,coverage:'',model:{retornosCRM:[],pedidos:[],retornosEnvios:[]},...options};
  return {ctx,x,calls,html:ctx.DiamondPainel.render(x)};
}

test('aba de previsão ignora filtros comerciais herdados e recebe a posição inteira',()=>{
  const {html,x,calls}=painel();
  assert.match(html,/<h1>Previsão de custo<\/h1>/);
  assert.match(html,/Posição de todas as unidades/);
  assert.match(html,/id="forecast-synthetic"/);
  assert.doesNotMatch(html,/id="di-filters"/);
  assert.equal(calls.render.length,1);
  assert.equal(calls.render[0],x);
  assert.equal(x.insights.rows.length,6);
  assert.equal(x.insights.filtered.length,6);
  assert.equal(x.insights.confirmadas.length,2);
  assert.equal(x.insights.disponiveis.length,3);
  assert.match(html,/class="di-tab on"[^>]*>Previsão de custo<\/a>/);
});

test('wire delega somente a visão de previsão e mantém atualizar dados',()=>{
  for(const visao of ['previsao','resumo']){
    const {ctx,calls}=painel(visao),handlers={};
    const host={querySelector:selector=>selector==='#gt-refresh'?{addEventListener:(_,handler)=>{handlers.refresh=handler;}}:null,querySelectorAll:()=>[]};
    const reload=()=>{};
    ctx.DiamondPainel.wire(host,reload);
    assert.equal(handlers.refresh,reload);
    assert.equal(calls.wire.length,visao==='previsao'?1:0);
    if(visao==='previsao'){assert.equal(calls.wire[0][0],host);assert.equal(calls.wire[0][1],reload);}
  }
});

test('falha do estoque impede renderizar uma previsão vazia como consulta válida',()=>{
  const {html,calls}=painel('previsao',{unitsOk:false,unidades:[]});
  assert.equal(calls.render.length,0);
  assert.match(html,/Estoque indisponível/);
  assert.doesNotMatch(html,/forecast-synthetic/);
});

test('falha das condições chega explicitamente ao componente de previsão',()=>{
  const {html,calls}=painel('previsao',{conditionsOk:false,condicoes:[]});
  assert.equal(calls.render[0].conditionsOk,false);
  // O componente controla o aviso para removê-lo quando a atualização automática recuperar a fonte.
  assert.match(html,/id="forecast-synthetic"/);
});

test('visão de previsão é reconhecida pelo carregador gerencial',async()=>{
  let rendered;
  const host={isConnected:true,innerHTML:'',querySelector:()=>null};
  const store={podeVerPainel:()=>true,getUser:()=>({}),getPropostas:()=>[],status:()=>({}),listEnvios:async()=>[],api:async action=>({reservasPainel:{unidades:[],pedidos:[]},listLeads:{leads:[]},listPropostas:{propostas:[]},vendasCondicoes:{condicoes:[]}}[action])};
  const ctx=vm.createContext({Intl,Date,URLSearchParams,location:{hash:'#/admin/painel?visao=previsao'},document:{querySelector:()=>host,body:{classList:{remove(){},add(){}}}},STORE:store});
  ctx.window=ctx;
  vm.runInContext(source('gestao-domain.js'),ctx);
  ctx.DiamondPainel={render:x=>{rendered=x;return 'rendered';},wire:()=>{}};
  vm.runInContext(source('gestao.js'),ctx);
  ctx.DiamondGestao.render();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(rendered.visao,'previsao');
  assert.equal(host.innerHTML,'rendered');
});

test('HTML carrega estilo, domínio, persistência e UI antes do painel',()=>{
  const html=source('index.html');
  assert.match(html,/href="previsao-custo\.css\?v=/);
  const names=['previsao-custo-domain.js','previsao-cobertura-domain.js','previsao-custo-store.js','previsao-custo.js','gestao-painel.js'];
  for(let i=1;i<names.length;i++)assert.ok(html.indexOf('src="'+names[i-1])<html.indexOf('src="'+names[i]));
});

test('prévia possui dois contratos conciliados, uma permuta, finais e três disponíveis',async()=>{
  const {b}=criarServidorPrevisao();
  const units=await b.request('reservasPainel',{operacao:'listar'},'domo');
  const sales=await b.request('vendasCondicoes',{operacao:'listar'},'domo');
  assert.equal(units.status,200);
  assert.equal(sales.status,200);
  assert.equal(units.unidades.filter(u=>u.status==='Vendido').length,2);
  assert.equal(units.unidades.filter(u=>u.status==='Disponível').length,3);
  assert.equal(sales.condicoes.length,2);
  for(const c of sales.condicoes){
    const u=units.unidades.find(u=>u.id===c.unidadeId);
    assert.equal(c.clienteId,u.clienteId);
    assert.equal(c.unidadeRevisao,u.atualizadoEm);
    assert.equal(c.total,c.entrada+c.permutas.reduce((n,p)=>n+p.valor,0)+c.parcelas.reduce((n,p)=>n+p.valor*p.quantidade,0));
    assert.match(c.parcelas[1].descricao,/Final sintético/);
  }
  assert.equal(sales.condicoes.reduce((n,c)=>n+c.permutas.length,0),1);
});
