# Conexão Diamond / Vagas Estacionamento

Projeto vinculado à planilha oficial. O identificador autorizado fica na configuração privada do servidor.

1. Código e manifesto desta pasta no Apps Script da planilha oficial.
2. `verificarConexao` identifica o OAuth audience, sem imprimir tokens ou alterar dados.
3. Backend `dmd-sheets` aceita apenas JWT Google assinado, audience e e-mail configurados em `dmd_kv / integracoes_privadas / sheets_diamond`.
4. `sincronizarDiamond` confere uma vez; `ativarSincronizacao` instala um único acionador a cada minuto após uma execução bem-sucedida.

A sincronização é eventual (um minuto, sujeita às cotas do Google). Só são alteradas células dos vínculos, compradores, situação, contrato, datas e observações. Fórmulas e formatação geral ficam preservadas. Mudanças incompatíveis e transferências de vínculos exigem conferência. As vendas dos apartamentos são independentes das vagas; esta integração não altera seus preços ou status.

Operações usam a revisão atômica existente. Uma saída para a planilha fica pendente até a leitura de confirmação. Durante esse período, o editor recusa mudanças concorrentes. Em falha parcial, a próxima execução aceita valores já aplicados e conclui as células restantes. Edições concorrentes diferentes suspendem a operação para conferência.

Backup anterior à ativação: `dmd_kv / auditoria_vagas / antes-sync-google-20260919` (privado). Para interromper, remova o acionador no Apps Script; não exclua o histórico. Para revogar a conexão, remova a configuração privada de audience. Não exponha tokens, service-role ou os registros de auditoria no front-end.
