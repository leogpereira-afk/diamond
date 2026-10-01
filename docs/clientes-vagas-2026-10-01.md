# Cliente e vaga na tabela de vendas

Em Unidades e vendas, cada linha oferece incluir ou editar os dados do cliente, selecionar um cadastro existente e abrir sua ficha. Nome, telefone, e-mail, tipo de pessoa, CPF/CNPJ opcional, endereço e observações ficam no cadastro compartilhado. A associação não altera status, preço, responsável comercial nem prazo da reserva.

A coluna Vaga vinculada consulta o módulo de garagem, mostra código e pavimento e abre a vaga escolhida. Vínculos em conflito recebem indicação para conferência. Nomes iguais não vinculam pessoas automaticamente.

## Verificação

- 136 testes automatizados aprovados.
- Navegador: criar, editar, reabrir dados, escolher cliente existente, consultar ficha e abrir V18 pela tabela.
- Tela de 390 px: formulário sem transbordamento horizontal e ações de salvar/cancelar acessíveis.
- Transação SQL com dados fictícios e rollback: gravação conjunta, atualização de outras unidades do mesmo cliente, preservação de prazo, rejeição de edição desatualizada e execução restrita ao serviço.
- Nenhum cadastro real alterado nos testes.
