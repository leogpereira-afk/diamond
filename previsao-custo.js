/* Planejamento compartilhado da obra. Contratos e preços vêm do painel; baixas nunca são inferidas. */
(function(){
 'use strict';
 const D=window.DiamondPrevisaoDomain,S=window.DiamondPrevisaoStore;
 const e=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money=v=>v==null?'A conferir':(v/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
 const decimal=v=>v==null?'':(v/100).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
 const percentValue=v=>v==null?'':Number((v*100).toFixed(2));
 const pct=v=>v==null?'—':(100*v).toLocaleString('pt-BR',{maximumFractionDigits:2})+'%';
 const day=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
 const date=v=>/^\d{4}-\d{2}-\d{2}$/.test(v||'')?v.split('-').reverse().join('/'):'—';
 const sum=xs=>{if(xs.some(x=>!Number.isSafeInteger(x)))return null;const n=xs.reduce((a,b)=>a+BigInt(b),0n);return n>BigInt(Number.MAX_SAFE_INTEGER)?null:Number(n);};
 const uid=()=>crypto.randomUUID();
 function cents(value){
  const s=String(value||'').trim().replace(/^R\$\s*/, '');
  if(!/^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/.test(s))return null;
  const [a,b='']=s.replaceAll('.','').split(','),n=BigInt(a)*100n+BigInt((b+'00').slice(0,2));
  return n>BigInt(Number.MAX_SAFE_INTEGER)?null:Number(n);
 }
 function fraction(value){const s=String(value).trim().replace(',','.');return /^\d+(?:\.\d{1,2})?$/.test(s)?Number(s)/100:null;}
 const table=(headers,rows)=>`<div class="pc-table-wrap" tabindex="0" role="region" aria-label="Tabela com rolagem horizontal"><table class="di-table"><thead><tr>${headers.map(h=>`<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows.length?rows.map(r=>`<tr>${r.map(c=>`<td>${c}</td>`).join('')}</tr>`).join(''):`<tr><td colspan="${headers.length}">Nenhum registro.</td></tr>`}</tbody></table></div>`;
 const field=(label,name,value='',extra='')=>`<label>${label}<input name="${name}" value="${e(value)}" ${extra}></label>`;
 const amountField=(label,name,value)=>field(label,name,decimal(value),'inputmode="decimal" placeholder="0,00" autocomplete="off"');
 const note=s=>`<p class="pc-note">${s}</p>`;
 let state,refreshTimer;
 const sessionKey=()=>{const u=STORE.getUser?.();return JSON.stringify([u?.usuario,u?.senhaHash,u?.papel]);};
 const active=current=>!!current&&state===current&&current.root?.isConnected&&current.route===location.hash&&current.session===sessionKey()&&STORE.podeVerPainel();
 function assertActive(current){if(!active(current))throw Error('Esta edição pertence a uma tela ou sessão anterior. Abra a previsão novamente para continuar.');}
 function finance(data){
  const contracts={};
  for(const [id,c] of Object.entries(data.contracts)){
   const receipts=data.receipts.filter(r=>r.unitId===id&&r.contractKey===c.contractKey);
   contracts[id]={...c,receivedCommonCents:c.receiptsReviewed?sum(receipts.filter(r=>r.natureza==='comum').map(r=>r.valorCents)):null,receivedFinalCents:c.receiptsReviewed?sum(receipts.filter(r=>r.natureza==='final').map(r=>r.valorCents)):null};
  }
  return {contributionsCents:data.contributionsReviewed?sum(data.contributions.map(c=>c.valorCents)):null,contracts};
 }
 function model(settings=state.record.data.settings,data=state.record.data){
  // A failed conditions query cannot be interpreted as an empty sales portfolio.
  return D.build({rows:state.x.unitsOk&&state.x.conditionsOk&&!state.x.insights.duplicadas?.length?state.x.insights.rows:null,settings:{...settings,selectedInventoryIds:[...state.selected]},finance:finance(data)});
 }
 function metric(label,value,sub,style='',id=''){return `<article class="pc-metric ${style}"><span>${label}</span><strong ${id?`data-pc-value="${id}"`:''}>${value}</strong><small>${sub}</small></article>`;}
 function summary(m){
  const t=m.totals,target=m.settings.targetCents,ratio=target>0&&t.coverageCents!==null?t.coverageCents/target:null;
  const excess=t.coverageCents!==null&&target!==null?Math.max(0,t.coverageCents-target):null;
  const soldNet=t.grossCents!==null&&t.commissionCents!==null?t.grossCents-t.commissionCents:null;
  const outstanding=t.receivedComplete?sum(m.contracts.map(c=>c.outstandingCommonCents)):null;
  const finalOutstanding=t.receivedComplete?sum(m.contracts.map(c=>c.outstandingFinalCents)):null;
  const issues=m.issues.filter(i=>i.scope==='coverage'||i.scope==='target');
  return `<div class="pc-kpis">${metric('Custo previsto da obra',money(target),'Meta configurável','', 'target')}${metric('Cobertura contratada',money(t.coverageCents),'Aportes + vendas − comissões − finais','pc-accent','coverage')}${metric('Falta cobrir',money(t.shortfallCents),ratio===null?'Conclua as conferências abaixo':`${pct(Math.max(0,1-ratio))} do custo previsto`,'','shortfall')}${metric('Meta de novas vendas',money(m.future.requiredGrossCents),`${pct(m.future.P)} durante a obra · ${pct(m.future.C)} comissão`,'pc-dark','sales-goal')}</div>
  <div class="pc-progress"><div><b>${ratio===null?'Cobertura a conferir':pct(ratio)+' do custo coberto'}</b><span>${excess>0?'Excedente previsto: '+money(excess):'Parcelas finais fora da cobertura'}</span></div><progress max="100" value="${ratio===null?0:Math.max(0,Math.min(100,ratio*100))}" aria-label="Percentual de cobertura da obra"></progress>${note('Cobertura inclui permutas e recebimentos futuros contratados. Não representa saldo bancário nem disponibilidade imediata de dinheiro.')}</div>
  ${issues.length?`<div class="pc-warning" role="status"><b>Existem dados a conferir antes de fechar a meta.</b> Subtotal identificado: ${money(t.coverageKnownCents)}. Não é a cobertura total.<ul>${[...new Set(issues.map(i=>i.message))].map(s=>`<li>${e(s)}</li>`).join('')}</ul></div>`:''}
  ${!m.future.valid?'<p class="pc-warning" role="status">Informe a comissão futura (inclusive 0%) e um percentual durante a obra maior que a comissão. A soma durante a obra + final deve ser 100%.</p>':''}
  <div class="pc-breakdown">${metric('Vendas brutas',money(t.grossCents),'Valores dos contratos atuais')}${metric('Comissões das vendas',money(t.commissionCents),'Descontadas uma única vez')}${metric('Vendas líquidas',money(soldNet),'Bruto menos comissão; inclui finais')}${metric('Aportes realizados',money(m.contributionsCents),'Conferidos nos lançamentos do sistema')}${metric('Permutas',money(t.permutaCents),'Já incluídas nas vendas e na cobertura','pc-barter')}${metric('Parcelas finais contratadas',money(t.finalCents),'Excluídas da cobertura da obra','pc-final')}</div>
  <details class="pc-details" data-section="cash"><summary>Recebido e a receber <span>Baixas separadas das condições de venda</span></summary><div class="pc-breakdown">${metric('Aportes + recebido comum',money(m.contributionsCents!==null&&t.receivedCommonCents!==null?sum([m.contributionsCents,t.receivedCommonCents]):null),'Entradas realizadas; antes de comissões e gastos')}${metric('Recebido durante a obra',money(t.receivedCommonCents),'Entradas e parcelas comuns; bruto das baixas')}${metric('A receber durante a obra',money(outstanding),'Saldo de entradas e parcelas comuns')}${metric('Parcelas comuns contratadas',money(t.installmentsCents!==null&&t.finalCents!==null?t.installmentsCents-t.finalCents:null),'Total antes das baixas; não inclui entrada')}${metric('Final já recebida',money(t.receivedFinalCents),'Permanece fora da cobertura','pc-final')}${metric('Final ainda a receber',money(finalOutstanding),'Permanece fora da cobertura','pc-final')}</div>${note(t.receivedComplete?'Recebimentos conferidos para todos os contratos. Entradas e parcelas não são somadas novamente à cobertura.':'Conclua a conferência de recebimentos de cada contrato. Ausência de baixas não confirma que nada foi recebido.')}</details>`;
 }
 function inventory(m){const i=m.inventory;return `<div class="pc-section-title"><div><h2>Quanto o estoque pode cobrir</h2><p>Somente unidades disponíveis, pelo preço vigente. Reservadas ficam de fora.</p></div><span class="pc-tag">${i.units.length} disponíveis</span></div><div class="pc-breakdown">${metric('Estoque em tabela',money(i.availableGrossCents),'Preço vigente na última atualização')}${metric('Cobertura potencial',money(i.availableContributionCents),'Estoque × (durante a obra − comissão)')}${metric('Selecionado para vender',money(i.selectedGrossCents),'Seleção para simulação; não reserva unidades')}${metric('Falta após a seleção',money(i.remainingShortfallCents),i.coversShortfall===true?'Seleção suficiente para cobrir a meta':'Cobertura selecionada: '+money(i.selectedContributionCents))}</div>
  ${m.totals.shortfallCents!==null&&i.availableContributionCents!==null&&i.availableContributionCents<m.totals.shortfallCents?'<p class="pc-warning">O estoque disponível não cobre a falta com esses percentuais. Revise custo, aportes ou condição comercial.</p>':''}
  <details class="pc-details" data-section="inventory"><summary>Selecionar unidades para simular a meta</summary>${table(['Simular','Unidade','Preço de tabela','Cobertura prevista'],i.units.map(u=>[`<input type="checkbox" data-pc-stock="${e(u.id)}" aria-label="Selecionar unidade ${e(u.row.u.unidade)}" ${u.selected?'checked':''}>`,e(u.row.u.unidade),money(u.priceCents),money(u.contributionCents)]))}</details>`;}
 function contracts(m){
  return `<details class="pc-details" data-section="contracts" open><summary>Conferir contratos <span>${m.contracts.filter(c=>c.coverageComplete).length}/${m.contracts.length+m.unconfirmedContracts.length} completos para cobertura</span></summary>${table(['Unidade','Venda bruta','Comissão','Final excluída','Cobertura da venda','Conferência'],[...m.contracts.map(c=>[e(c.row.u.unidade),money(c.grossCents),money(c.commissionCents),money(c.finalCents),money(c.contributionCents),`<button type="button" class="di-btn" data-pc-contract="${e(c.id)}">${c.coverageComplete?'Revisar':'Conferir'}</button><small>${c.receiptsComplete?'Recebimentos conferidos':'Recebimentos a conferir'}</small>`]),...m.unconfirmedContracts.map(c=>[e(c.row.u.unidade),'A conferir','—','—','—',`<button type="button" class="di-btn" data-pc-source="${e(c.id)}">Revisar condições</button><small>Contrato pendente ou revisão desatualizada</small>`])])}${note('Cada venda usa seu valor original e sua comissão total. Identifique explicitamente as séries finais. Alterações do contrato exigem nova conferência. Os percentuais da simulação valem apenas para novas vendas.')}</details>`;
 }
 function ledgers(m){const data=state.record.data;
  const orphan=data.receipts.filter(r=>!m.contracts.some(c=>c.id===r.unitId&&c.contractKey===r.contractKey));
  return `<details class="pc-details" data-section="contributions"><summary>Aportes dos sócios <span>${data.contributions.length} lançamentos · ${data.contributionsReviewed?'conferidos':'a conferir'}</span></summary><form id="pc-aporte" class="pc-form">${field('Sócio','socio','','required maxlength="200"')}${field('Data do aporte realizado','data',day(),'type="date" required max="'+day()+'"')}${amountField('Valor aportado (R$)','valor',null)}${field('Observação','observacao','','maxlength="2000"')}<input type="hidden" name="id"><button class="di-btn primary">Salvar aporte</button></form><label class="pc-check"><input type="checkbox" id="pc-aportes-reviewed" ${data.contributionsReviewed?'checked':''}> Conferi todos os aportes realizados até hoje (inclusive se nenhum).</label>${table(['Sócio','Data','Valor realizado','Observação','Ações'],data.contributions.map(a=>[e(a.socio),date(a.data),money(a.valorCents),e(a.observacao),`<button class="di-btn" data-pc-edit-aporte="${e(a.id)}" type="button">Editar</button> <button class="di-btn" data-pc-delete-aporte="${e(a.id)}" type="button">Excluir</button>`]))}</details>
  <details class="pc-details" data-section="receipts"><summary>Recebimentos das vendas <span>${data.receipts.length} baixas registradas</span></summary>${note('Registre somente valores efetivamente recebidos. Escolha “final” para manter a separação. A conferência no contrato confirma se o histórico de baixas está completo.')}
  ${orphan.length?'<p class="pc-warning">'+orphan.length+' baixas pertencem a contratos alterados ou inativos. Estão preservadas, mas fora dos totais. Revise cada vínculo antes de reaplicar.</p>':''}
  <form id="pc-receipt" class="pc-form"><label>Unidade<select name="unitId" required><option value="">Selecione</option>${m.contracts.filter(c=>c.coverageComplete).map(c=>`<option value="${e(c.id)}">${e(c.row.u.unidade)}</option>`).join('')}</select></label>${field('Data do recebimento','data',day(),'type="date" required max="'+day()+'"')}${amountField('Valor recebido (R$)','valor',null)}<label>Natureza<select name="natureza"><option value="comum">Durante a obra</option><option value="final">Parcela final (excluída)</option></select></label>${field('Observação','observacao','','maxlength="2000"')}<input type="hidden" name="id"><button class="di-btn primary">Salvar recebimento</button></form>
  ${table(['Unidade','Data','Natureza','Recebido','Observação','Ações'],data.receipts.map(r=>{const c=m.contracts.find(c=>c.id===r.unitId),current=c?.contractKey===r.contractKey;return [e(c?.row.u.unidade||r.unitId),date(r.data),r.natureza==='final'?'Final · excluída':'Durante a obra',money(r.valorCents),e(r.observacao)+(current?'':'<small>Vínculo a revisar; fora dos totais</small>'),`<button type="button" class="di-btn" data-pc-edit-receipt="${e(r.id)}">${current?'Editar':'Revisar vínculo'}</button> <button type="button" class="di-btn" data-pc-delete-receipt="${e(r.id)}">Excluir</button>`];}))}</details>`;
 }
 function legacyNotice(){const info=S.legacyStatus();return info.pending||info.error||info.localError?`<div class="pc-warning"><b>Cópia anterior deste navegador preservada.</b><p>${e(info.error||info.localError||'Há lançamentos locais que ainda não foram transferidos para o sistema. A transferência adiciona registros compatíveis e bloqueia conflitos.')}</p>${info.pending?'<button type="button" class="di-btn" data-pc-migrate>Transferir lançamentos locais</button> <button type="button" class="di-btn" data-pc-export-legacy>Exportar cópia anterior</button>':''}</div>`:info.migrated?'<p class="pc-note">Os lançamentos anteriores deste navegador já foram transferidos para o sistema. A cópia original foi preservada.</p>':'';}
 function contents(){const r=state.record,s=r.data.settings,m=model();return `
  <div class="pc-local"><div><b>${r.revision>0?'Salvo no sistema · revisão '+r.revision:'Previsão inicial · nenhum lançamento salvo'}</b><span>Aportes, comissões, baixas e configurações são compartilhados entre computador e celular, para os perfis autorizados da gestão.${r.updatedAt?' Atualizado em '+e(new Date(r.updatedAt).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}))+'.':''}</span></div><div class="pc-actions"><button type="button" class="di-btn" data-pc-export>Exportar backup</button><button type="button" class="di-btn" data-pc-import>Importar backup</button><input type="file" id="pc-import-file" accept="application/json,.json" hidden></div></div>${legacyNotice()}
  <p class="pc-scope">Todo o empreendimento · inclui a loja · filtros das outras abas não se aplicam. <span id="pc-refresh-status">Atualização automática a cada 30 s enquanto esta aba estiver aberta.</span></p>
  <div id="pc-message" role="status" aria-live="polite"></div>
  <form id="pc-settings" class="pc-settings"><div class="pc-section-title"><div><h2>Planejar custo e vendas</h2><p>Os indicadores recalculam ao editar. Salve para manter esta configuração.</p></div><span class="pc-tag" id="pc-draft">Configuração ${r.revision?'salva':'inicial'}</span></div><div class="pc-form">${amountField('Custo previsto (R$)','target',s.targetCents)}${field('Durante a obra (%)','payment',percentValue(s.futurePaymentShare),'type="number" min="0" max="100" step="0.01" required')}${field('Parcela final (%)','final',Number((100-s.futurePaymentShare*100).toFixed(2)),'type="number" min="0" max="100" step="0.01" required')}${field('Comissão futura (%)','commission',percentValue(s.futureCommissionRate),'type="number" min="0" max="100" step="0.01" placeholder="Informe, inclusive 0"')}<button class="di-btn primary">Salvar configuração</button></div>${note('A comissão é calculada sobre a venda inteira e descontada da parte durante a obra. Meta bruta = falta cobrir ÷ (percentual durante a obra − comissão). A parcela final não cobre a meta.')}</form>
  <div id="pc-summary">${summary(m)}</div><section id="pc-inventory" class="pc-inventory">${inventory(m)}</section>${contracts(m)}${ledgers(m)}
  <details class="pc-details" data-section="criteria"><summary>Critérios desta previsão</summary><p>Base: vendas confirmadas na revisão atual, valores contratuais em centavos e preço vigente das unidades disponíveis. Aportes são apenas os realizados e conferidos. Permutas já fazem parte da venda e não são somadas duas vezes. A comissão total sai uma única vez. Todas as séries marcadas como finais são excluídas, mesmo se já recebidas.</p><p>Não é fluxo de caixa por data nem apuração de saldo bancário: não desconta gastos de obra realizados. O custo informado representa a necessidade total de recursos. Percentuais futuros não modificam contratos existentes. Recebimentos são decomposição do contratado, nunca receita adicional.</p><p>O registro fica no sistema e é compartilhado entre dispositivos da gestão. Uma gravação só é concluída quando o servidor confirma. Edições simultâneas exigem atualização e conferência; a digitação é preservada. Um contrato alterado exige revisão dos valores; baixas antigas ficam preservadas até serem reavaliadas.</p></details>`;}
 function render(x){
  state=null;
  try{state={x,record:null,selected:new Set(),drafts:{},dirty:false,session:sessionKey(),route:location.hash};return '<div id="pc-root" class="pc-root"><p role="status">Carregando a previsão salva no sistema…</p><div id="pc-message"></div></div>';}
  catch(err){return `<div id="pc-root" class="pc-root"><p role="alert" class="pc-warning">${e(err.message)}</p></div>`;}
 }
 function wire(host,reload){
  const root=host.querySelector('#pc-root');if(!root||!state)return;
  state.root=root;state.reload=reload;
  root.addEventListener('submit',onSubmit);root.addEventListener('input',onInput);root.addEventListener('change',onChange);root.addEventListener('click',onClick);
  if(!refreshTimer)refreshTimer=setInterval(refreshSources,30000);
  const current=state;loadCentral().catch(err=>{if(state===current&&current.root.isConnected)reportError(err);});
 }
 function message(text,error=false){const n=state.root.querySelector('#pc-message');if(n){n.className=error?'pc-warning':'pc-success';n.setAttribute('role',error?'alert':'status');n.textContent=text;}}
 function repaint(text){
  const open=new Set([...state.root.querySelectorAll('details[open]')].map(n=>n.dataset.section));state.root.innerHTML=contents();state.root.querySelectorAll('details[data-section]').forEach(n=>n.open=open.has(n.dataset.section));
  for(const [id,values] of Object.entries(state.drafts)){const form=state.root.querySelector('#'+id);if(form)for(const [name,value]of Object.entries(values))if(form.elements.namedItem(name))form.elements.namedItem(name).value=value;}
  if(state.drafts['pc-settings']){state.root.querySelector('#pc-draft').textContent='Simulação não salva';calculations();}
  if(state.dirty)state.root.querySelector('#pc-refresh-status').textContent='Atualização automática pausada durante a edição. Salve para retomar.';
  if(text)message(text);
 }
 function reportError(err,current=state){if(!active(current))return;message(err.message,true);if(err.status===409||!current.record){const n=current.root.querySelector('#pc-message'),b=document.createElement('button');b.type='button';b.className='di-btn';b.dataset.pcReload='';b.textContent=current.record?'Atualizar sem perder a edição':'Tentar carregar novamente';n?.append(document.createElement('br'),b);}}
 async function loadCentral(){const current=state;assertActive(current);if(current.saving||current.loading)return;current.loading=true;try{const record=await S.load();if(!active(current)||record.revision<(current.record?.revision||0))return;const initial=!current.record;current.record=record;if(initial){current.root.innerHTML=contents();message(record.revision>0?'Previsão carregada do sistema.':'Conexão confirmada. Salve as premissas e os lançamentos para registrar sua previsão.');}else repaint('Previsão carregada do sistema.');}finally{current.loading=false;}}
 async function persist(action,text,clearForm){
  const current=state;assertActive(current);if(current.loading)throw Error('Aguarde o carregamento dos dados do sistema antes de salvar.');if(current.saving)throw Error('Aguarde a confirmação da gravação atual.');current.saving=true;
  const controls=[...current.root.querySelectorAll('input,select,button'),...document.querySelectorAll('.pc-dialog input,.pc-dialog select,.pc-dialog button')].filter(n=>!n.disabled);controls.forEach(n=>n.disabled=true);
  message('Salvando no sistema… Aguarde a confirmação.');
  try{const record=await action();if(!active(current))return false;current.record=record;if(clearForm)delete current.drafts[clearForm];current.dirty=Object.keys(current.drafts).length>0;repaint(text||'Salvo no sistema. Os outros dispositivos receberão a atualização.');return true;}
  finally{current.saving=false;controls.forEach(n=>{if(n.isConnected)n.disabled=false;});}
 }
 async function save(data,text,clearForm){const current=state,revision=current.record.revision;return persist(()=>S.save(data,revision),text,clearForm);}
 const copy=()=>structuredClone(state.record.data);
 function draft(){const f=state.root.querySelector('#pc-settings');return {targetCents:cents(f.elements.target.value),futurePaymentShare:fraction(f.elements.payment.value),futureCommissionRate:fraction(f.elements.commission.value)};}
 function calculations(){const m=model(draft()),cash=state.root.querySelector('[data-section="cash"]')?.open,stock=state.root.querySelector('[data-section="inventory"]')?.open;state.root.querySelector('#pc-summary').innerHTML=summary(m);state.root.querySelector('#pc-inventory').innerHTML=inventory(m);state.root.querySelector('[data-section="cash"]').open=!!cash;state.root.querySelector('[data-section="inventory"]').open=!!stock;}
 function markDirty(form){if(form)state.drafts[form.getAttribute('id')]=Object.fromEntries(new FormData(form));state.dirty=true;const status=state.root.querySelector('#pc-refresh-status');if(status)status.textContent='Atualização automática pausada durante a edição. Salve para retomar.';}
 function onInput(ev){if(!ev.target.closest('#pc-settings')){if(ev.target.form)markDirty(ev.target.form);return;}const f=ev.target.form;
  if(ev.target.name==='payment'||ev.target.name==='final'){const v=fraction(ev.target.value),other=ev.target.name==='payment'?'final':'payment';f.elements[other].value=v===null?'':Number((100-v*100).toFixed(2));}
  markDirty(f);state.root.querySelector('#pc-draft').textContent='Simulação não salva';calculations();
 }
 function positive(value){const n=cents(value);if(n===null||n<=0)throw Error('Informe um valor positivo no formato 1.234,56.');return n;}
 function actualDate(value){if(!value||value>day())throw Error('Informe uma data de recebimento já realizado, até hoje.');return value;}
 async function onSubmit(ev){
  const f=ev.target,formId=f.getAttribute('id'),owner=state;if(!['pc-settings','pc-aporte','pc-receipt'].includes(formId))return;ev.preventDefault();
  try{
   const data=copy();
   if(formId==='pc-settings'){
    const d=draft();if(d.targetCents===null||d.targetCents<=0)throw Error('Informe um custo previsto maior que zero.');
    if(d.futurePaymentShare===null||d.futurePaymentShare<=0||d.futurePaymentShare>1)throw Error('O percentual durante a obra deve ser maior que 0% e no máximo 100%.');
    if(d.futureCommissionRate!==null&&(d.futureCommissionRate<0||d.futureCommissionRate>=d.futurePaymentShare))throw Error('A comissão deve ser menor que o percentual durante a obra.');
    data.settings=d;await save(data,'Configuração salva no sistema. A meta acompanha as vendas e os aportes conferidos.',formId);
   }else if(formId==='pc-aporte'){
    f.elements.id.value||=uid();markDirty(f);
    const a={id:f.elements.id.value,socio:f.elements.socio.value.trim(),data:actualDate(f.elements.data.value),valorCents:positive(f.elements.valor.value),observacao:f.elements.observacao.value.trim()};
    if(!a.socio)throw Error('Informe o sócio responsável pelo aporte.');
    data.contributions=data.contributions.filter(c=>c.id!==a.id).concat(a);await save(data,'Aporte salvo no sistema. Confirme abaixo se todos os aportes realizados estão registrados.',formId);
   }else{
    const m=model(),c=m.contracts.find(c=>c.id===f.elements.unitId.value&&c.coverageComplete);
    if(!c)throw Error('Conclua a conferência do contrato antes de registrar recebimentos.');
    f.elements.id.value||=uid();markDirty(f);
    const r={id:f.elements.id.value,unitId:c.id,contractKey:c.contractKey,data:actualDate(f.elements.data.value),valorCents:positive(f.elements.valor.value),natureza:f.elements.natureza.value,observacao:f.elements.observacao.value.trim()};
    data.receipts=data.receipts.filter(v=>v.id!==r.id).concat(r);
    const amount=sum(data.receipts.filter(v=>v.unitId===c.id&&v.contractKey===c.contractKey&&v.natureza===r.natureza).map(v=>v.valorCents)),limit=r.natureza==='final'?c.finalCents:c.commonReceivableCents;
    if(amount===null||amount>limit)throw Error('As baixas superam o valor contratado desta natureza. Confira o contrato e os lançamentos.');
    await save(data,'Recebimento salvo no sistema. A conferência do contrato define se o histórico está completo.',formId);
   }
  }catch(err){reportError(err,owner);}
 }
 async function onChange(ev){const owner=state;try{
  if(ev.target.matches('[data-pc-stock]')){ev.target.checked?state.selected.add(ev.target.dataset.pcStock):state.selected.delete(ev.target.dataset.pcStock);calculations();}
  else if(ev.target.id==='pc-aportes-reviewed'){const checked=ev.target.checked,data=copy();data.contributionsReviewed=checked;try{await save(data);}catch(err){ev.target.checked=!checked;throw err;}}
  else if(ev.target.id==='pc-import-file'){const file=ev.target.files[0];if(file)importFile(file);}
 }catch(err){reportError(err,owner);}}
 function download(json,name){const blob=new Blob([json],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 async function onClick(ev){const b=ev.target.closest('button'),owner=state;if(!b)return;try{
  if(b.hasAttribute('data-pc-reload')){await loadCentral();return;}
  if(b.hasAttribute('data-pc-migrate')){const revision=state.record.revision;await persist(()=>S.migrateLegacy(revision),'Lançamentos anteriores transferidos e salvos no sistema. A cópia local foi preservada.');return;}
  if(b.hasAttribute('data-pc-export-legacy')){const legacy=S.inspectLegacy();if(!legacy.record)throw Error(legacy.error||'Cópia anterior indisponível.');download(S.exportData(legacy.record),'diamond-previsao-copia-anterior-'+day()+'.json');return;}
  if(b.hasAttribute('data-pc-contract'))contractDialog(b.dataset.pcContract);
  if(b.hasAttribute('data-pc-source'))window.DiamondVendaEditor.abrir(b.dataset.pcSource,{onSaved:state.reload});
  if(b.hasAttribute('data-pc-export'))download(S.exportData(state.record),'diamond-previsao-'+day()+'.json');
  if(b.hasAttribute('data-pc-import'))state.root.querySelector('#pc-import-file').click();
  for(const [kind,list,form] of [['aporte','contributions','pc-aporte'],['receipt','receipts','pc-receipt']]){
   const edit=b.getAttribute('data-pc-edit-'+kind),del=b.getAttribute('data-pc-delete-'+kind);
   if(edit){const a=state.record.data[list].find(v=>v.id===edit),f=state.root.querySelector('#'+form);if(!a)return;for(const [k,v]of Object.entries(a))if(f.elements[k])f.elements[k].value=v;f.elements.valor.value=decimal(a.valorCents);markDirty(f);f.scrollIntoView({block:'center'});f.querySelector('input,select').focus();message('Editando lançamento. Salve para confirmar; atualizar a página descarta a edição.');}
   if(del){const data=copy();data[list]=data[list].filter(v=>v.id!==del);await save(data,'Lançamento excluído do registro compartilhado no sistema.');}
  }
 }catch(err){reportError(err,owner);}}
 function dialog(title,body){const el=document.createElement('dialog');el.className='pc-dialog';el.dataset.pcRoute=location.hash;el.innerHTML=`<header><h2>${e(title)}</h2><button class="di-btn" type="button" data-close aria-label="Fechar">Fechar</button></header>${body}`;document.body.append(el);el.querySelector('[data-close]').onclick=()=>el.close();el.addEventListener('close',()=>el.remove());el.showModal();return el;}
 function contractDialog(id){const owner=state,expectedRevision=owner.record.revision;assertActive(owner);const m=model(),c=m.contracts.find(c=>c.id===id);if(!c)return;const stored=state.record.data.contracts[id],current=c.manualCurrent;
  const receipts=state.record.data.receipts.filter(r=>r.unitId===id&&r.contractKey===c.contractKey);
  const el=dialog('Conferir unidade '+c.row.u.unidade,`<form id="pc-contract-form"><p>Venda bruta: <b>${money(c.grossCents)}</b> · Entrada: ${money(c.entryCents)} · Permuta: ${money(c.permutaCents)}</p>${!c.compositionComplete?'<p class="pc-warning">A composição não fecha o valor vendido. Revise as condições originais da venda.</p>':''}${stored&&!current?'<p class="pc-warning">O contrato mudou. Confirme novamente a comissão e as séries finais. Baixas da revisão anterior continuam preservadas, fora dos totais.</p>':''}
  ${amountField('Comissão total desta venda (R$)','commission',current?stored.commissionCents:null)}
  <fieldset><legend>Quais séries são parcelas finais?</legend>${c.series.length?c.series.map(p=>`<label class="pc-check"><input type="checkbox" name="finalSeries" value="${p.index}" ${current&&stored.finalSeriesIndices.includes(p.index)?'checked':''}><span>${e(p.description)} · ${p.count} × ${money(p.valueCents)} = ${money(p.totalCents)}</span></label>`).join(''):'<p>Este contrato não tem séries parceladas.</p>'}<label class="pc-check"><input type="checkbox" name="finalReviewed" ${current?'checked':''} required> Conferi as séries finais; nenhuma marcada significa que não há parcela final.</label></fieldset>
  <fieldset><legend>Recebimentos efetivamente realizados</legend><p>Baixas vinculadas a esta revisão: durante a obra <b>${money(sum(receipts.filter(r=>r.natureza==='comum').map(r=>r.valorCents)))}</b> · final <b>${money(sum(receipts.filter(r=>r.natureza==='final').map(r=>r.valorCents)))}</b>.</p><label class="pc-check"><input type="checkbox" name="receiptsReviewed" ${current&&stored.receiptsReviewed?'checked':''}> Todas as baixas recebidas estão registradas, inclusive se nenhum valor foi recebido.</label></fieldset>
  <p role="alert" id="pc-dialog-error"></p><footer><button type="button" class="di-btn" id="pc-original">Condições originais</button><button class="di-btn primary">Salvar conferência</button></footer></form>`);
  el.querySelector('#pc-original').onclick=()=>{if(!active(owner)){el.close();return;}el.close();window.DiamondVendaEditor.abrir(id,{onSaved:owner.reload});};
  el.querySelectorAll('[name="finalSeries"]').forEach(input=>input.addEventListener('change',()=>{
   el.querySelector('[name="receiptsReviewed"]').checked=false;
   el.querySelector('#pc-dialog-error').textContent='A classificação das finais mudou. Revise a natureza das baixas antes de confirmar novamente os recebimentos.';
  }));
  el.querySelector('form').onsubmit=async ev=>{ev.preventDefault();try{assertActive(owner);if(owner.record.revision!==expectedRevision)throw Object.assign(Error('A previsão mudou desde a abertura desta conferência.'),{status:409});const f=ev.target,commission=cents(f.elements.commission.value);if(commission===null||commission>c.grossCents)throw Error('Informe a comissão entre zero e o valor bruto da venda.');
   const data=copy();data.contracts[id]={contractKey:c.contractKey,commissionCents:commission,finalSeriesIndices:[...f.querySelectorAll('[name="finalSeries"]:checked')].map(n=>Number(n.value)),receiptsReviewed:f.elements.receiptsReviewed.checked};
   const trial=model(data.settings,data).contracts.find(v=>v.id===id);
   if(data.contracts[id].receiptsReviewed&&!trial.receiptsComplete)throw Error('As baixas excedem a nova classificação. Revise os recebimentos antes de confirmar o histórico.');
   if(await persist(()=>S.save(data,expectedRevision),'Conferência salva no sistema. Os percentuais futuros não alteram esta venda.'))el.close();
  }catch(err){el.querySelector('#pc-dialog-error').textContent=err.message+(err.status===409?' Feche esta janela e atualize os dados antes de conferir novamente.':'');reportError(err,owner);}};
 }
 async function importFile(file){const owner=state,expectedRevision=owner.record.revision;try{
  assertActive(owner);if(file.size>1024*1024)throw Error('O backup excede 1 MB.');const json=await file.text();assertActive(owner);const value=JSON.parse(json);
  const el=dialog('Importar backup no sistema',`<p>Este arquivo substituirá os lançamentos e configurações compartilhados da Previsão de custo, em todos os dispositivos. Exporte o backup atual antes de continuar.</p><p>Arquivo: <b>${e(file.name)}</b> · ${Array.isArray(value.data?.contributions)?value.data.contributions.length:'—'} aportes · ${Array.isArray(value.data?.receipts)?value.data.receipts.length:'—'} baixas.</p><p id="pc-import-error" role="alert"></p><footer><button type="button" class="di-btn primary" id="pc-confirm-import">Substituir pelo backup</button></footer>`);
  el.querySelector('#pc-confirm-import').onclick=async()=>{try{assertActive(owner);if(await persist(()=>S.importData(json,expectedRevision),'Backup importado e salvo no sistema. Confira os vínculos dos contratos atuais.')){owner.drafts={};owner.dirty=false;repaint('Backup importado e salvo no sistema. Confira os vínculos dos contratos atuais.');el.close();}}catch(err){el.querySelector('#pc-import-error').textContent=err.message;reportError(err,owner);}};
 }catch(err){reportError(Error('Não foi possível importar: '+err.message),owner);}finally{if(active(owner)){const input=owner.root.querySelector('#pc-import-file');if(input)input.value='';}}}
 window.addEventListener('storage',ev=>{if(ev.key?.startsWith('dv_previsao_custo_')&&state?.root?.isConnected){if(state.dirty)message('Há dados de outra aba para conferir. Sua digitação foi preservada; salve ou atualize antes de continuar.');else refreshSources();}});
 window.addEventListener('focus',()=>refreshSources());
 window.addEventListener('online',()=>refreshSources());
 window.addEventListener('hashchange',()=>{document.querySelectorAll('.pc-dialog').forEach(el=>{if(el.dataset.pcRoute!==location.hash)el.close();});});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshSources();});
 async function refreshSources(){
  const current=state;
  if(!current?.record||!active(current)||document.hidden||current.refreshing||current.loading||current.saving||current.dirty||document.querySelector('dialog[open]'))return;
  const user=STORE.getUser()?.usuario;current.refreshing=true;
  try{
   const [units,conditions,forecast]=await Promise.allSettled([STORE.api('reservasPainel',{operacao:'listar'}),STORE.api('vendasCondicoes',{operacao:'listar'}),S.load()]);
   if(!active(current)||current.loading||current.saving||current.dirty||document.querySelector('dialog[open]')||STORE.getUser()?.usuario!==user)return;
   const unitsOk=units.status==='fulfilled'&&units.value?.ok!==false&&Array.isArray(units.value?.unidades),conditionsOk=conditions.status==='fulfilled'&&conditions.value?.ok!==false&&Array.isArray(conditions.value?.condicoes);
   const forecastOk=forecast.status==='fulfilled';
   if(forecastOk&&forecast.value.revision>=current.record.revision)current.record=forecast.value;
   const signature=JSON.stringify([unitsOk,conditionsOk,unitsOk?units.value.unidades:null,conditionsOk?conditions.value.condicoes:null,STORE.getCfg(),current.record.revision,forecastOk]);
   if(signature!==current.sourceSignature){
    current.sourceSignature=signature;current.x={...current.x,unitsOk,conditionsOk,unidades:unitsOk?units.value.unidades:[],condicoes:conditionsOk?conditions.value.condicoes:[]};
    current.x.insights=window.DiamondInsights.build({unidades:current.x.unidades,condicoes:current.x.condicoes,leads:current.x.leads,usuarios:STORE.getUsuarios(),cfg:STORE.getCfg()||{},filtros:{}});
    repaint(unitsOk&&conditionsOk&&forecastOk?'Lançamentos, vendas e preços sincronizados com o sistema.':'Não foi possível atualizar todas as fontes. A previsão mostra somente o último registro confirmado; confira a conexão antes de salvar.');
   }
   const status=current.root.querySelector('#pc-refresh-status');if(status)status.textContent=forecastOk?'Última sincronização: '+new Date().toLocaleTimeString('pt-BR')+'.':'Sem sincronização: exibindo a última revisão confirmada.';
  }catch(err){if(state===current&&current.root.isConnected)message('Falha ao atualizar a previsão: '+err.message,true);}
  finally{current.refreshing=false;}
 }
 window.DiamondPrevisao={render,wire,refresh:refreshSources};
})();
