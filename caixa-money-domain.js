/* Posição em dinheiro, sem confundir consolidação com novas baixas.
 * Apenas leitura. Valores em centavos; nenhuma data ou quitação é presumida. */
(function(root){
 'use strict';
 if(!root.DiamondPrevisaoDomain&&typeof require==='function')require('./previsao-custo-domain.js');
 const P=root.DiamondPrevisaoDomain;
 const ok=v=>Number.isSafeInteger(v)&&v>=0;
 const sum=a=>{if(!a.every(ok))return null;const n=a.reduce((s,v)=>s+BigInt(v),0n);return n<=BigInt(Number.MAX_SAFE_INTEGER)?Number(n):null;};
 function newReceiptNote(record,unitId){
  const con=record?.data?.coverageConsolidation,g=con?.groups?.find(g=>g.unitIds?.includes(unitId)&&ok(g.receivedCents));
  if(!g||!con.asOf)return '';
  return 'Novo recebimento, fora da posição '+g.label+' de '+con.asOf.split('-').reverse().join('/')+' (recebido '+(g.receivedCents/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})+').';
 }
 function build({units=[],conditions=[],record,model}={}){
  const groups=[],issues=[],data=record?.data,con=data?.coverageConsolidation;
  const fail=t=>({total:null,received:null,outstanding:null,groups,issues:[t],caption:'Não foi possível conciliar as fontes. Nenhum lançamento foi alterado.'});
  if(!data||!model||model.ledgerInvalido)return fail('Posição geral indisponível: consulte novamente as condições e os recebimentos.');
  const us=new Map(units.map(u=>[u.id,u])),cs=new Map(conditions.map(c=>[c.unidadeId,c]));
  if(us.size!==units.length||cs.size!==conditions.length)return fail('Há cadastros duplicados nas fontes consultadas.');
  const included=new Set();
  const active=model.recebimentos||[];
  const add=(label,total,received,note)=>{
   if(!ok(total)||received!==null&&(!ok(received)||received>total)){issues.push('Os recebimentos de '+label+' excedem ou divergem do valor em dinheiro.');received=null;}
   groups.push({label,total,received,outstanding:ok(total)&&ok(received)?total-received:null,note});
  };
  if(con){
   if(!/^\d{4}-\d{2}-\d{2}$/.test(con.asOf||'')||!Array.isArray(con.groups)||!con.contractKeys)return fail('Consolidação sem data-base ou contratos válidos.');
   for(const g of con.groups){
    if(!Array.isArray(g.unitIds)||!g.unitIds.length||!ok(g.commonCents))return fail('Grupo consolidado inválido.');
    for(const id of g.unitIds){
     const u=us.get(id),c=cs.get(id);
     if(included.has(id)||u?.status!=='Vendido'||!c||con.contractKeys[id]!==P.contractKey({u,contrato:c}))return fail('As condições mudaram desde a consolidação. Atualize a conciliação para mostrar um total confiável.');
     included.add(id);
    }
    const finalValues=g.unitIds.map(id=>{
     const c=cs.get(id),manual=data.contracts?.[id];
     if(!manual||manual.contractKey!==con.contractKeys[id]||!Array.isArray(manual.finalSeriesIndices))return null;
     return sum(manual.finalSeriesIndices.map(i=>{const p=c.parcelas?.[i];return p?sum(Array.from({length:p.quantidade},()=>p.valor)):null;}));
    });
    const finals=sum(finalValues),total=sum([g.commonCents,finals]);
    const events=active.filter(e=>g.unitIds.includes(e.unidadeId));
    const general=(data.receipts||[]).filter(e=>g.unitIds.includes(e.unitId));
    let received=null,note='';
    if(g.receivedCents!==null){
     if(!ok(g.receivedCents)||g.receivedCents>g.commonCents)return fail('Recebido consolidado inválido.');
     // Backdated payments could already be included in the aggregate. Do not guess.
     if(events.some(e=>e.data<con.asOf||(e.data===con.asOf&&!e.observacao?.startsWith(newReceiptNote(record,e.unidadeId))))||general.length){
      issues.push(g.label+': há baixas que podem estar incluídas na posição consolidada. Concilie o histórico antes de somar.');
     }else received=sum([g.receivedCents,...events.map(e=>e.valor)]);
     note='Base consolidada em '+con.asOf.split('-').reverse().join('/')+'; novas baixas com data posterior ou declaradas novas no mesmo dia são acrescentadas uma única vez.';
    }else if(events.length&&general.length){
     issues.push(g.label+': há baixas na Previsão de custo e no Caixa. O total aguarda conciliação para evitar duplicidade.');
    }else{
     const validGeneral=general.every(e=>e.contractKey===con.contractKeys[e.unitId]);
     received=validGeneral?sum(events.length?events.map(e=>e.valor):general.map(e=>e.valorCents)):null;
     note='Baixas individuais registradas. Ausência de baixa não comprova falta de pagamento.';
    }
    const contractual=sum(g.unitIds.map(id=>{const c=cs.get(id),barter=sum((c.permutas||[]).map(p=>p.valor));return ok(c.total)&&barter!==null&&barter<=c.total?c.total-barter:null;}));
    if(ok(total)&&ok(contractual)&&total!==contractual)note+=' Diferença documental de '+((total-contractual)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})+' frente aos valores individuais, que permanecem preservados.';
    add(g.label,total,received,note);
   }
  }
  for(const u of units.filter(u=>u.status==='Vendido'&&!included.has(u.id))){
   const c=cs.get(u.id),lines=model.linhas.filter(l=>l.unidadeId===u.id);
   if(!c||!ok(c.total)||!Array.isArray(c.permutas)){add('Unidade '+u.unidade,null,null,'Condições incompletas.');continue;}
   const barter=sum(c.permutas.map(p=>p.valor)),total=barter!==null&&barter<=c.total?c.total-barter:null;
   const events=active.filter(e=>e.unidadeId===u.id),general=(data.receipts||[]).filter(e=>e.unitId===u.id);
   const uncertain=lines.some(l=>l.conferir)||events.length&&general.length||general.some(e=>e.contractKey!==P.contractKey({u,contrato:c}));
   add(u.compradorNome||'Unidade '+u.unidade,total,uncertain?null:sum(events.length?events.map(e=>e.valor):general.map(e=>e.valorCents)),'Saldo contratual sem baixa; pode conter valores ainda sem vencimento cadastrado.');
  }
  if(active.some(e=>!us.has(e.unidadeId)||us.get(e.unidadeId).status!=='Vendido'))return fail('Há recebimentos de unidades reabertas ou removidas. Concilie o histórico.');
  return {total:sum(groups.map(g=>g.total)),received:sum(groups.map(g=>g.received)),outstanding:sum(groups.map(g=>g.outstanding)),groups,issues,caption:'Inclui os balões finais em dinheiro. Permutas e aportes dos sócios ficam fora. Os totais não mudam com o filtro mensal; as baixas individuais antigas ainda precisam ser vinculadas ao consolidado.'};
 }
 root.DiamondCaixaMoneyDomain={build,newReceiptNote};
 if(typeof module!=='undefined'&&module.exports)module.exports={build,newReceiptNote};
})(typeof window!=='undefined'?window:globalThis);
