/* Reserva de apartamento: a confirmação é transacional no servidor. */
(()=>{
 const S=window.STORE,esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),fmt=s=>Number.isFinite(Date.parse(s))?new Date(s).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'}):s?'Prazo inválido':'Prazo não informado';
 let filtro='ativas',busca='',historico=[],unidadesPainel=null,pedidosPainel=null,consulta=0,rotaVista='',unidadeFiltro='';
 const filtrosValidos=new Set(['todas','pedidos','ativas','vencidas','incompletas','historico']);
 function lerRota(hash){const [path,query='']=String(hash||'#/admin/reservas').split('?'),params={};query.split('&').filter(Boolean).forEach(pair=>{const [k,v='']=pair.split('=');try{params[decodeURIComponent(k.replaceAll('+',' '))]=decodeURIComponent(v.replaceAll('+',' '));}catch{}});return{path,filtro:filtrosValidos.has(params.filtro)?params.filtro:'ativas',unidade:params.unidade||''};}
 function montarRota({filtro:status,unidade=''}={}){return '#/admin/reservas?filtro='+encodeURIComponent(status||'ativas')+(unidade?'&unidade='+encodeURIComponent(unidade):'');}
 const classeReserva=u=>{const t=u.reserva?.prazo?Date.parse(u.reserva.prazo):NaN;if(!Number.isFinite(t))return'incompletas';return t<=Date.now()?'vencidas':'ativas';};
 const vencida=u=>classeReserva(u)==='vencidas';
 const api=b=>S.api('reservasPainel',b);
 const erro=(el,e)=>{el.textContent=e.message||'Não foi possível concluir.';el.setAttribute('role','alert');};
 async function render(){
  const root=document.querySelector('#aba-corpo');if(!root)return;
  const rota=lerRota(location.hash);if(rota.path!=='#/admin/reservas')return;
  if(location.hash!==rotaVista){filtro=rota.filtro;unidadeFiltro=rota.unidade;rotaVista=location.hash;}
  root.innerHTML='<div class="rs-shell"><p role="status">Atualizando reservas…</p></div>';
  const atual=++consulta;
  try{const r=await api({operacao:'listar'});if(atual!==consulta||!root.isConnected||lerRota(location.hash).path!=='#/admin/reservas')return;historico=r.historico||[];unidadesPainel=r.unidades;pedidosPainel=r.pedidos;pintar(root);}catch(e){if(atual!==consulta||!root.isConnected||lerRota(location.hash).path!=='#/admin/reservas')return;root.innerHTML='<p class="rs-error" role="alert"></p><button id="rs-retry">Tentar novamente</button>';erro(root.querySelector('p'),e);root.querySelector('button').onclick=render;}

 }
 function pintar(root){
 const units=unidadesPainel||S.getUnidades(),pedidos=pedidosPainel||S.getReservas(),res=units.filter(u=>u.status==='Reservado');
 const totais={todas:res.length,pedidos:pedidos.length,ativas:res.filter(u=>classeReserva(u)==='ativas').length,vencidas:res.filter(u=>classeReserva(u)==='vencidas').length,incompletas:res.filter(u=>classeReserva(u)==='incompletas').length,historico:historico.length};
 const unidadeAlvo=unidadeFiltro?units.find(u=>u.id===unidadeFiltro):null;
 root.innerHTML=`<section class="rs-shell"><header class="rs-header"><div><h2>Reservas de apartamentos</h2><p>Cliente, responsável e prazo em um só lugar.</p></div><button class="btn" id="rs-new">+ Reservar apartamento</button></header><nav class="rs-tabs" aria-label="Situação das reservas">${Object.entries({todas:'Todas as reservas',pedidos:'Pedidos',ativas:'Ativas',vencidas:'Vencidas',incompletas:'Incompletas',historico:'Histórico'}).map(([k,v])=>`<button data-rs-filter="${k}" aria-pressed="${k===filtro}">${v} <b>${totais[k]}</b></button>`).join('')}</nav>${unidadeFiltro?`<p class="rs-route-note" role="status">${unidadeAlvo?`Filtro por apartamento ${esc(unidadeAlvo.unidade)} · `:'Apartamento não encontrado · '}<button type="button" id="rs-clear-unit">Remover filtro do apartamento</button></p>`:''}<div class="rs-tools"><input id="rs-search" aria-label="Buscar reservas" placeholder="Apartamento, cliente ou corretor" value="${esc(busca)}"><button id="rs-refresh">Atualizar</button></div><div id="rs-list"></div><p class="rs-note">Reservas vencidas continuam bloqueadas até você prorrogar ou cancelar. Escolher uma vaga é opcional.</p></section>`;
 root.querySelector('#rs-new').onclick=()=>abrir();root.querySelector('#rs-refresh').onclick=render;
 root.querySelectorAll('[data-rs-filter]').forEach(b=>b.onclick=()=>{filtro=b.dataset.rsFilter;location.hash=montarRota({filtro,unidade:unidadeFiltro});});
 const clearUnit=root.querySelector('#rs-clear-unit');if(clearUnit)clearUnit.onclick=()=>{unidadeFiltro='';location.hash=montarRota({filtro});};
 root.querySelector('#rs-search').oninput=e=>{busca=e.target.value;lista(root,units,pedidos,res);};lista(root,units,pedidos,res);
 }
 function lista(root,units,pedidos,res){
 const q=busca.toLocaleLowerCase('pt-BR'),box=root.querySelector('#rs-list'),unidadeAlvo=unidadeFiltro?units.find(u=>u.id===unidadeFiltro):null;
 let rows=filtro==='pedidos'?pedidos.map(p=>({u:units.find(u=>u.id===p.unidadeId),p,r:p})):filtro==='historico'?historico.map(h=>({h,r:h.depois?.reserva||h.antes?.reserva||h.antes?.pedido||{cliente:h.antes?.compradorNome||h.antes?.clienteVinculadoNome||h.antes?.comprador||h.antes?.clienteNome||h.antes?.cliente,corretor:h.antes?.vendedorNome,empresa:h.antes?.vendedorEmpresa},u:{id:h.unidadeId,unidade:h.unidade}})):res.filter(u=>filtro==='todas'||filtro==='incompletas'&&classeReserva(u)==='incompletas'||filtro==='vencidas'&&classeReserva(u)==='vencidas'||filtro==='ativas'&&classeReserva(u)==='ativas').map(u=>({u,r:u.reserva||{cliente:u.compradorNome,corretor:u.vendedorNome}}));
 if(unidadeFiltro)rows=rows.filter(x=>(x.u?.id||x.p?.unidadeId||x.h?.unidadeId)===unidadeFiltro);
 rows=rows.filter(x=>x.u&&[x.u.unidade,x.r.cliente,x.r.corretor,x.h?.motivo].join(' ').toLocaleLowerCase('pt-BR').includes(q));
 rows.sort((a,b)=>filtro==='historico'?b.h.em.localeCompare(a.h.em):filtro==='pedidos'?a.p.em.localeCompare(b.p.em):(a.r.prazo||'9999').localeCompare(b.r.prazo||'9999'));
 box.innerHTML=rows.length?rows.map((x,i)=>`<article class="rs-row" data-state="${x.h?({reservar:'reservado',prorrogar:'reservado',cancelar:'cancelada',vender:'vendido',recusar:'recusado',reabrir:'cancelada'})[x.h.acao]||'historico':x.p?'pedido':classeReserva(x.u)=='vencidas'?'vencida':classeReserva(x.u)=='incompletas'?'incompleta':'reservado'}"><div class="rs-unit">Apto <strong>${esc(x.u.unidade)}</strong>${x.r.vaga?`<small>${esc(x.r.vaga)}</small>`:''}</div><div class="rs-person"><strong>${esc(x.r.cliente||'Cliente não informado')}</strong><span>${esc(x.r.corretor||'Corretor não informado')}</span>${x.r.telefone?`<span>${esc(x.r.telefone)}</span>`:''}</div><div class="rs-deadline"><strong>${x.h?esc(({reservar:'Reserva confirmada',prorrogar:'Prazo prorrogado',cancelar:'Reserva cancelada',vender:'Convertida em venda',recusar:'Pedido recusado',reabrir:'Unidade voltou a disponível'})[x.h.acao]):x.p?'Aguardando aprovação':classeReserva(x.u)==='vencidas'?'Prazo vencido':classeReserva(x.u)==='incompletas'?'Prazo ausente ou inválido':'Reservado'}</strong><span>${esc(fmt(x.h?.em||x.p?.em||x.r.prazo))}</span>${x.h?`<small>${esc(x.h.por)} · ${esc(x.h.motivo)}</small>`:''}</div><div class="rs-actions"><button type="button" class="rs-pdf-button" data-rs-pdf="${i}">📄 PDFs do cliente</button>${x.h?'':(x.p?[['reservar','Aprovar'],['recusar','Recusar']]:[['prorrogar',classeReserva(x.u)==='incompletas'?'Completar':'Prorrogar'],['vender','Converter em venda'],['cancelar','Cancelar']]).map(([a,l])=>`<button class="${['cancelar','recusar'].includes(a)?'btn-danger':''}" data-rs-index="${i}" data-rs-action="${a}">${l}</button>`).join('')}</div></article>`).join(''):`<div class="rs-empty">${unidadeFiltro&&!unidadeAlvo?'Apartamento não encontrado.':unidadeAlvo?`Nenhum registro de ${esc(unidadeAlvo.unidade)} nesta seleção.`:'Nenhuma reserva nesta seleção.'}</div>`;
 box.querySelectorAll('[data-rs-pdf]').forEach(b=>b.onclick=()=>{const x=rows[+b.dataset.rsPdf];abrirPdfs(x.u,x.r,b);});
 box.querySelectorAll('[data-rs-index]').forEach(b=>b.onclick=()=>{const x=rows[+b.dataset.rsIndex];abrir(x.u.id,b.dataset.rsAction,x.p);});
 }

 // Envios guarda o PDF original. Sem referência explícita, nome + apartamento
 // são candidatos para conferência, nunca uma associação gravada automaticamente.
 function pdfsDaReserva(envios,u,r={}){
  const nome=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().replace(/\s+/g,' ').toLocaleLowerCase('pt-BR');
  const telefone=v=>{let n=String(v||'').replace(/\D/g,'');if(n.startsWith('55')&&n.length>=12)n=n.slice(2);return n;};
  const unidade=String(u?.unidade||'').trim().toUpperCase();
  if(!unidade)return[];
  return envios.flatMap(e=>{
   if(!/^pp-[a-f0-9]{16,}$/i.test(e.id||'')||String(e.unidade||'').trim().toUpperCase()!==unidade)return[];
   const refs=['propostaId','leadId'].filter(k=>r[k]);
   if(refs.length){if(refs.some(k=>e[k]!==r[k]))return[];return[{envio:e,vinculo:'referencia'}];}
   if(!nome(r.cliente)||nome(r.cliente)!==nome(e.cliente))return[];
   const a=telefone(r.telefone),b=telefone(e.telefone);
   if(a&&b&&a!==b)return[];
   return[{envio:e,vinculo:'nome'}];
  }).sort((a,b)=>(Date.parse(b.envio.em)||0)-(Date.parse(a.envio.em)||0));
 }
 function propostasDaReserva(propostas,u,r={}){
  const normalizaNome=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().replace(/\s+/g,' ').toLocaleLowerCase();
  return propostas.filter(p=>{
   if(String(p.unidade)!==String(u.unidade))return false;
   if(r.propostaId)return p.id===r.propostaId;
   if(r.leadId)return p.leadId===r.leadId;
   return !!normalizaNome(r.cliente)&&normalizaNome(p.cliente)===normalizaNome(r.cliente);
  });
 }
 async function abrirPdfs(u,r={},opener){
  if(!S.podeVerPainel())return;
  document.querySelector('#rs-pdfs')?.close();
  const dialog=document.createElement('dialog');dialog.id='rs-pdfs';dialog.className='rs-dialog rs-pdfs';
  dialog.setAttribute('aria-labelledby','rs-pdfs-title');
  dialog.innerHTML=`<header><div><p class="rs-eyebrow">DIAMOND · DOCUMENTOS</p><h2 id="rs-pdfs-title">PDFs do cliente · Apto ${esc(u.unidade)}</h2><p>${esc(r.cliente||'Cliente não informado')}</p></div><button type="button" id="rs-pdfs-close" aria-label="Fechar PDFs">×</button></header><div id="rs-pdfs-content" aria-live="polite"></div>`;
  document.body.append(dialog);dialog.showModal();
  const fechar=()=>dialog.close(),sessao=()=>{const s=S.getUser();return JSON.stringify([s?.usuario,s?.corretorAtivo?.nome]);},usuario=sessao();
  dialog.querySelector('#rs-pdfs-close').onclick=fechar;
  window.addEventListener('hashchange',fechar);
  dialog.addEventListener('close',()=>{window.removeEventListener('hashchange',fechar);dialog.remove();if(opener?.isConnected)opener.focus();},{once:true});
  const content=dialog.querySelector('#rs-pdfs-content');
  async function carregar(){
   content.innerHTML='<p role="status">Consultando os PDFs registrados…</p>';
   try{
    const envios=await S.listEnvios();
    if(!dialog.isConnected||!dialog.open)return;
    if(sessao()!==usuario){dialog.close();return;}
    const items=pdfsDaReserva(envios,u,r);
    if(!items.length){content.innerHTML='<div class="rs-pdf-empty"><strong>Nenhum PDF localizado para este cliente e apartamento.</strong><p>Arquivos baixados e enviados por fora da plataforma só aparecem aqui se também foram registrados no CRM.</p><a href="#/admin/envios">Consultar CRM</a></div>';return;}
    content.innerHTML=`<p class="rs-note">${items.some(x=>x.vinculo==='nome')?'Localizados pelo nome e apartamento. Confira o destinatário e a data antes de abrir.':'Arquivos vinculados ao cadastro da proposta ou do cliente.'}</p><div class="rs-pdf-list">${items.map(({envio:e,vinculo})=>{
     const url=String(window.P_URL).replace(/\/$/,'')+'/'+e.id;
     return `<article class="rs-pdf-item"><div><strong>Proposta ${e.numero?'#'+esc(e.numero):'· '+esc(e.id.slice(-8))}</strong><span>${esc(e.cliente)} · Apto ${esc(e.unidade)}</span><span>Link criado em ${esc(fmt(e.em))}</span><small>${e.origem==='anexado'?'PDF anexado':e.origem==='gerado'?'Gerado pelo sistema':'Arquivo histórico'}</small><small>${esc(e.corretor||'Corretor não informado')}${e.empresa?' · '+esc(e.empresa):''}</small>${e.resumo?.modalidade?`<small>${esc(e.resumo.modalidade)}</small>`:''}</div><div class="rs-pdf-actions"><a class="rs-pdf-open" target="_blank" rel="noopener" href="${esc(url+'?pdf=1&preview=1')}">Abrir PDF arquivado ↗</a><a href="#/admin/envios?envio=${encodeURIComponent(e.id)}">Ver acompanhamento</a></div></article>`;
    }).join('')}</div><p class="rs-note">É a cópia arquivada no CRM; pode incluir anexos ou revisões posteriores. Esta consulta não conta como abertura do cliente. O registro do link, sozinho, não confirma a entrega no WhatsApp.</p>`;
   }catch(e){
    if(!dialog.isConnected||!dialog.open)return;
    if(sessao()!==usuario){dialog.close();return;}
    content.innerHTML='<p class="rs-error" role="alert">Não foi possível consultar os PDFs agora. Tente novamente.</p><button type="button" id="rs-pdfs-retry">Tentar novamente</button>';
    content.querySelector('#rs-pdfs-retry').onclick=carregar;
   }
  }
  const candidatos=propostasDaReserva(S.getPropostas?.()||[],u,r);
  if(candidatos.length){
   const anexo=document.createElement('section');anexo.className='rs-note';
   anexo.innerHTML=`<h3>Anexar PDF à proposta</h3><p>Escolha a proposta correspondente ao arquivo. O PDF será guardado no CRM sem enviar mensagem ao cliente.</p><select aria-label="Proposta do anexo">${candidatos.map((p,i)=>`<option value="${i}">${esc(p.cliente)} · ${esc(Number(p.neg).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}))} · ${esc(p.criadoEm||p.id)}</option>`).join('')}</select><input type="file" accept="application/pdf,.pdf" aria-label="PDF da proposta"><button type="button">Anexar PDF</button><p role="status"></p>`;
   dialog.append(anexo);const btn=anexo.querySelector('button'),status=anexo.querySelector('[role="status"]');
   btn.onclick=async()=>{
    const file=anexo.querySelector('input').files[0],p=candidatos[Number(anexo.querySelector('select').value)];
    if(!file||!p){status.textContent='Escolha a proposta e o PDF.';return;}
    if(file.size>3*1024*1024){status.textContent='O limite é 3 MB.';return;}
    btn.disabled=true;
    try{
     const bytes=new Uint8Array(await file.arrayBuffer());if(new TextDecoder().decode(bytes.slice(0,5))!=='%PDF-')throw Error('Escolha um PDF válido.');
     if(sessao()!==usuario)throw Error('A sessão mudou. Abra a reserva novamente.');
     let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);
     const result=await S.api('putPropostaPdf',{origem:'anexado',base64:btoa(binary),propostaId:p.id,leadId:p.leadId||'',unidade:p.unidade,valor:p.neg,area:p.area,andar:p.andar,cliente:p.cliente,telefone:p.clienteTel||r.telefone||'',corretor:p.corretor,corretorTel:p.corretorTel,empresa:p.corretorEmpresa||'',comoCorretor:S.getUser()?.corretorAtivo?.nome||''});
     if(result.ok!==true||!/^pp-[a-f0-9]{16,}$/.test(result.id||''))throw Error('O servidor não confirmou o anexo.');
     status.textContent='PDF anexado e disponível no CRM.';anexo.querySelector('input').value='';await carregar();
    }catch(e){status.textContent=e.message||'Não foi possível anexar.';}finally{btn.disabled=false;}
   };
  }
  await carregar();
 }

 async function abrir(id,operacao='reservar',pedido){
 if(!S.podeVerPainel())return;
 if(operacao==='reservar'&&id&&S.unidadePorId(id)?.status==='Vendido')return alert('Esta unidade está vendida. Escolha Disponível na linha e salve para encerrar a venda antes de fazer uma nova reserva.');
 document.querySelector('#rs-dialog')?.remove();const dialog=document.createElement('dialog');dialog.id='rs-dialog';dialog.className='rs-dialog';document.body.append(dialog);
 const opLabel={reservar:'Confirmar reserva',prorrogar:'Atualizar prazo',cancelar:'Cancelar reserva',vender:'Converter em venda',recusar:'Recusar pedido',reabrir:'Voltar para disponível'};
 const units=(lerRota(location.hash).path==='#/admin/reservas'&&unidadesPainel?unidadesPainel:S.getUnidades()).filter(u=>id?u.id===id:u.status==='Disponível');
 if(!units.length){dialog.remove();return alert('Não há apartamentos disponíveis. Atualize o espelho.');}
 const edit=['reservar','prorrogar'].includes(operacao);
 dialog.innerHTML=`<form id="rs-form"><header><div><p class="rs-eyebrow">DIAMOND · RESERVAS</p><h2>${opLabel[operacao]}</h2></div><button type="button" id="rs-close" aria-label="Fechar">×</button></header><div class="rs-grid"><label>Apartamento<select name="unidadeId" ${id?'disabled':''}>${units.map(u=>`<option value="${esc(u.id)}">Apto ${esc(u.unidade)} · ${esc(u.status)}</option>`).join('')}</select></label>${edit?`<label>Usar cliente do CRM<select id="rs-crm"><option value="">Preencher manualmente</option>${S.getLeads().map((l,i)=>`<option value="${i}">${esc(l.cliente||'Sem nome')} · ${esc(l.clienteTel||l.unidade||'')}</option>`).join('')}</select></label>`:''}<label>Cliente<input name="cliente" maxlength="160" ${edit||operacao==='vender'?'required':''} ${edit||operacao==='vender'?'':'readonly'}></label><label>Telefone<input name="telefone" type="tel" maxlength="40" ${edit?'':'readonly'}></label><label>Corretor<input name="corretor" maxlength="160" ${edit?'required':'readonly'}></label><label>Imobiliária / empresa<input name="empresa" maxlength="160" ${edit?'':'readonly'}></label>${edit?'<label>Válida até<input name="prazo" type="datetime-local" required></label><label>Vaga de garagem<select name="vaga"><option value="">Escolher depois</option></select><small id="rs-vaga-info">Consultando disponibilidade…</small></label>':''}</div><label>Motivo / observações<textarea name="motivo" maxlength="300" rows="2" required></textarea></label><p id="rs-summary" class="rs-note"></p><p id="rs-error" role="status"></p><footer><button type="button" id="rs-back">Voltar</button><button class="btn ${['cancelar','recusar'].includes(operacao)?'btn-danger':''}" type="submit">${opLabel[operacao]}</button></footer></form>`;
 dialog.showModal();dialog.querySelector('#rs-close').onclick=()=>dialog.close();dialog.querySelector('#rs-back').onclick=()=>dialog.close();dialog.addEventListener('close',()=>dialog.remove());
 const form=dialog.querySelector('form'),fields=form.elements;let u,estadoVagas=null,mostrarVagas=()=>{};
 function preencher(){u=units.find(x=>x.id===fields.unidadeId.value);if(operacao==='reservar')pedido=(lerRota(location.hash).path==='#/admin/reservas'&&pedidosPainel?pedidosPainel:S.getReservas()).find(p=>p.unidadeId===u.id);const r=u.reserva||{};fields.cliente.value=pedido?.cliente||r.cliente||u.compradorNome||u.clienteVinculadoNome||u.comprador||u.clienteNome||u.cliente||'';fields.telefone.value=pedido?.telefone||r.telefone||'';fields.corretor.value=pedido?.corretor||r.corretor||u.vendedorNome||S.getUser()?.corretorAtivo?.nome||S.getUser()?.nome||'';fields.empresa.value=pedido?.empresa||r.empresa||u.vendedorEmpresa||'Domo';if(edit){const prazo=Date.parse(r.prazo);fields.prazo.value=Number.isFinite(prazo)?new Date(prazo-new Date(prazo).getTimezoneOffset()*60000).toISOString().slice(0,16):'';}fields.motivo.value=operacao==='reservar'?'Reserva confirmada pela Domo':'';dialog.querySelector('#rs-summary').textContent=operacao==='reabrir'?'Ao confirmar, a venda será encerrada no cadastro ativo e a unidade voltará a disponível. O comprador e o motivo ficarão no histórico. A planilha será atualizada.':operacao==='cancelar'?(u.reserva?.vagaEstrutural?'Ao confirmar, a reserva será cancelada. A vaga permanece vinculada ao apartamento.':'Ao confirmar, o apartamento e a vaga desta reserva serão liberados.'):operacao==='vender'?'Confirme somente após conferir a venda. O comprador será registrado na unidade.':operacao==='recusar'?'O pedido será retirado da fila e a decisão ficará no histórico.':'A reserva será confirmada no sistema. Se escolher uma vaga, ela será reservada junto e enviada à planilha.';}
 preencher();fields.unidadeId.onchange=()=>{preencher();if(estadoVagas)mostrarVagas();};form.onsubmit=e=>e.preventDefault();form.querySelector('[type=submit]').disabled=true;
 if(edit){dialog.querySelector('#rs-crm').onchange=e=>{const l=S.getLeads()[+e.target.value];if(e.target.value===''||!l)return;fields.cliente.value=l.cliente||'';fields.telefone.value=l.clienteTel||'';fields.corretor.value=l.corretorNome||fields.corretor.value;fields.empresa.value=l.empresaNome||fields.empresa.value;};
 mostrarVagas=()=>{
  const V=globalThis.DomoVagas,key=s=>String(s||'').replace(/^(?:apto\.?|apartamento)\s*/i,'').trim();
  const propria=V.efetivas(estadoVagas).filter(v=>key(v.apartamento)===key(u.unidade));
  const vinculada=propria.length===1&&!propria[0].alertas?.length?propria[0]:null;
  const fixa=u.reserva?.vaga||vinculada?.codigo||'';
  fields.vaga.innerHTML='<option value="">Escolher depois</option>'+V.livres(estadoVagas).map(v=>`<option value="${esc(v.codigo)}">${esc(v.codigo)} · ${esc(V.PISOS[v.piso].nome)}</option>`).join('');
  fields.vaga.disabled=!!fixa;
  if(fixa){if(!Array.from(fields.vaga.options).some(o=>o.value===fixa))fields.vaga.add(new Option(fixa+' · vinculada ao apartamento',fixa));fields.vaga.value=fixa;}
  dialog.querySelector('#rs-vaga-info').textContent=fixa?'Esta vaga já pertence ao vínculo deste apartamento.':propria.length?'O vínculo existente precisa de conferência na garagem.':'Disponibilidade conferida novamente ao salvar.';
 };
 try{const data=await S.api('vagas',{operacao:'carregar'});if(!dialog.isConnected)return;if(!data.estado)throw Error('Consulta incompleta');estadoVagas=data.estado;mostrarVagas();}catch(e){dialog.querySelector('#rs-vaga-info').textContent='Não foi possível consultar vagas. O vínculo existente será conferido no servidor ao salvar.';if(u.reserva?.vaga){fields.vaga.add(new Option(u.reserva.vaga,u.reserva.vaga));fields.vaga.value=u.reserva.vaga;fields.vaga.disabled=true;}}

 }
 form.querySelector('[type=submit]').disabled=false;
 form.onsubmit=async e=>{e.preventDefault();const button=form.querySelector('[type=submit]');if(button.disabled)return;const body={operacao,unidadeId:u.id,revisao:u.atualizadoEm||'',pedidoEm:pedido?.em||null};for(const key of ['cliente','telefone','corretor','empresa','motivo','vaga'])body[key]=fields[key]?.value||'';if(edit)body.prazo=new Date(fields.prazo.value).toISOString();button.disabled=true;const msg=dialog.querySelector('#rs-error');msg.textContent='Confirmando…';try{await api(body);dialog.close();if(operacao==='reabrir'){await S.pull();location.hash='#/admin/vendas?busca='+encodeURIComponent(u.unidade);}else{location.hash='#/admin/reservas';if(document.querySelector('#aba-corpo'))await render();}}catch(e){erro(msg,e);button.disabled=false;}};
 }
 window.DiamondReservas={render,abrir,lerRota,montarRota,classeReserva,pdfsDaReserva,propostasDaReserva,abrirPdfs};
})();
