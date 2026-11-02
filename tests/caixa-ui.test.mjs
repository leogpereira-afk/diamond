import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {criarFixtureVendas} from './serve-vendas-preview.mjs';
import {prepararCaixaFixture} from './serve-caixa-preview.mjs';
const source=name=>fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');

function fixture({user={usuario:'domo',papel:'corretor',ehMaster:true},hash='#/admin/painel?visao=caixa&mes=2026-10',failure=null,conditionsOk=true,leadsOk=true,receipts,headerLinks=[]}={}){
 const {b}=criarFixtureVendas();prepararCaixaFixture(b);let calls=0;
 const handlers={},host={isConnected:true,innerHTML:'',addEventListener:(name,fn)=>{handlers[name]=fn;},querySelectorAll:()=>[]};
 const ctx=vm.createContext({Intl,Date,Math,URLSearchParams,location:{hash},STORE:{getUser:()=>user,api:async()=>{calls++;if(failure)throw failure;return {ok:true,recebimentos:receipts??[...b.table('vendas_recebimentos').values()]};}},console,crypto:{randomUUID:()=>Math.random().toString(36)}});ctx.window=ctx;
 vm.runInContext(source('caixa-domain.js'),ctx);
 ctx.DiamondCaixaDomain.hoje=()=> '2026-11-01';
 vm.runInContext(source('caixa-dashboard-domain.js'),ctx);
 vm.runInContext(source('caixa-dashboard.js'),ctx);
 vm.runInContext(source('caixa.js').replace('root.DiamondCaixa={render,wire};','root.__cxTest={parseValue,eventActive,submitWire,currentModel,dialog,openDashboardClient,getState:()=>state};root.DiamondCaixa={render,wire};'),ctx);
 const x={unidades:[...b.table('unidades').values()],condicoes:[...b.table('vendas_condicoes').values()],leads:[...b.table('leads').values()],unitsOk:true,conditionsOk,leadsOk};
 const initial=ctx.DiamondCaixa.render(x);
 const load=async()=>{ctx.DiamondCaixa.wire({querySelector:()=>host,querySelectorAll:()=>headerLinks},()=>{});await new Promise(resolve=>setImmediate(resolve));return host.innerHTML;};
 return {ctx,b,x,initial,load,host,handlers,calls:()=>calls};
}
const value=(html,name)=>html.match(new RegExp('data-cx-value="'+name+'">([^<]+)'))?.[1].replaceAll('\u00a0',' ');
const response=(operacaoId)=>({ok:true,registro:{unidadeId:'u-101',revisao:1,eventos:[{id:'event-'+operacaoId,operacaoId,tipo:'receber',parcelaId:'entrada',cronogramaChave:'fixture-key',data:'2026-10-31',valor:100}]}});

test('consulta pendente ou falha não apresenta recebido zero nem ações de baixa',async()=>{
 const t=fixture({failure:Error('Servidor indisponível')});
 assert.equal(value(t.initial,'recebido-parcelas'),'A conferir');
 assert.doesNotMatch(t.initial,/data-cx-confirm=/);
 const html=await t.load();
 assert.match(html,/Não foi possível consultar o caixa/);assert.equal(value(html,'a-receber'),'A conferir');assert.doesNotMatch(html,/data-cx-confirm=/);
});

test('mês de vencimento separa recebimentos das parcelas e data real em caixa',async()=>{
 const t=fixture();const ledger=t.b.table('vendas_recebimentos').get('u-101');ledger.eventos[1].data='2026-11-01';
 const html=await t.load();
 assert.equal(value(html,'previsto'),'R$ 20.000,00');assert.equal(value(html,'recebido-parcelas'),'R$ 5.000,00');
 assert.equal(value(html,'a-receber'),'R$ 15.000,00');assert.equal(value(html,'recebido-mes'),'R$ 2.000,00');
 assert.match(html,/Data real e busca; independe do filtro de parcelas/);assert.match(html,/sem projeção de reajuste ou INCC/);
 assert.match(html,/Cliente Exemplo sem Plano/);assert.match(html,/Condições da venda não informadas/);
});

test('ausência das condições mantém toda previsão indeterminada',async()=>{
 const html=await fixture({conditionsOk:false}).load();assert.match(html,/Condições de venda indisponíveis/);assert.equal(value(html,'previsto'),'A conferir');assert.doesNotMatch(html,/data-cx-confirm=/);
});


test('falha de clientes não transforma uma carteira vendida em previsão zero',async()=>{
 const t=fixture({leadsOk:false});t.x.leads=[];const html=await t.load();
 assert.match(html,/Cadastro de clientes indisponível/);assert.equal(value(html,'previsto'),'A conferir');assert.doesNotMatch(html,/data-cx-confirm=/);
});

test('equipe não master não consulta nem acessa confirmações',async()=>{
 for(const user of [{usuario:'domo',papel:'corretor',ehMaster:false},{usuario:'outra-equipe',papel:'corretor',ehMaster:true}]){
  const t=fixture({user});await t.load();assert.match(t.initial,/somente para a administração/);assert.equal(t.calls(),0);
 }
 const admin=fixture({user:{usuario:'admin',papel:'admin'}});await admin.load();assert.equal(admin.calls(),2);
});

test('sem vencimento é uma visão própria e não inventa o dia da entrada',async()=>{
 const html=await fixture({hash:'#/admin/painel?visao=caixa&mes=sem-data'}).load();
 assert.equal(value(html,'previsto'),'R$ 10.000,00');assert.match(html,/Entrada em dinheiro/);assert.match(html,/data da venda não foi usada/);
 assert.equal(value(html,'recebido-mes'),'A conferir');assert.match(html,/data-cx-confirm="u-101\|entrada"/);
});

test('cronograma alterado preserva caixa real e não rotula saldo desconhecido como recebido',async()=>{
 const t=fixture();t.x.condicoes.find(c=>c.unidadeId==='u-101').correcao='Condição alterada';
 const html=await t.load();assert.equal(value(html,'a-receber'),'A conferir');assert.equal(value(html,'recebido-mes'),'R$ 5.000,00');
 const row=html.split('<tr class="').find(r=>r.includes('Cliente Exemplo Um'));
 assert.match(row,/Conferir histórico/);assert.doesNotMatch(row,/✓ Recebido/);assert.doesNotMatch(row,/data-cx-confirm=/);
});

test('HTML escapa nomes e observações; histórico mostra estorno sem apagar original',async()=>{
 const t=fixture(),ledger=t.b.table('vendas_recebimentos').get('u-101'),original=ledger.eventos[0];
 t.x.leads.find(l=>l.id==='preview-u-101').cliente='<script>alert(1)</script>';
 original.observacao='<img src=x onerror=alert(1)>';
 ledger.eventos.push({...original,id:'reverse-1',operacaoId:'reverse-operation-1',tipo:'estornar',eventoId:original.id,motivo:'Valor lançado por engano',data:'2026-10-25',em:'2026-10-25T15:00:00.000Z'});ledger.revisao++;
 const html=await t.load();assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>alert/);
 assert.match(html,/&lt;img src=x/);assert.match(html,/Recebimento estornado/);assert.match(html,/Estorno registrado/);
 assert.equal(value(html,'recebido-parcelas'),'R$ 3.000,00');
});

test('valores brasileiros são convertidos em centavos inteiros e entradas ambíguas rejeitadas',()=>{
 const {ctx}=fixture(),parse=ctx.__cxTest.parseValue;
 assert.equal(parse('1.234,56'),123456);assert.equal(parse('0,01'),1);assert.equal(parse('R$ 10,5'),1050);
 for(const bad of ['1,234','-1','1e4','12.34','abc',''])assert.equal(parse(bad),null,bad);
});

test('repetição após timeout reutiliza operação e payload; não mostra sucesso antes da resposta',async()=>{
 const t=fixture();await t.load();const s=t.ctx.__cxTest.getState(),buttons=[{textContent:'Confirmar recebido',dataset:{},disabled:false},{dataset:{},disabled:false}],fields=[{readOnly:false}],error={textContent:''};let listener,closed=false,builds=0;
 const form={addEventListener:(event,fn)=>{listener=fn;},querySelector:()=>buttons[0],querySelectorAll:()=>fields};
 const el={querySelector:()=>error,querySelectorAll:()=>buttons,addEventListener(){},removeEventListener(){},close:()=>{closed=true;}};
 const requests=[];t.ctx.STORE.api=async(action,payload)=>{requests.push(JSON.parse(JSON.stringify(payload)));if(requests.length===1){const e=Error('Timeout');e.status=408;throw e;}return response(payload.operacaoId);};
 t.ctx.__cxTest.submitWire(form,el,s,()=>{builds++;return {operacao:'confirmar',operacaoId:'immutable-operation',unidadeId:'u-101',valor:100};},'Confirmado no servidor');
 await listener({preventDefault(){}});assert.equal(closed,false);assert.equal(s.notice,'');assert.equal(buttons[0].textContent,'Tentar novamente');assert.equal(fields[0].readOnly,true);
 await listener({preventDefault(){}});assert.equal(closed,true);assert.equal(builds,1);assert.deepEqual(requests[0],requests[1]);assert.equal(s.notice,'Confirmado no servidor');
});

test('conflito de revisão não libera repetição silenciosa com dados antigos',async()=>{
 const t=fixture();await t.load();const buttons=[{textContent:'Confirmar recebido',dataset:{}}],error={textContent:''};let listener;
 const form={addEventListener:(_,fn)=>{listener=fn;},querySelector:()=>buttons[0],querySelectorAll:()=>[]};
 const el={querySelector:()=>error,querySelectorAll:()=>buttons,addEventListener(){},removeEventListener(){},close(){throw Error('Não deveria fechar');}};
 t.ctx.STORE.api=async()=>{const e=Error('Revisão mudou');e.status=409;throw e;};
 t.ctx.__cxTest.submitWire(form,el,t.ctx.__cxTest.getState(),()=>({unidadeId:'u-101'}),'sucesso');
 await listener({preventDefault(){}});assert.equal(buttons[0].disabled,true);assert.match(error.textContent,/Atualizar caixa/);
});

test('dois cliques rápidos fazem apenas uma confirmação e bloqueiam fechamento durante a gravação',async()=>{
 const t=fixture();await t.load();const s=t.ctx.__cxTest.getState(),buttons=[{textContent:'Confirmar recebido',dataset:{}}],error={textContent:''};let listener,resolve,requests=0,closed=0,cancel;
 const form={addEventListener:(_,fn)=>{listener=fn;},querySelector:()=>buttons[0],querySelectorAll:()=>[]};
 const el={querySelector:()=>error,querySelectorAll:()=>buttons,addEventListener:(_,fn)=>{cancel=fn;},removeEventListener(){},close:()=>{closed++;}};
 t.ctx.STORE.api=()=>{requests++;return new Promise(r=>{resolve=r;});};
 t.ctx.__cxTest.submitWire(form,el,s,()=>({unidadeId:'u-101',operacaoId:'one-click'}),'Salvo');
 const first=listener({preventDefault(){}});await listener({preventDefault(){}});
 assert.equal(requests,1);assert.equal(buttons[0].disabled,true);let prevented=false;cancel({preventDefault(){prevented=true;}});assert.equal(prevented,true);assert.equal(closed,0);
 resolve(response('one-click'));await first;assert.equal(closed,1);
});

test('resposta malformada ou sem a operação solicitada mantém formulário e não afirma sucesso',async()=>{
 for(const invalid of [{ok:true,registro:{unidadeId:'u-101',revisao:2,eventos:[]}},response('another-operation')]){
  const t=fixture();await t.load();const s=t.ctx.__cxTest.getState(),before=JSON.stringify(s.ledgers),buttons=[{textContent:'Confirmar recebido',dataset:{}}],fields=[{readOnly:false,value:'1,00'}],error={textContent:''};let listener,closed=false;
  const form={addEventListener:(_,fn)=>{listener=fn;},querySelector:()=>buttons[0],querySelectorAll:()=>fields};
  const el={querySelector:()=>error,querySelectorAll:()=>buttons,addEventListener(){},removeEventListener(){},close(){closed=true;}};
  t.ctx.STORE.api=async()=>invalid;
  t.ctx.__cxTest.submitWire(form,el,s,()=>({unidadeId:'u-101',operacaoId:'expected-operation'}),'Sucesso');
  await listener({preventDefault(){}});assert.equal(closed,false);assert.equal(s.notice,'');assert.equal(JSON.stringify(s.ledgers),before);assert.equal(fields[0].value,'1,00');assert.match(error.textContent,/não confirmou esta operação/);
 }
});

test('repetição já estornada informa situação atual sem afirmar que o recebimento está ativo',async()=>{
 const t=fixture();await t.load();const s=t.ctx.__cxTest.getState(),buttons=[{textContent:'Confirmar recebido',dataset:{}}],error={textContent:''};let listener;
 const form={addEventListener:(_,fn)=>{listener=fn;},querySelector:()=>buttons[0],querySelectorAll:()=>[]};
 const el={querySelector:()=>error,querySelectorAll:()=>buttons,addEventListener(){},removeEventListener(){},close(){}};
 const saved=response('already-saved-operation'),original=saved.registro.eventos[0];saved.repetida=true;saved.registro.eventos.push({...original,id:'reversal',operacaoId:'reversal-operation',tipo:'estornar',eventoId:original.id});saved.registro.revisao=2;
 t.ctx.STORE.api=async()=>saved;t.ctx.__cxTest.submitWire(form,el,s,()=>({unidadeId:'u-101',operacaoId:'already-saved-operation'}),'Recebimento confirmado');
 await listener({preventDefault(){}});assert.match(s.notice,/Operação já registrada/);assert.doesNotMatch(s.notice,/Recebimento confirmado/);assert.equal(t.ctx.DiamondCaixaDomain.eventosAtivos(s.ledgers.find(l=>l.unidadeId==='u-101')).length,0);
});

test('dialog tem nome acessível e título escapado',()=>{
 const t=fixture(),attributes={},closeButton={},element={setAttribute:(key,value)=>{attributes[key]=value;},querySelector:()=>closeButton,addEventListener(){},showModal(){}};
 t.ctx.document={createElement:()=>element,body:{appendChild(){}}};
 t.ctx.__cxTest.dialog('Título <seguro>','<p>Conteúdo</p>');assert.equal(attributes['aria-label'],'Título <seguro>');assert.match(element.innerHTML,/<h2>Título &lt;seguro&gt;<\/h2>/);
});

test('filtros ficam na URL para sobreviver à atualização das condições',async()=>{
 const t=fixture();let savedUrl;t.ctx.FormData=class{constructor(form){this.values=form.values;}get(key){return this.values[key];}};
 t.ctx.history={replaceState:(_state,_title,url)=>{savedUrl=url;}};
 await t.load();t.handlers.submit({target:{id:'cx-filters',values:{mes:'2026-10',busca:'Cliente Exemplo Um',status:'pendentes'}},preventDefault(){}});
 assert.equal(savedUrl,'#/admin/painel?visao=caixa&mes=2026-10&caixaBusca=Cliente+Exemplo+Um&caixaStatus=pendentes');
 assert.equal(value(t.host.innerHTML,'previsto'),'R$ 10.000,00');assert.equal(value(t.host.innerHTML,'recebido-parcelas'),'R$ 5.000,00');
 assert.equal(t.host.innerHTML.match(/Histórico por data de recebimento <span class="cx-tag">(\d+) registro/)?.[1],'2');
});

test('aba Caixa acompanha o mês atual sem reconsultar nem alterar links das outras abas',async()=>{
 const anchor=href=>({href,getAttribute(){return this.href;},setAttribute(_key,value){this.href=value;}});
 const active=anchor('#/admin/painel?visao=caixa&mes=2026-10'),second=anchor('#/admin/painel?visao=caixa'),sales=anchor('#/admin/painel?visao=vendas&tipo=apartamento');
 const t=fixture({headerLinks:[active,second,sales]});let currentRoute;t.ctx.history={replaceState:(_state,_title,href)=>{currentRoute=href;}};
 t.ctx.FormData=class{constructor(form){this.values=form.values;}get(key){return this.values[key];}};
 await t.load();const requests=t.calls();
 t.handlers.submit({target:{id:'cx-filters',values:{mes:'2026-11',busca:'Cliente Exemplo Um',status:'pendentes'}},preventDefault(){}});
 assert.equal(currentRoute,'#/admin/painel?visao=caixa&mes=2026-11&caixaBusca=Cliente+Exemplo+Um&caixaStatus=pendentes');
 assert.equal(active.href,currentRoute);assert.equal(second.href,currentRoute);assert.equal(sales.href,'#/admin/painel?visao=vendas&tipo=apartamento');assert.equal(t.calls(),requests);
});

test('vencimento sem baixa é descrito como falta de confirmação, sem afirmar inadimplência',async()=>{
 const html=await fixture().load();assert.match(html,/Vencido sem confirmação:/);assert.match(html,/class="cx-warning-text">Vencida sem confirmação<\/small>/);assert.doesNotMatch(html,/>Vencida<\/small>/);
});

test('clique no gráfico mensal mantém busca e status, atualiza URL e não grava nem reconsulta',async()=>{
 const t=fixture({hash:'#/admin/painel?visao=caixa&mes=2026-10&caixaBusca=Cliente+Exemplo+Um&caixaStatus=pendentes'});
 let route,focused=0,scrolled=0;t.ctx.history={replaceState:(_s,_t,href)=>{route=href;}};
 await t.load();const requests=t.calls();t.host.querySelector=()=>({focus:()=>focused++,scrollIntoView:()=>scrolled++});
 const target={dataset:{cxdMonth:'2026-11'}};t.handlers.click({target:{closest:()=>target}});
 assert.equal(route,'#/admin/painel?visao=caixa&mes=2026-11&caixaBusca=Cliente+Exemplo+Um&caixaStatus=pendentes');
 assert.equal(value(t.host.innerHTML,'previsto'),'R$ 10.000,00');assert.equal(value(t.host.innerHTML,'a-receber'),'R$ 10.000,00');
 assert.equal(focused,1);assert.equal(scrolled,1);assert.equal(t.calls(),requests);
});

test('detalhamento do gráfico usa o cadastro exato mesmo quando clientes têm o mesmo nome',async()=>{
 const t=fixture();for(const id of ['preview-u-101','preview-u-102'])t.x.leads.find(l=>l.id===id).cliente='Cliente Homônimo';
 let shown=0;const element={classList:{add(){}},setAttribute(){},querySelector:()=>({}),addEventListener(){},showModal(){shown++;}};
 t.ctx.document={createElement:()=>element,body:{appendChild(){}}};await t.load();const requests=t.calls();
 t.handlers.click({target:{closest:()=>({dataset:{cxdClient:'preview-u-102'}})}});
 assert.equal(shown,1);assert.match(element.innerHTML,/Cliente Homônimo/);assert.match(element.innerHTML,/u-102\|parcela:0:1/);assert.doesNotMatch(element.innerHTML,/u-101\|/);
 assert.match(element.innerHTML,/10\.000,00/);assert.equal(t.calls(),requests);
});

test('cliques nos gráficos sem consulta confirmada não navegam nem abrem detalhes',async()=>{
 const t=fixture({failure:Error('Consulta indisponível')});await t.load();t.ctx.history={replaceState(){throw Error('Não deve navegar');}};
 t.ctx.document={createElement(){throw Error('Não deve abrir cliente');}};
 for(const dataset of [{cxdMonth:'2026-11'},{cxdClient:'preview-u-101'}])t.handlers.click({target:{closest:()=>({dataset})}});
 assert.equal(t.ctx.__cxTest.getState().filters.mes,'2026-10');assert.equal(t.calls(),1);
});
