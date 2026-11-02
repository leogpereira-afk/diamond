const {test}=require('node:test'), assert=require('node:assert/strict');
const D=require('../caixa-domain.js');
const u={id:'u-a',unidade:'101',status:'Vendido',clienteId:'c-a',atualizadoEm:'r1'};
const c={unidadeId:u.id,clienteId:u.clienteId,unidadeRevisao:'r1',total:100001,entrada:10000,data:'2026-01-01',permutas:[{valor:20000}],parcelas:[{descricao:'Mensais',quantidade:2,valor:35000,primeiro:'2026-10-31',intervalo:1},{descricao:'Ajuste',quantidade:1,valor:1,primeiro:'2026-12-01',intervalo:1}]};
const copy=x=>JSON.parse(JSON.stringify(x));
const run=(extra={})=>D.build({unidades:[u],condicoes:[c],leads:[{id:'c-a',cliente:'Cliente exemplo'}],hoje:'2026-11-01',mes:'2026-10',...extra});
const event=(extra={})=>({id:'e1',tipo:'receber',parcelaId:'parcela:0:1',cronogramaChave:D.cronograma(c,u).chave,valor:10000,data:'2026-11-01',operacaoId:'op1',em:'2026-11-01T12:00:00Z',fonte:{clienteId:'c-a',unidade:'101',cliente:'Cliente exemplo',descricao:'Mensais',vencimento:'2026-10-31',valorPrevisto:35000},...extra});
const ledger=(evs=[event()])=>({unidadeId:u.id,revisao:evs.length,eventos:evs});
test('datas ISO reais, bissexto e clamp sem perder dia original',()=>{
  assert.equal(D.dia('2026-02-29'),false);assert.equal(D.dia('2028-02-29'),true);assert.equal(D.dia('2026-13-01'),false);
  assert.equal(D.somarMeses('2026-01-31',1),'2026-02-28');assert.equal(D.somarMeses('2026-01-31',2),'2026-03-31');
  assert.equal(D.somarMeses('2028-01-31',1),'2028-02-29');assert.equal(D.somarMeses('2026-11-30',3),'2027-02-28');
  assert.throws(()=>D.somarMeses('2199-12-01',1));
});
test('cronograma conserva centavo e exclui permuta; entrada sem data não é inventada',()=>{
  const p=D.cronograma(c,u);assert.equal(p.ok,true);assert.equal(p.permuta,20000);assert.equal(p.semData,true);assert.equal(p.parcelas[0].vencimento,null);
  assert.equal(p.parcelas.reduce((s,p)=>s+p.valor,0)+p.permuta,c.total);assert.equal(p.parcelas[2].vencimento,'2026-11-30');
  assert.equal(run().resumo.previsto,35000);assert.equal(run({mes:'sem-data'}).resumo.previsto,10000);assert.equal(run().pendencias.length,1);
});
test('venda somente permuta tem caixa zero informado, sem baixa inventada',()=>{
  const p={...c,entrada:0,total:20000,parcelas:[]};const b=run({condicoes:[p]});assert.equal(b.linhas.length,0);assert.equal(b.permutas,20000);assert.equal(b.resumo.previsto,0);assert.equal(b.resumo.recebidoNoMes,0);
});
test('parcelamento incompleto inclui apenas série informada e identifica lacuna',()=>{
  const b=run({condicoes:[{...c,total:150001,composicaoPendente:true}]});assert.equal(b.resumo.previsto,35000);assert.equal(b.pendencias.find(p=>p.motivo.includes('completar')).valor,50000);
});
for(const [label,patch,unit] of [
  ['revisão obsoleta',{unidadeRevisao:'r0'}],['cliente trocado',{clienteId:'outro'}],['total incorreto',{total:1}],['centavo fracionário',{total:100001.5}],['série negativa',{parcelas:[{...c.parcelas[0],valor:-1}]}],['data impossível',{parcelas:[{...c.parcelas[0],primeiro:'2026-02-30'}]}],['prazo desmedido',{total:1000000,parcelas:[{...c.parcelas[0],quantidade:600,valor:1,intervalo:120}],composicaoPendente:true}],['unidade reaberta',{}, {...u,status:'Disponível'}],['cliente ausente',{}, {...u,clienteId:null}],['composição incompleta não marcada',{total:150001}],
]) test('cronograma recusa '+label,()=>assert.equal(D.cronograma({...c,...patch},unit||u).ok,false));
test('identidade ignora observação/nome de série/revisão; conserva termos financeiros',()=>{
  const k=D.cronograma(c,u).chave;
  assert.equal(D.cronograma({...c,observacoes:'nova',revisao:9,parcelas:c.parcelas.map(p=>({...p,descricao:'outro texto'}))},u).chave,k);
  assert.notEqual(D.cronograma({...c,correcao:'Índice X'},u).chave,k);
  assert.notEqual(D.cronograma({...c,parcelas:c.parcelas.map((p,i)=>i?{...p}: {...p,primeiro:'2026-10-30'})},u).chave,k);
});
test('recebimento parcial usa mês do vencimento no saldo e mês real no caixa',()=>{
  const r=ledger(),out=run({recebimentos:[r]}),nov=run({recebimentos:[r],mes:'2026-11'});
  assert.deepEqual(out.resumo,{previsto:35000,recebidoParcelas:10000,aReceber:25000,vencido:25000,recebidoNoMes:0,recebidoSemDataExata:0});
  assert.equal(nov.resumo.recebidoNoMes,10000);assert.equal(nov.resumo.recebidoParcelas,0);assert.equal(out.filtradas[0].status,'parcial');
});
test('várias baixas fecham uma parcela exatamente',()=>{
  const b=run({recebimentos:[ledger([event(),event({id:'e2',operacaoId:'op2',valor:25000})])]});assert.equal(b.filtradas[0].saldo,0);assert.equal(b.filtradas[0].status,'recebido');assert.equal(b.resumo.vencido,0);
});
test('estorno preserva histórico e reabre saldo sem movimentar caixa fictício',()=>{
  const e=event(),s=event({id:'s1',tipo:'estornar',eventoId:e.id,operacaoId:'op2',data:'2026-11-02'}),r=ledger([e,s]);
  assert.equal(D.validarLedger(r),true);assert.deepEqual(D.eventosAtivos(r),[]);const b=run({recebimentos:[r]});assert.equal(b.resumo.aReceber,35000);assert.equal(b.historico.length,2);assert.equal(b.recebimentos.length,0);
});
test('mudança de calendário preserva caixa real e bloqueia saldo incerto',()=>{
  const novo={...c,parcelas:c.parcelas.map((p,i)=>i?p:{...p,primeiro:'2026-10-30'})};const b=run({condicoes:[novo],recebimentos:[ledger()],mes:'2026-11'});
  assert.equal(b.resumo.recebidoNoMes,10000);assert.equal(b.resumo.aReceber,null);assert.equal(b.linhas[1].conferir,true);assert.match(b.pendencias.map(p=>p.motivo).join(' '),/cronograma mudou/);
});
test('reabertura de unidade conserva baixas no caixa e histórico de origem',()=>{
  const b=run({unidades:[{...u,status:'Disponível'}],recebimentos:[ledger()],mes:'2026-11'});assert.equal(b.linhas.length,0);assert.equal(b.resumo.recebidoNoMes,10000);assert.equal(b.historico[0].cliente,'Cliente exemplo');assert.ok(b.pendencias.some(p=>/reaberta/.test(p.motivo)));
});
for(const [label,modify] of [
  ['evento duplicado',r=>r.eventos.push(copy(r.eventos[0]))],['operação duplicada',r=>r.eventos.push(event({id:'e2'}))],['revisão inválida',r=>r.revisao=8],['data impossível',r=>r.eventos[0].data='2026-02-30'],['recebido negativo',r=>r.eventos[0].valor=-1],['estorno sem original',r=>r.eventos[0].tipo='estornar'],['estorno duas vezes',r=>{r.eventos.push(event({id:'s1',operacaoId:'s1',tipo:'estornar',eventoId:'e1'}));r.eventos.push(event({id:'s2',operacaoId:'s2',tipo:'estornar',eventoId:'e1'}));}],
]) test('ledger falha fechado: '+label,()=>{const r=ledger();modify(r);if(label!=='revisão inválida')r.revisao=r.eventos.length;assert.equal(D.validarLedger(r),false);const b=run({recebimentos:[r]});assert.equal(b.resumo.aReceber,null);assert.equal(b.resumo.recebidoNoMes,null);assert.throws(()=>D.eventosAtivos(r));});
test('ledger duplicado não soma duas vezes nem presume recebimento zero',()=>{
  const b=run({recebimentos:[ledger(),ledger()]});assert.equal(b.resumo.aReceber,null);assert.equal(b.resumo.recebidoNoMes,null);
});
test('excesso no ledger não produz saldo negativo',()=>{const b=run({recebimentos:[ledger([event({valor:35001})])]});assert.equal(b.resumo.aReceber,null);assert.equal(b.filtradas[0].conferir,true);});
test('filtros reconciliam indicadores com detalhes e busca não distingue acento',()=>{
  const b=run({leads:[{id:'c-a',cliente:'Ficção'}],busca:'FICCAO',status:'pendentes'});assert.equal(b.filtradas.length,1);assert.equal(b.resumo.previsto,b.filtradas.reduce((s,r)=>s+r.valor,0));assert.equal(run({busca:'inexistente'}).resumo.previsto,0);
});
test('sem comprador ou condições válidas não inventa previsão',()=>{
  assert.equal(run({leads:[]}).linhas.length,0);assert.equal(run({condicoes:[]}).linhas.length,0);assert.ok(run({leads:[]}).pendencias.length);
});
test('motor não modifica fontes e mantém meses vazios no calendário',()=>{
  const args={unidades:[copy(u)],condicoes:[copy(c)],leads:[{id:'c-a',cliente:'Exemplo'}],recebimentos:[ledger()],hoje:'2026-11-01',mes:'2026-08'},antes=JSON.stringify(args);const b=D.build(args);assert.equal(JSON.stringify(args),antes);assert.deepEqual(b.meses,['2026-08','2026-09','2026-10','2026-11','2026-12']);
});
test('permuta nula vira pendência da unidade, sem derrubar as demais',()=>{const b=run({condicoes:[{...c,permutas:[null]}]});assert.equal(b.linhas.length,0);assert.match(b.pendencias[0].motivo,/permuta inválido/);});
test('histórico inválido fora do estoque aparece nas pendências',()=>{const b=run({recebimentos:[{unidadeId:'fora-do-estoque',revisao:1,eventos:[]}]});assert.equal(b.resumo.recebidoNoMes,null);assert.ok(b.pendencias.some(p=>p.unidadeId==='fora-do-estoque'));});

test('confirmação histórica quita por vencimento sem inventar entrada de caixa na data-base',()=>{
 const e=event({valor:35000,data:'2026-10-31',confirmacaoHistorica:{versao:1,ate:'2026-10-31',consolidacao:null}}),r=run({recebimentos:[ledger([e])]});
 assert.equal(r.resumo.recebidoParcelas,35000);assert.equal(r.resumo.aReceber,0);assert.equal(r.resumo.recebidoNoMes,0);assert.equal(r.resumo.recebidoSemDataExata,35000);assert.equal(D.confirmacaoHistorica(e).ate,'2026-10-31');
});
test('metadados históricos inválidos não ocultam entrada nem geram quitação aparente',()=>{
 const e=event({data:'2026-10-31',confirmacaoHistorica:{versao:1,ate:'2026-09-31',consolidacao:null}});assert.equal(D.validarLedger(ledger([e])),false);assert.equal(run({recebimentos:[ledger([e])]}).resumo.recebidoParcelas,null);
});
