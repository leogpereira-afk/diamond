/* Painel gerencial independente; a navegação e o carregamento do app são integrados em app.js. */
(function(){
  const D=window.DiamondGestaoDomain;
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmtDate=s=>{if(!s)return 'Sem data';const d=new Date(/^\d{4}-\d{2}-\d{2}$/.test(String(s))?s+'T12:00:00':s);return Number.isNaN(d.getTime())?'Data inválida':d.toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo'});};
  const fmtMoney=n=>Number(n||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL',minimumFractionDigits:2,maximumFractionDigits:2});
  const routeBack=visao=>`#/admin/painel?visao=${encodeURIComponent(visao)}`;
  const unitLink=(u,visao)=>D.routes.unit(u.id,visao);
  const reservationLink=(filtro,id='')=>D.routes.reservation(filtro,id);
  const customerLink=(id,visao)=>D.routes.customer(id,visao);
  const proposalLink=(p,visao)=>D.routes.proposal(p.id,visao);
  const envioLink=e=>D.routes.envio(e.id);
  let generation=0;
  async function listAllProposals(){
    const out=[];let after=null,more=true,pages=0,total=null;
    while(more&&pages<50){const r=await STORE.api('listPropostas',{after,comoCorretor:STORE.getUser()?.corretorAtivo?.nome||''});if(r?.ok===false||!Array.isArray(r?.propostas))throw Error(r?.erro||'Resposta de propostas inválida.');out.push(...r.propostas);total=Number.isFinite(r.total)?r.total:total;after=r.nextAfter||null;more=!!after;pages++;}
    return {propostas:out,total,completa:!more&&(total==null||total<=out.length)};
  }
  function buyer(u,leads,fn){
    const direct=String(u.compradorNome||'').trim();if(direct)return {label:direct,source:'unidade'};
    if(typeof fn==='function'){
      const result=String(fn(u,leads)||'').trim();
      if(result==='Conferir compradores no CRM')return {label:'Conferir vínculo do comprador',source:'pendente'};
      if(result&& !['—','Não informado','Não informado.'].includes(result))return {label:result,source:'CRM'};
    }
    return {label:'Comprador não identificado',source:'pendente'};
  }
  function dueLabel(value,today){const state=D.when(value,today);return state==='vencido'?'Vencido':state==='hoje'?'Hoje':state==='sem-data'?'Definir data':'Retorno futuro';}
  function escLink(href,label,cls='gt-link'){return `<a class="${cls}" href="${esc(href)}">${label}</a>`;}
  function sectionTitle(title,detail=''){return `<div class="gt-section-title"><h2>${title}</h2>${detail?`<span>${detail}</span>`:''}</div>`;}
  function metric(label,value,href,kind=''){
    return href?`<a class="gt-metric ${kind}" href="${esc(href)}"><span>${label}</span><b>${value}</b></a>`:`<div class="gt-metric ${kind}"><span>${label}</span><b>${value}</b></div>`;
  }
  function chartBars(rows,total){
    return `<ul class="gt-bars">${rows.map(r=>{
      const pct=total?r.value/total*100:0;
      const content=`<span class="gt-bar-label"><i class="gt-dot" aria-hidden="true"></i>${esc(r.label)}</span><span class="gt-bar-value"><b>${r.value}</b><small>${pct.toLocaleString('pt-BR',{maximumFractionDigits:1})}%</small></span><span class="gt-bar-track" aria-hidden="true"><i style="width:${pct}%"></i></span>`;
      return `<li class="tone-${r.tone}">${r.href?`<a href="${esc(r.href)}">${content}</a>`:`<div>${content}</div>`}</li>`;
    }).join('')}</ul>`;
  }
  function visualCharts({model:m,unitsOk,leadsOk,proposalsOk,proposalsComplete=true,report=false}){
    const c=m.charts;
    const title=(icon,text,sub)=>`<figcaption><span class="gt-chart-icon" aria-hidden="true">${icon}</span><div><h2>${text}</h2><p>${esc(sub)}</p></div></figcaption>`;
    const unavailable='<p class="gt-chart-empty">Consulta indisponível. Atualize os dados para ver este gráfico.</p>';
    const stock=c.stock.map(r=>({...r,href:r.key==='Reservado'?reservationLink('todas'):r.key==='outros'?'':'#/admin/vendas?status='+encodeURIComponent(r.key)}));
    const max=Math.max(1,...c.months.map(x=>x.value));
    const excluded=[c.invalidDates?`${c.invalidDates} sem data válida`:null,c.futureDates?`${c.futureDates} com data futura`:null].filter(Boolean);
    const trendNote=`${proposalsComplete?'':'Leitura parcial. '}${c.periodTotal} proposta(s) no período. Mês atual até ${fmtDate(m.hoje)}.${excluded.length?' Fora do gráfico: '+excluded.join(' e ')+'.':''} Propostas não são vendas.`;
    return `<div class="gt-charts ${report?'gt-charts-report':''}">
      <figure class="gt-chart gt-chart-stock">${title('▦','Unidades por situação',unitsOk?`${c.stockTotal} unidades no estoque atual`:'Estoque não consultado')}${unitsOk?`${chartBars(stock,c.stockTotal)}<p class="gt-chart-note">Participação no estoque.${report?'':' Clique numa situação para abrir a lista.'}</p>`:unavailable}</figure>
      <figure class="gt-chart gt-chart-trend">${title('▥','Propostas por mês','Quantidade emitida nos últimos 6 meses')}${proposalsOk?`<div class="gt-months" role="list" aria-label="Propostas emitidas por mês. Escala de zero a ${max} propostas.">${c.months.map(x=>`<div class="gt-month ${x.current?'is-current':''}" role="listitem"><b>${x.value}</b><span class="gt-month-track" aria-hidden="true"><i style="height:${x.value/max*100}%"></i></span><span>${esc(x.label)}</span></div>`).join('')}</div><p class="gt-chart-note">${esc(trendNote)}</p>`:unavailable}</figure>
      ${report?'':`<figure class="gt-chart gt-chart-crm">${title('♙','Clientes por etapa',leadsOk?`${c.leadsTotal} registros na carteira consultada`:'CRM não consultado')}${leadsOk?`${chartBars(c.stages.map(r=>({...r,href:r.key==='outros'?'':'#/admin/clientes?etapa='+r.key})),c.leadsTotal)}<p class="gt-chart-note">Situação atual dos registros, sem medir conversão. Fechado no CRM não significa unidade vendida.</p>`:unavailable}</figure>
      <figure class="gt-chart gt-chart-reservations">${title('◷','Prazos das reservas',unitsOk?`${m.estoque.reservadas} apartamentos reservados`:'Reservas não consultadas')}${unitsOk?`${chartBars([{label:'Com prazo vigente',value:m.reservas.ativas.length,tone:'purple',href:reservationLink('ativas')},{label:'Prazo vencido',value:m.reservas.vencidas.length,tone:'red',href:reservationLink('vencidas')},{label:'Sem prazo válido',value:m.reservas.semPrazo.length,tone:'amber',href:reservationLink('incompletas')}],m.estoque.reservadas)}<a class="gt-chart-callout" href="${reservationLink('pedidos')}"><span>Pedidos aguardando decisão</span><b>${m.pedidos.length} →</b></a><p class="gt-chart-note">Pedidos ainda não aprovados ficam separados das unidades reservadas.</p>`:unavailable}</figure>`}
    </div>`;
  }
  function stateText(s){return s==='fulfilled'?'Consultado nesta abertura':s==='rejected'?'Falha nesta consulta':'Cache local';}
  function render({compradorVenda}={}){
    const current=++generation;
    const host=document.querySelector('#aba-corpo');if(!host)return;
    document.body.classList.remove('gestao-print-mode');
    if(!window.STORE?.podeVerPainel?.()){host.innerHTML='<section class="gt-panel"><h2>Acesso restrito</h2><p>O painel gerencial está disponível apenas para perfis autorizados.</p></section>';return;}
    const params=new URLSearchParams(location.hash.split('?')[1]||''),visao=['compradores','retornos','relatorios'].includes(params.get('visao'))?params.get('visao'):'resumo';
    const consultas=[
      STORE.api('reservasPainel',{operacao:'listar'}),
      STORE.api('listLeads',{comoCorretor:STORE.getUser()?.corretorAtivo?.nome||''}),
      STORE.listEnvios(),
      listAllProposals(),
    ];
    host.innerHTML='<section class="gt-panel"><p role="status">Atualizando os dados gerenciais…</p></section>';
    Promise.allSettled(consultas).then(results=>{
      if(current!==generation||!host.isConnected||location.hash.split('?')[0]!=='#/admin/painel')return;
      const [resResult,leadResult,envResult,proposalResult]=results;
      const unitsOk=resResult.status==='fulfilled'&&resResult.value?.ok!==false&&Array.isArray(resResult.value?.unidades);
      const leadsOk=leadResult.status==='fulfilled'&&leadResult.value?.ok!==false&&Array.isArray(leadResult.value?.leads);
      const envOk=envResult.status==='fulfilled'&&Array.isArray(envResult.value);
      const proposalsOk=proposalResult.status==='fulfilled'&&Array.isArray(proposalResult.value?.propostas);
      const unidades=unitsOk?resResult.value.unidades:[],pedidos=unitsOk?(resResult.value.pedidos||[]):[],leads=leadsOk?leadResult.value.leads:[],envios=envOk?envResult.value:[];
      const propostas=proposalsOk?proposalResult.value.propostas:(STORE.getPropostas?.()||[]);
      const model=D.build({unidades,pedidos,leads,envios,propostas,now:new Date()});
      const freshness=STORE.status?.()||{};
      const sources=[['Estoque e reservas',unitsOk?'fulfilled':'rejected',unitsOk?'Consulta da gestão de reservas':resResult.reason?.message||resResult.value?.erro||'Sem resposta'],['CRM',leadsOk?'fulfilled':'rejected',leadsOk?'Consulta da carteira autorizada':leadResult.reason?.message||leadResult.value?.erro||'Sem resposta'],['Envios',envOk?'fulfilled':'rejected',envOk?'Links e acompanhamentos deste acesso':envResult.reason?.message||'Sem resposta'],['Propostas',proposalsOk?'fulfilled':'rejected',proposalsOk?`${propostas.length} registro(s) consultado(s)${proposalResult.value.completa?'':' · leitura parcial após 50 páginas'}`:`Consulta falhou; ${propostas.length} registro(s) do cache local exibidos`]];
      if(current!==generation||!host.isConnected||location.hash.split('?')[0]!=='#/admin/painel')return;
      if(visao==='relatorios')document.body.classList.add('gestao-print-mode');
      const tab=[['resumo','Visão geral'],['compradores','Compradores'],['retornos','Retornos'],['relatorios','Relatório']].map(([key,label])=>`<a href="${esc(routeBack(key))}" class="${key===visao?'on':''}" ${key===visao?'aria-current="page"':''}>${label}</a>`).join('');
      const stamp=new Date().toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'});
      const coverage=`<div class="gt-coverage"><b>Consulta ${esc(stamp)} · horário de Brasília</b><div>${sources.map(([n,s,d])=>`<span class="${s==='rejected'?'err':''}"><b>${esc(n)}:</b> ${esc(stateText(s))} · ${esc(d)}</span>`).join('')}</div>${freshness.estado==='offline'?'<p class="gt-warning">O painel está sem conexão. Propostas vêm do cache local; consultas que falharam estão marcadas.</p>':''}</div>`;
      let body='';
      if(visao==='resumo')body=overview({model,unitsOk,leadsOk,envOk,proposalsOk,proposalsComplete:proposalResult.value?.completa,propostas,leads,compradorVenda});
      if(visao==='compradores')body=buyers({model,unitsOk,leads,compradorVenda});
      if(visao==='retornos')body=returns({model,unitsOk,leadsOk,envOk});
      if(visao==='relatorios')body=report({model,unitsOk,leadsOk,envOk,proposalsOk,proposalsComplete:proposalResult.value?.completa,propostas,stamp,sources,compradorVenda,leads});
      host.innerHTML=`<section class="gt-panel"><header class="gt-header"><div><p class="gt-kicker">DIAMOND · GESTÃO</p><h1>${visao==='relatorios'?'Relatório gerencial':visao==='compradores'?'Compradores e propostas':visao==='retornos'?'Reservas e próximos passos':'Visão geral'}</h1><p>Estoque, compradores, reservas e acompanhamento numa só entrada.</p></div><div class="gt-header-actions"><button type="button" class="gt-refresh" id="gt-refresh" aria-label="Atualizar dados do painel">Atualizar dados</button>${visao==='relatorios'?'<button type="button" class="gt-print" id="gt-print">Imprimir / salvar PDF</button>':''}</div></header><nav class="gt-tabs" aria-label="Visões gerenciais">${tab}</nav>${body}${coverage}</section>`;
      host.querySelector('#gt-print')?.addEventListener('click',()=>window.print());
      host.querySelector('#gt-refresh')?.addEventListener('click',()=>render({compradorVenda}));
    }).catch(err=>{if(current===generation&&host.isConnected)host.innerHTML=`<section class="gt-panel"><p role="alert">Não foi possível abrir o painel: ${esc(err.message)}</p><button class="gt-print" id="gt-retry">Tentar novamente</button></section>`;host.querySelector('#gt-retry')?.addEventListener('click',()=>render({compradorVenda}));});
  }
  function overview({model:m,unitsOk,leadsOk,envOk,proposalsOk,proposalsComplete,propostas,leads,compradorVenda}){
    const stock=unitsOk?m.estoque:null;
    const reserved=unitsOk?m.reservas:null;
    const crm=leadsOk?m.retornosCRM:null,mail=envOk?m.retornosEnvios:null;
    const priorities=[];
    if(unitsOk){if(m.pedidos.length)priorities.push({title:`${m.pedidos.length} pedido(s) aguardam decisão`,detail:'Fila de pedidos de reserva',href:reservationLink('pedidos')});if(reserved.vencidas.length)priorities.push({title:`${reserved.vencidas.length} reserva(s) vencida(s)`,detail:'Revisar prazo e situação',href:reservationLink('vencidas')});if(reserved.semPrazo.length)priorities.push({title:`${reserved.semPrazo.length} reserva(s) sem prazo`,detail:'Completar o cadastro da reserva',href:reservationLink('incompletas')});}
    if(leadsOk&&crm.length)priorities.push({title:`${crm.length} retorno(s) de CRM para hoje ou atrasado(s)`,detail:'Clientes abertos com data vencida ou hoje',href:routeBack('retornos')});
    if(envOk&&mail.length)priorities.push({title:`${mail.length} acompanhamento(s) de envio para revisar`,detail:'Pendente ou em contato, com data vencida ou ausente',href:routeBack('retornos')});
    const newest=propostas.slice(0,5);
    const buyers=unitsOk?m.compradores.slice(0,5):[];
    return `<div class="gt-metrics">${unitsOk?`${metric('Disponíveis',stock.disponiveis,'#/admin/vendas?status=Disponível','available')}${metric('Reservadas',stock.reservadas,reservationLink('todas'),'reserved')}${metric('Vendidas',stock.vendidas,'#/admin/vendas?status=Vendido','sold')}`:'<p class="gt-warning">Estoque não consultado. Os números de estoque não estão disponíveis.</p>'}${unitsOk?metric('Pedidos pendentes',m.pedidos.length,reservationLink('pedidos'),'urgent'):''}${leadsOk?metric('Retornos CRM',crm.length,routeBack('retornos'),crm.length?'urgent':'info'):''}${envOk?metric('Envios a revisar',mail.length,routeBack('retornos'),mail.length?'urgent':'info'):''}</div>
      ${visualCharts({model:m,unitsOk,leadsOk,proposalsOk,proposalsComplete})}
      <div class="gt-columns"><section class="gt-block">${sectionTitle('Próximos passos','Contagens permanecem separadas por fonte')}${priorities.length?`<ul class="gt-priorities">${priorities.map(x=>`<li><a href="${esc(x.href)}"><b>${esc(x.title)}</b><span>${esc(x.detail)}</span><i>›</i></a></li>`).join('')}</ul>`:'<p class="gt-muted">Nenhuma pendência visível nas fontes consultadas.</p>'}</section>
      <section class="gt-block">${sectionTitle('Propostas recentes',`${propostas.length} ${proposalsOk?'consultadas':'no cache local'}`)}${newest.length?`<ul class="gt-recent">${newest.map(p=>`<li><a href="${esc(proposalLink(p,'resumo'))}"><b>${esc(p.cliente||'Cliente sem nome')}</b><span>Unidade ${esc(p.unidade||'—')} · ${esc(p.corretor||'Responsável não informado')}</span><small>${fmtDate(p.criadoEm)} · ${esc(p.formaLabel||p.forma||'Proposta')} · ${fmtMoney(p.neg)}</small></a></li>`).join('')}</ul>`:'<p class="gt-muted">Nenhuma proposta disponível nesta fonte.</p>'}${escLink('#/admin/historico','Abrir histórico de propostas')}</section></div>
      ${unitsOk?`<section class="gt-block">${sectionTitle('Compradores por unidade','Unidades vendidas; nome só com fonte identificada')}${buyers.length?`<ul class="gt-buyer-mini">${buyers.map(x=>{const b=buyer(x.unidade,leads,compradorVenda);return `<li><span><b>Apto ${esc(x.unidade.unidade)}</b><small>${esc(b.label)}</small></span>${escLink(unitLink(x.unidade,'compradores'),'Abrir propostas')}</li>`;}).join('')}</ul>`:'<p class="gt-muted">Nenhuma unidade vendida consultada.</p>'}${escLink(routeBack('compradores'),'Ver compradores')}</section>`:''}`;
  }
  function buyers({model:m,unitsOk,leads,compradorVenda}){
    if(!unitsOk)return '<p class="gt-warning">A consulta de estoque falhou. A lista de unidades vendidas não pode ser exibida.</p>';
    return `<section class="gt-block">${sectionTitle('Unidades vendidas',`${m.compradores.length} unidade(s) no estado atual do estoque`)}<p class="gt-muted">Comprador é exibido quando consta no cadastro da unidade ou é identificado pelo sistema. Sem vínculo exato, o painel não associa pessoas por nome.</p>${m.compradores.length?`<div class="gt-table-wrap"><table class="gt-table"><thead><tr><th>Unidade</th><th>Comprador</th><th>Origem</th><th>Acesso</th></tr></thead><tbody>${m.compradores.map(({unidade})=>{const b=buyer(unidade,leads,compradorVenda);return `<tr class="gt-buyer-row ${b.source==='pendente'?'needs-review':''}"><td><b>${esc(unidade.unidade)}</b></td><td>${esc(b.label)}</td><td>${b.source==='pendente'?'Vínculo pendente':b.source==='CRM'?'CRM fechado com vínculo':'Cadastro da unidade'}</td><td>${escLink(unitLink(unidade,'compradores'),'Ver propostas')}</td></tr>`;}).join('')}</tbody></table></div>`:'<p class="gt-muted">Nenhuma unidade vendida na consulta atual.</p>'}${escLink('#/admin/vendas?status=Vendido','Abrir gestão de vendas')}</section>`;
  }
  function returns({model:m,unitsOk,leadsOk,envOk}){
    const rowsCRM=leadsOk?m.retornosCRM:[],rowsEnv=envOk?m.retornosEnvios:[];
    return `<div class="gt-columns">${unitsOk?`<section class="gt-block">${sectionTitle('Reservas que precisam de atenção')}${m.pedidos.length?`<p class="gt-inline-alert">${m.pedidos.length} pedido(s) aguardam decisão.</p>${escLink(reservationLink('pedidos'),'Abrir pedidos')}`:''}${m.reservas.vencidas.length?`<p class="gt-inline-alert">${m.reservas.vencidas.length} reserva(s) vencida(s).</p>${escLink(reservationLink('vencidas'),'Abrir vencidas')}`:''}${m.reservas.semPrazo.length?`<p class="gt-inline-alert">${m.reservas.semPrazo.length} reserva(s) sem prazo registrado.</p>${escLink(reservationLink('incompletas'),'Completar prazos')}`:''}${!m.pedidos.length&&!m.reservas.vencidas.length&&!m.reservas.semPrazo.length?'<p class="gt-muted">Nenhuma pendência de reserva nesta consulta.</p>':''}</section>`:'<section class="gt-block"><p class="gt-warning">Reservas sem consulta.</p></section>'}
      <section class="gt-block">${sectionTitle('Retornos do CRM',leadsOk?`${rowsCRM.length} cliente(s) aberto(s), data hoje ou vencida`:'CRM não consultado')}${!leadsOk?'<p class="gt-warning">Falha na consulta do CRM; nenhum total foi presumido.</p>':rowsCRM.length?`<ul class="gt-priorities">${rowsCRM.map(l=>`<li><a href="${esc(customerLink(l.id,'retornos'))}"><b>${esc(l.cliente||'Cliente sem nome')}</b><span>${esc(l.corretorNome||'Responsável não informado')} · ${esc(l.unidade?`Apto ${l.unidade}`:'unidade não informada')}</span><small>${dueLabel(l.proximoContato,m.hoje)} · ${fmtDate(l.proximoContato)}</small><i>›</i></a></li>`).join('')}</ul>`:'<p class="gt-muted">Nenhum retorno vencido ou previsto para hoje na consulta.</p>'}</section>
      <section class="gt-block">${sectionTitle('Acompanhamento dos envios',envOk?`${rowsEnv.length} link(s) pendente(s)/em contato sem retorno futuro`:'Envios não consultados')}${!envOk?'<p class="gt-warning">Falha na consulta de Envios; nenhum total foi presumido.</p>':rowsEnv.length?`<ul class="gt-priorities">${rowsEnv.map(e=>`<li><a href="${esc(envioLink(e))}"><b>${esc(e.cliente||'Cliente a conferir')} · Apto ${esc(e.unidade||'—')}</b><span>${esc(e.corretor||'Responsável não informado')} · ${esc(e.acompanhamento.etapa==='contato'?'Em contato':'Retorno pendente')}</span><small>${dueLabel(e.acompanhamento.data,m.hoje)} · ${fmtDate(e.acompanhamento.data)}</small><i>›</i></a></li>`).join('')}</ul>`:'<p class="gt-muted">Nenhum acompanhamento pendente sem retorno futuro.</p>'}</section></div>`;
  }
  function report({model:m,unitsOk,leadsOk,envOk,proposalsOk,proposalsComplete,propostas,stamp,sources,compradorVenda,leads}){
    const src=`<ul class="gt-report-sources">${sources.map(([n,s,d])=>`<li><b>${esc(n)}:</b> ${esc(stateText(s))} · ${esc(d)}</li>`).join('')}</ul>`;
    const reservaRows=unitsOk?[
      ...m.pedidos.map(p=>({unit:p.unidade||p.unidadeId,client:p.cliente||'Cliente não informado',state:'Pedido aguardando decisão',owner:p.corretor||'Responsável não informado',date:p.em})),
      ...m.reservas.vencidas.map(u=>({unit:u.unidade,client:u.reserva?.cliente||'Cliente não informado',state:'Prazo vencido',owner:u.reserva?.corretor||'Responsável não informado',date:u.reserva?.prazo})),
      ...m.reservas.semPrazo.map(u=>({unit:u.unidade,client:u.reserva?.cliente||'Cliente não informado',state:'Prazo não informado',owner:u.reserva?.corretor||'Responsável não informado',date:''})),
    ]:[];
    const proposalRows=propostas.slice(0,8);
    return `<article class="gt-report"><div class="gt-report-title"><div><p class="gt-kicker">DIAMOND · RELATÓRIO GERENCIAL</p><h2>Posição comercial</h2></div><span>Emitido em ${esc(stamp)}</span></div><p class="gt-report-note">Retrato das fontes consultadas nesta abertura. Estoque atual, CRM, acompanhamentos e propostas são apresentados separadamente.</p>
      ${visualCharts({model:m,unitsOk,leadsOk,proposalsOk,proposalsComplete,report:true})}<div class="gt-report-grid"><section>${sectionTitle('Estoque atual')}${unitsOk?`<p>Disponíveis <b>${m.estoque.disponiveis}</b> · Reservadas <b>${m.estoque.reservadas}</b> · Vendidas <b>${m.estoque.vendidas}</b> · Total <b>${m.estoque.total}</b></p>`:'<p>Não consultado; totais indisponíveis.</p>'}</section>
      <section>${sectionTitle('Reservas')}${unitsOk?`<p>Pedidos aguardando <b>${m.pedidos.length}</b> · Reservas vencidas <b>${m.reservas.vencidas.length}</b> · Sem prazo <b>${m.reservas.semPrazo.length}</b> · Com prazo vigente <b>${m.reservas.ativas.length}</b></p>`:'<p>Não consultado.</p>'}</section>
      <section>${sectionTitle('CRM')}${leadsOk?`<p>Carteira consultada <b>${leads.length}</b> · Retornos hoje ou vencidos <b>${m.retornosCRM.length}</b> · Clientes fechados <b>${leads.filter(l=>l.estagio==='fechado').length}</b></p>`:'<p>Não consultado; totais indisponíveis.</p>'}<small>Clientes fechados não são somados às unidades vendidas.</small></section>
      <section>${sectionTitle('Envios')}${envOk?`<p>Links consultados <b>${m.totalEnvios}</b> · acompanhamentos pendentes/em contato vencidos ou sem data <b>${m.retornosEnvios.length}</b>.</p>`:'<p>Não consultado; totais indisponíveis.</p>'}<small>Acompanhamentos permanecem separados dos retornos do CRM.</small></section>
      <section>${sectionTitle('Propostas') }<p>Propostas ${proposalsOk?'consultadas no servidor':'disponíveis no cache local após falha da consulta'} <b>${propostas.length}</b>${proposalsOk?'':'. A contagem pode estar incompleta.'}</p></section></div>
      ${unitsOk?`<section class="gt-report-buyers">${sectionTitle('Unidades vendidas e compradores identificados')}${m.compradores.length?`<table class="gt-table"><thead><tr><th>Unidade</th><th>Comprador</th><th>Fonte</th></tr></thead><tbody>${m.compradores.map(({unidade})=>{const b=buyer(unidade,leads,compradorVenda);return `<tr><td>${esc(unidade.unidade)}</td><td>${esc(b.label)}</td><td>${b.source==='pendente'?'Não identificado':b.source==='CRM'?'Vínculo confirmado pelo sistema':'Cadastro da unidade'}</td></tr>`;}).join('')}</tbody></table>`:'<p>Nenhuma unidade vendida nesta consulta.</p>'}</section><section class="gt-report-buyers">${sectionTitle('Reservas que requerem ação',`${reservaRows.length} registro(s)`)}${reservaRows.length?`<table class="gt-table"><thead><tr><th>Unidade</th><th>Cliente</th><th>Situação</th><th>Responsável</th><th>Prazo / pedido</th></tr></thead><tbody>${reservaRows.map(x=>`<tr><td>${esc(x.unit)}</td><td>${esc(x.client)}</td><td>${esc(x.state)}</td><td>${esc(x.owner)}</td><td>${fmtDate(x.date)}</td></tr>`).join('')}</tbody></table>`:'<p>Nenhuma pendência de reserva na consulta.</p>'}</section>`:''}
      <section class="gt-report-buyers">${sectionTitle('Retornos do CRM',leadsOk?`${m.retornosCRM.length} registro(s)`: 'Consulta indisponível')}${leadsOk&&m.retornosCRM.length?`<table class="gt-table"><thead><tr><th>Cliente</th><th>Responsável</th><th>Unidade</th><th>Retornar em</th></tr></thead><tbody>${m.retornosCRM.map(l=>`<tr><td>${esc(l.cliente||'Cliente sem nome')}</td><td>${esc(l.corretorNome||'Responsável não informado')}</td><td>${esc(l.unidade||'—')}</td><td>${dueLabel(l.proximoContato,m.hoje)} · ${fmtDate(l.proximoContato)}</td></tr>`).join('')}</tbody></table>`:leadsOk?'<p>Nenhum retorno CRM vencido ou previsto para hoje.</p>':'<p>Dados indisponíveis; não foi presumido total.</p>'}</section>
      <section class="gt-report-buyers">${sectionTitle('Acompanhamentos de Envios',envOk?`${m.retornosEnvios.length} registro(s)`:'Consulta indisponível')}${envOk&&m.retornosEnvios.length?`<table class="gt-table"><thead><tr><th>Cliente</th><th>Unidade</th><th>Responsável</th><th>Etapa</th><th>Retorno</th></tr></thead><tbody>${m.retornosEnvios.map(e=>`<tr><td>${esc(e.cliente||'Cliente a conferir')}</td><td>${esc(e.unidade||'—')}</td><td>${esc(e.corretor||'Responsável não informado')}</td><td>${e.acompanhamento.etapa==='contato'?'Em contato':'Pendente'}</td><td>${dueLabel(e.acompanhamento.data,m.hoje)} · ${fmtDate(e.acompanhamento.data)}</td></tr>`).join('')}</tbody></table>`:envOk?'<p>Nenhum acompanhamento pendente vencido ou sem data.</p>':'<p>Dados indisponíveis; não foi presumido total.</p>'}</section>
      <section class="gt-report-buyers">${sectionTitle('Propostas recentes',`Exibindo ${proposalRows.length} de ${propostas.length}`)}${proposalRows.length?`<table class="gt-table"><thead><tr><th>Data</th><th>Cliente</th><th>Unidade</th><th>Corretor</th><th>Modalidade</th><th>Valor registrado</th></tr></thead><tbody>${proposalRows.map(p=>`<tr><td>${fmtDate(p.criadoEm)}</td><td>${esc(p.cliente||'Cliente sem nome')}</td><td>${esc(p.unidade||'—')}</td><td>${esc(p.corretor||'Responsável não informado')}</td><td>${esc(p.formaLabel||p.forma||'Proposta')}</td><td>${fmtMoney(p.neg)}</td></tr>`).join('')}</tbody></table>`:'<p>Nenhuma proposta disponível.</p>'}</section>${sectionTitle('Fontes e cobertura')}${src}</article>`;
  }
  window.DiamondGestao={render};
})();
