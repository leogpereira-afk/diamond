/* global STORE */
// Reajuste com conferência, confirmação online e histórico por versão.
(() => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const moeda = n => Number(n || 0).toLocaleString('pt-BR', {style:'currency',currency:'BRL',minimumFractionDigits:2});
  const percentual = n => Number(n || 0).toLocaleString('pt-BR', {maximumFractionDigits:4}) + '%';
  const hoje = () => {const d = new Date(); return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');};
  const dataBr = iso => /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.split('-').reverse().join('/') : iso;
  const horario = iso => {const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('pt-BR', {timeZone:'America/Sao_Paulo'});};
  const itensDe = p => Array.isArray(p.itens) ? p.itens : [];
  function numerarHistorico(lista) {
    return lista.filter(Boolean).map((registro,index)=>({registro,index})).sort((a,b)=>{
      const ta=Date.parse(a.registro.criadoEm||a.registro.em||''),tb=Date.parse(b.registro.criadoEm||b.registro.em||'');
      if(Number.isFinite(ta)&&Number.isFinite(tb)&&ta!==tb)return ta-tb;
      // Na ausência de horário, a versão salva define a sequência sem inventar data.
      const va=Number(/^v(\d+)$/i.exec(a.registro.versaoNova||'')?.[1]),vb=Number(/^v(\d+)$/i.exec(b.registro.versaoNova||'')?.[1]);
      return Number.isFinite(va)&&Number.isFinite(vb)&&va!==vb?va-vb:b.index-a.index;
    }).map(({registro},index)=>({registro,numero:index+1}));
  }
  let logoPDF;
  async function carregarLogoPDF(){
    if(!logoPDF)logoPDF=fetch(new URL('logo-diamond.png',document.baseURI)).then(async r=>{
      if(!r.ok)throw Error('Não foi possível carregar a marca Diamond. Tente baixar o PDF novamente.');
      return new Uint8Array(await r.arrayBuffer());
    }).catch(e=>{logoPDF=null;throw e;});
    return logoPDF;
  }
  async function exportarPDF(p,numero,{retornar=false}={}){
    if(!p?.id||!itensDe(p).length||!Number.isSafeInteger(numero)||numero<1)throw Error('Selecione uma atualização salva com comparativo para emitir o PDF.');
    if(!globalThis.jspdf?.jsPDF)throw Error('O gerador de PDF não está disponível. Atualize a tela e tente novamente.');
    const logo=await carregarLogoPDF(),doc=new globalThis.jspdf.jsPDF({orientation:'landscape',unit:'mm',format:'a4'});
    const itens=[...itensDe(p)].sort((a,b)=>String(a.unidade||a.id).localeCompare(String(b.unidade||b.id),'pt-BR',{numeric:true}));
    const regularizada=p.modo==='regularizar'||p.origem==='regularizacao_legado',titulo=numero+'ª atualização';
    const dataTabela=p.dataTabela?dataBr(p.dataTabela):'Data não informada';
    const registro=horario(p.criadoEm||p.em||'');
    const money=n=>moeda(n).replace(/\u00a0/g,' '),delta=i=>Number(i.novo)-Number(i.anterior);
    const cabecalho=()=>{
      doc.setFillColor(0);doc.rect(0,0,297,32,'F');doc.addImage(logo,'PNG',12,8,60,8.05,'diamond-logo');
      doc.setFillColor(235,255,45);doc.rect(0,32,297,1.2,'F');doc.setTextColor(255);doc.setFont('helvetica','bold');doc.setFontSize(14);doc.text(titulo,285,12,{align:'right'});
      doc.setFont('helvetica','normal');doc.setFontSize(10);doc.text(String(p.versaoAnterior||'Versão anterior não informada')+' para '+String(p.versaoNova||'Versão não informada')+' · '+percentual(p.percentual),285,21,{align:'right'});
      doc.setFontSize(8);doc.text('Data da tabela: '+dataTabela,285,27,{align:'right'});
    };
    cabecalho();doc.setTextColor(28);doc.setFont('helvetica','bold');doc.setFontSize(15);doc.text('Evolução da tabela de preços',12,44);
    doc.setFont('helvetica','normal');doc.setFontSize(9);doc.text(itens.length+' unidades · '+itens.filter(i=>i.alterada).length+' disponíveis reajustadas · '+itens.filter(i=>!i.alterada).length+' bases preservadas',12,51);
    doc.setFontSize(8);doc.setTextColor(90);doc.text((registro?'Registro salvo em '+registro+' (Brasília)':'Registro sem data informada')+(p.por?' · Responsável: '+p.por:''),12,57);
    const anterior=itens.reduce((sum,i)=>sum+Number(i.anterior||0),0),novo=itens.reduce((sum,i)=>sum+Number(i.novo||0),0);
    [['Total da base anterior',money(anterior)],['Total da nova tabela',money(novo)],['Variação total',money(novo-anterior)]].forEach(([label,value],i)=>{
      const x=12+i*91;doc.setFillColor(i===2?235:245,i===2?255:247,i===2?45:239);doc.rect(x,63,88,19,'F');doc.setTextColor(65);doc.setFont('helvetica','normal');doc.setFontSize(8);doc.text(label,x+4,69);doc.setTextColor(20);doc.setFont('helvetica','bold');doc.setFontSize(13);doc.text(value,x+4,77);
    });
    const nota=regularizada?'Comparação reconstruída a partir dos preços base e do percentual antigo. A data do registro é a regularização e não comprova quando o reajuste original foi aplicado.':'Somente as unidades disponíveis receberam reajuste. Vendidas e reservadas mantiveram seus preços base.';
    doc.setFont('helvetica','normal');doc.setFontSize(8);doc.setTextColor(80);const linhasNota=doc.splitTextToSize(nota+' Valores de tabela antes dos descontos individuais.',273);doc.text(linhasNota,12,89);
    let y=92+linhasNota.length*3.4;
    const colunas=regularizada?[['Unidade',20],['Situação',29],['Base anterior',43],['Exibido antes',43],['Nova tabela',43],['Variação',35],['Resultado',60]]:[['Unidade',20],['Situação',36],['Base anterior',50],['Nova tabela',50],['Variação',47],['Resultado',70]];
    const topoTabela=()=>{doc.setFillColor(30);doc.rect(12,y,273,8,'F');doc.setFont('helvetica','bold');doc.setFontSize(8);doc.setTextColor(255);let x=12;for(const [label,width]of colunas){doc.text(label,x+2,y+5.2);x+=width;}y+=8;};
    topoTabela();
    for(const [index,i]of itens.entries()){
      const variacao=delta(i),resultado=i.corrigida?'Exibição corrigida':i.alterada?'Reajustada':'Preço preservado';
      const valores=[String(i.unidade||i.id),String(i.status||'Não informada'),money(i.anterior),...(regularizada?[money(i.exibidoAntes)]:[]),money(i.novo),(variacao>0?'+ ':'')+money(variacao),resultado];
      doc.setFont('helvetica','normal');doc.setFontSize(8);const linhas=valores.map((s,j)=>doc.splitTextToSize(s,colunas[j][1]-4));const h=Math.max(5.8,Math.max(...linhas.map(s=>s.length))*3.3+2.5);
      if(y+h>191){doc.addPage();cabecalho();y=41;topoTabela();}
      const cor=i.corrigida?[255,245,224]:i.alterada?[245,250,226]:index%2?[248,249,246]:[255,255,255];doc.setFillColor(...cor);doc.rect(12,y,273,h,'F');doc.setDrawColor(223,226,216);doc.line(12,y+h,285,y+h);
      let x=12;for(let j=0;j<colunas.length;j++){const width=colunas[j][1],numeroCelula=j>=2&&j<colunas.length-1;doc.setTextColor(...(j===colunas.length-1?(i.corrigida?[147,89,10]:i.alterada?[64,95,22]:[85,91,79]):[35,40,30]));doc.setFont('helvetica',j===0||j===colunas.length-3?'bold':'normal');doc.setFontSize(8);doc.text(linhas[j],numeroCelula?x+width-2:x+2,y+3.9,{align:numeroCelula?'right':'left'});x+=width;}y+=h;
    }
    const paginas=doc.getNumberOfPages();
    for(let pagina=1;pagina<=paginas;pagina++){doc.setPage(pagina);doc.setDrawColor(213,219,197);doc.line(12,196,285,196);doc.setTextColor(80);doc.setFont('helvetica','normal');doc.setFontSize(7);doc.text('DIAMOND · Histórico de preços · '+titulo,12,201);doc.text('Página '+pagina+' de '+paginas,285,201,{align:'right'});doc.setFontSize(6);doc.text('Registro: '+String(p.id),12,205);}
    doc.setProperties({title:'Diamond | '+titulo+' | '+String(p.versaoNova||''),subject:regularizada?'Comparativo reconstruído de regularização de preços':'Comparativo da atualização de preços por unidade',author:'Domo Construtora'});
    const dataArquivo=/^\d{2}\/\d{2}\/\d{4}$/.test(dataTabela)?dataTabela.replaceAll('/','-'):'sem-data';
    const versaoArquivo=String(p.versaoNova||'sem-versao').replace(/[^a-zA-Z0-9_-]/g,'');
    if(!retornar)doc.save('Diamond-'+numero+'a-atualizacao-'+versaoArquivo+'-'+dataArquivo+'.pdf');return doc;
  }
  function comparativo(p) {
    const itens = itensDe(p);
    return `<div class="precos-comparativo"><table><caption>Comparativo dos preços de tabela, antes dos descontos individuais</caption><thead><tr><th>Unidade</th><th>Situação</th><th>Base anterior</th>${p.modo==='regularizar'?'<th>Exibido com reajuste antigo</th>':''}<th>Nova tabela</th><th>Resultado</th></tr></thead><tbody>${itens.map(i=>`<tr class="${i.corrigida?'precos-corrigida':i.alterada?'precos-alterada':''}"><th scope="row">${esc(i.unidade || i.id)}</th><td>${esc(i.status)}</td><td>${moeda(i.anterior)}</td>${p.modo==='regularizar'?`<td>${moeda(i.exibidoAntes)}</td>`:''}<td><b>${moeda(i.novo)}</b></td><td>${i.corrigida?'Retirado reajuste indevido':i.alterada?`+ ${moeda(i.novo-i.anterior)}`:'Preservado'}</td></tr>`).join('')}</tbody></table></div>`;
  }
  function resumo(p) {
    const itens = itensDe(p), elegiveis = itens.filter(i=>i.alterada), corrigidas = itens.filter(i=>i.corrigida);
    return `<div class="precos-resumo"><span><b>${elegiveis.length}</b> disponíveis reajustadas</span><span><b>${itens.length-elegiveis.length}</b> preços base preservados</span>${corrigidas.length?`<span><b>${corrigidas.length}</b> exibições corrigidas</span>`:''}</div>`;
  }
  function mount(el, {temEdicao = () => false, marcarEdicao = () => {}, salvo = () => {}} = {}) {
    const cfg = STORE.getCfg() || {}, legado = Number(cfg.reajuste || 0);
    el.innerHTML = `<div class="precos-painel">
      <header class="precos-cab"><div><span class="precos-kicker">Tabela de preços</span><h2>${esc(cfg.versao || 'v1')} <small>· ${esc(cfg.dataTabela || 'Data não informada')}</small></h2></div><button class="btn-mini" id="precos-historico" aria-expanded="false">Histórico e comparativo</button></header>
      ${legado ? `<div class="precos-legado"><div><b>Reajuste de ${percentual(legado*100)} aguardando regularização</b><p>O método antigo atingiu todas as unidades. A correção mantém esse aumento nas disponíveis, retira o efeito das vendidas e reservadas e registra uma nova versão.</p></div><button class="btn-lime" id="precos-regularizar">Revisar correção</button></div>` : `<form class="precos-form"><label>Reajuste nas disponíveis (%)<input id="precos-percentual" type="number" min="0.0001" max="1000" step="any" placeholder="Ex.: 4" required></label><label>Data da nova tabela<input id="precos-data" type="date" value="${hoje()}" required></label><button class="btn-lime" type="submit">Revisar reajuste</button><p>A versão será criada automaticamente. Vendidas e reservadas mantêm seus preços.</p></form>`}
      <p class="precos-erro" role="alert" hidden></p><div id="precos-historico-lista" hidden></div>
    </div>`;
    const erro = msg => {const x=el.querySelector('.precos-erro');x.textContent=msg;x.hidden=!msg;};
    const historico = el.querySelector('#precos-historico-lista');
    el.querySelector('#precos-historico').onclick = async event => {
      const btn = event.currentTarget;
      if(!historico.hidden){historico.hidden=true;btn.setAttribute('aria-expanded','false');return;}
      historico.hidden=false;btn.setAttribute('aria-expanded','true');btn.disabled=true;historico.innerHTML='<p role="status">Consultando versões salvas…</p>';
      try {
        const r = await STORE.api('precosHistorico');
        if(!el.isConnected)return;
        const lista=numerarHistorico(r.historico || []).reverse();
        historico.innerHTML=lista.length?lista.map(({registro:p,numero},index)=>`<details class="precos-versao"><summary><span><b>${numero}ª atualização · ${esc(p.versaoAnterior)} → ${esc(p.versaoNova)}</b> · ${percentual(p.percentual)}</span><small>Tabela: ${esc(dataBr(p.dataTabela)||'Data não informada')} · ${horario(p.criadoEm||p.em)?'Registro: '+esc(horario(p.criadoEm||p.em)):'Registro sem data informada'}</small></summary><div class="precos-resumo"><button type="button" class="btn-mini" data-precos-pdf="${index}">↓ PDF da ${numero}ª atualização</button></div><p class="precos-origem">${p.modo==='regularizar'?'Regularização do reajuste antigo. Comparação reconstruída a partir dos preços base e do percentual que estava salvo. A data deste registro não comprova quando o reajuste original foi aplicado.':'Reajuste aplicado somente às unidades disponíveis.'} ${p.por?`Registrado por ${esc(p.por)}.`:''}</p>${resumo(p)}${comparativo(p)}</details>`).join(''):'<p class="precos-origem">Ainda não há versões registradas. O próximo reajuste salvará o comparativo aqui.</p>';
        historico.querySelectorAll('[data-precos-pdf]').forEach(button=>button.onclick=async()=>{
          const {registro,numero}=lista[Number(button.dataset.precosPdf)],label=button.textContent;button.disabled=true;button.textContent='Preparando PDF…';erro('');
          try{await exportarPDF(registro,numero);}catch(e){erro(e.message);}finally{button.disabled=false;button.textContent=label;}
        });
      } catch(e){historico.innerHTML=`<p role="alert">${esc(e.message)}</p>`;}
      finally{btn.disabled=false;}
    };
    async function revisar(modo, btn) {
      erro('');
      if(temEdicao()){erro('Salve as edições de unidade antes de revisar o reajuste.');return;}
      if(STORE.filaGet().some(x=>['upsert','setCfg'].includes(x.action))){erro('Aguarde a sincronização das unidades e configurações.');return;}
      const dados={modo,percentual:modo==='regularizar'?legado*100:Number(el.querySelector('#precos-percentual').value),dataTabela:modo==='regularizar'?dataBr(hoje()):dataBr(el.querySelector('#precos-data').value)};
      btn.disabled=true;
      try {
        const r = await STORE.api('precosPrevia',dados);
        if(!el.isConnected)return;
        const p=r.previa || r;
        if(!p.token || !Array.isArray(p.itens))throw Error('Não foi possível carregar o comparativo. Tente novamente.');
        abrirPrevia(p,dados,btn);
      } catch(e){erro(e.message);}
      finally{btn.disabled=false;}
    }
    function abrirPrevia(p,dados,origem) {
      const dialog=document.createElement('dialog');dialog.className='precos-dialog';dialog.setAttribute('aria-labelledby','precos-dialog-titulo');
      const operacaoId=crypto.randomUUID();let enviando=false;
      dialog.innerHTML=`<header><div><span class="precos-kicker">Conferência antes de salvar</span><h2 id="precos-dialog-titulo">${esc(p.versaoAnterior)} → ${esc(p.versaoNova)}</h2><p>${esc(p.dataTabela)} · Reajuste de ${percentual(p.percentual)}</p></div><button class="btn-mini" data-fechar aria-label="Fechar conferência">✕</button></header><div class="precos-dialog-conteudo">${p.modo==='regularizar'?'<p class="precos-origem">Os 4% não serão aplicados novamente sobre o valor exibido. A nova versão consolida o percentual já salvo nas disponíveis. Os preços base das demais ficam preservados.</p>'.replace('4%',percentual(p.percentual)):'<p class="precos-origem">Confira os valores. Somente unidades disponíveis e com preço definido recebem o reajuste.</p>'}${resumo(p)}${comparativo(p)}</div><footer><p class="precos-dialog-erro" role="alert"></p><button class="btn-mini" data-fechar>Voltar</button><button class="btn-lime" data-confirmar>Confirmar e salvar ${esc(p.versaoNova)}</button></footer>`;
      const fechar=()=>{if(enviando)return;dialog.close();dialog.remove();origem.focus();};
      dialog.querySelectorAll('[data-fechar]').forEach(b=>b.onclick=fechar);
      dialog.addEventListener('cancel',e=>{e.preventDefault();fechar();});
      dialog.querySelector('[data-confirmar]').onclick=async event=>{
        const btn=event.currentTarget;enviando=true;dialog.querySelectorAll('button').forEach(b=>b.disabled=true);btn.textContent='Salvando na nuvem…';
        dialog.querySelector('.precos-dialog-erro').textContent='';
        try{
          await STORE.aplicarTabelaPrecos({...dados,token:p.token,operacaoId});
          dialog.close();dialog.remove();salvo();
        }catch(e){
          dialog.querySelector('.precos-dialog-erro').textContent=e.status===409?`${e.message} Volte e confira uma nova prévia.`:e.message;
          dialog.querySelectorAll('button').forEach(b=>b.disabled=false);
          btn.disabled=e.status===409;btn.textContent='Tentar salvar novamente';
        }finally{enviando=false;}
      };
      document.body.append(dialog);dialog.showModal();dialog.querySelector('[data-fechar]').focus();
    }
    const form=el.querySelector('form');
    if(form){form.addEventListener('input',marcarEdicao);form.onsubmit=e=>{e.preventDefault();revisar('reajustar',form.querySelector('button'));};}
    const regularizar=el.querySelector('#precos-regularizar');if(regularizar)regularizar.onclick=()=>revisar('regularizar',regularizar);
  }
  window.DiamondPrecos={mount,exportarPDF};
})();
