/* Exportação somente leitura: os mesmos modelos do Caixa, em centavos. */
(function(root){
 'use strict';
 const known=n=>Number.isSafeInteger(n)&&n>=0;
 const clean=s=>String(s??'').replace(/[\u00a0\u202f]/g,' ').replace(/[\u2010-\u2015]/g,'-');
 const money=n=>known(n)?clean((n/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})):'A conferir';
 const month=s=>/^\d{4}-\d{2}$/.test(s||'')?new Date(s+'-15T12:00:00Z').toLocaleDateString('pt-BR',{month:'long',year:'numeric',timeZone:'UTC'}):'Sem vencimento';
 const short=s=>new Date(s+'-15T12:00:00Z').toLocaleDateString('pt-BR',{month:'short',timeZone:'UTC'}).replace('.','');
 const compact=n=>known(n)?clean((n/100).toLocaleString('pt-BR',{notation:'compact',maximumFractionDigits:1})):'A conferir';
 const sum=values=>values.every(known)&&Number.isSafeInteger(values.reduce((s,v)=>s+v,0))?values.reduce((s,v)=>s+v,0):null;
 function model(source,financial,meta={}){
  const D=root.DiamondCaixaDomain,Dash=root.DiamondCaixaDashboardDomain,M=root.DiamondCaixaMoneyDomain;
  if(!D||!Dash||!M||!financial?.data)throw Error('Os dados do Caixa ainda não estão completos para exportar. Atualize o caixa.');
  const cash=D.build(source),selected=Dash.build(source),charts=cash.mes==='sem-data'?Dash.build({...source,mes:cash.hoje.slice(0,7)}):selected;
  const position=M.build({units:source.unidades,conditions:source.condicoes,record:financial,model:cash});
  const undated=D.build({...source,mes:'sem-data'}),totals={previsto:sum(charts.mensal.map(m=>m.previsto)),recebido:sum(charts.mensal.map(m=>m.recebido)),aReceber:sum(charts.mensal.map(m=>m.aReceber))};
  return {cash,charts,selected,position,undated,totals,filters:{busca:source.busca||'',status:source.status||''},meta:{generatedAt:new Date().toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}),revision:financial.revision,...meta}};
 }
 function build(r){
  const Pdf=root.jspdf?.jsPDF;if(!Pdf)throw Error('Gerador de PDF indisponível. Recarregue a página.');
  const doc=new Pdf({unit:'mm',format:'a4'}),W=210,left=14,right=196,width=182,bottom=278;
  const ink=[38,47,32],muted=[90,103,78],paid=[56,108,72],due=[200,220,98],line=[224,229,216];let y=0;
  const font=(size=9,bold=false,color=ink)=>{doc.setFont('helvetica',bold?'bold':'normal');doc.setFontSize(size);doc.setTextColor(...color);};
  const header=()=>{doc.setFillColor(35,40,28);doc.rect(0,0,W,25,'F');font(17,true,[235,249,126]);doc.text('DIAMOND | Caixa',left,12);font(8,false,[235,249,126]);doc.text('Domo Construtora - previsão e recebimentos',left,19);y=34;};
  const page=()=>{doc.addPage();header();};
  const space=h=>{if(y+h>bottom)page();};
  const text=(s,size=9,bold=false,color=ink)=>{font(size,bold,color);const lines=doc.splitTextToSize(clean(s),width),h=lines.length*size*.40+3;space(h);font(size,bold,color);doc.text(lines,left,y,{lineHeightFactor:1.16});y+=h;};
  const title=s=>{space(14);text(s,13,true);};
  const amountRow=(label,value)=>{font();const ls=doc.splitTextToSize(clean(label),115),h=Math.max(8,ls.length*4+3);space(h);font();doc.text(ls,left,y);font(10,true);doc.text(money(value),right,y,{align:'right'});y+=h;};
  const empty=s=>text(s,9,false,muted);
  header();text('Emitido em '+r.meta.generatedAt+' (Brasília) | Revisão '+(r.meta.revision??'-'),8,false,muted);
  text('Todos os meses: '+(r.charts.periodo?month(r.charts.periodo.inicio)+' a '+month(r.charts.periodo.fim):'sem vencimentos cadastrados'),10,true);
  title('Dinheiro recebido e a receber');
  const cards=[['Total em dinheiro',r.position.total],['Recebido informado',r.position.received],['A receber em dinheiro',r.position.outstanding]];
  const cw=(width-8)/3;cards.forEach(([label,value],i)=>{const x=left+i*(cw+4);doc.setFillColor(...(i===1?[235,244,235]:i===2?[246,248,228]:[246,247,242]));doc.setDrawColor(...line);doc.roundedRect(x,y,cw,24,2,2,'FD');font(8,true,muted);doc.text(label,x+3,y+6);font(11,true);doc.text(money(value),x+3,y+16);});y+=31;
  text('Carteira completa, independentemente dos filtros. Inclui parcelas finais em dinheiro; exclui permutas e aportes dos sócios.',8,false,muted);
  const labels={pendentes:'A receber',vencidas:'Vencidas sem confirmação',recebido:'Recebidas',recebidas:'Recebidas',parcial:'Parciais',aberto:'Em aberto'};
  text('Gráficos e tabela mensal: '+(r.filters.busca?'busca “'+r.filters.busca+'”; ':'sem filtro de cliente; ')+(labels[r.filters.status]||'todas as situações')+'. Mês do painel: '+month(r.cash.mes)+'.',8,false,muted);
  if(r.charts.cobertura.incompleta||r.position.issues.length)text('Previsão parcial: as pendências e os valores a conferir foram preservados neste relatório.',9,true);
  title('Previsão por mês');
  const legend=()=>{doc.setFillColor(...paid);doc.rect(left,y-2,3,3,'F');font(8);doc.text('Recebido',left+5,y+.5);doc.setFillColor(...due);doc.rect(left+30,y-2,3,3,'F');doc.text('A receber',left+35,y+.5);y+=7;};legend();
  const months=r.charts.mensal,scales=months.filter(m=>!m.semParcelas&&known(m.previsto)).map(m=>m.previsto),max=scales.length?Math.max(...scales):null;
  text((max===null?(months.every(m=>m.semParcelas)?'Sem parcelas nesta janela':'Escala a conferir'):'Mesma escala do painel: '+money(max))+'. Valores nominais, sem projeção de reajustes.',8,false,muted);
  for(const year of [...new Set(months.map(m=>m.mes.slice(0,4)))]){
   if(y+67>bottom){page();title('Previsão por mês - continuação');legend();text('Mesma escala: '+money(max)+'. Valores nominais em R$.',8,false,muted);}font(11,true);doc.text(year,left,y);y+=6;
   const items=months.filter(m=>m.mes.startsWith(year)),cell=width/items.length,base=y+40;
   doc.setDrawColor(...line);doc.setLineWidth(.2);for(let j=0;j<=2;j++)doc.line(left,base-j*18,right,base-j*18);
   items.forEach((m,i)=>{const cx=left+cell*(i+.5),bw=Math.min(8,cell*.55),ok=!m.conferir&&[m.previsto,m.recebido,m.aReceber].every(known);
    font(items.length>10?7:8,true);doc.text(m.semParcelas?['Sem','parcelas']:ok?compact(m.previsto):['A','conferir'],cx,y+3,{align:'center'});
    if(!m.semParcelas&&ok&&max>0){const hp=m.recebido/max*32,hd=m.aReceber/max*32;doc.setFillColor(...paid);if(hp>0)doc.rect(cx-bw/2,base-hp,bw,hp,'F');doc.setFillColor(...due);if(hd>0)doc.rect(cx-bw/2,base-hp-hd,bw,hd,'F');}
    else {font(8,false,muted);doc.text(m.semParcelas?'-':ok?'0':'?',cx,base-3,{align:'center'});}
    font(8,true);doc.text(short(m.mes),cx,base+5,{align:'center'});
   });y=base+14;
  }
  if(!months.length)empty('Não há vencimentos conhecidos para formar o gráfico mensal.');
  space(54);title('Totais das parcelas por vencimento');
  amountRow('Previsto nas parcelas com vencimento',r.totals.previsto);amountRow('Recebido vinculado a essas parcelas',r.totals.recebido);amountRow('A receber nessas parcelas',r.totals.aReceber);
  text('Detalhamento do gráfico, sem somar novamente à posição geral. O recebido consolidado pode conter valores ainda sem vínculo individual; veja a posição por origem e seus critérios.',8,false,muted);
  page();title('Valores exatos de todos os meses');text('Mesma busca e situação do painel. Meses sem parcelas não significam fechamento financeiro.',8,false,muted);
  const x=[left,66,106,146,183];
  const tableHeader=()=>{doc.setFillColor(239,242,231);doc.rect(left,y-4,width,8,'F');font(8,true);doc.text('Mês',x[0]+1,y+1);doc.text('Previsto',x[1]+34,y+1,{align:'right'});doc.text('Recebido',x[2]+34,y+1,{align:'right'});doc.text('A receber',x[3]+34,y+1,{align:'right'});doc.text('Qtd.',right-1,y+1,{align:'right'});y+=8;};
  tableHeader();
  for(const m of months){if(y+6>bottom){page();title('Valores exatos - continuação');tableHeader();}font(8);doc.text(month(m.mes).replace(' de ','/'),left+1,y);for(const [k,j]of [['previsto',1],['recebido',2],['aReceber',3]])doc.text(m.semParcelas?'-':money(m[k]),x[j]+34,y,{align:'right'});doc.text(String(m.parcelas),right-1,y,{align:'right'});doc.setDrawColor(...line);doc.line(left,y+2,right,y+2);y+=5.5;}
  page();title('A receber por cliente');text(month(r.cash.mes)+' - mesmo recorte do painel',10,true);
  const ranking=r.selected.ranking;
  amountRow('Saldo conhecido do recorte',ranking.total);
  if(!ranking.disponivel)empty('Ranking a conferir: há recebimentos ou cronogramas que precisam de conciliação.');
  else if(!ranking.clientes.length)empty('Nenhum cliente com saldo a receber neste recorte.');
  else{
   const highest=Math.max(...ranking.clientes.map(c=>c.aReceber));
   for(const c of ranking.clientes){font(9,true);const names=doc.splitTextToSize(clean(c.nome),112),units=doc.splitTextToSize('Unidades: '+c.unidades.join(', '),width),height=names.length*4+units.length*3.5+12;space(height);font(9,true);doc.text(names,left,y);doc.text(money(c.aReceber),right,y,{align:'right'});y+=names.length*4;doc.setFillColor(237,241,225);doc.roundedRect(left,y,width,2,1,1,'F');doc.setFillColor(99,125,29);if(c.aReceber>0)doc.rect(left,y,width*c.aReceber/highest,2,'F');y+=6;font(8,false,muted);doc.text(units,left,y);y+=units.length*3.5;doc.text(clean((c.participacao*100).toLocaleString('pt-BR',{maximumFractionDigits:1}))+'% do saldo | '+c.parcelas+' parcela(s)',left,y);y+=7;}
  }
  page();title('Posição por origem - carteira completa');
  for(const g of r.position.groups){space(30);text(g.label,10,true);amountRow('Recebido informado',g.received);amountRow('A receber em dinheiro',g.outstanding);text(g.note,8,false,muted);}
  title('Critérios e pendências');
  text(r.position.caption,9);
  if(r.cash.resumo.recebidoSemDataExata>0)text(money(r.cash.resumo.recebidoSemDataExata)+' em parcelas com confirmação histórica, sem data exata de pagamento. Esses valores aparecem como recebidos por vencimento e não simulam entrada em caixa na data-base.',9);
  text('Os totais mensais somam somente parcelas com vencimento cadastrado e com os filtros indicados. A posição geral pode incluir recebido consolidado ainda sem vínculo individual, parcelas fora do filtro ou valores sem vencimento. Não some novamente os totais dos gráficos à posição geral.',9);
  if(r.undated.filtradas.length){text('Sem vencimento - '+r.undated.filtradas.length+' lançamento(s) no recorte',10,true);amountRow('Previsto sem data',r.undated.resumo.previsto);amountRow('Recebido sem vencimento',r.undated.resumo.recebidoParcelas);amountRow('A receber sem vencimento',r.undated.resumo.aReceber);}
  const issues=[...r.position.issues,...r.cash.pendencias.map(p=>'Unidade '+p.unidade+': '+p.motivo+(known(p.valor)?' '+money(p.valor):''))];
  for(const issue of issues)text(issue,8,false,muted);
  text('Exportação somente leitura. Não altera vendas, permutas, aportes ou recebimentos. Confirmação histórica não informa o dia exato de entrada do dinheiro.',8,false,muted);
  for(let p=1;p<=doc.getNumberOfPages();p++){doc.setPage(p);font(8,false,muted);doc.text('Diamond | Caixa - '+p+'/'+doc.getNumberOfPages(),right,289,{align:'right'});}
  return doc;
 }
 const api={model,build};root.DiamondCaixaPdf=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window==='undefined'?globalThis:window);
