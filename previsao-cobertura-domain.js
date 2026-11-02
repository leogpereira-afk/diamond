/* Leitura da cobertura já calculada: nenhum recebimento é somado novamente.
 * Valores monetários em centavos; percent/knownPercent são frações do custo.
 * A origem da venda só vem de evidência explícita, nunca do nome do comprador.
 */
(function(root){
 'use strict';
 const own=(o,k)=>Object.prototype.hasOwnProperty.call(o||{},k);
 const safe=Number.isSafeInteger,amount=n=>safe(n)&&n>=0;
 const fromBig=n=>n>BigInt(Number.MAX_SAFE_INTEGER)||n<BigInt(Number.MIN_SAFE_INTEGER)?null:Number(n);
 const sum=values=>values.every(safe)?fromBig(values.reduce((a,v)=>a+BigInt(v),0n)):null;
 const known=values=>sum(values.filter(safe));
 const difference=(a,b)=>safe(a)&&safe(b)?fromBig(BigInt(a)>BigInt(b)?BigInt(a)-BigInt(b):0n):null;
 const ratio=(value,target)=>safe(value)&&amount(target)&&target>0?value/target:null;
 const isShop=unit=>String(unit?.row?.u?.unidade||'').trim().toUpperCase()==='LOJA';
 const normalized=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();

 function classifyOrigin(contract,unitName){
  if(typeof contract?.observacoes!=='string')return null;
  const text=normalized(contract.observacoes).trim();
  // Uncertain, denied or conflicting evidence is deliberately left unclassified.
  if(/\b(?:rascunho|hipotese|simulacao|possivel|provisorio|proposta|terceiro|terceiros)\b/.test(text)||/\b(?:a confirmar|nao confirmado|nao confirmada)\b/.test(text)||/(?:^|[\n.;])\s*exemplo\s*:/.test(text))return null;
  if(/\b(?:nao|sem)\b[^.;\n]{0,70}\b(?:scp\b|venda direta\b|compra e venda\b|contrato_compra_e_venda_)/.test(text)||/\b(?:vinculo|origem|contrato|documento)\b[^.;\n]{0,35}\b(?:nao|inexistente|negado|negada|invalido|invalida|cancelado|cancelada)\b/.test(text))return null;
  const unitEvidence=text.match(/^scp\/pbs,\s*unidade\s+([a-z0-9-]+)\b/);
  const expected=String(unitName||String(contract.unidadeId||'').match(/^u-([0-9]+|loja)$/i)?.[1]||'').trim().toLowerCase();
  if(unitEvidence&&expected&&unitEvidence[1]!==expected)return null;
  const scp=/(?:^|[\n.;])\s*origem da venda:\s*scp\s*(?:[.;]|$)/.test(text)||/\ba data cadastrada corresponde aos instrumentos scp de \d{2}\/\d{2}\/\d{4}\b/.test(text)||!!unitEvidence;
  const direct=/(?:^|[\n.;])\s*origem da venda:\s*venda direta\s*(?:[.;]|$)/.test(text)||/\bfonte:\s*contrato_compra_e_venda_[a-z0-9]/.test(text);
  return scp===direct?null:scp?'scp':'direta';
 }

 // Consolidated coverage is a separate, dated source. It never creates receipts
 // or allocates a group amount across apartments. Current contract keys bind it.
 function consolidate(model,record){
  if(!record)return model;
  const invalid=message=>({...model,consolidation:{valid:false,message},issues:[...model.issues,{code:'consolidation_stale',scope:'coverage',message}]});
  const contracts=model.contracts,keys=record.contractKeys,groups=record.groups;
  if(!keys||!Array.isArray(groups)||!contracts.length||model.unconfirmedContracts.length||model.issues.some(i=>['rows_invalid','unit_duplicate_or_missing'].includes(i.code)))return invalid('A consolidação aguarda a posição completa dos contratos.');
  const ids=groups.flatMap(g=>Array.isArray(g.unitIds)?g.unitIds:[]);
  if(new Set(ids).size!==ids.length||ids.length!==contracts.length||Object.keys(keys).length!==contracts.length||contracts.some(c=>!ids.includes(c.id)||keys[c.id]!==c.contractKey||!c.manualCurrent||![c.grossCents,c.permutaCents,c.finalCents,c.commissionCents].every(amount)))return invalid('Os contratos mudaram desde a consolidação. Atualize a fonte consolidada antes de usar estes valores.');
  if(groups.some(g=>!['scp','direta','barter'].includes(g.origin)||!amount(g.commonCents)||(g.origin==='barter'&&g.commonCents!==0)||(g.receivedCents!==null&&(!amount(g.receivedCents)||g.receivedCents>g.commonCents))))return invalid('Os valores da consolidação são inválidos.');
  const commonCents=sum(groups.map(g=>g.commonCents)),barterCents=sum(contracts.map(c=>c.permutaCents)),commissionCents=sum(contracts.map(c=>c.commissionCents)),finalCents=sum(contracts.map(c=>c.finalCents));
  if(![commonCents,barterCents,commissionCents,finalCents,model.contributionsCents].every(amount))return invalid('A consolidação excede a precisão suportada ou os aportes não estão conferidos.');
  // A barter-only group must remain fully covered by the recorded barter.
  if(groups.filter(g=>g.origin==='barter').some(g=>g.unitIds.some(id=>{const c=contracts.find(c=>c.id===id);return c.grossCents!==c.permutaCents||c.finalCents!==0;})))return invalid('Uma venda antes integralmente em permuta passou a ter outra composição.');
  const coverageCents=sum([commonCents,barterCents,-commissionCents,model.contributionsCents]);
  if(!amount(coverageCents))return invalid('O total consolidado é inválido.');
  const gap=difference(model.settings.targetCents,coverageCents);
  const dec=value=>{const [mantissa,exponent='0']=String(value).toLowerCase().split('e'),[integer,decimal='']=mantissa.split('.');let n=BigInt(integer+decimal),scale=decimal.length-Number(exponent);if(scale<0){n*=10n**BigInt(-scale);scale=0;}return {n,d:10n**BigInt(scale)};};
  let requiredGrossCents=null;
  if(model.future.valid&&gap!==null){const p=dec(model.future.P),c=dec(model.future.C),n=p.n*c.d-c.n*p.d,d=p.d*c.d;requiredGrossCents=fromBig((BigInt(gap)*d+n-1n)/n);}
  const gross=sum(contracts.map(c=>c.grossCents));
  const consolidation={...record,valid:true,groups:groups.map(g=>({...g,outstandingCents:g.receivedCents===null?null:g.commonCents-g.receivedCents})),commonCents,barterCents,commissionCents,finalCents,adjustmentCents:sum([commonCents,barterCents,finalCents,-gross])};
  return {...model,consolidation,totals:{...model.totals,coverageCents,coverageKnownCents:coverageCents,coverageComplete:true,shortfallCents:gap,shortfallKnownCents:gap,targetStatus:gap===null?'unknown':gap===0?'achieved':'shortfall'},future:{...model.future,requiredGrossCents},inventory:{...model.inventory,remainingShortfallCents:model.inventory.selectionComplete?difference(gap,model.inventory.selectedContributionCents):null},issues:model.issues.filter(i=>i.scope!=='coverage'),complete:gap!==null&&model.future.valid&&requiredGrossCents!==null};
 }

 function build({model,classifications={}}={}){
  const source=!!model&&typeof model==='object'&&!!model.totals&&Array.isArray(model.contracts)&&Array.isArray(model.inventory?.units);
  const m=source?model:{},t=m.totals||{},contracts=source?m.contracts:[],issues=[];
  const note=(code,message)=>issues.push({code,message});
  if(!source)note('source_missing','A previsão de custo não está disponível.');
  const targetCents=amount(m.settings?.targetCents)&&m.settings.targetCents>0?m.settings.targetCents:null;
  const unitIds=(field,rows=contracts)=>rows.filter(c=>safe(c[field])).map(c=>c.id);
  function metric(cents,knownCents,complete,ids=[]){
   const value=complete&&safe(cents)?cents:null,knownValue=source&&safe(knownCents)?knownCents:null;
   return {cents:value,knownCents:knownValue,complete:value!==null,percent:ratio(value,targetCents),knownPercent:ratio(knownValue,targetCents),unitIds:[...ids]};
  }
  const coverage=metric(t.coverageCents,t.coverageKnownCents,t.coverageComplete,unitIds('contributionCents'));
  Object.assign(coverage,{gapCents:safe(t.shortfallCents)?t.shortfallCents:null,knownGapCents:safe(t.shortfallKnownCents)?t.shortfallKnownCents:null,surplusCents:difference(coverage.cents,targetCents),knownSurplusCents:difference(coverage.knownCents,targetCents)});
  for(const [key,field] of [['gapPercent','gapCents'],['knownGapPercent','knownGapCents'],['surplusPercent','surplusCents'],['knownSurplusPercent','knownSurplusCents']])coverage[key]=ratio(coverage[field],targetCents);
  const receivedCents=t.receivedComplete===true?sum([t.receivedCommonCents,t.receivedFinalCents]):null;
  const metrics={
   target:metric(targetCents,targetCents,targetCents!==null),
   gross:metric(t.grossCents,t.grossKnownCents,safe(t.grossCents),unitIds('grossCents')),
   contributions:metric(m.contributionsCents,m.contributionsCents,amount(m.contributionsCents)),
   barter:metric(t.permutaCents,known(contracts.map(c=>c.permutaCents)),safe(t.permutaCents),unitIds('permutaCents')),
   commission:metric(t.commissionCents,t.commissionKnownCents,safe(t.commissionCents),unitIds('commissionCents')),
   finals:metric(t.finalCents,t.finalKnownCents,safe(t.finalCents),unitIds('finalCents')),
   received:metric(receivedCents,known(contracts.flatMap(c=>[c.receivedCommonCents,c.receivedFinalCents])),t.receivedComplete===true,contracts.filter(c=>safe(c.receivedCommonCents)||safe(c.receivedFinalCents)).map(c=>c.id)),
   receivedCommon:metric(t.receivedCommonCents,t.receivedCommonKnownCents,t.receivedComplete===true,unitIds('receivedCommonCents')),
   receivedFinal:metric(t.receivedFinalCents,t.receivedFinalKnownCents,t.receivedComplete===true,unitIds('receivedFinalCents')),
   shortfall:metric(coverage.gapCents,coverage.knownGapCents,coverage.complete),
   requiredGross:metric(m.future?.requiredGrossCents,m.future?.requiredGrossCents,m.future?.valid===true&&coverage.complete),
   coverage
  };
  const eligible=contracts.filter(c=>c.coverageComplete===true&&[c.commonReceivableCents,c.permutaCents,c.commissionCents,c.contributionCents].every(safe));
  const origin=c=>own(classifications,c.id)&&['scp','direta'].includes(classifications[c.id])?classifications[c.id]:'unknown';
  const pending=[...contracts.filter(c=>!eligible.includes(c)).map(c=>({id:c.id,reason:'coverage_incomplete',issues:[...(c.issues||[])]})),...(m.unconfirmedContracts||[]).map(c=>({id:c.id,reason:'unconfirmed',issues:[...(c.issues||[])]}))];
  const excluded=(m.excludedContracts||[]).map(c=>({id:c.id,reason:c.reason}));
  const part=(key,rows,field,sign=1)=>{
   const value=source?sum(rows.map(c=>c[field])):null;
   return {key,cents:value,knownCents:value,signedCents:value===null?null:sign*value,percent:ratio(value,targetCents),knownPercent:ratio(value,targetCents),sign,unitIds:rows.map(c=>c.id),count:rows.length,complete:coverage.complete};
  };
  const contributionPart={key:'contributions',cents:amount(m.contributionsCents)?m.contributionsCents:null,knownCents:source?(amount(m.contributionsCents)?m.contributionsCents:0):null,sign:1,unitIds:[],count:null,complete:amount(m.contributionsCents)};
  Object.assign(contributionPart,{signedCents:contributionPart.cents,percent:ratio(contributionPart.cents,targetCents),knownPercent:ratio(contributionPart.knownCents,targetCents)});
  const parts=[contributionPart,part('direta',eligible.filter(c=>origin(c)==='direta'),'commonReceivableCents'),part('scp',eligible.filter(c=>origin(c)==='scp'),'commonReceivableCents'),part('unknown',eligible.filter(c=>origin(c)==='unknown'),'commonReceivableCents'),part('barter',eligible,'permutaCents'),part('commission',eligible,'commissionCents',-1)];
  if(m.consolidation?.valid){
   for(const p of parts){
    if(p.key==='contributions')continue;
    const selected=m.consolidation.groups.filter(g=>g.origin===p.key);
    const value=p.key==='barter'?m.consolidation.barterCents:p.key==='commission'?m.consolidation.commissionCents:sum(selected.map(g=>g.commonCents));
    Object.assign(p,{cents:value,knownCents:value,signedCents:p.sign*value,percent:ratio(value,targetCents),knownPercent:ratio(value,targetCents),complete:true,unitIds:['barter','commission'].includes(p.key)?contracts.map(c=>c.id):selected.flatMap(g=>g.unitIds),groups:selected});
   }
  }
  const knownTotalCents=source?sum(parts.map(p=>p.knownCents===null?null:p.sign*p.knownCents)):null;
  const matchesCoverageKnown=knownTotalCents!==null&&knownTotalCents===coverage.knownCents;
  if(source&&!matchesCoverageKnown)note('decomposition_unavailable','A composição detalhada não pôde ser conciliada com a cobertura conhecida.');
  const decomposition={parts,totalCents:coverage.complete&&matchesCoverageKnown?knownTotalCents:null,knownTotalCents,complete:coverage.complete&&matchesCoverageKnown,matchesCoverageKnown,classificationComplete:eligible.every(c=>origin(c)!=='unknown'),acceptedUnitIds:m.consolidation?.valid?contracts.map(c=>c.id):eligible.map(c=>c.id),pending:m.consolidation?.valid?[]:pending,excluded};
  if(m.consolidation?.valid)decomposition.classificationComplete=true;

  const available=(m.inventory?.units||[]).filter(u=>u?.row?.u?.status==='Disponível').map(u=>({...u,unidade:String(u.row.u.unidade||'')}));
  const apartments=available.filter(u=>!isShop(u)),shops=available.filter(isShop);
  const rowsComplete=source&&!(m.issues||[]).some(i=>['rows_invalid','unit_duplicate_or_missing'].includes(i.code));
  const validRates=m.future?.valid===true;
  const pricesComplete=rowsComplete&&apartments.every(u=>amount(u.priceCents)&&u.priceCents>0);
  const inventoryComplete=pricesComplete&&validRates&&apartments.every(u=>amount(u.contributionCents))&&sum(apartments.map(u=>u.contributionCents))!==null&&sum(apartments.map(u=>u.priceCents))!==null;
  const availableGrossCents=pricesComplete?sum(apartments.map(u=>u.priceCents)):null;
  const availableContributionCents=inventoryComplete?sum(apartments.map(u=>u.contributionCents)):null;
  const count=apartments.length,gapCents=coverage.complete?coverage.gapCents:coverage.knownGapCents;
  const average=total=>count&&amount(total)?fromBig((BigInt(total)+BigInt(count)/2n)/BigInt(count)):null;
  // Use the exact average N/sum, not the rounded average displayed in a card.
  const estimatedCount=inventoryComplete&&amount(gapCents)?gapCents===0?0:count>0&&availableContributionCents>0?fromBig((BigInt(gapCents)*BigInt(count)+BigInt(availableContributionCents)-1n)/BigInt(availableContributionCents)):null:null;
  const selected=apartments.filter(u=>u.selected),ignoredShopIds=shops.filter(u=>u.selected).map(u=>u.id);
  const selectionProblem=(m.issues||[]).some(i=>['selection_invalid','selection_unavailable'].includes(i.code));
  let selectionComplete=rowsComplete&&!selectionProblem&&validRates&&selected.every(u=>amount(u.priceCents)&&u.priceCents>0&&amount(u.contributionCents));
  const selectedGrossCents=rowsComplete&&!selectionProblem&&selected.every(u=>amount(u.priceCents)&&u.priceCents>0)?sum(selected.map(u=>u.priceCents)):null;
  const selectedContributionCents=selectionComplete?sum(selected.map(u=>u.contributionCents)):null;
  selectionComplete=selectionComplete&&selectedGrossCents!==null&&selectedContributionCents!==null;
  const remainingGapCents=selectionComplete?difference(gapCents,selectedContributionCents):null;
  const selection={ids:selected.map(u=>u.id),count:selected.length,grossCents:selectedGrossCents,contributionCents:selectedContributionCents,remainingGapCents,surplusCents:selectionComplete?difference(selectedContributionCents,gapCents):null,coversGap:remainingGapCents===null?null:remainingGapCents===0,complete:selectionComplete,ignoredShopIds};
  const simulation={estimated:true,partial:!coverage.complete||targetCents===null,definitive:coverage.complete&&inventoryComplete&&amount(gapCents),gapCents,gapBasis:coverage.complete?'complete':'known',availableCount:count,pricedCount:apartments.filter(u=>amount(u.priceCents)&&u.priceCents>0).length,averagePriceCents:pricesComplete?average(availableGrossCents):null,averageContributionCents:inventoryComplete?average(availableContributionCents):null,estimatedCount,possibleCount:estimatedCount===null?inventoryComplete&&count===0?0:null:Math.min(estimatedCount,count),insufficient:availableContributionCents!==null&&gapCents!==null?availableContributionCents<gapCents:null,remainingGapCents:difference(gapCents,availableContributionCents),inventoryComplete,availableGrossCents,availableGrossKnownCents:source?known(apartments.map(u=>u.priceCents)):null,availableContributionCents,availableContributionKnownCents:source&&validRates?known(apartments.map(u=>u.contributionCents)):null,apartments,shops,selection,rates:{P:typeof m.future?.P==='number'?m.future.P:null,C:typeof m.future?.C==='number'?m.future.C:null,valid:validRates}};
  if(targetCents===null)note('target_unknown','Informe o custo previsto antes de concluir a simulação de cobertura.');
  if(!validRates)note('future_rates_unknown','Confira a participação durante a obra e a comissão das novas vendas.');
  if(!pricesComplete)note('apartment_prices_unknown','Há preços de apartamentos ou dados do estoque a conferir.');
  if(!coverage.complete)note('partial_scenario','O cenário usa somente a cobertura conhecida; não confirma a falta definitiva para a meta.');
  if(estimatedCount===null&&inventoryComplete&&amount(gapCents)&&gapCents>0)note(count&&availableContributionCents>0?'estimate_overflow':'no_apartment_contribution','Não há uma quantidade estimada de apartamentos calculável para este cenário.');
  return {targetCents,metrics,coverage,decomposition,simulation,issues};
 }
 const api={build,classifyOrigin,consolidate};
 root.DiamondCoberturaDomain=api;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
