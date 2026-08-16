# Roadmap — ERP SHKT

Ordem de implantação conforme a seção 32 do documento de requisitos: cada fase
só começa depois da anterior estar estável em uso real.

---

## ✅ FASE 1 — Núcleo operacional crítico (concluída)

**Cadastros → Estoque → Fumigação → Certificado → Carregamento → Financeiro**

Entregue e testado ponta a ponta, incluindo o roteiro de aceite da seção 32
(600 t em estoque → fumigação de 500 t → certificado de 100 t → saldo de 400 t →
Contas a Pagar automático → carregamento → expedição → auditoria).

Também incluídos, por serem base para tudo: autenticação, perfis e permissões,
auditoria imutável, numeração documental anual, documentos para impressão,
relatórios, DRE gerencial, painel, backup verificado e rotina de restauração.

---

## ✅ FASE 2 — Compras, recebimento e vendas (concluída)

Ciclo comercial fechado. A regra que atravessa tudo:
**o pedido não move estoque** — quem move é o recebimento (entrada) e o
carregamento (saída).

**Compras**
- Pedido numerado (mercadoria, frete ou serviço), com Incoterm, moeda,
  condição de pagamento, prazo e previsão de entrega
- Fluxo: Rascunho → Aguardando aprovação → Aprovado → Parcialmente recebido →
  Recebido → Cancelado
- Pedido aprovado gera a previsão em Contas a Pagar
- Itens de pedido aprovado ficam **imutáveis no banco**: preço, quantidade e
  produto não podem ser reescritos nem por SQL direto
- Cancelar o pedido cancela o título previsto, e é recusado se já houver
  recebimento confirmado

**Recebimento**
- Entrada física com pesagem (bruto/tara/líquido), veículo, motorista,
  transportadora e documento fiscal
- Recebimento parcial com saldo em aberto: 500 t pedidas, 320 t recebidas,
  180 t ainda a chegar — a situação do pedido é recalculada pelo banco
- Divergência entre previsto e recebido preenchida automaticamente
- Confirmar dá a entrada no estoque; cancelar estorna e devolve o saldo ao
  pedido, sem apagar nada do histórico

**Vendas**
- Pedido de venda com itens por produto e local de saída
- Aprovar **reserva** o estoque (o físico não muda) e gera Contas a Receber
- Venda acima do disponível é recusada na aprovação, inteira
- Carregamento vinculado ao pedido **não reserva de novo**: consome o saldo do
  pedido na expedição. Sem isso o mesmo grão apareceria comprometido duas
  vezes e travaria vendas possíveis
- Cancelar o carregamento expedido devolve estoque, saldo e reserva; cancelar
  o pedido libera a reserva e cancela o título

Coberto por 16 testes automatizados de aceite, além dos 27 da Fase 1.

---

## FASE 3 — RH, frota e obrigações

**RH / Folha**
- Detalhamento mensal por funcionário: salário-base, horas extras,
  bonificações, comissões, vales, descontos e encargos parametrizados
- Ao fechar a competência, gera um título por funcionário no Contas a Pagar
  com o **líquido a pagar** — o detalhe fica no RH
- Provisões de 13º, férias, rescisão e encargos

**Abastecimento**
- Autorização de abastecimento numerada, com veículo, motorista, combustível,
  quilometragem e centro de custo
- Relatórios de consumo por veículo, motorista, período e viagem, com km/l

**Despesas de viagem**
- Adiantamento, gastos por categoria, comprovantes e prestação de contas
- Saldo a devolver ou reembolsar
- Margem da operação: receita − custos diretos da viagem

**Manutenção**
- Ordem de serviço com peças, serviços, mão de obra e oficina
- Histórico por veículo; despesas aprovadas vão para o Contas a Pagar

**Impostos e obrigações**
- Estrutura parametrizável de impostos, parcelamentos e vencimentos
  (sem regra tributária fixa no código)

---

## FASE 4 — Gestão avançada

- DRE com rateio por operação e comparativo entre períodos
- Painéis por área (comercial, operação, frota)
- Indicadores: custo por tonelada exportada, margem por cliente e por destino,
  giro de estoque, prazo médio de recebimento
- Importação assistida das planilhas históricas: modelo, validação,
  pré-visualização, relatório de erros e prevenção de duplicidade
- Anexos digitalizados nos documentos (comprovantes, certificados, NF-e)

---

## Melhorias avulsas mapeadas

Fora das fases, valem quando houver necessidade real:

- Cotação de moeda por data para operações em USD/PEN
- Notificação por e-mail de títulos a vencer e certificados pendentes
- Autenticação em duas etapas para os perfis Financeiro e Administrador
- Registro fotográfico do carregamento pelo celular
