/* Visualizações somente leitura, alimentadas pelo modelo de cobertura existente. */
(function(root){
 'use strict';
 const colors={scp:'#416fa1',direta:'#29918f',barter:'#9268af',contributions:'#5b8b44',unknown:'#be685e',gap:'#dedecf',sold:'#416fa1',reserved:'#9268af',goal:'#5b8b44',left:'#cc8f34',other:'#aab0a0'};
 const valid=n=>Number.isSafeInteger(n)&&n>=0;
 const total=xs=>{if(!xs.every(valid))return null;const n=xs.reduce((a,b)=>a+BigInt(b),0n);return n<=BigInt(Number.MAX_SAFE_INTEGER)?Number(n):null;};
 function build(m,c,units){
  const t=m.totals,target=m.settings.targetCents,con=m.consolidation?.valid?m.consolidation:null;
  let parts=con?[...con.groups.filter(g=>g.commonCents>0).map(g=>({label:g.label,value:g.commonCents,origin:g.origin,key:'consolidated-'+g.id})),{label:'Permutas',value:con.barterCents,origin:'barter',key:'part-barter'},{label:'Aportes dos sócios',value:m.contributionsCents,origin:'contributions',key:'contributions'}]:(c?.decomposition.parts||[]).filter(p=>p.sign>0&&p.knownCents>0).map(p=>({label:({scp:'SCP',direta:'Compra e venda',barter:'Permutas',contributions:'Aportes dos sócios',unknown:'A classificar'})[p.key],value:p.knownCents,origin:p.key,key:'part-'+p.key}));
  parts=parts.filter(p=>valid(p.value)&&p.value>0).map(p=>({...p,color:colors[p.origin]||colors.unknown,percent:target>0?p.value/target:null}));
  const commission=con?.commissionCents??t.commissionCents??0;
  const complete=t.coverageComplete&&valid(t.coverageCents)&&target>0;
  const gap=complete?Math.max(0,target-t.coverageCents):null;
  const slices=complete?[...(commission>0?[{label:'Cobertura líquida',value:t.coverageCents,color:colors.contributions,key:'coverage',percent:t.coverageCents/target}]:parts),{label:'Falta cobrir',value:gap,color:colors.gap,key:'shortfall',percent:gap/target}].filter(p=>p.value>0):[];
  let stock=null,stockParts=[];const i=c?.simulation;
  if(Array.isArray(units)&&i){
   const apartments=units.filter(u=>String(u.unidade||'').trim().toUpperCase()!=='LOJA'),count=status=>apartments.filter(u=>u.status===status).length;
   const available=count('Disponível'),sold=count('Vendido'),reserved=count('Reservado'),other=apartments.length-available-sold-reserved;
   const needed=valid(i.estimatedCount)?i.estimatedCount:null,used=needed===null?null:Math.min(needed,available),left=needed===null?null:Math.max(0,available-needed);
   const apartmentCents=left===null||!valid(i.availableGrossCents)?null:available?Number((BigInt(i.availableGrossCents)*BigInt(left)+BigInt(available)/2n)/BigInt(available)):0;
   const shopCents=Array.isArray(i.shops)?total(i.shops.map(u=>u.priceCents)):null;
   stock={total:apartments.length,available,sold,reserved,other,needed,used,left,apartmentCents,shopCents,totalCents:total([apartmentCents,shopCents])};
   stockParts=[{label:'Vendidos',value:sold,key:'stockSold',color:colors.sold},{label:'Reservados',value:reserved,key:'stockReserved',color:colors.reserved},...(used===null?[{label:'Disponíveis · meta a conferir',value:available,key:'stockAvailable',color:colors.other}]:[{label:'Disponíveis para a meta',value:used,key:'estimatedCount',color:colors.goal},{label:'Disponíveis fora da meta',value:left,key:'stockLeft',color:colors.left}]),{label:'Outras situações',value:other,key:'stockOther',color:colors.other}].filter(p=>p.value>0).map(p=>({...p,percent:apartments.length?p.value/apartments.length:0}));
  }
  return {parts,slices,complete,commission,gap,stock,stockParts};
 }
 root.DiamondGraficos={build,colors};
})(typeof window==='undefined'?globalThis:window);
