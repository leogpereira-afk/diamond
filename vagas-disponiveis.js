(function(){
 async function gerar(vagas,opts={}){
  if(!Array.isArray(vagas))throw Error('Lista de vagas inválida.');
  const {jsPDF}=window.jspdf,doc=new jsPDF({orientation:'landscape',unit:'mm',format:'a4'}),W=297,H=210,M=16;
  let logo=null;try{logo=await new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=reject;im.src='logo-diamond.png';});}catch{throw Error('Não foi possível carregar a marca. Tente novamente conectado.');}
  const groups=new Map();vagas.slice().sort((a,b)=>a.codigo.localeCompare(b.codigo,'pt-BR',{numeric:true})).forEach(v=>{const key=v.pavimento||'Pavimento não informado';if(!groups.has(key))groups.set(key,[]);groups.get(key).push(v.codigo);});
  let y=53,page=0;const generated=opts.em||new Date();
  function header(){page++;doc.setFillColor(0,0,0);doc.rect(0,0,W,34,'F');doc.addImage(logo,'PNG',M,11,65,logo.height/logo.width*65);doc.setTextColor(234,255,54);doc.setFont('helvetica','bold');doc.setFontSize(18);doc.text('Vagas disponíveis',W-M,18,{align:'right'});doc.setFontSize(9);doc.setTextColor(255,255,255);doc.text(vagas.length+' vagas livres · consulta em '+generated.toLocaleString('pt-BR'),W-M,26,{align:'right'});doc.setTextColor(70,70,70);doc.setFont('helvetica','normal');doc.setFontSize(9);doc.text('Disponibilidade sujeita à confirmação. Este documento não efetua uma reserva.',M,H-12);doc.text(String(page),W-M,H-12,{align:'right'});y=48;}
  header();
  if(!vagas.length){doc.setFontSize(16);doc.text('Nenhuma vaga disponível nesta consulta.',M,y);}
  for(const [floor,codes] of groups){
    if(y>H-50){doc.addPage();header();}
    doc.setFillColor(236,240,209);doc.roundedRect(M,y-7,W-2*M,12,2,2,'F');doc.setTextColor(20,20,20);doc.setFont('helvetica','bold');doc.setFontSize(12);doc.text(floor+' · '+codes.length+(codes.length===1?' vaga':' vagas'),M+4,y+1);y+=14;
    for(let i=0;i<codes.length;i+=8){if(y>H-34){doc.addPage();header();doc.setFontSize(11);doc.text(floor+' (continuação)',M,y);y+=10;}codes.slice(i,i+8).forEach((code,j)=>{const x=M+j*33;doc.setDrawColor(215,215,205);doc.roundedRect(x,y,30,12,2,2);doc.setFontSize(11);doc.text(code,x+15,y+8,{align:'center'});});y+=16;}y+=9;
  }
  if(opts.retornar)return doc;
  doc.save('Diamond-vagas-disponiveis-'+generated.toISOString().slice(0,10)+'.pdf');return doc;
 }
 async function baixar(btn){const label=btn.textContent;btn.disabled=true;btn.textContent='Consultando vagas…';try{const r=await STORE.api('vagas',{operacao:'paraProposta'});if(r.erro||!Array.isArray(r.vagas))throw Error(r.erro||'Não foi possível conferir as vagas.');await gerar(r.vagas);}catch(e){window.alert(e.message);}finally{btn.disabled=false;btn.textContent=label;}}
 window.DiamondVagasDisponiveis={gerar,baixar};
})();
