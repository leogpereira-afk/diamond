# Plantas nas propostas

## Falha reproduzida

A leitura da foto local acontecia fora do tratamento de erro. Uma falha do IndexedDB impedia a consulta da imagem no servidor. Se o download funcionasse mas a gravação no cache falhasse, a foto também era descartada. Os três geradores de proposta capturavam essas falhas silenciosamente e devolviam um PDF sem planta.

Esses caminhos foram reproduzidos em testes controlados. Isso não identifica, por si só, qual falha ocorreu em um PDF antigo sem acesso ao arquivo e ao navegador que o gerou.

## Correção

- Cache local opcional para leitura: falhas de leitura ou gravação não descartam a foto do servidor.
- A consulta getFoto passa a ser classificada como leitura.
- Validação de formato/dados e nova tentativa sem cache quando a planta não carrega ou não pode ser decodificada.
- Proposta completa, simples e SCP exigem a planta antes de liberar o documento. Ausência de cadastro e falha de carregamento exibem orientações distintas.
- O botão de PDF da unidade mostra o erro e volta a ficar disponível.
- Propostas simples/SCP abrem outra página se faltar espaço para a planta.
- Cache de arquivos da interface atualizado para v41.

## Verificação local

292 testes automatizados aprovados, incluindo regressões de cache indisponível, quota, imagem inválida, recuperação, os três modelos e paginação. Teste no navegador com imagens existentes, cliente/valores fictícios e API local simulada: imagem incorporada, recuperação após erro temporário e bloqueio do documento após falha persistente. Páginas renderizadas e conferidas visualmente. Nenhuma proposta real ou mensagem foi criada/enviada.

Comando: `node --test tests/*.test.mjs verificar-copias.cjs verificar-versoes.cjs tests-vagas.cjs`.

## Publicação

Somente interface: app.js, store.js, index.html e sw.js. Não requer migração ou alteração na função do servidor. Após publicar, conferir o deploy e a correspondência dos quatro arquivos na URL pública.
