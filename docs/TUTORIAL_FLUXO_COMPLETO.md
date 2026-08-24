# Tutorial prático — um dia completo no ERP SHKT

Este roteiro usa pessoas, empresas e valores imaginários. Ele serve para treinar
a equipe sem misturar explicação técnica com a rotina de trabalho.

> Regra principal: rascunho pode ser corrigido. Documento confirmado não se
> apaga; ele é cancelado ou estornado, sempre com motivo.

## Quem participa

| Pessoa | Perfil | Responsabilidade |
|---|---|---|
| Marta | Administradora | Primeiro acesso, empresa, usuários e perfis |
| Ana | Compras e vendas | Pedidos, fumigação e certificados |
| Carlos | Estoque / Pátio | Recebimento, pesagem, carregamento e expedição |
| João | Transportes | Viagens, abastecimentos, despesas e comprovantes |
| Paula | Financeiro | Baixas, caixa, folha e obrigações |
| Suécio | Diretoria | Aprovações, panorama, margem e DRE |

## 1. Primeiro acesso

1. Marta entra com o usuário administrador e troca a senha provisória.
2. Conclui as quatro telas do assistente: empresa, endereço, armazém e produto
   principal.
3. Em **Sistema → Usuários e perfis**, cria um usuário para cada pessoa.
4. Confere o cartão **Primeiros passos** no Panorama. Ele se marca sozinho
   conforme os cadastros passam a existir.

Resultado: documentos com cabeçalho correto e cada ação ligada à pessoa que a
realizou.

## 2. SHKT Grãos compra, prepara e vende milho

### Cenário

- Fornecedor: Fazenda Boa Safra
- Produto: milho amarelo
- Compra: 100 t por R$ 120.000
- Venda: 40 t por R$ 60.000

### Passo 1 — compra

Ana abre **Compras → Novo pedido**, escolhe a operação SHKT, o fornecedor, 100 t
e o total de R$ 120.000. Salva e envia. Suécio aprova.

Resultado: pedido **APROVADO**, estoque ainda em 0 t e título de R$ 120.000 em
Contas a Pagar. Pedido não movimenta estoque.

### Passo 2 — recebimento

Carlos abre **Recebimentos → Novo recebimento**. Confirma primeiro um caminhão
de 60 t e depois outro de 40 t, sempre com placa, motorista, nota, peso bruto e
tara.

Resultado: pedido **RECEBIDO**, estoque físico de 100 t e saldo do pedido em 0 t.

### Passo 3 — fumigação

Ana abre **Armazém → Nova fumigação** e informa 80 t. Quando recebe o comunicado
`COM-2026-0457`, preenche o número e valida.

Resultado: estoque físico continua 100 t e saldo fumigado passa a 80 t. Sem o
comunicado, o sistema bloqueia a validação.

### Passo 4 — certificado

Ana abre **Armazém → Emitir certificado**, seleciona a fumigação, informa 50 t,
anexa o documento e valida.

Resultado: certificado **VALIDADO**, saldo fumigado restante de 30 t e custo da
fumigadora gerado em Contas a Pagar.

### Passo 5 — venda

Ana abre **Vendas → Novo pedido**, escolhe o cliente Exportadora Horizonte e
vende 40 t por R$ 60.000. Suécio aprova.

Resultado: físico 100 t, reservado 40 t, disponível 60 t e título de R$ 60.000
em Contas a Receber.

### Passo 6 — carregamento e expedição

Carlos abre o pedido e clica em **Criar carregamento**. Vincula certificado,
veículo e motorista. Programa, imprime o romaneio e confirma a expedição.

Resultado: físico 60 t, reservado 0 t, pedido **ATENDIDO** e carregamento
**EXPEDIDO**. A baixa física acontece somente na expedição.

### Passo 7 — dinheiro

Paula abre o Financeiro. Quando a empresa paga o fornecedor, baixa o título de
R$ 120.000; quando recebe do cliente, baixa os R$ 60.000. Em pagamentos
parciais, informa somente o que realmente entrou ou saiu.

Resultado: títulos quitados, caixa atualizado e trilha completa na auditoria.

### Passo 8 — caixa do dia

Paula abre **Financeiro → Caixa do dia**. Se ela já tinha aberto o turno,
encontra as duas baixas na linha do tempo; se não tinha, a primeira baixa na
conta física abriu o caixa automaticamente com saldo inicial zero.

Durante o dia, Paula faz uma sangria de R$ 10.000 para o cofre, sempre com
motivo. No fim do expediente, usa o **Contador de dinheiro**, confere cada meio
de pagamento e clica em **Fechar caixa**.

Resultado: o total do sistema fica comparado ao valor contado, qualquer sobra
ou falta fica explícita e o turno passa para **Caixas anteriores** sem poder ser
reescrito.

## 3. SHKT Transportes realiza uma viagem

### Cenário

- Motorista: João Pereira
- Rota: Cascavel → Foz do Iguaçu
- Frete: R$ 8.500
- Adiantamento: R$ 2.000
- Km inicial: 125.000

### Passo 1 — programação

João abre **Transportadora → Programar nova viagem**, escolhe cliente,
caminhão, rota, data e frete.

Resultado: viagem **PROGRAMADA** e R$ 8.500 em Contas a Receber.

### Passo 2 — adiantamento

Paula lança R$ 2.000 de adiantamento dentro da viagem. Esse valor é dinheiro
entregue ao motorista, não custo direto.

### Passo 3 — despesas reais

João lança 300 litros a R$ 5,50 (R$ 1.650), pedágio de R$ 280 e alimentação de
R$ 170. Cada despesa real recebe o comprovante.

Resultado: R$ 2.100 de despesas comprovadas.

### Passo 4 — retorno e prestação de contas

João informa km final 126.200. O sistema calcula 1.200 km e 4,00 km/l. Como
gastou R$ 2.100 e recebeu R$ 2.000, o acerto gera R$ 100 a reembolsar.

Resultado: viagem **CONCLUÍDA**, sem contar o adiantamento duas vezes.

### Passo 5 — margem

Suécio abre **Transportadora → Viagens e resultados**.

| Receita | Custo direto | Margem prevista |
|---:|---:|---:|
| R$ 8.500 | R$ 2.100 | R$ 6.400 |

## 4. Fechamento do mês

1. **RH:** Paula cria a competência, lança proventos e descontos e fecha. O
   sistema gera um título a pagar por funcionário.
2. **Obrigações:** lança impostos, licenças e guias com competência, vencimento
   e parcelas. Ao aprovar, as parcelas entram em Contas a Pagar.
3. **Diretoria:** Suécio abre o Panorama e a DRE, filtra o mês e confere SHKT e
   Transportes. Moedas estrangeiras aparecem na base BRL gravada no lançamento.
4. **Caixa:** Paula abre **Conferir meios de pagamento**, filtra o mês e exporta
   a movimentação para a conferência da diretoria ou do contador.

## 5. Checklist final

- Estoque físico, reservado e disponível batem com o pátio.
- Somente baixas de pagamento ou recebimento alteraram o caixa.
- Cada turno foi fechado e a diferença entre sistema e contagem foi explicada.
- Combustível e comprovantes aparecem na viagem.
- Adiantamento não entrou como custo direto.
- O Panorama não mostra documentos sem responsável ou títulos vencidos.
- Qualquer valor pode ser rastreado até a pessoa e o documento de origem.

No sistema, este mesmo treinamento fica em **Sistema → Tutorial do fluxo
completo**, com botões que levam diretamente às telas de prática.
