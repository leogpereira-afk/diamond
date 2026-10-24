import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {source} from './helpers.mjs';
function setup({admin=false,status='Reservado'}={}){
 const screen={innerHTML:'VALOR R$ 330.000'},dialog={closed:false,close(){this.closed=true;}};
 let refresh;const sync=[];const unit={id:'u-1',status};
 const document={activeElement:{tagName:'INPUT'},querySelector:s=>s==='#app'?screen:null,querySelectorAll:s=>s==='dialog[open]'?[dialog]:[]};
 const STORE={isAdmin:()=>admin,unidadePorId:()=>unit,on:(name,fn)=>{if(name==='sync')sync.push(fn);},iniciar:fn=>{refresh=fn;}};
 const c=vm.createContext({window:{},document,STORE,location:{hash:'#/sim/u-1'},Date,Math});
 const code=source('app.js'),cut=code.lastIndexOf("  window.addEventListener('hashchange'");
 vm.runInContext(code.slice(0,cut)+`;globalThis.check=typeof bloquearSimuladorIndisponivel==='function'?bloquearSimuladorIndisponivel:null;globalThis.seed=()=>{_sujo=true;_uniDraft['u-1']={cliente:'Teste'};};globalThis.state=()=>({sujo:_sujo,draft:_uniDraft['u-1']});})();`,c);
 const start=code.indexOf('  STORE.iniciar(() => {'),end=code.indexOf('\n  render();',start);
 c.bloquearSimuladorIndisponivel=c.check;c._sujo=true;c._painelEquipe=false;c.$=()=>null;c.render=()=>{throw Error('Should not render while editing');};
 vm.runInContext(code.slice(start,end),c);
 return{c,screen,dialog,refresh};
}
test('reserva remove valor e rascunho mesmo durante edição e com diálogo aberto',()=>{
 const t=setup();assert.equal(typeof t.c.check,'function');t.c.seed();t.refresh();assert.match(t.screen.innerHTML,/Unidade indisponível/);assert.doesNotMatch(t.screen.innerHTML,/330.000/);assert.equal(t.c.state().sujo,false);assert.equal(t.c.state().draft,undefined);assert.equal(t.dialog.closed,true);
});
test('venda também bloqueia; disponibilidade e administrador preservam edição',()=>{
 for(const options of [{status:'Vendido'},{status:'Disponível'},{admin:true}]){const t=setup(options);assert.equal(typeof t.c.check,'function');t.c.seed();const blocked=t.c.check();assert.equal(blocked,options.status==='Vendido');if(!blocked)assert.match(t.screen.innerHTML,/330.000/);}
});
