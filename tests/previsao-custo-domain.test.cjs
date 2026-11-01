const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const context=vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../previsao-custo-domain.js'),'utf8'),context);
const D=context.DiamondPrevisaoDomain;
const row=(id='a')=>({
 u:{id,unidade:'Unidade sintética '+id,status:'Vendido',clienteId:'cliente-'+id,atualizadoEm:'revisao-unidade-1'},
 preco:130000,
 contrato:{unidadeId:id,clienteId:'cliente-'+id,unidadeRevisao:'revisao-unidade-1',revisao:1,total:100000,entrada:10000,permutas:[{descricao:'Permuta sintética',valor:20000}],parcelas:[{descricao:'Mensais',valor:4000,quantidade:10},{descricao:'Final',valor:30000,quantidade:1}]}
});
const manual=r=>({contractKey:D.contractKey(r),commissionCents:5000,finalSeriesIndices:[1],receivedCommonCents:10000,receivedFinalCents:0});
const settings={targetCents:200000,futurePaymentShare:.5,futureCommissionRate:.05,selectedInventoryIds:[]};
function build(r=row(),options={}){
 return D.build({rows:[r],settings,finance:{contributionsCents:10000,contracts:{[r.u.id]:manual(r)}},...options});
}
const snapshot=x=>JSON.parse(JSON.stringify(x));

test('cobertura soma aporte, bruto, comissão e final uma única vez',()=>{
 const r=build();
 assert.equal(r.totals.grossCents,100000);
 assert.equal(r.totals.permutaCents,20000);
 assert.equal(r.contracts[0].contributionCents,65000);
 assert.equal(r.totals.coverageCents,75000);
 assert.equal(r.totals.shortfallCents,125000);
 assert.equal(r.future.requiredGrossCents,277778);
 assert.equal(r.totals.coverageComplete,true);
 assert.equal(r.contracts[0].commonReceivableCents,50000);
 assert.equal(r.contracts[0].outstandingCommonCents,40000);
});

test('recebido comum e final conciliam o contrato e nunca aumentam cobertura',()=>{
 const r=row();
 const a=build(r),b=build(r,{finance:{contributionsCents:10000,contracts:{a:{...manual(r),receivedCommonCents:50000,receivedFinalCents:30000}}}});
 assert.equal(a.totals.coverageCents,b.totals.coverageCents);
 assert.equal(b.totals.receivedCommonCents,50000);
 assert.equal(b.totals.receivedFinalCents,30000);
 assert.equal(b.contracts[0].outstandingCommonCents,0);
 assert.equal(b.contracts[0].outstandingFinalCents,0);
 assert.equal(b.totals.receivedComplete,true);
});

test('recebimentos ausentes não viram zero e não impedem cobertura contratual',()=>{
 const r=row(),m=manual(r);delete m.receivedCommonCents;delete m.receivedFinalCents;
 const result=build(r,{finance:{contributionsCents:10000,contracts:{a:m}}});
 assert.equal(result.totals.receivedCommonCents,null);
 assert.equal(result.totals.receivedFinalCents,null);
 assert.equal(result.totals.receivedComplete,false);
 assert.equal(result.totals.coverageCents,75000);
});

test('recebimentos negativos, fracionários ou superiores ao contratado são inválidos',()=>{
 const r=row();
 for(const changes of [{receivedCommonCents:-1},{receivedCommonCents:1.5},{receivedCommonCents:50001},{receivedFinalCents:-1},{receivedFinalCents:30001}]){
  const result=build(r,{finance:{contributionsCents:10000,contracts:{a:{...manual(r),...changes}}}});
  assert.equal(result.contracts[0].receiptsComplete,false);
  assert.equal(result.totals.receivedComplete,false);
  assert.equal(result.totals.coverageCents,75000);
 }
});

test('comissão ausente deixa cobertura parcial; comissão zero explícita é aceita',()=>{
 const r=row(),m=manual(r);delete m.commissionCents;
 const missing=build(r,{finance:{contributionsCents:10000,contracts:{a:m}}});
 assert.equal(missing.contracts[0].commissionCents,null);
 assert.equal(missing.totals.commissionCents,null);
 assert.equal(missing.totals.commissionKnownCents,0);
 assert.equal(missing.totals.coverageKnownCents,10000);
 assert.equal(missing.totals.coverageCents,null);
 assert.equal(missing.totals.shortfallCents,null);
 assert.equal(missing.future.requiredGrossCents,null);
 assert.equal(missing.totals.targetStatus,'unknown');
 const zero=build(r,{finance:{contributionsCents:10000,contracts:{a:{...m,commissionCents:0}}}});
 assert.equal(zero.totals.coverageCents,80000);
});

test('finais só existem por índice explícito; nome e data não inferem final',()=>{
 const r=row(),m=manual(r);delete m.finalSeriesIndices;
 const missing=build(r,{finance:{contributionsCents:0,contracts:{a:m}}});
 assert.equal(missing.contracts[0].finalCents,null);
 assert.equal(missing.totals.coverageCents,null);
 const none=build(r,{finance:{contributionsCents:0,contracts:{a:{...m,finalSeriesIndices:[]}}}});
 assert.equal(none.contracts[0].finalCents,0);
 assert.equal(none.totals.coverageCents,95000);
 const multiple=build(r,{finance:{contributionsCents:0,contracts:{a:{...m,finalSeriesIndices:[0,1],receivedCommonCents:0}}}});
 assert.equal(multiple.contracts[0].finalCents,70000);
 assert.equal(multiple.totals.coverageCents,25000);
});

test('índices de final repetidos, ausentes ou inválidos não são descartados silenciosamente',()=>{
 const r=row();
 for(const indices of [[1,1],[-1],[2],['1'],[.5],null]){
  const result=build(r,{finance:{contributionsCents:0,contracts:{a:{...manual(r),finalSeriesIndices:indices}}}});
  assert.equal(result.contracts[0].finalCents,null);
  assert.equal(result.totals.coverageCents,null);
 }
});

test('saldo contratual não composto impede conclusão da cobertura',()=>{
 const r=row();r.contrato.total+=1000;
 const result=build(r);
 assert.equal(result.contracts[0].unallocatedCents,1000);
 assert.equal(result.contracts[0].compositionComplete,false);
 assert.equal(result.contracts[0].contributionCents,null);
 assert.equal(result.totals.coverageKnownCents,10000);
 assert.equal(result.future.requiredGrossCents,null);
});

test('entrada ou séries não informadas não viram zero',()=>{
 for(const key of ['entrada','permutas','parcelas']){
  const r=row();delete r.contrato[key];
  const result=build(r);
  assert.equal(result.totals.coverageComplete,false);
  assert.equal(result.totals.shortfallCents,null);
 }
});

test('composição maior que o bruto, valores negativos e comissão excessiva são inválidos',()=>{
 const excess=row();excess.contrato.entrada++;
 assert.equal(build(excess).contracts[0].coverageComplete,false);
 const negative=row();negative.contrato.permutas[0].valor=-1;
 assert.equal(build(negative).contracts[0].permutaCents,null);
 const r=row();
 for(const commissionCents of [-1,100001,1.1,'0']){
  assert.equal(build(r,{finance:{contributionsCents:0,contracts:{a:{...manual(r),commissionCents}}}}).contracts[0].commissionCents,null);
 }
});

test('dados manuais antigos não são reaplicados após revisão ou alteração da composição',()=>{
 const original=row(),saved=manual(original);
 for(const mutate of [r=>r.contrato.revisao++,r=>{r.contrato.parcelas.reverse();},r=>{r.contrato.entrada+=1;r.contrato.parcelas[1].valor-=1;}]){
  const r=snapshot(original);mutate(r);
  const result=build(r,{finance:{contributionsCents:10000,contracts:{a:saved}}});
  assert.equal(result.contracts[0].manualCurrent,false);
  assert.equal(result.contracts[0].contributionCents,null);
  assert.ok(result.issues.some(i=>i.code==='manual_stale'));
 }
});

test('cancelamentos e reaberturas excluem contratos e recebimentos antigos',()=>{
 for(const changes of [{status:'Disponível'},{status:'Reservado'}]){
  const r=row();Object.assign(r.u,changes);
  const result=build(r);
  assert.equal(result.contracts.length,0);
  assert.equal(result.totals.grossCents,0);
  assert.equal(result.totals.receivedCommonCents,0);
  assert.equal(result.totals.coverageCents,10000);
 }
 const r=row();r.contrato.cancelado=true;
 assert.equal(build(r).contracts.length,0);
 assert.equal(build(r).totals.coverageCents,10000);
});

test('venda sem contrato vigente é pendência e bloqueia meta conclusiva',()=>{
 for(const mutate of [r=>{r.contrato=null;},r=>{r.contrato.unidadeRevisao='antiga';},r=>{r.contrato.clienteId='outro';},r=>{r.contrato.unidadeId='outro';},r=>{delete r.contrato.unidadeRevisao;delete r.u.atualizadoEm;}]){
  const r=row();mutate(r);
  const result=build(r);
  assert.equal(result.contracts.length,0);
  assert.equal(result.unconfirmedContracts.length,1);
  assert.equal(result.totals.coverageKnownCents,10000);
  assert.equal(result.totals.coverageCents,null);
  assert.equal(result.totals.grossCents,null);
 }
});

test('aportes ausentes bloqueiam conclusão, aporte zero explícito é válido',()=>{
 const r=row();
 const missing=build(r,{finance:{contracts:{a:manual(r)}}});
 assert.equal(missing.contributionsCents,null);
 assert.equal(missing.totals.coverageKnownCents,65000);
 assert.equal(missing.totals.coverageCents,null);
 assert.equal(build(r,{finance:{contributionsCents:0,contracts:{a:manual(r)}}}).totals.coverageCents,65000);
});

test('contratos completos compõem subtotal enquanto outro contrato permanece pendente',()=>{
 const a=row(),b=row('b');
 const result=build(a,{rows:[a,b],finance:{contributionsCents:10000,contracts:{a:manual(a)}}});
 assert.equal(result.contracts.length,2);
 assert.equal(result.totals.grossCents,200000);
 assert.equal(result.totals.coverageKnownCents,75000);
 assert.equal(result.totals.coverageCents,null);
 assert.equal(result.totals.shortfallKnownCents,125000);
});

test('comissão futura incide em todo o contrato e P padrão é 50%',()=>{
 const r=D.build({rows:[],settings:{targetCents:45000,futureCommissionRate:.05},finance:{contributionsCents:0}});
 assert.equal(r.future.P,.5);
 assert.equal(r.future.F,.5);
 assert.equal(r.future.requiredGrossCents,100000);
 assert.equal(r.future.netShare,.45);
});

test('meta futura arredonda para cima sem centavo extra por ponto flutuante',()=>{
 for(const [targetCents,P,C,expected] of [[1,.5,.05,3],[100,.5,.05,223],[45000,.5,.05,100000],[30,.3,0,100],[1,1,0,1]]){
  const r=D.build({rows:[],settings:{targetCents,futurePaymentShare:P,futureCommissionRate:C},finance:{contributionsCents:0}});
  assert.equal(r.future.requiredGrossCents,expected);
 }
});

test('exige 0 ≤ C < P ≤ 1, inclusive comissão futura zero explícita',()=>{
 for(const [P,C] of [[.5,undefined],[.5,null],[.5,-.01],[.5,.5],[.5,.6],[0,0],[1.01,.05],[NaN,.05],[.5,'0.05']]){
  const r=D.build({rows:[],settings:{targetCents:100,futurePaymentShare:P,futureCommissionRate:C},finance:{contributionsCents:0}});
  assert.equal(r.future.valid,false);
  assert.equal(r.future.requiredGrossCents,null);
 }
 const zero=D.build({rows:[],settings:{targetCents:100,futureCommissionRate:0},finance:{contributionsCents:0}});
 assert.equal(zero.future.valid,true);
 assert.equal(zero.future.requiredGrossCents,200);
});

test('meta satisfeita resulta em necessidade zero, inclusive com estoque vazio',()=>{
 const result=build(row(),{settings:{...settings,targetCents:75000}});
 assert.equal(result.totals.shortfallCents,0);
 assert.equal(result.future.requiredGrossCents,0);
 assert.equal(result.inventory.availableGrossCents,0);
 assert.equal(result.inventory.coversShortfall,true);
});

test('meta zero não representa objetivo atingido nem libera projeção conclusiva',()=>{
 const result=build(row(),{settings:{...settings,targetCents:0}});
 assert.equal(result.settings.targetCents,null);
 assert.equal(result.totals.coverageCents,75000);
 assert.equal(result.totals.shortfallCents,null);
 assert.equal(result.totals.shortfallKnownCents,null);
 assert.equal(result.totals.targetStatus,'unknown');
 assert.equal(result.future.requiredGrossCents,null);
 assert.equal(result.inventory.remainingShortfallCents,null);
 assert.equal(result.inventory.coversShortfall,null);
 assert.equal(result.complete,false);
 assert.ok(result.issues.some(i=>i.code==='target_missing'));
});

test('estoque inclui somente Disponível e usa preço já em centavos',()=>{
 const available={u:{id:'d',status:'Disponível'},preco:100001};
 const reserved={u:{id:'r',status:'Reservado'},preco:100000};
 const sold=row();
 const result=build(sold,{rows:[sold,available,reserved],settings:{...settings,selectedInventoryIds:['d']}});
 assert.equal(result.inventory.units.length,1);
 assert.equal(result.inventory.availableGrossCents,100001);
 assert.equal(result.inventory.selectedGrossCents,100001);
 assert.equal(result.inventory.selectedContributionCents,45000);
 assert.equal(result.inventory.remainingShortfallCents,80000);
 assert.equal(result.inventory.coversShortfall,false);
});

test('seleção identifica unidade reservada, vendida, inexistente ou repetida',()=>{
 const rows=[{u:{id:'d',status:'Disponível'},preco:100000},{u:{id:'r',status:'Reservado'},preco:100000}];
 for(const ids of [['r'],['ausente'],['d','d']]){
  const result=D.build({rows,settings:{...settings,selectedInventoryIds:ids},finance:{contributionsCents:0}});
  assert.equal(result.inventory.selectionComplete,false);
  assert.equal(result.inventory.selectedContributionCents,null);
  assert.equal(result.inventory.coversShortfall,null);
 }
});

test('preço ausente deixa capacidade total desconhecida e bloqueia somente seleção afetada',()=>{
 const rows=[{u:{id:'d',status:'Disponível'},preco:100000},{u:{id:'x',status:'Disponível'},preco:null}];
 const result=D.build({rows,settings:{...settings,selectedInventoryIds:['d']},finance:{contributionsCents:0}});
 assert.equal(result.inventory.inventoryComplete,false);
 assert.equal(result.inventory.availableGrossCents,null);
 assert.equal(result.inventory.availableGrossKnownCents,100000);
 assert.equal(result.inventory.selectedContributionCents,45000);
 const missing=D.build({rows,settings:{...settings,selectedInventoryIds:['x']},finance:{contributionsCents:0}});
 assert.equal(missing.inventory.selectedContributionCents,null);
 assert.equal(missing.inventory.selectionComplete,false);
});

test('preço bruto do estoque continua conhecido enquanto a comissão futura está ausente',()=>{
 const result=D.build({rows:[{u:{id:'d',status:'Disponível'},preco:100000}],settings:{targetCents:100000,selectedInventoryIds:['d']},finance:{contributionsCents:0}});
 assert.equal(result.inventory.availableGrossCents,100000);
 assert.equal(result.inventory.selectedGrossCents,100000);
 assert.equal(result.inventory.availableContributionCents,null);
 assert.equal(result.inventory.selectedContributionCents,null);
});

test('unidade duplicada não duplica cobertura e torna posição inconclusiva',()=>{
 const r=row();const result=build(r,{rows:[r,r]});
 assert.equal(result.contracts.length,1);
 assert.equal(result.totals.coverageKnownCents,75000);
 assert.equal(result.totals.coverageCents,null);
});

test('entradas não são modificadas pelo motor',()=>{
 const r=row(),args={rows:[r],settings:{...settings,selectedInventoryIds:[]},finance:{contributionsCents:10000,contracts:{a:manual(r)}}};
 const before=JSON.stringify(args);
 D.build(args);
 assert.equal(JSON.stringify(args),before);
});

test('soma acima de centavos seguros não produz meta ou cobertura enganosa',()=>{
 const r=row();
 const result=build(r,{finance:{contributionsCents:Number.MAX_SAFE_INTEGER,contracts:{a:manual(r)}}});
 assert.equal(result.totals.coverageKnownCents,null);
 assert.equal(result.totals.coverageCents,null);
 assert.equal(result.future.requiredGrossCents,null);
});

test('contribuição negativa é preservada e falta acima da precisão fica desconhecida',()=>{
 const r=row();
 const result=build(r,{settings:{...settings,targetCents:Number.MAX_SAFE_INTEGER},finance:{contributionsCents:0,contracts:{a:{...manual(r),commissionCents:100000}}}});
 assert.equal(result.totals.coverageCents,-30000);
 assert.equal(result.totals.shortfallCents,null);
 assert.equal(result.future.requiredGrossCents,null);
 assert.equal(result.complete,false);
 assert.ok(result.issues.some(i=>i.code==='shortfall_overflow'));
});

test('necessidade é o menor bruto suficiente e contribuições nunca superestimam centavos',()=>{
 const scenarios=[[5000,500],[7000,2000],[3333,333],[10000,0],[5001,5000],[1,0]];
 const prices=[1,7,100003];
 for(const [paymentBps,commissionBps] of scenarios){
  const margin=BigInt(paymentBps-commissionBps),scale=10000n;
  for(const targetCents of [1,17,99991,200000]){
   const rows=prices.map((preco,i)=>({u:{id:'d'+i,status:'Disponível'},preco}));
   const result=D.build({rows,settings:{targetCents,futurePaymentShare:paymentBps/10000,futureCommissionRate:commissionBps/10000,selectedInventoryIds:rows.map(r=>r.u.id)},finance:{contributionsCents:0}});
   const gross=BigInt(result.future.requiredGrossCents),required=BigInt(targetCents)*scale;
   assert.ok(gross*margin>=required,'o bruto calculado precisa alcançar a falta');
   assert.ok((gross-1n)*margin<required,'um centavo a menos não pode alcançar a falta');
   for(const unit of result.inventory.units){
    const raw=BigInt(unit.priceCents)*margin,credited=BigInt(unit.contributionCents)*scale;
    assert.ok(credited<=raw,'o estoque não pode creditar fração de centavo a maior');
    assert.ok(raw-credited<scale,'o arredondamento por unidade perde menos de um centavo');
   }
   assert.equal(result.inventory.selectedContributionCents,result.inventory.units.reduce((n,u)=>n+u.contributionCents,0));
  }
 }
});

test('percentuais válidos que exigem bruto acima da precisão não geram meta conclusiva',()=>{
 const result=D.build({rows:[],settings:{targetCents:Number.MAX_SAFE_INTEGER,futurePaymentShare:.5,futureCommissionRate:.49999999999999994},finance:{contributionsCents:0}});
 assert.equal(result.future.valid,true);
 assert.equal(result.future.requiredGrossCents,null);
 assert.equal(result.complete,false);
 assert.ok(result.issues.some(i=>i.code==='future_overflow'));
});
