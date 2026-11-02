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
  const text=(value,size=10,bold=false)=>{doc.setFont('helvetica',bold?'bold':'normal');doc.setFontSize(size);const lines=doc.splitTextToSize(String(value),182);space(lines.length*5+3);doc.setTextColor(35,40,28);doc.setFont('helvetica',bold?'bold':'normal');doc.setFontSize(size);doc.text(lines,14,y);y+=lines.length*5+3;};
  const row=(label,value)=>{space(14);doc.setFontSize(10);doc.setFont('helvetica','normal');const lines=doc.splitTextToSize(label,113);space(lines.length*5+5);doc.text(lines,14,y);doc.setFont('helvetica','bold');doc.text(value,196,y,{align:'right'});y+=lines.length*5+5;doc.setDrawColor(220,224,209);doc.line(14,y-3,196,y-3);};
  header();text('Emitido em '+(meta.generatedAt||new Date().toLocaleString('pt-BR'))+' | Revisão '+(meta.revision??'—'),8);
  if(meta.draft)text('SIMULAÇÃO NÃO SALVA - percentuais em edição.',10,true);
  const t=m.totals,target=m.settings.targetCents,complete=t.coverageComplete&&target>0&&t.coverageCents>=0;
  if(!complete)text('Cobertura parcial ou inválida: consulte as pendências do painel.',10,true);
  row('Custo previsto',money(target));row('Cobertura contratada',money(t.coverageCents));row('Falta cobrir',money(t.shortfallCents));
  if(complete){
   space(62);const ratio=Math.min(1,t.coverageCents/target),cx=40,cy=y+24,r=23;
   doc.setFillColor(222,222,207);doc.circle(cx,cy,r,'F');
   if(ratio>=1){doc.setFillColor(107,133,51);doc.circle(cx,cy,r,'F');}
   else if(ratio>0){const points=[[cx,cy],[cx,cy-r]];for(let i=1;i<=Math.ceil(ratio*100);i++){const a=-Math.PI/2+2*Math.PI*ratio*i/Math.ceil(ratio*100);points.push([cx+r*Math.cos(a),cy+r*Math.sin(a)]);}const delta=points.slice(1).map((p,i)=>[p[0]-points[i][0],p[1]-points[i][1]]);doc.setFillColor(107,133,51);doc.lines(delta,cx,cy,[1,1],'F',true);}
   doc.setFontSize(11);doc.text('Já coberto: '+pct(ratio),76,y+18);doc.text('Falta cobrir: '+pct(1-ratio),76,y+29);y+=56;
   if(t.coverageCents>target)text('Excedente além do custo: '+money(t.coverageCents-target),9);
  }
  text('Composição da cobertura',13,true);
  const con=m.consolidation?.valid?m.consolidation:null;
  if(con){for(const g of con.groups)row(g.label,money(g.commonCents));row('Permutas',money(con.barterCents));row('Aportes dos sócios',money(m.contributionsCents));if(con.commissionCents)row('Comissões - dedução','- '+money(con.commissionCents));}
  else {const labels={contributions:'Aportes dos sócios',direta:'Compra e venda',scp:'SCP',unknown:'A classificar',barter:'Permutas',commission:'Comissões - dedução'};for(const p of c?.decomposition.parts||[])if(p.knownCents!==0)row(labels[p.key],(p.sign<0?'- ':'')+money(p.knownCents));}
  row(t.coverageComplete?'Total de cobertura':'Cobertura conhecida (parcial)',money(t.coverageKnownCents));
  doc.addPage();header();const i=c?.simulation; text('Meta de apartamentos',13,true);
  text((i?.estimatedCount??'A conferir')+' apartamentos estimados para cobrir a obra',18,true);
  if(i?.partial)text('Estimativa parcial: há dados pendentes.',9,true);
  row('Durante a obra / parcela final',pct(m.future.P)+' / '+pct(m.future.P==null?null:1-m.future.P));row('Comissão sobre novas vendas',pct(m.future.C));row('Parte líquida para a obra',pct(m.future.valid?m.future.P-m.future.C:null));
  row('Preço médio dos apartamentos disponíveis',money(i?.averagePriceCents));row('Cobertura líquida média por apartamento',money(i?.averageContributionCents));row('Meta bruta de novas vendas',money(m.future.requiredGrossCents));
  if(i?.insufficient)text('Estoque insuficiente: falta '+money(i.remainingGapCents)+' após vender os '+i.availableCount+' apartamentos disponíveis.',10,true);
  space(45);text('Critérios',12,true);text('Cobertura contratada não é saldo em caixa. Parcelas finais não cobrem a meta. Comissão é custo, descontado uma única vez. Loja e unidades reservadas não entram na média dos apartamentos disponíveis. A quantidade é arredondada para cima e depende das unidades efetivamente vendidas.',9);
  text('Este relatório não altera vendas, permutas, aportes nem recebimentos.',9);
  for(let p=1;p<=doc.getNumberOfPages();p++){doc.setPage(p);doc.setFontSize(8);doc.setTextColor(100,105,90);doc.text('Diamond - '+p+'/'+doc.getNumberOfPages(),196,289,{align:'right'});}
  return doc;
 }
 root.DiamondPrevisaoPdf={build};
})(typeof window==='undefined'?globalThis:window);
