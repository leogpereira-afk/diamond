/* Espelho de vagas Diamond. A base autenticada é compartilhada entre aparelhos. */
(function(){
  'use strict';

  const S={get senhaHash(){return STORE.getUser()?.senhaHash||''},get perfil(){return STORE.isAdmin()?'direcao':'escritorio'}};
  const esc=s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  const fmt={data:s=>s?new Date(s.length===10?s+'T12:00:00':s).toLocaleDateString('pt-BR'):'—',dataHora:s=>s?new Date(s).toLocaleString('pt-BR'):'—'};
  function cabecalho(t,s,a){document.getElementById('vgHeader').innerHTML='<h2>'+esc(t)+'</h2><div>'+a+'</div>'}
function toast(msg, tipo = '') {
  let caixa = document.getElementById('toasts');
  if (!caixa) {
    caixa = document.createElement('div');
    caixa.id = 'toasts';
    document.body.appendChild(caixa);
  }
  const t = document.createElement('div');
  t.className = 'toast ' + tipo;
  t.textContent = msg;
  caixa.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; }, 3200);
  setTimeout(() => t.remove(), 3600);
}

/* ── Modal ─────────────────────────────────────────────────────────────────── */
// Os modais ficam EMPILHADOS: abrir uma confirmação de dentro de um formulário
// não pode apagar o que já foi digitado embaixo.
// E o toque no fundo NÃO fecha: no canteiro, um toque torto ao rolar a tela
// apagava o recebimento inteiro (fotos já enviadas inclusive).
let _modalAberto = null;
const _pilhaModais = [];

function abrirModal({ titulo, corpo, acoes = [], largo = false, aoFechar = null, semFechar = false }) {
  if (_modalAberto) {
    _modalAberto.foco = document.activeElement;
    _modalAberto.fundo.style.display = 'none';
    _pilhaModais.push(_modalAberto);
  }
  const fundo = document.createElement('div');
  fundo.className = 'fundo-modal vg-modal';
  fundo.innerHTML =
    '<div class="modal' + (largo ? ' largo' : '') + '" role="dialog" aria-modal="true">' +
      '<header><h2>' + esc(titulo) + '</h2>' +
      (semFechar ? '' : '<button class="fechar" data-fechar aria-label="Fechar">&times;</button>') + '</header>' +
      '<div class="corpo"></div>' +
      (acoes.length ? '<footer></footer>' : '') +
    '</div>';
  fundo.querySelector('.corpo').innerHTML = corpo;
  const rodape = fundo.querySelector('footer');
  acoes.forEach((a, i) => {
    const b = document.createElement('button');
    b.className = 'btn ' + (a.classe || '');
    b.textContent = a.texto;
    b.dataset.i = i;
    b.addEventListener('click', () => a.aoClicar && a.aoClicar(fundo));
    rodape.appendChild(b);
  });
  fundo.addEventListener('click', (e) => {
    if (e.target.hasAttribute('data-fechar')) fecharModal();
  });
  document.body.appendChild(fundo);
  _modalAberto = { fundo, aoFechar, semFechar };
  const primeiro = fundo.querySelector('input,select,textarea');
  if (primeiro && window.innerWidth > 900) setTimeout(() => primeiro.focus(), 60);
  return fundo;
}

function fecharModal() {
  if (!_modalAberto) return;
  const { fundo, aoFechar } = _modalAberto;
  tirarDaPilha(fundo);
  fundo.remove();
  if (aoFechar) aoFechar();
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && _modalAberto && !_modalAberto.semFechar) fecharModal();
});

// Fecha sem disparar o aoFechar (usado quando a própria ação já resolveu a
// promessa). Precisa devolver a pilha ao estado certo, senão o modal de baixo
// fica escondido para sempre.
function fecharSilencioso(fundo) {
  tirarDaPilha(fundo);
  fundo.remove();
}

// Fecha ESTE modal (o do handler), não "o que estiver por cima". Depois de um
// await pode ter aparecido outro modal em cima — fechar o errado embaralha tudo.
function fecharEste(fundo) {
  if (!fundo) return fecharModal();
  const dono = (_modalAberto && _modalAberto.fundo === fundo)
    ? _modalAberto : _pilhaModais.find((m) => m.fundo === fundo);
  tirarDaPilha(fundo);
  fundo.remove();
  if (dono && dono.aoFechar) dono.aoFechar();
}

function tirarDaPilha(fundo) {
  if (_modalAberto && _modalAberto.fundo === fundo) {
    _modalAberto = _pilhaModais.pop() || null;
    if (_modalAberto) {
      _modalAberto.fundo.style.display = '';
      if (_modalAberto.foco && _modalAberto.foco.focus) _modalAberto.foco.focus();
    }
    return;
  }
  const i = _pilhaModais.findIndex((m) => m.fundo === fundo);
  if (i >= 0) _pilhaModais.splice(i, 1);
}
  const V=globalThis.DomoVagas;
  let base=null,pav=0,visao='espelho',filtro='',busca='',erro='',carregando=false,ultimaLeitura=0,identidade='';
  const chamar=(action,dados={})=>STORE.api('vagas',{operacao:action,...dados});
  const ativa=()=>location.hash.split('?')[0]==='#/admin/vagas'&&STORE.podeVerPainel();
  const data=d=>d?fmt.data(d):'—';
  const txtStatus=v=>V.STATUS[v.situacao]||'Conferir';
  function selecionadas(vs){return vs.filter(v=>(!filtro||v.situacao===filtro||(filtro==='alertas'&&(v.alertas.length||v.avisos.length||v.vencida)))&&(!busca||VagaNormal([v.codigo,v.apartamento,v.cliente,v.observacoes].join(' ')).includes(VagaNormal(busca))));}
  function VagaNormal(s){return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();}
  async function carregar(forcar=false){
    if(carregando||!ativa()||(!forcar&&Date.now()-ultimaLeitura<20000))return;
    carregando=true;const pessoa=S.senhaHash;
    try{const r=await chamar('carregar');if(!ativa()||pessoa!==S.senhaHash)return;base=r;ultimaLeitura=Date.now();erro='';}
    catch(e){erro=e.message;}finally{carregando=false;if(ativa()&&!document.querySelector('.fundo-modal')&&!document.activeElement?.matches('input,select,textarea'))desenhar(document.getElementById('vgPagina'));}
  }
  function badge(v){return '<span class="vg-badge vg-'+v.situacao+'">'+esc(txtStatus(v))+'</span>';}
  function botaoVaga(v,row,col,visivel){return `<button class="vg-slot vg-${v.situacao}${visivel?'':' vg-dim'}" data-vaga="${v.codigo}" style="grid-row:${row+1};grid-column:${col?3:1}" aria-label="${esc(v.codigo+', '+txtStatus(v)+', '+(v.apartamento||'sem apartamento'))}"><span><b>${v.codigo}</b>${v.vencida?' ⏱':v.alertas.length?' !':''}</span><small>${esc(v.apartamento||txtStatus(v))}</small></button>`;}
  function mapa(vs,id){const porId=new Map(vs.map(v=>[v.numero,v])),ok=new Set(selecionadas(vs).map(v=>v.codigo));return `<div class="vg-plan" style="--vg-linhas:${V.LINHAS[id].length}"><div class="vg-corredor">CIRCULAÇÃO</div>${V.LINHAS[id].flatMap((r,y)=>r.map((n,x)=>n?botaoVaga(porId.get(n),y,x,ok.has(V.codigo(n))):'')).join('')}</div>`;}
  function listaHTML(vs){return `<div class="tabela-wrap"><table class="tabela vg-table"><thead><tr><th>Vaga / piso</th><th>Apartamento</th><th>Cliente / proprietário</th><th>Situação</th><th>Contrato</th><th>Prazo da reserva</th><th></th></tr></thead><tbody>${vs.map(v=>`<tr><td><b>${v.codigo}</b><small>${esc(V.PISOS[v.piso].nome)}</small></td><td>${esc(v.apartamento||'—')}</td><td>${esc(v.cliente||'—')}</td><td>${badge(v)}</td><td>${esc(v.contrato||'—')}</td><td>${data(v.expiracao)}${v.vencida?'<small class="vg-danger">Reserva vencida</small>':''}</td><td><button class="btn pequeno" data-vaga="${v.codigo}">Abrir</button></td></tr>`).join('')}</tbody></table></div>`;}
  function desenhar(el){
    if(!el||!ativa())return;
    cabecalho('Vagas do Diamond','Espelho, vínculos e reservas',`<button class="btn" id="vgRefresh">↻ Atualizar</button><button class="btn primario" id="vgPDF" ${!base?'disabled':''}>↓ Emitir PDF</button>`);
    document.getElementById('vgRefresh').onclick=()=>carregar(true);document.getElementById('vgPDF').onclick=()=>exportar();
    if(!base){el.innerHTML=`<div class="cartao"><h2>${erro?'Não foi possível abrir o espelho':'Carregando as vagas…'}</h2><p>${esc(erro||'Consultando a base do Diamond.')}</p></div>`;return;}
    const vs=V.efetivas(base.estado),sel=selecionadas(vs),alertas=vs.filter(v=>v.alertas.length||v.avisos.length||v.vencida),num=s=>vs.filter(v=>v.situacao===s).length;
    el.innerHTML=`<section class="vg-hero"><div><img class="vg-logo" src="logo-diamond.png" alt="Diamond Residencial" width="820" height="110"><h2>Disponibilidade e vínculos</h2><p>82 vagas · 3 pavimentos · posição conforme a planta</p></div><div class="vg-sync"><b>${erro?'Atualização indisponível':'● Base consultada '+new Date(ultimaLeitura).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</b><span>${erro?esc(erro):'Consulta automática a cada 20 segundos nesta tela'}</span><span>Planilha importada em ${fmt.dataHora(base.estado.fonte.lidoEm)}</span></div></section>
    <div class="vg-metricas">${[['','82','Total de vagas'],['disponivel',num('disponivel'),'Disponíveis'],['reservada',num('reservada'),'Reservadas'],['vendida',num('vendida'),'Vendidas'],['conferir',num('conferir'),'Para conferir']].map(([s,n,t])=>`<button class="vg-metrica ${filtro===s?'selecionada':''}" data-filtro="${s}" aria-pressed="${filtro===s}"><span>${t}</span><b>${n}</b><i class="vg-dot vg-${s||'todas'}"></i></button>`).join('')}</div>
    ${alertas.length?`<button class="vg-aviso" id="vgVerAlertas"><b>! ${alertas.length} vagas precisam de atenção</b><span>Situações divergentes, vínculos ou pavimentos para conferir. Ver alertas →</span></button>`:''}
    <div class="vg-toolbar"><div class="vg-tabs" role="group" aria-label="Visualização">${[['espelho','▦ Espelho'],['lista','☷ Lista completa'],['alertas','! Alertas'],['historico','↶ Histórico']].map(([k,t])=>`<button data-visao="${k}" class="${visao===k?'ativo':''}" aria-pressed="${visao===k}">${t}</button>`).join('')}</div><input id="vgBusca" type="search" placeholder="Buscar vaga, apartamento ou cliente" aria-label="Buscar vaga, apartamento ou cliente" value="${esc(busca)}"></div>
    <div id="vgConteudo">${visao==='espelho'?`<div class="vg-pavimentos">${V.PISOS.map(p=>`<button data-piso="${p.id}" class="${pav===p.id?'ativo':''}" aria-pressed="${pav===p.id}"><b>${p.nome}</b><span>${V.codigo(p.de)}–${V.codigo(p.ate)} · ${p.ate-p.de+1} vagas</span></button>`).join('')}</div><div class="vg-espelho"><section class="cartao vg-mapa"><div class="vg-mapa-topo"><b>${V.PISOS[pav].nome}</b><small>Espelho esquemático · clique na vaga</small></div>${mapa(vs,pav)}<div class="vg-legenda">${Object.entries(V.STATUS).map(([k,v])=>`<span><i class="vg-dot vg-${k}"></i>${v}</span>`).join('')}</div><p class="vg-nota">Posição e numeração baseadas no PDF recebido. Esquema sem escala; consulte o projeto para medidas.</p></section><section class="cartao vg-resumo"><h2>Neste pavimento</h2><p>${sel.filter(v=>v.piso===pav).length} vagas correspondem à sua seleção.</p>${listaHTML(sel.filter(v=>v.piso===pav))}</section></div>`:visao==='lista'?`<section class="cartao"><h2>Todas as vagas <small>· ${sel.length} resultados</small></h2>${listaHTML(sel)}</section>`:visao==='alertas'?`<section class="cartao"><h2>Conferência das informações</h2><p>Diferenças ficam visíveis até uma decisão ser salva. Reserva vencida não libera a vaga automaticamente.</p>${selecionadas(alertas).map(v=>`<article class="vg-alerta"><div><b>${v.codigo} · ${esc(v.apartamento||'Sem apartamento')}</b>${badge(v)}</div><ul>${[...v.alertas,...v.avisos,...(v.vencida?['Reserva vencida em '+data(v.expiracao)+'. Confirmar venda ou liberação.']:[])].map(t=>`<li>${esc(t)}</li>`).join('')}</ul><button class="btn" data-vaga="${v.codigo}">Conferir esta vaga</button></article>`).join('')||'<p class="vg-vazio">Nenhum alerta nesta seleção.</p>'}</section>`:`<section class="cartao"><h2>Histórico de decisões</h2>${[...(base.estado.historico||[])].reverse().map(h=>`<article class="vg-historico"><span>${fmt.dataHora(h.em)}</span><div><b>${esc(h.vaga||'Planilha')} · ${esc(h.por)}</b><p>${esc(h.motivo||h.acao)}</p>${h.depois?`<small>${esc(V.STATUS[h.antes?.situacao]||'—')} → ${esc(V.STATUS[h.depois.situacao])} · ${esc(h.depois.apartamento||'Sem apartamento')}</small>`:''}</div></article>`).join('')||'<p class="vg-vazio">As alterações salvas aparecerão aqui com data, responsável e motivo.</p>'}</section>`}</div>
    <details class="cartao vg-fonte"><summary>Origem e atualização dos dados</summary><p>Fonte: aba Vagas de Garagem da planilha Vagas Estacionamento. Alterações feitas aqui são salvas no Diamond, com histórico e proteção contra gravações simultâneas. Vagas, apartamentos e compradores usam a mesma aba.</p><a class="btn" href="https://docs.google.com/spreadsheets/d/130glBupRR7bFE0KeMTYds2x-9AuoB9hbShobLGzcyOE/edit" target="_blank" rel="noopener">Abrir planilha original ↗</a>${S.perfil==='direcao'?'<button class="btn" id="vgImportar">Importar atualização da planilha</button>':''}<p class="vg-nota">${base.estado.sync?.ultimaConsulta ? 'Google Sheets: última consulta '+esc(fmt.dataHora(base.estado.sync.ultimaConsulta))+'. '+(base.estado.sync.pendente?'Alterações aguardando confirmação na planilha.':base.estado.sync.ultimaConclusao?'Última conclusão: '+esc(fmt.dataHora(base.estado.sync.ultimaConclusao))+'.':'')+((base.estado.sync.conflitos||[]).length?' Conferir vínculos: '+esc(base.estado.sync.conflitos.join(', '))+'.':'') : 'A conexão com o Google aguarda ativação. Atualizar consulta a base do Diamond.'}</p></details>`;
    el.querySelectorAll('[data-vaga]').forEach(b=>b.onclick=()=>abrir(b.dataset.vaga));
    el.querySelectorAll('[data-filtro]').forEach(b=>b.onclick=()=>{filtro=b.dataset.filtro;desenhar(el);});
    el.querySelectorAll('[data-visao]').forEach(b=>b.onclick=()=>{visao=b.dataset.visao;filtro='';desenhar(el);});
    el.querySelectorAll('[data-piso]').forEach(b=>b.onclick=()=>{pav=+b.dataset.piso;desenhar(el);});
    el.querySelector('#vgVerAlertas')?.addEventListener('click',()=>{visao='alertas';filtro='';busca='';desenhar(el);});
    el.querySelector('#vgImportar')?.addEventListener('click',importar);
    el.querySelector('#vgBusca').oninput=e=>{busca=e.target.value;const pos=e.target.selectionStart;desenhar(el);const input=el.querySelector('#vgBusca');input.focus();try{input.setSelectionRange(pos,pos);}catch{}};
  }
  function abrir(codigo){
    const original=base.estado.vagas.find(x=>x.codigo===codigo),v=V.efetivas(base.estado).find(x=>x.codigo===codigo),revisao=base.revisao;
    const campo=(nome,label,type='text')=>`<label>${label}<input type="${type}" name="${nome}" value="${esc(v[nome]||'')}"></label>`;
    const m=abrirModal({titulo:codigo+' · '+V.PISOS[v.piso].nome,largo:true,corpo:`<form id="vgForm"><div class="vg-form-resumo">${badge(v)}<span>${v.manual?'Decisão salva no Diamond':'Informações da planilha'} · ${esc(v.area||'Área não informada')}</span></div>${v.alertas.length?`<div class="aviso">${v.alertas.map(esc).join('<br>')}</div>`:''}<div class="vg-form-grid"><label>Vaga<select name="vaga">${[`<option value="${codigo}" selected>${codigo} · ${esc(V.PISOS[v.piso].nome)} (atual)</option>`,...V.PISOS.map(p=>{const livres=V.livres(base.estado).filter(x=>x.piso===p.id&&x.codigo!==codigo);return livres.length?`<optgroup label="Mudar para · ${esc(p.nome)}">${livres.map(x=>`<option value="${x.codigo}">${x.codigo}</option>`).join('')}</optgroup>`:'';})].join('')}</select><small class="vg-nota">Escolher outra vaga move o vínculo inteiro e libera a ${codigo}. Só aparecem as disponíveis.</small></label><label>Situação<select name="situacao"><option value="">Selecione para conferir</option>${Object.entries(V.STATUS).filter(([k])=>k!=='conferir').map(([k,t])=>`<option value="${k}" ${v.situacao===k?'selected':''}>${t}</option>`).join('')}</select></label><label>Apartamento<select name="apartamento"><option value="">Sem vínculo</option>${base.estado.unidades.map(u=>`<option ${u.apartamento===v.apartamento?'selected':''}>${esc(u.apartamento)}</option>`).join('')}</select></label>${campo('cliente','Cliente / proprietário')}<label>Etapa do contrato<select name="contrato">${['','Documentos','Elaboração','Assinaturas','Finalizado',...(!['','Documentos','Elaboração','Assinaturas','Finalizado'].includes(v.contrato)?[v.contrato]:[])].map(t=>`<option value="${esc(t)}" ${v.contrato===t?'selected':''}>${esc(t||'Não informado')}</option>`).join('')}</select></label>${campo('reserva','Início da reserva','date')}${campo('expiracao','Prazo da reserva','date')}</div><label>Observações<textarea name="observacoes" rows="3">${esc(v.observacoes)}</textarea></label><label>Motivo da alteração ou conferência<input name="motivo" required maxlength="300" placeholder="Ex.: conferido com o contrato assinado"></label><p id="vgErroForm" role="alert" class="vg-danger"></p><details class="vg-fontes"><summary>Conferir as informações originais</summary><div class="vg-origens"><div><h3>Vagas de Garagem</h3>${original.origem.vinculos.map(u=>`<p>${esc(u.apartamento)} · ${esc(u['cliente / proprietario'])}<br><b>${esc(u.status)}</b> · ${esc(u.contratos||'Sem contrato')}</p>`).join('')||'<p>Sem vínculo informado.</p>'}</div><div><h3>${base.estado.fonte.abaUnica?'Espelho da aba única':'Gestão de Vagas'}</h3><p>${esc(original.origem.gestao.apartamento||'Sem apartamento')} · ${esc(original.origem.gestao['cliente / proprietario']||'Sem cliente')}<br><b>${esc(original.origem.gestao.status)}</b> · ${esc(original.origem.gestao.pavimento)}</p></div></div><p>${esc(v.avisos.join(' '))}</p></details></form>`,acoes:[{texto:'Fechar',aoClicar:fecharModal},{texto:'Salvar alterações',classe:'primario',aoClicar:async f=>{
      const form=f.querySelector('form'),error=f.querySelector('#vgErroForm'),button=f.querySelector('footer .primario');
      if(button.disabled)return;
      error.textContent='';
      try{
        if(!await regrasAtuais())return;
        const ajuste=Object.fromEntries(new FormData(form));
        const destino=(ajuste.vaga||codigo);delete ajuste.vaga;
        const mudou=destino!==codigo;
        if(mudou)V.validarMudancaVaga(codigo,destino,ajuste,base.estado);else V.validarAjuste(codigo,ajuste,base.estado);
        button.disabled=true;button.textContent='Salvando…';
        const r=await chamar('salvar',{codigo,destino,ajuste,revisao});base=r;ultimaLeitura=Date.now();
        fecharModal();desenhar(document.getElementById('vgPagina'));
        toast(mudou?codigo+' → '+destino+': vaga trocada no Diamond.':codigo+' salva no Diamond.');
      }
      catch(e){error.textContent=e.message;button.disabled=false;button.textContent='Salvar alterações';error.scrollIntoView({block:'nearest'});}
    }}]});
    m.classList.add('vg-modal');
    m.querySelector('form').onsubmit=e=>{e.preventDefault();m.querySelector('footer .primario').click();};
  }
  // Troca de vaga: mostra SÓ as livres (mesma régua da proposta) e grava as duas
  // vagas de uma vez. A tela usa o que está salvo — edição aberta no modal de trás
  // não entra, por isso o aviso.
  // A tela (vagas.js) e as regras (vagas-domain.js) são arquivos separados. Se o
  // navegador servir uma cópia velha das regras, o botão morre com "is not a
  // function" e a pessoa fica sem saída. Aqui a tela percebe a incompatibilidade,
  // limpa o que estiver guardado e recarrega UMA vez (marca na sessão evita laço).
  async function regrasAtuais(){
    if(V&&typeof V.validarMudancaVaga==='function'&&typeof V.livres==='function'){sessionStorage.removeItem('vgRecarregado');return true;}
    if(sessionStorage.getItem('vgRecarregado')){toast('Esta tela está desatualizada e o navegador continua entregando a versão antiga. Feche o aplicativo por completo e abra de novo.','ruim');return false;}
    sessionStorage.setItem('vgRecarregado','1');
    toast('Atualizando a tela para a versão nova…');
    try{
      if(navigator.serviceWorker)for(const r of await navigator.serviceWorker.getRegistrations())await r.unregister();
      if(window.caches)for(const k of await caches.keys())await caches.delete(k);
    }catch(e){/* sem cache para limpar: o reload abaixo ainda resolve */}
    location.reload(true);
    return false;
  }
  function importar(){
    let preview=null,fonte=null;
    abrirModal({titulo:'Atualizar a partir da planilha',corpo:`<p>No Google Sheets, baixe cada aba em <b>Arquivo → Fazer download → CSV</b>. Escolha os dois arquivos para conferir antes de importar.</p><label>Vagas de Garagem<input id="vgArquivoVinculos" type="file" accept=".csv,text/csv"></label><label>Gestão de Vagas<input id="vgArquivoGestao" type="file" accept=".csv,text/csv"></label><p id="vgPreview" role="status"></p>`,acoes:[{texto:'Cancelar',aoClicar:fecharModal},{texto:'Conferir arquivos',classe:'primario',aoClicar:async f=>{
      const out=f.querySelector('#vgPreview'),btn=f.querySelector('footer .primario');try{
        btn.disabled=true;
        if(preview){const r=await chamar('importar',{fonte,revisao:preview.revisao});base=r;ultimaLeitura=Date.now();fecharModal();desenhar(document.getElementById('vgPagina'));toast('Planilha importada. Decisões anteriores preservadas.');return;}
        const a=f.querySelector('#vgArquivoVinculos').files[0],b=f.querySelector('#vgArquivoGestao').files[0];if(!a||!b)throw Error('Selecione os dois arquivos.');if(a.size+b.size>800000)throw Error('Os arquivos excedem o tamanho esperado para 82 vagas.');
        fonte={vinculos:V.parseCSV(await a.text()),gestao:V.parseCSV(await b.text()),spreadsheetId:base.estado.fonte.spreadsheetId};V.importar(fonte);
        preview=await chamar('preverImportacao',{fonte});out.textContent=`82 vagas conferidas. ${preview.mudaram.length} vagas com mudanças na origem; ${preview.alertas} com alertas. As decisões salvas serão mantidas e avisaremos se a origem mudou.`;btn.textContent='Confirmar importação';f.querySelectorAll('input').forEach(x=>x.disabled=true);
      }catch(e){out.textContent=e.message;}finally{btn.disabled=false;}
    }}]});
  }
  async function exportar(){
    const btn=document.getElementById('vgPDF');if(btn)btn.disabled=true;
    try{await carregar(true);if(erro)throw Error('Não foi possível conferir a versão atual. Atualize a conexão antes de emitir o PDF.');if(!base)throw Error('Carregue o espelho primeiro.');DomoVagasPDF(base);toast('PDF emitido com os três pavimentos.');}
    catch(e){toast(e.message,'ruim');}finally{if(btn)btn.disabled=false;}
  }
  window.DiamondVagas=el=>{if(identidade!==S.senhaHash){base=null;ultimaLeitura=0;erro='';identidade=S.senhaHash;}desenhar(el);carregar();};
  setInterval(()=>{if(ativa()&&!document.hidden)carregar();else if(!S.senhaHash)base=null;},20000);
})();
