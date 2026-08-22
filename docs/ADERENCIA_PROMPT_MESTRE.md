# Aderência ao Prompt Mestre ERP SHKT

Esta matriz liga os requisitos do documento mestre à implementação. A regra
transversal é a mesma em todos os módulos: a informação nasce uma vez, a
integração acontece na mesma transação, permissões são verificadas no servidor,
ações críticas são auditadas e cancelamentos preservam o histórico.

| Área do Prompt Mestre | Implementação final |
|---|---|
| Segurança e acesso | Login, sessão no PostgreSQL, troca obrigatória de senha, RBAC por módulo/ação, perfis Admin, Diretoria, Financeiro, Compras, Estoque, Vendas, RH, Transportes, Fumigação e Consulta. |
| Auditoria | Log imutável com usuário, data/hora, módulo, documento, antes/depois, IP e sessão. |
| Numeração | Sequência anual concorrente e transacional para todos os documentos. |
| Cadastros | Parceiros com múltiplos papéis, produtos, unidades, moedas, países, locais, lotes, funcionários, veículos, motoristas e tabelas de apoio. |
| Compras e recebimento | Pedido, aprovação, previsão financeira, recebimento parcial, pesagem, divergência e entrada física no estoque. |
| Estoque | Saldo físico/reservado/disponível/fumigado/expedido por produto, local e lote; ajuste, transferência e estorno. |
| Fumigação | Fluxo com Comunicado obrigatório, conta-corrente fumigada e validações no banco. |
| Certificados | Consumo do saldo fumigado, custo por tonelada, validação e Contas a Pagar único. |
| Vendas | Pedido, reserva, aprovação, atendimento parcial e Contas a Receber. |
| Carregamento/exportação | Programação, expedição, baixa de estoque, documentos e impressão/PDF. |
| Financeiro | CP/CR, baixas parciais, estornos, contas, transferências, conciliação e vínculo navegável à origem. |
| Moedas e DRE | Taxa para BRL gravada no título, valor-base calculado e DRE sem mistura de BRL/USD/PEN. |
| RH e folha | Competência, detalhe por funcionário, proventos/descontos/líquido, provisões e um CP por funcionário no fechamento. |
| Combustível | Abastecimento por viagem/veículo/motorista, litros, preço, quilometragem, CP e consumo km/l. |
| Viagens | Frete, rota, veículo, motorista, custos diretos, margem e ciclo de programação a conclusão. |
| Prestação de contas | Adiantamentos separados dos comprovantes; saldo a devolver/reembolsar e fechamento financeiro. |
| Manutenção | Ordem preventiva/corretiva, peças, serviços, mão de obra, oficina, histórico e CP. |
| Impostos e obrigações | Tipos parametrizados, natureza, competência, parcelas, vencimento, documentos e CP na aprovação. |
| Painel | Ações do dia, panorama por operação e alertas de estoque, financeiro, comercial, frota, folha e obrigações. |
| Relatórios | DRE, estoque, compras, vendas, fumigação, certificados, carregamentos, financeiro, caixa, combustível, viagens, manutenção, RH e obrigações. |
| Documentos | Impressão/PDF pelo navegador, CSV para Excel e anexos privados por documento. |
| Importação | Modelos XLSX, leitura XLSX/CSV, prévia persistida, erros por linha, confirmação e prevenção de duplicidade por conteúdo/cadastro. |
| Backup e operação | Backup diário em Docker, retenção, verificação e roteiro de restauração. |
| Usabilidade | Onboarding, checklist, linguagem direta, próximos passos, botões grandes, responsividade, PWA, tema, letras grandes e alto contraste. |

## Decisões contábeis importantes

- A cotação é informada no lançamento e o valor-base em BRL fica calculado no
  banco; uma mudança de cotação futura não reescreve o histórico.
- Adiantamento de motorista não entra como custo direto da viagem. Os
  comprovantes formam a despesa e o acerto gera apenas o saldo final.
- Rascunhos não movimentam estoque nem criam financeiro. A integração só ocorre
  na aprovação, validação, expedição ou fechamento correspondente.

## Segurança no Supabase

O ERP usa conexão PostgreSQL exclusivamente no servidor Express. As 59 tabelas
públicas estão com RLS habilitado (além de 11 views) e a Data API não recebe políticas de
acesso; permissões `anon` e `authenticated` permanecem revogadas. O RBAC da
aplicação continua sendo aplicado no back-end.
