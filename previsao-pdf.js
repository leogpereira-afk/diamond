/* Relatório somente leitura: recebe o mesmo modelo mostrado no painel. */
(function(root){
 'use strict';
 const money=n=>n==null?'A conferir':(n/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
 const pct=n=>n==null?'A conferir':(n*100).toLocaleString('pt-BR',{maximumFractionDigits:2})+'%';
 function build(m,c,meta={}){
  const Pdf=root.jspdf?.jsPDF;if(!Pdf)throw Error('Gerador de PDF indisponível. Recarregue a página.');
  const doc=new Pdf({unit:'mm',format:'a4'});let y=0;
  const header=()=>{doc.setFillColor(35,40,28);doc.rect(0,0,210,26,'F');doc.setTextColor(235,249,126);doc.setFont('helvetica','bold');doc.setFontSize(17);doc.text('DIAMOND | Cobertura da obra',14,13);doc.setFontSize(8);doc.text('Relatório de planejamento - Domo Construtora',14,20);doc.setTextColor(35,40,28);y=35;};
  const space=h=>{if(y+h>277){doc.addPage();header();}};
  const text=(value,size=10,bold=false)=>{doc.setFont('helvetica',bold?'bold':'normal');doc.setFontSize(size);const lines=doc.splitTextToSize(String(value),182);space(lines.length*(size<=9?4:5)+3);doc.setTextColor(35,40,28);doc.setFont('helvetica',bold?'bold':'normal');doc.setFontSize(size);doc.text(lines,14,y,{lineHeightFactor:1.15});y+=lines.length*(size<=9?4:5)+3;};
  const palette=[[65,111,161],[41,145,143],[204,143,52],[146,104,175],[91,139,68],[190,104,94],[125,147,160]];
  const row=(label,value,percent=null,color=null)=>{doc.setFontSize(10);doc.setFont('helvetica','normal');const lines=doc.splitTextToSize(label,percent===null?112:95),height=Math.max(10,lines.length*5+5);space(height);const top=y;doc.setTextColor(35,40,28);if(color){doc.setFillColor(...color);doc.roundedRect(14,top-2,3,3,0.6,0.6,'F');}doc.text(lines,color?20:14,top+1);doc.setFont('helvetica','bold');doc.text(value,percent===null?196:170,top+1,{align:'right'});if(percent!==null){doc.setFont('helvetica','normal');doc.setFontSize(9);doc.text(percent,196,top+1,{align:'right'});}doc.setDrawColor(230,233,224);doc.line(14,top+height-5,196,top+height-5);y=top+height;};
  const pie=(parts,cx,cy,r)=>{const total=parts.reduce((a,p)=>a+p.value,0);let angle=-Math.PI/2;for(const p of parts){if(p.value<=0)continue;const sweep=2*Math.PI*p.value/total;doc.setFillColor(...p.color);if(p.value===total){doc.circle(cx,cy,r,'F');continue;}const points=[[cx,cy],[cx+r*Math.cos(angle),cy+r*Math.sin(angle)]];for(let j=1;j<=64;j++){const a=angle+sweep*j/64;points.push([cx+r*Math.cos(a),cy+r*Math.sin(a)]);}doc.lines(points.slice(1).map((q,j)=>[q[0]-points[j][0],q[1]-points[j][1]]),cx,cy,[1,1],'F',true);angle+=sweep;}};
  header();text('Emitido em '+(meta.generatedAt||new Date().toLocaleString('pt-BR'))+' | Revisão '+(meta.revision??'—'),8);
  if(meta.draft)text('SIMULAÇÃO NÃO SALVA - percentuais em edição.',10,true);
  const t=m.totals,target=m.settings.targetCents,complete=t.coverageComplete&&target>0&&t.coverageCents>=0;
  if(!complete)text('Cobertura parcial ou inválida: consulte as pendências do painel.',10,true);
  row('Custo previsto',money(target));row('Cobertura contratada',money(t.coverageCents));row('Falta cobrir',money(t.shortfallCents));
  const con=m.consolidation?.valid?m.consolidation:null;
  let components=con?[...con.groups.filter(g=>g.commonCents>0).map(g=>({label:g.label,value:g.commonCents,origin:g.origin})),{label:'Permutas',value:con.barterCents,origin:'barter'},{label:'Aportes dos sócios',value:m.contributionsCents,origin:'contributions'}]: (c?.decomposition.parts||[]).filter(p=>p.sign>0&&p.knownCents>0).map(p=>({label:({contributions:'Aportes dos sócios',direta:'Compra e venda',scp:'SCP',unknown:'A classificar',barter:'Permutas'})[p.key],value:p.knownCents,origin:p.key}));
  components=components.filter(p=>p.value>0).map((p,j)=>({...p,color:({scp:palette[0],direta:palette[1],barter:palette[3],contributions:palette[4],unknown:palette[5]})[p.origin]||palette[j%palette.length]}));
  const commission=con?.commissionCents??t.commissionCents??0;
  if(complete){
   space(65);const ratio=Math.min(1,t.coverageCents/target),gap=Math.max(0,target-t.coverageCents);
   const slices=commission>0?[{label:'Cobertura líquida',value:t.coverageCents,color:palette[0]}]:components;
   pie([...slices,{label:'Falta cobrir',value:gap,color:[222,222,207]}],43,y+26,25);
   doc.setFont('helvetica','bold');doc.setFontSize(12);doc.text('Cobertura: '+pct(ratio),82,y+17);doc.text('Falta: '+pct(1-ratio),82,y+28);doc.setFont('helvetica','normal');doc.setFontSize(9);doc.text('Percentuais sobre o custo da obra',82,y+39);y+=62;
   if(commission>0)text('Pizza líquida de comissões; as origens brutas e a dedução estão discriminadas abaixo.',8);
   if(t.coverageCents>target)text('Excedente: '+money(t.coverageCents-target)+'. Fatias proporcionais à cobertura total; percentuais abaixo sobre o custo.',8);
  }
  text('Composição da cobertura',13,true);
  for(const p of components)row(p.label,money(p.value),target>0?pct(p.value/target):'—',p.color);
  if(commission)row('Comissões - dedução','- '+money(commission),target>0?'- '+pct(commission/target):'—');
  row('Falta cobrir',money(t.shortfallCents),target>0?pct(t.shortfallCents/target):'—',[222,222,207]);
  row(t.coverageComplete?'Total de cobertura':'Cobertura conhecida (parcial)',money(t.coverageKnownCents),target>0?pct(t.coverageKnownCents/target):'—');
  doc.addPage();header();const i=c?.simulation; text('Meta de apartamentos',13,true);
  text((i?.estimatedCount??'A conferir')+' apartamentos estimados para cobrir a obra',18,true);
  if(i?.partial)text('Estimativa parcial: há dados pendentes.',9,true);
  const units=Array.isArray(meta.units)?meta.units.filter(u=>String(u.unidade||'').trim().toUpperCase()!=='LOJA'):null;
  if(units){const available=units.filter(u=>u.status==='Disponível').length,needed=i?.estimatedCount,used=needed==null?null:Math.min(available,needed),left=needed==null?null:Math.max(0,available-needed);const sold=units.filter(u=>u.status==='Vendido').length,reserved=units.filter(u=>u.status==='Reservado').length,other=units.length-available-sold-reserved;
   row('Total de apartamentos (loja excluída)',String(units.length));
   if(used!==null){const parts=[{label:'Já vendidos',value:sold,color:palette[0]},{label:'Reservados',value:reserved,color:palette[3]},{label:'Disponíveis para a meta',value:used,color:palette[4]},{label:'Disponíveis fora da meta',value:left,color:palette[2]},{label:'Outras situações',value:other,color:[170,175,160]}].filter(p=>p.value>0);space(58);pie(parts,42,y+23,21);let yy=y+8;for(const p of parts){doc.setFillColor(...p.color);doc.rect(78,yy-2,3,3,'F');doc.setFont('helvetica','normal');doc.setFontSize(9);doc.text(p.label+': '+p.value+' ('+pct(p.value/units.length)+')',84,yy+1);yy+=10;}y+=56;}
   row('Apartamentos disponíveis hoje',String(available));row('Sobra disponível após a meta',left===null?'A conferir':String(left));
   const shopRows=i?.shops||[],shopTotal=shopRows.every(u=>Number.isSafeInteger(u.priceCents))?shopRows.reduce((v,u)=>v+u.priceCents,0):null;
   const apartmentRemainder=left===null||!Number.isSafeInteger(i?.availableGrossCents)||!available?null:Math.round(i.availableGrossCents*left/available);
   row('Valor estimado dos apartamentos que sobram',money(apartmentRemainder));row('Loja disponível - valor de tabela',money(shopTotal));row('Potencial bruto restante: apartamentos + loja',money(apartmentRemainder===null||shopTotal===null?null:apartmentRemainder+shopTotal));
   text('Sobra estimada pela média do estoque; valor bruto, não lucro. A loja não reduz a quantidade necessária para a meta.',8);

   if(needed>available)text('A meta excede o estoque disponível em '+(needed-available)+' apartamentos.',9,true);
  }

  row('Durante a obra / parcela final',pct(m.future.P)+' / '+pct(m.future.P==null?null:1-m.future.P));row('Comissão sobre novas vendas',pct(m.future.C));row('Parte líquida para a obra',pct(m.future.valid?m.future.P-m.future.C:null));
  row('Preço médio dos apartamentos disponíveis',money(i?.averagePriceCents));row('Cobertura líquida média por apartamento',money(i?.averageContributionCents));row('Meta bruta de novas vendas',money(m.future.requiredGrossCents));
  if(i?.insufficient)text('Estoque insuficiente: falta '+money(i.remainingGapCents)+' após vender os '+i.availableCount+' apartamentos disponíveis.',10,true);
  space(33);text('Critérios',12,true);text('Cobertura contratada não é saldo em caixa. Parcelas finais não cobrem a meta. Comissão é custo, descontado uma única vez. Loja e unidades reservadas não entram na média dos apartamentos disponíveis. A quantidade é arredondada para cima e depende das unidades efetivamente vendidas.',9);
  text('Este relatório não altera vendas, permutas, aportes nem recebimentos.',9);
  for(let p=1;p<=doc.getNumberOfPages();p++){doc.setPage(p);doc.setFontSize(8);doc.setTextColor(100,105,90);doc.text('Diamond - '+p+'/'+doc.getNumberOfPages(),196,289,{align:'right'});}
  return doc;
 }
 root.DiamondPrevisaoPdf={build};
})(typeof window==='undefined'?globalThis:window);
