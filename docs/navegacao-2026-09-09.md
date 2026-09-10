# Navegação e organização — Diamond

Implementação de 09/09/2026, posterior à auditoria de funcionamento. Mantém a identidade preto e lima e o espelho de unidades.

## O que mudou

- O Histórico abre uma ficha da proposta original, inclusive SCP e unidades vendidas. Cliente, corretor, preço e condições vêm do registro salvo; consultar não salva nem recalcula a proposta. Os endereços antigos com `?p=` continuam abrindo o registro correto.
- A ficha reúne condições, atendimento, situação atual da unidade, cliente vinculado e PDF do envio. A prévia do PDF não registra abertura do cliente.
- Clientes têm uma consulta com próximo retorno, observações, propostas e envios relacionados. “Editar no CRM” abre o cadastro pelo identificador, já expandido.
- O histórico da unidade reúne suas propostas. Oferece nova proposta somente quando a unidade está disponível.
- Envios têm atalhos para cliente e proposta original. Referência adicional distingue números antigos repetidos; vínculos ausentes aparecem sinalizados.
- O CRM passa a contar “Clientes fechados”, com descrição correta da conversão. As associações de SCP e apartamentos no CRM usam identificadores explícitos ou vínculos já existentes nos envios, sem juntar homônimos pelo nome. Novos envios comuns e SCP também preservam o identificador do cliente na proposta.
- O resumo separa SCP de outros planos parcelados.
- A entrada “Painel” passa a “Gestão comercial”; “Clientes” identifica a carteira.
- Filtros do CRM são preservados ao retornar, novas telas abrem no topo e atalhos avisam antes de sair com edição pendente.
- Marca, unidades, cabeçalhos de clientes e grupos de propostas usam links/botões acionáveis por teclado. Foco visível, ações mais claras, fichas em duas colunas no desktop e uma no celular, principais ações com área de toque de 44 px em tela estreita. A Domo não recebe seu próprio botão flutuante de contato.

## Verificações

33 testes automatizados aprovados, incluindo as 26 regressões anteriores e sete verificações de consulta, vínculos, indicadores, rotas e permissões. Sintaxe dos 15 arquivos JavaScript conferida.

No navegador local com registros fictícios: Histórico → proposta SCP de unidade vendida → cliente → cadastro correto; filtros preservados ao voltar; envios com e sem vínculo. Fichas de proposta, cliente e CRM sem transbordamento a 375 px de largura útil; envios sem transbordamento da página a 390 px. Principais botões da ficha medidos em 44 px. Sem erros de JavaScript observados nessa sessão.

As funções publicadas para o pacote de funcionamento são `dmd-api` v46 e `dmd-p` v45. O frontend utiliza cache `diamond-pages-v16`; sua publicação e validação online são acompanhadas na entrega ao usuário.

## Dados preservados e trabalho separado

Não houve exclusão, associação automática ou renumeração de registros antigos. A reconciliação dos 8 envios sem proposta e dos 3 sem cliente, e a numeração atômica de novos envios, permanecem separadas. A referência visual adicional não resolve a geração concorrente de números. Registros de aparência experimental não foram excluídos ou reclassificados.

Esta etapa também não implementa consultas em lote do banco, altera projeções financeiras, nem cria novas regras para confirmar reservas/vendas. Edição no simulador continua disponível ao administrador para modalidades comuns; consulta de SCP usa seus próprios campos salvos.
