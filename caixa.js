/* Caixa por vencimento e recebimento. A confirmação só aparece após resposta do servidor. */
(function(root){
 'use strict';
 const D=root.DiamondCaixaDomain;
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money=v=>Number.isSafeInteger(v)?(v/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}):'A conferir';
 const date=v=>/^\d{4}-\d{2}-\d{2}$/.test(String(v||''))?v.split('-').reverse().join('/'):'Sem vencimento';
 const today=()=>D.hoje();
 const monthLabel=v=>v==='sem-data'?'Sem vencimento':/^\d{4}-\d{2}$/.test(v)?new Date(v+'-15T12:00:00').toLocaleDateString('pt-BR',{month:'long',year:'numeric'}):v;
 const allowed=()=>{const u=STORE.getUser();return u?.papel==='admin'||String(u?.usuario||'').toLowerCase()==='domo'&&u?.ehMaster===true;};
 let state=null,serial=0;
 function parseValue(value){
  const s=String(value||'').trim().replace(/^R\$\s*/, '').replace(/\s/g,'');
  if(!/^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/.test(s))return null;
  const [whole,fraction='']=s.replaceAll('.','').split(',');
  const result=Number(whole)*100+Number(fraction.padEnd(2,'0'));
  return Number.isSafeInteger(result)?result:null;
 }
 const inputMoney=v=>(v/100).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
 const opId=()=>root.crypto?.randomUUID?.()||'caixa-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
 function modelSource(s=state){return {unidades:s.x.unidades,condicoes:s.x.condicoes,leads:s.x.leads,recebimentos:s.ledgers,hoje:today(),mes:s.filters.mes,busca:s.filters.busca,status:s.filters.status};}
 function currentModel(s=state){return D.build(modelSource(s));}
 function dashboards(s,m){
  if(!root.DiamondCaixaDashboard||!root.DiamondCaixaDashboardDomain)return msg('Os gráficos não foram carregados. Atualize a página para consultar os dashboards.','error');
  return root.DiamondCaixaDashboard.render(m?root.DiamondCaixaDashboardDomain.build(modelSource(s),m):null);
 }
 function usable(s=state){return !!s&&s.ready&&s.x.unitsOk&&s.x.conditionsOk&&s.x.leadsOk&&allowed();}
 const msg=(message,kind='info')=>`<p class="cx-message ${kind}" role="${kind==='error'?'alert':'status'}">${esc(message)}</p>`;
 function render(x){
  serial++;
  const p=new URLSearchParams(location.hash.split('?')[1]||'');
  state={serial,x,ledgers:[],ready:false,loading:false,error:'',notice:'',financial:null,financialError:'',filters:{mes:p.get('mes')||today().slice(0,7),busca:p.get('caixaBusca')||'',status:p.get('caixaStatus')||''}};
  if(!allowed())return '<section class="cx-root"><p class="cx-message error" role="alert">O caixa está disponível somente para a administração e a conta principal da Domo.</p></section>';
  return '<section id="cx-root" class="cx-root" aria-label="Previsão de caixa">'+content(state)+'</section>';
 }
 function metric(key,label,value,caption,extra=''){
  return `<article class="cx-kpi ${extra}"><span>${label}</span><strong data-cx-value="${key}">${money(value)}</strong><small>${caption}</small></article>`;
 }
 function content(s){
  const available=s.ready&&s.x.unitsOk&&s.x.conditionsOk&&s.x.leadsOk,m=available?currentModel(s):null;
  const r=m?.resumo||{},month=s.filters.mes,months=[...new Set([today().slice(0,7),month,...(m?.meses||[])])].filter(v=>v!=='sem-data').sort();
  const warning=!s.x.unitsOk?'Estoque indisponível. Atualize os dados para conferir as unidades.':!s.x.conditionsOk?'Condições de venda indisponíveis. Atualize os dados para calcular a previsão.':!s.x.leadsOk?'Cadastro de clientes indisponível. Atualize os dados para conferir o caixa sem omitir vendas.':s.error||s.pdfError||'';
  return `<div id="cx-message" aria-live="polite">${warning?msg(warning,'error'):s.loading?msg('Consultando os recebimentos no servidor…'):s.notice?msg(s.notice,'success'):''}</div>
   <div class="cx-export"><span>PDF com todos os meses<small>Gráficos e tabela seguem a busca e a situação do painel.</small></span><button type="button" class="cx-button" data-cx-action="pdf" ${!usable(s)||s.loading||s.exporting||!s.financial||s.financialError?'disabled':''}>${s.exporting?'Preparando PDF…':'Salvar Caixa em PDF'}</button></div>
   ${financialSummary(s,m)}
   <form id="cx-filters" class="cx-toolbar"><label>Mês de vencimento<select name="mes">${months.map(v=>`<option value="${esc(v)}" ${v===month?'selected':''}>${esc(monthLabel(v))}</option>`).join('')}<option value="sem-data" ${month==='sem-data'?'selected':''}>Sem vencimento</option></select></label><label class="cx-search">Cliente ou unidade<input type="search" name="busca" value="${esc(s.filters.busca)}" placeholder="Buscar no caixa" autocomplete="off"></label><label>Parcelas<select name="status">${[['','Todas'],['pendentes','A receber'],['vencidas','Vencidas sem confirmação'],['recebido','Recebidas']].map(([v,t])=>`<option value="${v}" ${s.filters.status===v?'selected':''}>${t}</option>`).join('')}</select></label><button type="submit" class="cx-button">Filtrar</button><button type="button" class="cx-button" data-cx-action="refresh" ${s.loading?'disabled':''}>${s.loading?'Consultando…':'Atualizar caixa'}</button></form>
   <div class="cx-kpis">${metric('previsto',month==='sem-data'?'Sem vencimento definido':'Previsto para o mês',r.previsto,'Valores nominais das parcelas no recorte.')}${metric('recebido-parcelas','Recebido dessas parcelas',r.recebidoParcelas,'Confirmações vinculadas aos vencimentos do recorte.')}${metric('a-receber','A receber dessas parcelas',r.aReceber,'Vencido sem confirmação: '+money(r.vencido)+'.','pending')}${metric('recebido-mes',month==='sem-data'?'Recebimentos sem recorte mensal':r.recebidoSemDataExata>0?'Recebido com data no mês':'Entrou no caixa no mês',month==='sem-data'?null:r.recebidoNoMes,month==='sem-data'?'Selecione um mês para ver o dinheiro recebido.':r.recebidoSemDataExata>0?'Somente pagamentos com data exata; histórico não distribuído por mês.':'Data real e busca; independe do filtro de parcelas.','received')}</div>
   ${r.recebidoSemDataExata>0?'<p class="cx-criteria"><b>'+money(r.recebidoSemDataExata)+'</b> em parcelas com confirmação histórica, sem data exata de pagamento. Entram como recebidas por vencimento; não simulam uma entrada de caixa no mês.</p>':''}
   <p class="cx-criteria">${month==='sem-data'?'Entradas sem data contratual ficam aqui. A data da venda não foi usada como vencimento.':'Vencimentos de <b>'+esc(monthLabel(month))+'</b>. O indicador mensal por data considera apenas pagamentos com data exata.'} Valores sem projeção de reajuste ou INCC; permutas não entram como dinheiro.</p><p class="cx-criteria">Este caixa considera confirmações por parcela. Confira os recebimentos gerais já salvos na <a href="#/admin/painel?visao=previsao">Previsão de custo</a> antes de confirmar aqui, para evitar repetir um recebimento.</p>

   ${dashboards(s,m)}
   <section class="cx-card cx-parcels" data-cx-parcels tabindex="-1" aria-label="Parcelas e recebimentos"><header class="cx-section-heading"><div><h2>Parcelas e recebimentos</h2><p>${m?m.filtradas.length+' parcela(s) no recorte':'Aguardando consulta confirmada'}</p></div>${m?`<span class="cx-tag">${esc(monthLabel(month))}</span>`:''}</header><p class="cx-help">“Recebi” registra um novo pagamento hoje, ainda não incluído no consolidado. Para valores parciais ou datas anteriores, use “Parcial / outra data”.</p>${m?rows(m,s):'<p class="cx-empty">Os valores serão exibidos após consultar condições e recebimentos. Uma falha de consulta não será apresentada como saldo zero.</p>'}</section>
   ${m?coverage(m)+history(m,s):''}
   <details class="cx-card cx-notes"><summary>Critérios e origem das informações</summary><p>Previsão calculada pelas condições das unidades vendidas. Confirmar um recebimento não altera o valor da venda, o comprador, a tabela ou a permuta. Pagamentos parciais mantêm o saldo a receber.</p><p>Recebimentos confirmados no servidor permanecem no histórico. Se o cronograma mudar, os registros anteriores continuam preservados e exigem conferência antes de novas baixas.</p><p>A <a href="#/admin/painel?visao=previsao">Previsão de custo</a> já sincroniza os recebimentos gerais do empreendimento entre computador e celular. Esses registros identificam a unidade e a natureza comum ou final, mas não a parcela específica. Por isso, não são importados nem somados automaticamente neste caixa. A conciliação exige conferir o vínculo de cada recebimento com sua parcela, evitando duplicidade.</p>${s.ready?'<p>Recebimentos consultados: '+esc(s.loadedAt)+'.</p>':''}</details>`;
 }
 function financialSummary(s,m){
  if(!m)return '';
  if(s.financialError)return msg(s.financialError,'error');
  const api=root.DiamondCaixaMoneyDomain;
  if(!s.financial||!api)return '';
  const r=api.build({units:s.x.unidades,conditions:s.x.condicoes,record:s.financial,model:m});
  return `<section class="cx-card cx-money" aria-label="Posição geral em dinheiro"><header class="cx-section-heading"><div><h2>Dinheiro recebido e a receber</h2><p>Carteira completa · todos os meses · permutas e aportes separados</p></div></header><div class="cx-kpis">${metric('dinheiro-total','Total em dinheiro',r.total,'Entrada, parcelas e finais; exclui bens em permuta.')}${metric('dinheiro-recebido','Recebido informado',r.received,'Consolidado da SCP e baixas conhecidas, sem repetir valores.','received')}${metric('dinheiro-saldo','A receber em dinheiro',r.outstanding,'Total em dinheiro menos recebimentos informados.','pending')}</div>${r.issues.map(t=>msg(t)).join('')}<details><summary>Ver posição por origem e critérios</summary><p class="cx-help">${esc(r.caption)}</p><ul class="cx-event-list">${r.groups.map(g=>`<li><div><b>${esc(g.label)}</b><span>Total: ${money(g.total)} · Recebido: ${money(g.received)} · Saldo: ${money(g.outstanding)}</span><small>${esc(g.note)}</small></div></li>`).join('')}</ul></details></section>`;
 }
 function rows(m,s){
  if(!m.filtradas.length)return '<p class="cx-empty">Nenhuma parcela neste recorte. Escolha outro mês ou confira as vendas sem cronograma abaixo.</p>';
  return `<div class="cx-table-wrap"><table class="cx-table"><thead><tr><th>Cliente · unidade / parcela</th><th>Vencimento</th><th>Previsto</th><th>Recebido</th><th>A receber</th><th>Confirmação</th></tr></thead><tbody>${m.filtradas.map(l=>`<tr class="${l.vencida?'is-overdue':''}"><td data-label="Cliente / parcela"><b>${esc(l.cliente||'Cliente não informado')}</b><span>Unidade ${esc(l.unidade)} · ${esc(l.descricao)}</span>${l.conferir?'<small class="cx-warning-text">Cronograma alterado: confira os recebimentos anteriores.</small>':''}</td><td data-label="Vencimento">${date(l.vencimento)}${l.vencida?'<small class="cx-warning-text">Vencida sem confirmação</small>':''}</td><td data-label="Previsto">${money(l.valor)}</td><td data-label="Recebido">${money(l.recebido)}</td><td data-label="A receber"><strong>${money(l.saldo)}</strong><small class="cx-status ${l.status}">${({aberto:'Em aberto',parcial:'Parcial',recebido:'Recebida'})[l.status]||'Conferir'}</small></td><td data-label="Confirmação">${l.conferir?'<span class="cx-warning-text">Conferir histórico</span>':l.saldo>0?`<button type="button" class="cx-button primary" title="Registrar novo pagamento hoje, ainda não incluído no recebido consolidado" data-cx-confirm="${esc(l.id||l.parcelaId)}" ${!usable(s)||l.conferir?'disabled':''}>Recebi</button><button type="button" class="cx-link" data-cx-partial="${esc(l.id||l.parcelaId)}">Parcial / outra data</button>`:'<span class="cx-checked">✓ Recebido</span>'+((l.eventos||[]).some(e=>D.confirmacaoHistorica(e))?'<small>Confirmação histórica</small>':'')}${l.eventos?.length?`<button type="button" class="cx-link" data-cx-history="${esc(l.id||l.parcelaId)}">Ver ${l.eventos.length} confirmação(ões)</button>`:''}</td></tr>`).join('')}</tbody></table></div>`;
 }
 function coverage(m){
  const issues=m.pendencias||[];
  return `<details class="cx-card cx-coverage" ${issues.length?'open':''}><summary>Cobertura da previsão <span class="cx-tag">${issues.length?issues.length+' pendência(s)':'Condições conferidas'}</span></summary>${issues.length?`<p>Valores ou datas ausentes não foram distribuídos por mês. Complete as condições para enxergar toda a previsão.</p><ul>${issues.map(p=>`<li><div><b>Unidade ${esc(p.unidade||p.unidadeId)} · ${esc(p.cliente||'Cliente não informado')}</b><span>${esc(p.motivo)}${Number.isSafeInteger(p.valor)?' · '+money(p.valor):''}</span></div>${p.unidadeId?`<button type="button" class="cx-button" data-cx-conditions="${esc(p.unidadeId)}">Conferir venda</button>`:''}</li>`).join('')}</ul>`:'<p>As condições consultadas não apontaram pendências no cronograma.</p>'}</details>`;
 }
 function eventId(ev){return ev.id||ev.eventoId||'';}
 function eventActive(ev){return ev.tipo!=='estornar'&&!ev.estornado&&!ev.estornadoEm&&ev.ativo!==false;}
 function receiptDate(ev){const h=D.confirmacaoHistorica(ev);return h?'Recebido até '+date(h.ate)+' · data exata não informada':date(ev.data);}
 function eventLine(ev,s){
  const active=eventActive(ev),reversal=ev.tipo==='estornar';
  return `<li><div><b>${esc(ev.cliente||'Cliente não informado')} · unidade ${esc(ev.unidade||ev.unidadeId)}</b><span>${esc(ev.descricao||ev.parcelaDescricao||ev.parcelaId||'Recebimento')} · ${receiptDate(ev)} · <strong>${money(ev.valor)}</strong></span><small>${reversal?'Estorno registrado':active?'Recebimento confirmado':'Recebimento estornado'}${ev.conferir?' · Cronograma a conferir':''}${ev.observacao?' · '+esc(ev.observacao):''}${ev.motivo?' · '+esc(ev.motivo):''}</small></div>${active&&eventId(ev)?`<button type="button" class="cx-button" data-cx-reverse="${esc(eventId(ev))}" data-cx-unit="${esc(ev.unidadeId)}" ${!usable(s)?'disabled':''}>Estornar</button>`:''}</li>`;
 }
 function history(m,s){
  const norm=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const events=(m.historico||[]).filter(ev=>(s.filters.mes==='sem-data'||String(D.confirmacaoHistorica(ev)?ev.fonte.vencimento:ev.data||'').slice(0,7)===s.filters.mes)&&(!s.filters.busca||norm([ev.cliente,ev.unidade,ev.descricao].join(' ')).includes(norm(s.filters.busca))));
  return `<details class="cx-card cx-history"><summary>Histórico de confirmações <span class="cx-tag">${events.length} registro(s)</span></summary><p>Recebimentos com data conhecida aparecem no mês de pagamento. Confirmações históricas aparecem pelo vencimento e informam até quando foram recebidas, sem inventar a data de entrada. Estornos preservam a confirmação original.</p>${events.length?'<ul>'+events.map(ev=>eventLine(ev,s)).join('')+'</ul>':'<p class="cx-empty">Nenhuma confirmação neste recorte.</p>'}</details>`;
 }
 function repaint(s=state){if(!s||s!==state||!s.root?.isConnected)return;const details=[...s.root.querySelectorAll('details')].map(el=>({className:el.className,open:el.open}));s.root.innerHTML=content(s);for(const el of s.root.querySelectorAll('details')){const previous=details.find(d=>d.className===el.className);if(previous)el.open=previous.open;}}
 async function load(s=state){
  if(!s||s.loading||!allowed())return;
  s.loading=true;s.error='';s.pdfError='';s.financial=null;s.financialError='';repaint(s);
  try{const res=await STORE.api('caixaRecebimentos',{operacao:'listar'});if(s!==state)return;if(res?.ok===false||!Array.isArray(res?.recebimentos))throw Error(res?.erro||'Resposta de recebimentos inválida.');s.ledgers=res.recebimentos;s.ready=true;s.loadedAt=new Date().toLocaleString('pt-BR');
   try{const p=await STORE.api('previsaoCusto',{operacao:'carregar'});if(s!==state)return;if(!p?.ok||!p.registro?.data)throw Error('Resposta inválida.');s.financial=root.DiamondPrevisaoSchema?root.DiamondPrevisaoSchema.decode(JSON.stringify(p.registro)):p.registro;}catch(e){if(s!==state)return;s.financialError='A posição geral em dinheiro não pôde ser consultada. As parcelas abaixo continuam disponíveis.';}
  }
  catch(error){if(s!==state)return;s.ready=false;s.error='Não foi possível consultar o caixa. '+error.message;}
  finally{if(s===state){s.loading=false;repaint(s);}}
 }
 function wire(host,reload){
  const s=state;if(!s||!allowed())return;
  s.host=host;s.root=host.querySelector('#cx-root');s.reload=reload;if(!s.root)return;
  s.root.addEventListener('click',ev=>onClick(ev,s));
  s.root.addEventListener('submit',ev=>{if(ev.target.id!=='cx-filters')return;ev.preventDefault();const f=new FormData(ev.target);s.filters={mes:String(f.get('mes')||today().slice(0,7)),busca:String(f.get('busca')||''),status:String(f.get('status')||'')};s.notice='';updateFilterRoute(s);repaint(s);});
  s.root.addEventListener('change',ev=>{if(ev.target.closest('#cx-filters')&&ev.target.matches('select'))ev.target.form.requestSubmit();});
  load(s);
 }
 function updateFilterRoute(s){
  const p=new URLSearchParams({visao:'caixa',mes:s.filters.mes});
  if(s.filters.busca)p.set('caixaBusca',s.filters.busca);
  if(s.filters.status)p.set('caixaStatus',s.filters.status);
  const href='#/admin/painel?'+p;
  root.history?.replaceState(null,'',href);
  for(const link of s.host?.querySelectorAll?.('a[href]')||[]){
   const old=link.getAttribute('href')||'';
   if(old.startsWith('#/admin/painel?')&&new URLSearchParams(old.split('?')[1]).get('visao')==='caixa')link.setAttribute('href',href);
  }
 }
 function findLine(id,s=state){return currentModel(s).linhas.find(l=>String(l.id||l.parcelaId)===id);}
 function openDashboardClient(id,s){
  if(!usable(s))return;
  const m=currentModel(s),lines=m.filtradas.filter(l=>l.clienteId===id&&l.saldo>0);
  if(!lines.length)return;
  const total=lines.reduce((sum,l)=>sum+l.saldo,0);
  const el=dialog('Parcelas do cliente',`<p class="cx-dialog-context"><b>${esc(lines[0].cliente)}</b><br>${esc(monthLabel(s.filters.mes))} · ${lines.length} parcela(s) · A receber: <b>${money(total)}</b></p><p class="cx-help">Mesmos filtros do Caixa. Esta lista reúne somente as parcelas com saldo do cadastro selecionado.</p>${rows({...m,filtradas:lines},s)}`);
  el.classList.add('cx-client-dialog');
  el.addEventListener('click',event=>{const b=event.target.closest('[data-cx-confirm],[data-cx-partial],[data-cx-history]');if(b&&!b.disabled){el.close();onClick(event,s);}});
 }
 function dialog(title,html){
  const el=document.createElement('dialog');el.className='cx-dialog';el.setAttribute('aria-label',title);el.innerHTML=`<header><h2>${esc(title)}</h2><button type="button" class="cx-button cx-close" aria-label="Fechar">×</button></header>${html}`;
  document.body.appendChild(el);el.querySelector('.cx-close').onclick=()=>el.close();el.addEventListener('close',()=>el.remove());el.showModal();return el;
 }
 function openReceipt(l,s,quick=false){
  if(!usable(s)||!l||l.conferir||!(l.saldo>0))return;
  const el=dialog('Confirmar recebido',`<p class="cx-dialog-context"><b>${esc(l.cliente)}</b><br>Unidade ${esc(l.unidade)} · ${esc(l.descricao)}<br>Vencimento: ${date(l.vencimento)} · A receber: <b>${money(l.saldo)}</b></p><form id="cx-confirm-form"><div class="cx-form-grid"><label>Valor recebido (R$)<input name="valor" inputmode="decimal" value="${inputMoney(l.saldo)}" required autocomplete="off"></label><label>Data do recebimento<input name="data" type="date" value="${today()}" max="${today()}" required></label></div><label>Observação (opcional)<textarea name="observacao" rows="2" maxlength="600" placeholder="Ex.: transferência ou referência do comprovante"></textarea></label><p class="cx-help">Se entrou apenas uma parte, ajuste o valor. O restante continua a receber.</p><div class="cx-form-error" role="alert" aria-live="assertive"></div><footer><button type="button" class="cx-button" data-cancel>Cancelar</button><button type="submit" class="cx-button primary">Confirmar recebido</button></footer></form>`);
  const form=el.querySelector('form');el.querySelector('[data-cancel]').onclick=()=>el.close();
  submitWire(form,el,s,()=>{const fields=new FormData(form),value=parseValue(fields.get('valor')),paid=String(fields.get('data')||'');if(!Number.isSafeInteger(value)||value<=0||value>l.saldo)throw Error('Informe um valor maior que zero e até '+money(l.saldo)+'.');if(!D.dia(paid)||paid>today())throw Error('Informe uma data válida, até hoje.');return {operacao:'confirmar',unidadeId:l.unidadeId,parcelaId:l.parcelaId,cronogramaChave:l.cronogramaChave,revisao:l.revisaoLedger,operacaoId:opId(),data:paid,valor:value,observacao:[quick?root.DiamondCaixaMoneyDomain?.newReceiptNote(s.financial,l.unidadeId):'',String(fields.get('observacao')||'').trim()].filter(Boolean).join(' ')};},'Recebimento confirmado no servidor. O saldo foi atualizado.');
  if(quick)form.requestSubmit();
 }
 function openReverse(ev,s){
  if(!usable(s)||!eventActive(ev))return;
  const ledger=s.ledgers.find(l=>l.unidadeId===ev.unidadeId);
  const el=dialog('Estornar recebimento',`<p>${esc(ev.cliente)} · unidade ${esc(ev.unidade||ev.unidadeId)}<br><b>${money(ev.valor)}</b> · ${receiptDate(ev)}</p>${D.confirmacaoHistorica(ev)?.consolidacao?'<p>Esta confirmação já está incluída no consolidado. Estorná-la exigirá conciliar essa posição; não haverá uma dedução automática do consolidado.</p>':''}<p>O valor volta a ficar a receber quando vinculado ao cronograma atual. A confirmação original será preservada no histórico.</p><form id="cx-reverse-form"><label>Motivo do estorno<textarea name="motivo" rows="2" required minlength="3" maxlength="600"></textarea></label><div class="cx-form-error" role="alert"></div><footer><button type="button" class="cx-button" data-cancel>Cancelar</button><button type="submit" class="cx-button primary">Confirmar estorno</button></footer></form>`);
  el.querySelector('[data-cancel]').onclick=()=>el.close();
  submitWire(el.querySelector('form'),el,s,()=>{const motivo=String(new FormData(el.querySelector('form')).get('motivo')||'').trim();if(motivo.length<3)throw Error('Informe o motivo do estorno.');return {operacao:'estornar',unidadeId:ev.unidadeId,eventoId:eventId(ev),revisao:ledger?.revisao??0,operacaoId:opId(),motivo};},'Estorno confirmado no servidor. O histórico foi preservado.');
 }
 function submitWire(form,el,s,payloadBuilder,success){
  let saving=false,retryPayload=null;
  form.addEventListener('submit',async ev=>{
   ev.preventDefault();if(saving||s!==state||!usable(s))return;
   const error=el.querySelector('.cx-form-error'),submit=form.querySelector('[type=submit]'),original=submit.textContent;error.textContent='';
   let payload;
   try{payload=retryPayload||payloadBuilder();}catch(e){error.textContent=e.message;return;}
   saving=true;submit.disabled=true;submit.textContent='Salvando…';
   for(const b of el.querySelectorAll('button'))b.disabled=true;
   const preventClose=e=>e.preventDefault();el.addEventListener('cancel',preventClose);
   try{
    const response=await STORE.api('caixaRecebimentos',payload);
    if(response?.ok===false||!response?.registro||response.registro.unidadeId!==payload.unidadeId||!D.validarLedger(response.registro)||!response.registro.eventos.some(event=>event.operacaoId===payload.operacaoId))throw Error(response?.erro||'O servidor não confirmou esta operação no histórico. Atualize o caixa antes de tentar novamente.');
    if(s!==state){el.close();return;}
    s.ledgers=s.ledgers.filter(l=>l.unidadeId!==payload.unidadeId).concat(response.registro);s.notice=response.repetida?'Operação já registrada no servidor. A situação atual foi atualizada; confira o histórico.':success;s.loadedAt=new Date().toLocaleString('pt-BR');el.close();repaint(s);
   }catch(e){
    const ambiguous=!e.status||e.status===408||e.status>=500;
    retryPayload=ambiguous?payload:null;
    for(const field of form.querySelectorAll('input,textarea'))field.readOnly=ambiguous;
    error.textContent=e.message+(ambiguous?' A confirmação pode ter chegado ao servidor. Use “Tentar novamente” para repetir a mesma operação sem duplicar.':e.status===409?' Feche esta janela e toque em Atualizar caixa antes de confirmar novamente.':'');
    submit.textContent=ambiguous?'Tentar novamente':original;
    if(e.status===409){submit.dataset.blocked='true';submit.textContent='Atualize os dados';}
   }finally{saving=false;el.removeEventListener('cancel',preventClose);for(const b of el.querySelectorAll('button'))b.disabled=b.dataset.blocked==='true';if(submit.textContent==='Salvando…')submit.textContent=original;}
  });
 }
 async function exportPdf(s){
  if(!usable(s)||s.loading||s.exporting||!s.financial||s.financialError)return;
  s.exporting=true;s.notice='';s.pdfError='';repaint(s);
  try{
   if(!root.DiamondCaixaPdf)throw Error('Gerador de PDF indisponível. Recarregue a página.');
   const report=root.DiamondCaixaPdf.model(modelSource(s),s.financial),doc=root.DiamondCaixaPdf.build(report),period=report.charts.periodo;
   await doc.save('Caixa-Diamond-'+(period?period.inicio+'-a-'+period.fim:'sem-vencimentos')+'.pdf',{returnPromise:true});
   s.notice='PDF preparado com todos os meses. Confira o download no navegador.';
  }catch(error){s.pdfError='Não foi possível gerar o PDF: '+error.message;}
  finally{s.exporting=false;repaint(s);s.root?.querySelector?.('[data-cx-action="pdf"]')?.focus?.({preventScroll:true});}
 }
 function onClick(ev,s){
  const button=ev.target.closest('button');if(!button||button.disabled||s!==state)return;
  if(button.dataset.cxdMonth){
   if(!usable(s)||!D.dia(button.dataset.cxdMonth+'-01'))return;
   s.filters.mes=button.dataset.cxdMonth;s.notice='';updateFilterRoute(s);repaint(s);
   const list=s.root?.querySelector('[data-cx-parcels]');list?.focus?.({preventScroll:true});list?.scrollIntoView?.({block:'start'});return;
  }
  if(button.dataset.cxdClient)return openDashboardClient(button.dataset.cxdClient,s);
  if(button.dataset.cxAction==='pdf')return exportPdf(s);
  if(button.dataset.cxAction==='refresh'){s.notice='';return s.reload?s.reload():load(s);}
  if(button.dataset.cxConditions)return root.DiamondVendaEditor.abrir(button.dataset.cxConditions,{onSaved:s.reload});
  if(button.dataset.cxConfirm)return openReceipt(findLine(button.dataset.cxConfirm,s),s,true);
  if(button.dataset.cxPartial)return openReceipt(findLine(button.dataset.cxPartial,s),s);
  if(button.dataset.cxHistory){const l=findLine(button.dataset.cxHistory,s);if(!l)return;const el=dialog('Histórico da parcela',`<p>${esc(l.cliente)} · unidade ${esc(l.unidade)}<br>${esc(l.descricao)} · ${date(l.vencimento)}</p><ul class="cx-event-list">${currentModel(s).historico.filter(e=>e.unidadeId===l.unidadeId&&e.parcelaId===l.parcelaId).map(e=>eventLine(e,s)).join('')}</ul>`);el.addEventListener('click',event=>{const b=event.target.closest('[data-cx-reverse]');if(!b)return;const item=currentModel(s).historico.find(e=>eventId(e)===b.dataset.cxReverse&&e.unidadeId===b.dataset.cxUnit);if(item){el.close();openReverse(item,s);}});return;}
  if(button.dataset.cxReverse){const event=currentModel(s).historico.find(e=>eventId(e)===button.dataset.cxReverse&&e.unidadeId===button.dataset.cxUnit);if(event)openReverse(event,s);}
 }
 root.DiamondCaixa={render,wire};
})(typeof window!=='undefined'?window:globalThis);
