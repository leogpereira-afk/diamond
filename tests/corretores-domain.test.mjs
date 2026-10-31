import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const file = new URL('../corretores-domain.js', import.meta.url);
function domain() {
  assert.ok(fs.existsSync(file), 'O catálogo de corretores deve resolver as grafias históricas');
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), context);
  return context.window.DiamondCorretores;
}
const users = () => [
  { usuario: 'domo', nome: 'Domo', papel: 'corretor', corretores: [{ nome: 'Leonardo' }, { nome: 'José da Silva' }] },
  { usuario: 'parque', nome: 'Parque Imóveis', papel: 'corretor', corretores: [{ nome: 'Leonardo' }] },
];

test('vendas com Leonardo/leonardo têm uma opção canônica sem regravar o histórico', () => {
  const input = { usuarios: users(), propostas: [{ corretor: 'leonardo', corretorEmpresa: 'DOMO', corretorUsuario: 'domo' }], leads: [{ corretorNome: ' LEONARDO ', empresaNome: 'Domo', empresaUsuario: 'domo' }], unidades: [{ vendedorNome: 'leonardo', vendedorEmpresa: 'domo' }] };
  const before = structuredClone(input);
  const c = domain().catalogo(input);
  const rows = c.lista.filter(v => v.empresaUsuario === 'domo' && v.nome === 'Leonardo');
  assert.equal(rows.length, 1);
  assert.equal(c.resolver(' LEONARDO ', 'domo').nome, 'Leonardo');
  assert.equal(c.resolver('leonardo', 'DOMO').cadastrado, true);
  assert.equal(c.chave('Leonardo', 'Domo'), c.chave('leonardo', 'DOMO'));
  assert.deepEqual(input, before);
});

test('acentos, caixa e espaços não separam o mesmo corretor', () => {
  const c = domain().catalogo({ usuarios: users(), unidades: [{ vendedorNome: '  JOSE   DA SILVA ', vendedorEmpresa: 'domo' }] });
  assert.equal(c.resolver('jose  da silva', 'DOMO').nome, 'José da Silva');
  assert.equal(c.lista.filter(v => v.empresaUsuario === 'domo').length, 2);
});

test('homônimos de empresas distintas continuam com opções e identidades distintas', () => {
  const c = domain().catalogo({ usuarios: users() });
  assert.equal(c.lista.filter(v => v.nome === 'Leonardo').length, 2);
  assert.notEqual(c.chave('Leonardo', 'Domo'), c.chave('Leonardo', 'Parque Imóveis'));
  assert.equal(c.resolver('leonardo', 'parque imoveis').empresaUsuario, 'parque');
});

test('empresas com mesmo nome continuam distintas pelo login e histórico ambíguo não é atribuído', () => {
  const c = domain().catalogo({ usuarios: [
    { usuario: 'a', nome: 'Rede', papel: 'corretor', corretores: [{ nome: 'Ana' }] },
    { usuario: 'b', nome: 'Rede', papel: 'corretor', corretores: [{ nome: 'Ana' }] },
  ], propostas: [{ corretor: 'ana', corretorEmpresa: 'Rede' }] });
  assert.equal(c.lista.length, 3);
  assert.notEqual(c.chave('Ana', 'Rede', 'a'), c.chave('Ana', 'Rede', 'b'));
  assert.equal(c.resolver('ana', 'Rede').cadastrado, false);
});

test('nomes antigos usam aliases cadastrados somente dentro da mesma empresa', () => {
  const usuarios = users(); usuarios[0].corretorAliases = { 'Leo antigo': 'Leonardo' };
  const c = domain().catalogo({ usuarios, propostas: [{ corretor: 'Leo antigo', corretorEmpresa: 'Domo' }] });
  assert.equal(c.resolver('leo antigo', 'Domo').nome, 'Leonardo');
  assert.notEqual(c.chave('leo antigo', 'Parque Imóveis'), c.chave('Leonardo', 'Domo'));
  assert.equal(c.lista.length, 3);
});

test('sem cadastro preserva grafia legível e não depende da ordem dos históricos', () => {
  for (const nomes of [['leonardo', 'Leonardo'], ['Leonardo', 'leonardo']]) {
    const c = domain().catalogo({ propostas: nomes.map(corretor => ({ corretor, corretorEmpresa: 'Domo' })) });
    assert.equal(c.lista.length, 1);
    assert.equal(c.lista[0].nome, 'Leonardo');
    assert.equal(c.lista[0].cadastrado, false);
  }
});

test('empresa vazia só é tratada como Domo quando o chamador declara esse padrão', () => {
  const base = { usuarios: users(), unidades: [{ vendedorNome: 'leonardo', vendedorEmpresa: '' }] };
  const explicit = domain().catalogo({ ...base, empresaPadrao: 'Domo' });
  const unspecified = domain().catalogo(base);
  assert.equal(explicit.resolver('leonardo', '').empresa, 'Domo');
  assert.equal(explicit.lista.length, 3);
  assert.equal(unspecified.resolver('leonardo', '').empresa, '');
  assert.equal(unspecified.lista.length, 4);
});

test('nome ausente não cria vendedor e contas de clientes/admin não entram no catálogo', () => {
  const c = domain().catalogo({ usuarios: [
    ...users(), { usuario: 'admin', papel: 'admin', nome: 'Admin', corretores: [{ nome: 'Administrador' }] },
    { usuario: 'cliente', papel: 'cliente', nome: 'Cliente', corretores: [{ nome: 'Comprador' }] },
  ], unidades: [{ vendedorNome: '', vendedorEmpresa: 'Domo' }], reservas: [{ corretor: 'Pessoa reservante', empresa: 'Domo' }] });
  assert.equal(c.lista.length, 4);
  assert.equal(c.resolver('', 'Domo'), null);
  assert.equal(c.chave('', 'Domo'), '');
  assert.ok(c.lista.some(v => v.nome === 'Pessoa reservante'));
});

test('autoria administrativa antiga sem empresa usa Domo só quando esse padrão é declarado', () => {
  const usuarios = [...users(), { usuario: 'admin-antigo', papel: 'admin', nome: 'leonardo' }];
  const propostas = [{ corretor: 'leonardo', corretorUsuario: 'admin-antigo', corretorEmpresa: '' }];
  const c = domain().catalogo({ usuarios, propostas, empresaPadrao: 'Domo' });
  assert.equal(c.lista.length, 3);
  assert.equal(c.resolver('leonardo', '', 'admin-antigo').nome, 'Leonardo');
  assert.equal(c.resolver('leonardo', '', 'admin-antigo').empresaUsuario, 'domo');
  const separado = domain().catalogo({ usuarios, propostas });
  assert.equal(separado.lista.length, 4);
});

test('pedido de reserva usa empresaUsuario para distinguir empresas homônimas', () => {
  const c = domain().catalogo({ usuarios: [
    { usuario: 'a', nome: 'Rede', papel: 'corretor', corretores: [{ nome: 'Ana' }] },
    { usuario: 'b', nome: 'Rede', papel: 'corretor', corretores: [{ nome: 'Ana' }] },
  ], reservas: [{ corretor: 'ana', empresa: 'Rede', empresaUsuario: 'b' }] });
  assert.equal(c.lista.length, 2);
  assert.equal(c.resolver('ana', 'Rede', 'b').nome, 'Ana');
});

test('login antigo de empresa resolve cadastro atual sem alterar documentos históricos', () => {
  const usuarios = users(); usuarios[0].loginsAntigos = ['domo-anterior'];
  const propostas = [{ corretor: 'leonardo', corretorEmpresa: 'Empresa antiga', corretorUsuario: 'domo-anterior' }];
  const c = domain().catalogo({ usuarios, propostas });
  assert.equal(c.lista.length, 3);
  assert.equal(c.resolver('leonardo', 'Empresa antiga', 'domo-anterior').empresaUsuario, 'domo');
  assert.equal(propostas[0].corretorUsuario, 'domo-anterior');
});
