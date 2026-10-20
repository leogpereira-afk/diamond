/* Regras de leitura para o painel de gestão Diamond. */
(function(root){
  const todaySP=(value=new Date())=>{
    const p=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(value);
    const o=Object.fromEntries(p.filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
    return `${o.year}-${o.month}-${o.day}`;
  };
  const dateSP=value=>{
    if(!value)return '';
    const s=String(value);
    if(/^\d{4}-\d{2}-\d{2}$/.test(s)){
      const [y,m,d]=s.split('-').map(Number),check=new Date(Date.UTC(y,m-1,d));
      return check.getUTCFullYear()===y&&check.getUTCMonth()===m-1&&check.getUTCDate()===d?s:'';
    }
    const d=new Date(value);
    return Number.isNaN(d.getTime())?'':todaySP(d);
  };
  const when=(value,today)=>{
    const day=dateSP(value);
    return !day?'sem-data':day<today?'vencido':day===today?'hoje':'futuro';
  };
  const back=visao=>`#/admin/painel?visao=${encodeURIComponent(visao)}`;
  const routes={
    proposal:(id,visao='resumo')=>`#/proposta/${encodeURIComponent(id)}?voltar=${encodeURIComponent(back(visao))}`,
    unit:(id,visao='compradores')=>`#/conexoes/${encodeURIComponent(id)}?voltar=${encodeURIComponent(back(visao))}`,
    customer:(id,visao='retornos')=>`#/cliente/${encodeURIComponent(id)}?voltar=${encodeURIComponent(back(visao))}`,
    reservation:(filtro,id='')=>`#/admin/reservas?filtro=${encodeURIComponent(filtro)}${id?'&unidade='+encodeURIComponent(id):''}`,
    envio:id=>`#/admin/envios?envio=${encodeURIComponent(id)}&fila=pendente`,
  };
  // Ranking de corretores pelas vendas efetivadas: unidade com situação Vendido e o
  // "quem vendeu" marcado em Unidades e vendas. Mesma pessoa escrita com acento, caixa
  // ou espaço diferente conta junto; empate divide a posição (1º, 1º, 3º). Venda sem
  // corretor marcado não entra no ranking e é contada à parte, para corrigir.
  const chave=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim().toLowerCase();
  const porUnidade=(a,b)=>a.unidade.localeCompare(b.unidade,'pt-BR',{numeric:true});
  function rankingCorretores(unidades=[]){
    const vendidas=unidades.filter(u=>u.status==='Vendido'),mapa=new Map(),semCorretorVendas=[];let semCorretor=0;
    for(const u of vendidas){
      const venda={id:u.id,unidade:String(u.unidade??'').trim(),comprador:String(u.compradorNome||'').trim()};
      const nome=String(u.vendedorNome||'').replace(/\s+/g,' ').trim();if(!nome){semCorretor++;semCorretorVendas.push(venda);continue;}
      const empresa=String(u.vendedorEmpresa||'').replace(/\s+/g,' ').trim(),k=chave(nome)+'|'+chave(empresa);
      const r=mapa.get(k)||{nome,empresa,vendas:0,unidades:[],lista:[]};r.vendas++;r.unidades.push(venda.unidade);r.lista.push(venda);mapa.set(k,r);
    }
    const lista=[...mapa.values()].sort((a,b)=>b.vendas-a.vendas||a.nome.localeCompare(b.nome,'pt-BR'));
    let posicao=0,anterior=null;
    lista.forEach((r,i)=>{if(r.vendas!==anterior){posicao=i+1;anterior=r.vendas;}r.posicao=posicao;r.unidades=r.unidades.filter(Boolean).sort((a,b)=>a.localeCompare(b,'pt-BR',{numeric:true}));r.lista.sort(porUnidade);});
    return {lista,semCorretor,semCorretorVendas:semCorretorVendas.sort(porUnidade),totalVendidas:vendidas.length};
  }
  function charts({unidades=[],leads=[],propostas=[],now=new Date()}={}){
    const hoje=todaySP(now),[year,month]=hoje.split('-').map(Number);
    const months=Array.from({length:6},(_,i)=>{
      const d=new Date(Date.UTC(year,month-1-5+i,1));
      const key=`${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}`;
      return {key,label:new Intl.DateTimeFormat('pt-BR',{month:'short',year:'2-digit',timeZone:'UTC'}).format(d).replace('.',''),value:0,current:i===5};
    });
    let invalidDates=0,outsidePeriod=0,futureDates=0;
    for(const p of propostas){
      const date=dateSP(p.criadoEm);
      if(!date){invalidDates++;continue;}
      if(date>hoje){futureDates++;continue;}
      const bucket=months.find(m=>m.key===date.slice(0,7));
      if(bucket)bucket.value++;else outsidePeriod++;
    }
    const stages=[['novo','Novos','blue'],['contato','Em contato','blue'],['proposta','Com proposta','purple'],['negociando','Negociando','amber'],['fechado','Fechados no CRM','green'],['perdido','Perdidos','neutral']].map(([key,label,tone])=>({key,label,tone,value:leads.filter(l=>l.estagio===key).length}));
    const unknownLeads=leads.length-stages.reduce((n,s)=>n+s.value,0);
    if(unknownLeads)stages.push({key:'outros',label:'Etapa não informada',tone:'neutral',value:unknownLeads});
    const stock=[['Disponível','Disponíveis','green'],['Reservado','Reservadas','purple'],['Vendido','Vendidas','red']].map(([key,label,tone])=>({key,label,tone,value:unidades.filter(u=>u.status===key).length}));
    const unknownStock=unidades.length-stock.reduce((n,s)=>n+s.value,0);
    if(unknownStock)stock.push({key:'outros',label:'Outra situação',tone:'neutral',value:unknownStock});
    return {stock,stages,months,ranking:rankingCorretores(unidades),invalidDates,outsidePeriod,futureDates,periodTotal:months.reduce((n,m)=>n+m.value,0),leadsTotal:leads.length,stockTotal:unidades.length};
  }
  function build({unidades=[],pedidos=[],leads=[],envios=[],propostas=[],now=new Date()}={}){
    const hoje=todaySP(now),resUn=unidades.filter(u=>u.status==='Reservado');
    const vencidas=resUn.filter(u=>u.reserva?.prazo&&Date.parse(u.reserva.prazo)<=now.getTime());
    const semPrazo=resUn.filter(u=>!u.reserva?.prazo||!Number.isFinite(Date.parse(u.reserva.prazo)));
    const ativas=resUn.filter(u=>!vencidas.includes(u)&&!semPrazo.includes(u));
    const retornosCRM=leads.filter(l=>!['fechado','perdido'].includes(l.estagio)&&l.proximoContato&&when(l.proximoContato,hoje)!=='futuro');
    const retornosEnvios=envios.filter(e=>['pendente','contato'].includes(e.acompanhamento?.etapa)&&when(e.acompanhamento?.data,hoje)!=='futuro');
    const compradores=unidades.filter(u=>u.status==='Vendido').slice().sort((a,b)=>String(a.unidade||'').localeCompare(String(b.unidade||''),'pt-BR',{numeric:true})).map(u=>({unidade:u,comprador:String(u.compradorNome||'').trim()}));
    return {
      hoje, estoque:{disponiveis:unidades.filter(u=>u.status==='Disponível').length,reservadas:resUn.length,vendidas:unidades.filter(u=>u.status==='Vendido').length,total:unidades.length},
      pedidos, reservas:{vencidas,semPrazo,ativas}, retornosCRM, retornosEnvios, compradores, totalEnvios:envios.length,
      propostas:propostas.slice().sort((a,b)=>String(b.criadoEm||'').localeCompare(String(a.criadoEm||''))),
      charts:charts({unidades,leads,propostas,now}),
    };
  }
  root.DiamondGestaoDomain={todaySP,dateSP,when,build,charts,rankingCorretores,routes};
})(typeof window!=='undefined'?window:globalThis);
