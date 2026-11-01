/* Previsão de custo Diamond: motor puro. Todos os valores monetários são centavos.
 * Recebimentos são conciliação, nunca uma segunda contribuição para a cobertura.
 * A composição e os dados manuais devem pertencer à revisão atual do contrato.
 */
(function(root){
 'use strict';
 const own=(o,k)=>Object.prototype.hasOwnProperty.call(o||{},k);
 const money=v=>Number.isSafeInteger(v)&&v>=0;
 const sum=values=>{
  if(values.some(v=>!Number.isSafeInteger(v)))return null;
  const total=values.reduce((n,v)=>n+BigInt(v),0n);
  return total>BigInt(Number.MAX_SAFE_INTEGER)||total<BigInt(Number.MIN_SAFE_INTEGER)?null:Number(total);
 };
 const known=values=>sum(values.filter(v=>v!==null));
 const cancelled=c=>c&&(c.cancelado===true||c.cancelled===true||['cancelado','cancelled'].includes(String(c.status||'').toLowerCase()));
 function contractKey(row){
  const u=row?.u,c=row?.contrato;
  if(!u||!c)return '';
  return JSON.stringify([u.id,c.unidadeId,c.clienteId,c.unidadeRevisao,c.revisao??null,c.total,c.entrada,c.permutas,c.parcelas]);
 }
 // Decimal arithmetic avoids an extra cent from binary floating-point division.
 function fraction(value){
  const [mantissa,exponent='0']=String(value).toLowerCase().split('e');
  const [integer,decimals='']=mantissa.split('.');
  let n=BigInt(integer+decimals),scale=decimals.length-Number(exponent);
  if(scale<0){n*=10n**BigInt(-scale);scale=0;}
  return {n,d:10n**BigInt(scale)};
 }
 const subtract=(a,b)=>({n:a.n*b.d-b.n*a.d,d:a.d*b.d});
 function safeBig(value){return value>BigInt(Number.MAX_SAFE_INTEGER)||value<0n?null:Number(value);}
 const floorProduct=(amount,rate)=>safeBig(BigInt(amount)*rate.n/rate.d);
 const ceilQuotient=(amount,rate)=>safeBig((BigInt(amount)*rate.d+rate.n-1n)/rate.n);
 function build({rows=[],settings={},finance={}}={}){
  const issues=[];
  function issue(code,message,extra={}){const item={code,message,...extra};issues.push(item);return item;}
  const targetCents=money(settings.targetCents)&&settings.targetCents>0?settings.targetCents:null;
  if(targetCents===null)issue('target_missing','Informe uma meta de custo maior que zero em centavos.',{scope:'target'});
  const contributionsCents=money(finance.contributionsCents)?finance.contributionsCents:null;
  if(contributionsCents===null)issue('contributions_missing','Informe os aportes realizados; zero precisa ser informado explicitamente.',{scope:'coverage'});
  const contracts=[],unconfirmedContracts=[],excludedContracts=[],seen=new Set();
  let rowsComplete=Array.isArray(rows);
  if(!rowsComplete){issue('rows_invalid','A posição de unidades não está disponível.',{scope:'coverage'});rows=[];}
  const uniqueRows=[];
  for(const row of rows){
   const id=row?.u?.id;
   if(!id||seen.has(String(id))){rowsComplete=false;issue('unit_duplicate_or_missing','Unidade sem identificador ou repetida na posição.',{scope:'coverage',unitId:id||null});continue;}
   seen.add(String(id));uniqueRows.push(row);
  }
  for(const row of uniqueRows){
   const u=row.u,c=row.contrato,id=String(u.id);
   if(u.status!=='Vendido'||cancelled(c)){if(c)excludedContracts.push({id,row,reason:cancelled(c)?'cancelled':'not_sold'});continue;}
   if(!c||c.unidadeId!==u.id||!c.clienteId||c.clienteId!==u.clienteId||!c.unidadeRevisao||c.unidadeRevisao!==u.atualizadoEm){
    const problem=issue('contract_unconfirmed','Venda sem condições confirmadas na revisão atual.',{scope:'coverage',unitId:id});
    unconfirmedContracts.push({id,row,issues:[problem]});continue;
   }
   const local=[];
   const problem=(code,message,scope='coverage')=>{const item=issue(code,message,{scope,unitId:id});local.push(item);};
   const grossCents=money(c.total)&&c.total>0?c.total:null;
   const entryCents=money(c.entrada)?c.entrada:null;
   if(grossCents===null)problem('gross_invalid','O valor bruto do contrato é inválido.');
   if(entryCents===null)problem('entry_invalid','A entrada contratada não está informada corretamente.');
   const validPermutas=Array.isArray(c.permutas)&&c.permutas.every(p=>p&&money(p.valor));
   const permutaCents=validPermutas?sum(c.permutas.map(p=>p.valor)):null;
   if(permutaCents===null)problem('barter_invalid','A composição das permutas está incompleta ou inválida.');
   const validSeries=Array.isArray(c.parcelas)&&c.parcelas.every(p=>p&&money(p.valor)&&Number.isSafeInteger(p.quantidade)&&p.quantidade>0&&money(p.valor*p.quantidade));
   const series=validSeries?c.parcelas.map((p,index)=>({index,description:String(p.descricao||'Série '+(index+1)),count:p.quantidade,valueCents:p.valor,totalCents:p.valor*p.quantidade,isFinal:null})):[];
   const installmentsCents=validSeries?sum(series.map(p=>p.totalCents)):null;
   if(installmentsCents===null)problem('installments_invalid','A composição das parcelas está incompleta ou inválida.');
   const compositionCents=sum([entryCents,permutaCents,installmentsCents]);
   const compositionComplete=grossCents!==null&&compositionCents===grossCents;
   if(!compositionComplete)problem('composition_incomplete','Entrada, permutas e parcelas precisam fechar o valor bruto do contrato.');
   const key=contractKey(row),raw=finance.contracts?.[id];
   const manualCurrent=!!raw&&raw.contractKey===key;
   if(!manualCurrent)problem(raw?'manual_stale':'manual_missing',raw?'Revise os dados financeiros após a mudança do contrato.':'Informe a comissão e confirme quais séries são finais.');
   const manual=manualCurrent?raw:{};
   const commissionCents=money(manual.commissionCents)&&grossCents!==null&&manual.commissionCents<=grossCents?manual.commissionCents:null;
   if(commissionCents===null)problem('commission_missing','Informe a comissão total deste contrato; zero precisa ser explícito e o valor não pode superar o bruto.');
   const indices=manual.finalSeriesIndices;
   const finalsValid=validSeries&&Array.isArray(indices)&&new Set(indices).size===indices.length&&indices.every(i=>Number.isSafeInteger(i)&&i>=0&&i<series.length);
   if(!finalsValid)problem('final_series_missing','Confirme explicitamente as séries finais, ou confirme que não há parcela final.');
   if(finalsValid)series.forEach(p=>{p.isFinal=indices.includes(p.index);});
   const finalCents=finalsValid?sum(series.filter(p=>p.isFinal).map(p=>p.totalCents)):null;
   const commonReceivableCents=compositionComplete&&finalCents!==null?grossCents-permutaCents-finalCents:null;
   const contributionCents=compositionComplete&&commissionCents!==null&&finalCents!==null?grossCents-commissionCents-finalCents:null;
   const coverageComplete=Number.isSafeInteger(contributionCents);
   const receivedCommonCents=money(manual.receivedCommonCents)&&commonReceivableCents!==null&&manual.receivedCommonCents<=commonReceivableCents?manual.receivedCommonCents:null;
   const receivedFinalCents=money(manual.receivedFinalCents)&&finalCents!==null&&manual.receivedFinalCents<=finalCents?manual.receivedFinalCents:null;
   if(receivedCommonCents===null)problem('received_common_missing','Informe o recebido comum entre zero e o valor comum em dinheiro contratado.','receipts');
   if(receivedFinalCents===null)problem('received_final_missing','Informe o recebido final entre zero e o valor final contratado.','receipts');
   const receiptsComplete=receivedCommonCents!==null&&receivedFinalCents!==null;
   contracts.push({id,row,contractKey:key,manualCurrent,grossCents,entryCents,permutaCents,installmentsCents,compositionCents,compositionComplete,unallocatedCents:grossCents!==null&&compositionCents!==null?grossCents-compositionCents:null,commissionCents,finalCents,commonReceivableCents,contributionCents,coverageComplete,series,receivedCommonCents,receivedFinalCents,receiptsComplete,outstandingCommonCents:receivedCommonCents!==null?commonReceivableCents-receivedCommonCents:null,outstandingFinalCents:receivedFinalCents!==null?finalCents-receivedFinalCents:null,issues:local});
  }
  const total=k=>rowsComplete&&unconfirmedContracts.length===0?sum(contracts.map(c=>c[k])):null;
  const knownTotal=k=>known(contracts.map(c=>c[k]));
  const coverageKnownCents=known([contributionsCents,...contracts.map(c=>c.contributionCents)]);
  const coverageComplete=rowsComplete&&contributionsCents!==null&&unconfirmedContracts.length===0&&contracts.every(c=>c.coverageComplete)&&coverageKnownCents!==null;
  if(coverageKnownCents===null)issue('coverage_overflow','A soma de cobertura excede a precisão suportada.',{scope:'coverage'});
  const coverageCents=coverageComplete?coverageKnownCents:null;
  const shortfall=(target,coverage)=>target===null||coverage===null?null:safeBig(BigInt(target)>BigInt(coverage)?BigInt(target)-BigInt(coverage):0n);
  const shortfallCents=shortfall(targetCents,coverageCents);
  const shortfallKnownCents=shortfall(targetCents,coverageKnownCents);
  if(targetCents!==null&&coverageComplete&&shortfallCents===null)issue('shortfall_overflow','A falta para a meta excede a precisão suportada.',{scope:'target'});
  const receivedComplete=rowsComplete&&unconfirmedContracts.length===0&&contracts.every(c=>c.receiptsComplete)&&total('receivedCommonCents')!==null&&total('receivedFinalCents')!==null;
  const totals={grossCents:total('grossCents'),grossKnownCents:knownTotal('grossCents'),commissionCents:total('commissionCents'),commissionKnownCents:knownTotal('commissionCents'),finalCents:total('finalCents'),finalKnownCents:knownTotal('finalCents'),permutaCents:total('permutaCents'),entryCents:total('entryCents'),installmentsCents:total('installmentsCents'),commonReceivableCents:total('commonReceivableCents'),coverageKnownCents,coverageCents,coverageComplete,shortfallCents,shortfallKnownCents,receivedCommonCents:receivedComplete?total('receivedCommonCents'):null,receivedFinalCents:receivedComplete?total('receivedFinalCents'):null,receivedCommonKnownCents:knownTotal('receivedCommonCents'),receivedFinalKnownCents:knownTotal('receivedFinalCents'),receivedComplete,targetStatus:shortfallCents===null?'unknown':shortfallCents===0?'achieved':'shortfall'};
  const P=own(settings,'futurePaymentShare')?settings.futurePaymentShare:.5,C=settings.futureCommissionRate;
  const valid=typeof P==='number'&&Number.isFinite(P)&&typeof C==='number'&&Number.isFinite(C)&&0<=C&&C<P&&P<=1;
  const rate=valid?subtract(fraction(P),fraction(C)):null;
  if(!valid)issue('future_rates_invalid','A comissão futura deve atender a 0 ≤ C < P ≤ 100%.',{scope:'future'});
  const requiredGrossCents=valid&&shortfallCents!==null?ceilQuotient(shortfallCents,rate):null;
  if(valid&&shortfallCents!==null&&requiredGrossCents===null)issue('future_overflow','A venda necessária excede a precisão suportada.',{scope:'future'});
  const future={valid,P:typeof P==='number'?P:null,F:typeof P==='number'&&Number.isFinite(P)?1-P:null,C:typeof C==='number'?C:null,netShare:valid?P-C:null,requiredGrossCents};
  const selectedRaw=own(settings,'selectedInventoryIds')?settings.selectedInventoryIds:[];
  let selectionComplete=Array.isArray(selectedRaw)&&new Set(selectedRaw).size===selectedRaw.length;
  const selected=new Set(Array.isArray(selectedRaw)?selectedRaw.map(String):[]);
  if(!selectionComplete)issue('selection_invalid','A seleção de estoque precisa conter identificadores únicos.',{scope:'inventory'});
  const units=uniqueRows.filter(r=>r.u.status==='Disponível').map(row=>{
   const id=String(row.u.id),priceCents=money(row.preco)&&row.preco>0?row.preco:null;
   if(priceCents===null)issue('inventory_price_missing','Unidade disponível sem preço válido em centavos.',{scope:'inventory',unitId:id});
   return {id,row,priceCents,contributionCents:priceCents!==null&&valid?floorProduct(priceCents,rate):null,selected:selected.has(id)};
  });
  for(const id of selected)if(!units.some(u=>u.id===id)){selectionComplete=false;issue('selection_unavailable','Uma unidade selecionada não está mais disponível.',{scope:'inventory',unitId:id});}
  const selectedUnits=units.filter(u=>u.selected);
  const selectedPricesComplete=selectionComplete&&rowsComplete&&selectedUnits.every(u=>u.priceCents!==null);
  const selectedGrossCents=selectedPricesComplete?sum(selectedUnits.map(u=>u.priceCents)):null;
  selectionComplete=selectedPricesComplete&&valid&&selectedUnits.every(u=>u.contributionCents!==null);
  const selectedContributionCents=selectionComplete?sum(selectedUnits.map(u=>u.contributionCents)):null;
  selectionComplete=selectionComplete&&selectedGrossCents!==null&&selectedContributionCents!==null;
  const inventoryPricesComplete=rowsComplete&&units.every(u=>u.priceCents!==null);
  const inventoryComplete=inventoryPricesComplete&&valid&&units.every(u=>u.contributionCents!==null);
  const availableGrossCents=inventoryPricesComplete?sum(units.map(u=>u.priceCents)):null;
  const availableContributionCents=inventoryComplete?sum(units.map(u=>u.contributionCents)):null;
  const remainingShortfallCents=selectionComplete&&shortfallCents!==null?Math.max(0,shortfallCents-selectedContributionCents):null;
  const inventory={units,availableGrossCents,availableGrossKnownCents:known(units.map(u=>u.priceCents)),availableContributionCents,inventoryComplete:inventoryComplete&&availableGrossCents!==null&&availableContributionCents!==null,selectedGrossCents,selectedContributionCents,selectionComplete,remainingShortfallCents,coversShortfall:remainingShortfallCents===null?null:remainingShortfallCents===0};
  return {settings:{targetCents,futurePaymentShare:P,futureCommissionRate:C},contributionsCents,contracts,unconfirmedContracts,excludedContracts,totals,future,inventory,issues,complete:coverageComplete&&shortfallCents!==null&&valid&&requiredGrossCents!==null};
 }
 root.DiamondPrevisaoDomain={build,contractKey};
})(typeof window!=='undefined'?window:globalThis);
