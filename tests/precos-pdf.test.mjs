import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {source,copy} from './helpers.mjs';
const require=createRequire(import.meta.url),{jsPDF}=require('../vendor/jspdf.umd.min.js');
function setup(){
 const docs=[];const logo=fs.readFileSync(new URL('../logo-diamond.png',import.meta.url));
 function Document(options){const doc=new jsPDF(options),text=doc.text.bind(doc);doc.texts=[];doc.textsByPage={};doc.text=(s,...rest)=>{const value=Array.isArray(s)?s.join('\n'):String(s),page=doc.internal.getCurrentPageInfo().pageNumber;doc.texts.push(value);(doc.textsByPage[page]??=[]).push(value);return text(s,...rest)};doc.save=name=>{doc.savedName=name;return doc};docs.push(doc);return doc;}
 const ctx=vm.createContext({window:{},document:{baseURI:'https://diamond.example/'},jspdf:{jsPDF:Document},Date,URL,Uint8Array,fetch:async url=>{assert.equal(String(url),'https://diamond.example/logo-diamond.png');return{ok:true,arrayBuffer:async()=>logo.buffer.slice(logo.byteOffset,logo.byteOffset+logo.byteLength)}}});
 const code=source('precos.js'),cut=code.lastIndexOf('})();');vm.runInContext(code.slice(0,cut)+';globalThis.historyTools={numerar:typeof numerarHistorico===\'function\'?numerarHistorico:null};'+code.slice(cut),ctx);return{ctx,docs};
}
const record=(overrides={})=>({id:'registro-1',modo:'reajustar',versaoAnterior:'v1',versaoNova:'v2',dataTabela:'05/10/2026',criadoEm:'2026-10-05T17:23:00Z',por:'Direção',percentual:4,itens:Array.from({length:83},(_,i)=>({id:`u-${401+i}`,unidade:String(401+i),status:i<60?'Disponível':i<76?'Vendido':'Reservado',anterior:300000+i*100,novo:i<60?(300000+i*100)*1.04:300000+i*100,exibidoAntes:300000+i*100,alterada:i<60,corrigida:false})),...overrides});

test('histórico recebe numeração cronológica sem modificar registros salvos',()=>{
 const {ctx}=setup(),a=record(),b=record({id:'registro-2',versaoAnterior:'v2',versaoNova:'v3',criadoEm:'2026-10-06T17:00:00Z'}),saved=[b,a],before=copy(saved);
 assert.equal(typeof ctx.historyTools.numerar,'function','O histórico precisa numerar os registros para cada PDF');
 const numbered=ctx.historyTools.numerar(saved);assert.deepEqual(Array.from(numbered,x=>[x.registro.id,x.numero]),[['registro-1',1],['registro-2',2]]);assert.deepEqual(saved,before);
});

test('PDF usa snapshot completo com 83 unidades, data registrada e paginação em paisagem',async()=>{
 const{ctx,docs}=setup(),saved=record(),before=copy(saved);assert.equal(typeof ctx.window.DiamondPrecos.exportarPDF,'function','Deve existir exportação do registro salvo');await ctx.window.DiamondPrecos.exportarPDF(saved,1);
 const doc=docs[0],texts=doc.texts.join('\n');assert.equal(doc.savedName,'Diamond-1a-atualizacao-v2-05-10-2026.pdf');assert.ok(doc.internal.pageSize.getWidth()>doc.internal.pageSize.getHeight());assert.ok(doc.getNumberOfPages()>1);assert.match(texts,/1ª atualização/);assert.match(texts,/05\/10\/2026/);assert.match(texts,/14:23/);assert.match(texts,/Direção/);
 for(let n=401;n<=483;n++)assert.ok(doc.texts.includes(String(n)),`Unidade ${n} ausente do PDF`);
 for(let page=1;page<=doc.getNumberOfPages();page++){const pageTexts=doc.textsByPage[page].join('\n');assert.match(pageTexts,/1ª atualização/,`Numeração ausente na página ${page}`);assert.match(pageTexts,/Data da tabela: 05\/10\/2026/,`Data ausente na página ${page}`);assert.match(pageTexts,new RegExp('Página '+page+' de '+doc.getNumberOfPages()));assert.match(doc.internal.pages[page].join('\n'),/\/I\d+ Do/,`Logo ausente na página ${page}`);}
 assert.match(texts,/Disponível/);assert.match(texts,/Vendido/);assert.match(texts,/Reservado/);assert.match(texts,new RegExp('Página '+doc.getNumberOfPages()+' de '+doc.getNumberOfPages()));assert.deepEqual(saved,before);
});

test('regularização distingue reconstrução e mostra valor exibido antes sem inventar aplicação original',async()=>{
 const{ctx,docs}=setup(),saved=record({modo:'regularizar',origem:'regularizacao_legado',observacao:'Comparação reconstruída. A data do registro é a regularização.'});saved.itens[60].corrigida=true;saved.itens[60].exibidoAntes=318240;
 assert.equal(typeof ctx.window.DiamondPrecos.exportarPDF,'function');await ctx.window.DiamondPrecos.exportarPDF(saved,1);const text=docs[0].texts.join('\n');assert.match(text,/reconstruída/i);assert.match(text,/não comprova/i);assert.match(text,/Exibido antes/);assert.match(text,/318\.240,00/);assert.match(text,/Exibição corrigida/);
});

test('registro sem data não recebe data atual no nome nem no relatório',async()=>{
 const{ctx,docs}=setup();assert.equal(typeof ctx.window.DiamondPrecos.exportarPDF,'function');await ctx.window.DiamondPrecos.exportarPDF(record({dataTabela:'',criadoEm:''}),2);assert.equal(docs[0].savedName,'Diamond-2a-atualizacao-v2-sem-data.pdf');assert.match(docs[0].texts.join('\n'),/Data não informada/);assert.match(docs[0].texts.join('\n'),/Registro sem data informada/);
});
