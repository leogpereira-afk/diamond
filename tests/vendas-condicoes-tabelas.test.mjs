import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {source,copy,backend} from './helpers.mjs';
import {validarCondicoes,executarCondicoes} from '../supabase/functions/dmd-api/condicoes-api.mjs';
const unidade={id:'u-401',unidade:'401',status:'Vendido',clienteId:'c-demo',atualizadoEm:'rev1',precoBase:400000,precoVersao:'tb2',desconto:.02};
const cfg={tabelaId:'tb2',versao:'v2',dataTabela:'01/10/2026',reajuste:0};
const historico={id:'tb2',versaoAnterior:'v1',versaoNova:'v2',dataTabela:'01/10/2026',cfgAntes:{versao:'v1',dataTabela:'01/09/2026'},cfgDepois:cfg,itens:[{id:'u-401',unidade:'401',anterior:350000,novo:400000,desconto:.02}]};
const dados={total:39000000,entrada:5000000,data:'2026-10-01',permutas:[{descricao:'Bem de teste',valor:10000000}],parcelas:[{descricao:'Mensais',valor:1000000,quantidade:24,intervalo:1,primeiro:'2026-11-01'}],observacoes:'Preservar observação',correcao:'Conforme contrato'};
const request={operacao:'salvar',unidadeId:unidade.id,unidadeRevisao:'rev1',revisao:0,dados};
function setup(options={}){const b=backend(options);b.table('unidades').set(unidade.id,copy(unidade));b.table('leads').set(unidade.clienteId,{id:unidade.clienteId,cliente:'Cliente sintético'});b.table('cfg').set('cfg',copy(cfg));b.table('precos_historico').set('tb2',copy(historico));return b;}

test('cadastro rápido exige pendência explícita e mantém componentes sem inventar pagamento',()=>{
 assert.throws(()=>validarCondicoes({...dados,total:40000000},'2026-10-31'),/exatamente/);
 const r=validarCondicoes({...dados,total:40000000,composicaoPendente:true,saldoAInformar:1},'2026-10-31');
 assert.equal(r.saldoAInformar,1000000);assert.equal(r.composicaoPendente,true);assert.deepEqual(r.permutas,dados.permutas);assert.deepEqual(r.parcelas,dados.parcelas);assert.equal(r.entrada,dados.entrada);assert.equal(r.recebido,undefined);
 assert.throws(()=>validarCondicoes({...dados,total:38000000,composicaoPendente:true},'2026-10-31'),/exced|ultrapass|maior/);
 const fechado=validarCondicoes({...dados,composicaoPendente:true},'2026-10-31');assert.equal(fechado.composicaoPendente,false);assert.equal(fechado.saldoAInformar,0);
});
test('carregar permite gestão Domo e retorna escolhas iguais à proposta sem expor dados administrativos',async()=>{
 const b=setup();b.table('cfg').get('cfg').segredo='NÃO EXPOR';
 const r=await b.request('vendasCondicoes',{operacao:'carregar',unidadeId:unidade.id});assert.equal(r.status,200);assert.equal(r.condicao,null);assert.equal(r.unidade.id,unidade.id);
 const ctx=vm.createContext({});vm.runInContext(source('proposta-domain.js'),ctx);
 assert.deepEqual(r.tabelas,copy(ctx.DiamondProposta.tabelas(unidade,cfg,[historico])));assert.ok(!JSON.stringify(r).includes('NÃO EXPOR'));
 for(const user of ['cliente',null])assert.equal((await b.request('vendasCondicoes',{operacao:'carregar',unidadeId:unidade.id},user)).status,403);
 assert.equal((await b.request('precosHistorico',{})).status,403);
});
test('valor vendido e tabela são independentes; snapshot é resolvido no servidor e preservado quando omitido',async()=>{
 const b=setup();const select='versao:'+JSON.stringify(['v1','01/09/2026']);
 let r=await b.request('vendasCondicoes',{...request,tabelaSelecao:select,dados:{...dados,tabelaVenda:{versao:'FALSA',neg:1}}});assert.equal(r.status,200);
 assert.equal(r.registro.total,39000000);assert.equal(r.registro.tabelaVenda.versao,'v1');assert.equal(r.registro.tabelaVenda.neg,343000);assert.equal(r.registro.tabelaVenda.origem,'reconstruida');assert.deepEqual(b.table('unidades').get(unidade.id),unidade);
 const anterior=copy(r.registro.tabelaVenda);
 r=await b.request('vendasCondicoes',{...request,revisao:1,dados:{...dados,total:40000000,composicaoPendente:true}});assert.equal(r.status,200);assert.deepEqual(r.registro.tabelaVenda,anterior);assert.equal(r.registro.historico[0].total,39000000);assert.equal(r.registro.saldoAInformar,1000000);
 r=await b.request('vendasCondicoes',{...request,revisao:2,tabelaSelecao:null});assert.equal(r.status,200);assert.equal(r.registro.tabelaVenda,null);
});
test('seleção inexistente ou tabela sem preço da unidade falha sem escrever',async()=>{
 const b=setup();for(const key of ['tabela:inexistente','versao:["v404",""]']){const r=await b.request('vendasCondicoes',{...request,tabelaSelecao:key});assert.equal(r.status,400);assert.match(r.erro,/tabela/i);}assert.equal(b.table('vendas_condicoes').size,0);
});
test('conflito de unidade no instante da gravação não grava total nem tabela',async()=>{
 const b=setup({beforeCondicoesCommit:({table})=>{table('unidades').get(unidade.id).status='Disponível';}});
 const r=await b.request('vendasCondicoes',{...request,tabelaSelecao:'atual'});assert.equal(r.status,409);assert.equal(b.table('vendas_condicoes').size,0);
});
test('conflito da fonte de tabela ou revisão de condições impede gravação parcial',async()=>{
 for(const target of ['cfg','precos_historico','vendas_condicoes']){
  const b=setup({beforeCondicoesCommit:({table})=>{if(target==='cfg')table('cfg').get('cfg').versao='v99';if(target==='precos_historico')table('precos_historico').get('tb2').itens[0].anterior=1;if(target==='vendas_condicoes')table('vendas_condicoes').set(unidade.id,{revisao:99,total:1});}});
  const key=target==='precos_historico'?'versao:'+JSON.stringify(['v1','01/09/2026']):'atual';const r=await b.request('vendasCondicoes',{...request,tabelaSelecao:key});assert.equal(r.status,409);assert.notEqual(b.table('vendas_condicoes').get(unidade.id)?.total,dados.total);
 }
});
test('dashboard diferencia total informado, composição completa e saldo por detalhar',()=>{
 const ctx=vm.createContext({Intl,Date});vm.runInContext(source('gestao-domain.js'),ctx);vm.runInContext(source('gestao-insights.js'),ctx);
 const c={...dados,total:40000000,composicaoPendente:true,saldoAInformar:1000000,unidadeId:unidade.id,clienteId:unidade.clienteId,unidadeRevisao:unidade.atualizadoEm};
 const m=ctx.DiamondInsights.build({unidades:[unidade],condicoes:[c],cfg});assert.equal(m.total,40000000);assert.equal(m.composicoesCompletas.length,0);assert.equal(m.composicoesPendentes.length,1);assert.equal(m.saldoAInformar,1000000);assert.equal(m.total,m.entrada+m.permuta+m.parcelado+m.saldoAInformar);assert.equal(m.semContrato.length,0);
});

test('reconstruções de tabela seguem a mesma ordem cronológica do histórico administrativo',async()=>{
 const b=setup();const antigo={...copy(historico),id:'tb1',criadoEm:'2026-09-01T12:00:00Z',cfgDepois:{tabelaId:'tb1',versao:'v1',dataTabela:'01/09/2026'},cfgAntes:{versao:'v0',dataTabela:''}};antigo.itens[0].anterior=320000;
 const recente={...copy(historico),criadoEm:'2026-10-01T12:00:00Z',cfgAntes:{versao:'v0',dataTabela:''}};recente.itens[0].anterior=350000;
 b.table('precos_historico').clear();b.table('precos_historico').set('tb1',antigo);b.table('precos_historico').set('tb2',recente);
 const r=await b.request('vendasCondicoes',{operacao:'carregar',unidadeId:unidade.id});assert.equal(r.status,200);
 assert.equal(r.tabelas.find(t=>t.versao==='v0').valorTabela,350000);
});
test('dois salvamentos da mesma revisão não sobrescrevem uma venda silenciosamente',async()=>{
 const b=setup();const resultados=await Promise.all([b.request('vendasCondicoes',request),b.request('vendasCondicoes',{...request,dados:{...dados,total:40000000,composicaoPendente:true}})]);
 assert.deepEqual(resultados.map(r=>r.status).sort(),[200,409]);assert.equal(b.table('vendas_condicoes').get(unidade.id).revisao,1);
});
test('perda de vínculo de comprador antes do commit impede alteração de valor',async()=>{
 const b=setup({beforeCondicoesCommit:({table})=>table('leads').delete(unidade.clienteId)});const r=await b.request('vendasCondicoes',request);assert.equal(r.status,409);assert.equal(b.table('vendas_condicoes').size,0);
});
test('dados inválidos e redução abaixo da composição não apagam o contrato existente',async()=>{
 const b=setup();assert.equal((await b.request('vendasCondicoes',request)).status,200);const antes=copy(b.table('vendas_condicoes').get(unidade.id));
 for(const extra of [{total:1,composicaoPendente:true},{total:-1},{total:0},{total:'39000000'},{total:39000000.5},{data:'2026-02-30'}]){const r=await b.request('vendasCondicoes',{...request,revisao:1,dados:{...dados,...extra}});assert.equal(r.status,400);assert.deepEqual(b.table('vendas_condicoes').get(unidade.id),antes);}
});
test('tabela salva fica congelada quando uma nova tabela é aplicada depois',async()=>{
 const b=setup();let r=await b.request('vendasCondicoes',{...request,tabelaSelecao:{key:'atual',valorTabela:1,versao:'FALSA'}});assert.equal(r.status,200);const original=copy(r.registro.tabelaVenda);
 b.table('cfg').get('cfg').versao='v3';b.table('cfg').get('cfg').tabelaId='tb3';b.table('unidades').get(unidade.id).atualizadoEm='rev2';b.table('unidades').get(unidade.id).precoBase=450000;
 r=await b.request('vendasCondicoes',{...request,revisao:1,unidadeRevisao:'rev2'});assert.equal(r.status,200);assert.deepEqual(r.registro.tabelaVenda,original);assert.equal(r.registro.total,dados.total);
});
test('seleção exibida no modal não pode ser substituída por tabela alterada antes do clique em salvar',async()=>{
 const b=setup();const carregado=await b.request('vendasCondicoes',{operacao:'carregar',unidadeId:unidade.id});const esperada=carregado.tabelas.find(t=>t.key==='atual');
 // Uma mudança apenas nos metadados pode não ter alterado a revisão da unidade.
 b.table('cfg').get('cfg').versao='v99';
 const r=await b.request('vendasCondicoes',{...request,tabelaSelecao:{key:'atual',esperada}});assert.equal(r.status,409);assert.match(r.erro,/tabela/i);assert.equal(b.table('vendas_condicoes').size,0);
});
test('snapshot esperado aceita ordem diferente de propriedades, sem aceitar valores forjados',async()=>{
 const b=setup();const c=await b.request('vendasCondicoes',{operacao:'carregar',unidadeId:unidade.id});const esperada=Object.fromEntries(Object.entries(c.tabelas[0]).reverse());
 const r=await b.request('vendasCondicoes',{...request,tabelaSelecao:{key:esperada.key,esperada}});assert.equal(r.status,200);assert.deepEqual(r.registro.tabelaVenda,c.tabelas[0]);
 const forjada={...esperada,neg:1};assert.equal((await b.request('vendasCondicoes',{...request,revisao:1,tabelaSelecao:{key:esperada.key,esperada:forjada}})).status,409);
});
