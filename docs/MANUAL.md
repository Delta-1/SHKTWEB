# Manual do ERP SHKT

Como usar o sistema no dia a dia. Escrito para quem opera, não para quem
programa. Se você só tem cinco minutos, leia o capítulo 1 e o capítulo 3 —
o resto é consulta.

---

## 1. O sistema em uma frase

**O SHKT existe para responder, a qualquer hora, quanto entrou e quanto saiu
de cada uma das duas operações do grupo.**

Duas operações, sempre separadas:

| Operação | O que ela faz |
|---|---|
| **SHKT** | Grão: compra, armazena, fumiga, certifica e exporta |
| **SHKT Transportes** | Frete e logística |

E duas leituras, que o sistema **nunca soma uma na outra**:

- **Mercadoria** — quilos que entraram e saíram do armazém.
- **Dinheiro** — o que passou pelo caixa de verdade.

Isso importa mais do que parece. Um pedido de compra de 500 t **não é**
mercadoria que entrou: é uma promessa. Um título de R$ 300.000 em aberto
**não é** dinheiro que saiu: é um compromisso. O sistema é rígido nisso de
propósito, porque é exatamente aí que a conta de cabeça erra.

---

## 2. Primeiro acesso — uma vez só

1. Abra o endereço do sistema e entre com o usuário administrador.
2. O sistema pede **troca de senha** logo de cara. Troque. A senha inicial é
   de fábrica e todo mundo que leu a documentação a conhece.
3. Aparece o **assistente de primeiro acesso**, quatro telas:
   - **Boas-vindas** — o que o sistema faz.
   - **Dados da empresa** — razão social, CNPJ, endereço. Isso sai no
     cabeçalho de todo documento impresso.
   - **Armazém** — onde a mercadoria fica guardada. Pode cadastrar mais
     depois.
   - **Pronto** — o assistente encerra e o sistema libera.

Enquanto o assistente não é concluído, o sistema segura você nele. É de
propósito: sem empresa e sem armazém cadastrados, todo documento que você
criar depois nasce torto.

### Depois do assistente: os primeiros passos

Na tela inicial aparece a lista **Primeiros passos**, com seis itens. Ela
**não é marcada à mão** — cada item se marca sozinho quando a coisa existe
mesmo no banco. Enquanto houver item em aberto, é porque falta cadastro:

1. Dados da empresa
2. Onde a mercadoria fica guardada (locais de estoque)
3. O que a empresa movimenta (produtos)
4. Fornecedores e clientes
5. Quem mais vai usar o sistema (usuários)
6. Primeira movimentação

---

## 3. A tela que você abre todo dia

A tela inicial é o **Panorama do grupo**. Ela tem quatro partes, de cima
para baixo:

### O seletor de período

`Hoje · 7 dias · Este mês · Mês passado · Este ano`, ou duas datas na mão.
Tudo abaixo obedece ao período escolhido — **menos** o "ainda a receber" e
"ainda a pagar", que são dívidas que existem hoje, independentemente do mês
que você está olhando.

### Um cartão por operação

Cada cartão mostra, lado a lado:

- **Mercadoria no período** — Entrou | Saiu
- **Dinheiro que passou pelo caixa** — Recebido | Pago
- **Resultado de caixa no período** — recebido menos pago, com sinal
- No rodapé: *ainda a receber*, *ainda a pagar*, *hoje no armazém*

A transportadora não tem linha de mercadoria: ela não guarda grão.

### Precisa de atenção

O que trava o dia, uma linha cada: pedidos esperando aprovação, títulos
vencidos, fumigação sem comunicado. Clique e vá direto.

### Tudo que entrou e saiu

O extrato do período, linha a linha, do mais recente para o mais antigo. É o
**"de onde veio esse número"** do panorama. Se um total parecer errado, é
aqui que você confere.

---

## 4. A rotina

### Toda manhã — 5 minutos

1. Abra o sistema. Deixe em **Hoje** ou **7 dias**.
2. Olhe a barra de ícones: se o botão **A pagar** estiver com uma bolinha
   vermelha e um número, há títulos vencidos. Esse número é a única coisa no
   sistema que grita.
3. Leia **Precisa de atenção**. Resolva o que dá para resolver em um clique
   (aprovar pedido, dar baixa em título).
4. Troque para **Este mês** e olhe o *Resultado de caixa* das duas operações.

### Quando chega caminhão de mercadoria

→ Botão **Receber**. Ver capítulo 5.2.

### Quando fecha uma venda

→ Botão **Vender**. Ver capítulo 5.5.

### Quando sai carga

→ Botão **Carregar**. Ver capítulo 5.6.

### Quando paga ou recebe

→ Botões **A pagar** / **A receber**. Ver capítulo 5.7.

### Toda sexta — 15 minutos

1. Panorama em **7 dias**: confira se entrou e saiu o que você lembra.
2. **Armazém → Posição de estoque**: o *físico* bate com o que está no pátio?
3. **A pagar**, filtro *Atraso: vencidos*: nenhum título deveria estar aí.

### Todo fim de mês

1. Panorama em **Este mês** — o retrato do mês das duas operações.
2. **Relatórios → DRE gerencial**.
3. **Relatórios → Estoque** e **Financeiro**, para arquivar.
4. Confira se sobrou pedido de compra ou venda parado em **Rascunho**. Se
   sobrou, ou termina ou cancela — rascunho eterno vira confusão em janeiro.

---

## 5. Os sete caminhos, passo a passo

Todo documento no sistema nasce **rascunho** e só faz alguma coisa quando
você confirma. Rascunho é livre para corrigir; depois de confirmado, a
correção é por estorno — nunca por apagar. Essa é a espinha do sistema
inteiro.

---

### 5.1 Comprar — pedido de compra

**Quando:** você combinou uma compra com o fornecedor.
**Onde:** botão **Comprar**, ou *Compras → Novo pedido de compra*.

O formulário tem **três etapas**:

| Etapa | O que você informa |
|---|---|
| 1. Fornecedor | De quem, em que data, **de qual operação** e o que (mercadoria, frete ou serviço) |
| 2. Itens | Uma linha por item. O total se soma sozinho |
| 3. Conferir | Resumo do que vai ser gravado, mais prazos, moeda e Incoterm |

A quantidade pode ser digitada em **toneladas, quilos ou sacas**. O sistema
converte e guarda tudo em quilos.

Depois de criado, o pedido segue esta esteira:

```
RASCUNHO ──enviar──► AGUARDANDO APROVAÇÃO ──aprovar──► APROVADO
                                                          │
                                        recebimentos abatem o saldo
                                                          ▼
                                    PARCIALMENTE RECEBIDO ──► RECEBIDO
```

> **A aprovação é o momento que conta.** É ela que gera o **título a
> pagar** e trava preço e quantidade. Antes disso, nada aconteceu. Depois
> dela, corrigir exige cancelar.

---

### 5.2 Receber — entrada de mercadoria

**Quando:** o caminhão chegou e foi pesado.
**Onde:** botão **Receber**.

Este é o **único evento que coloca grão no estoque** vindo de compra. O
pedido não move estoque; o recebimento move.

1. Escolha o **pedido de compra** (ou deixe em branco: recebimento avulso é
   permitido, para o grão que já estava no armazém).
2. Informe fornecedor, local, placa, motorista e a nota fiscal.
3. Lance os pesos: **bruto**, **tara** — o líquido se calcula sozinho.
4. Grave. Ele nasce **RASCUNHO** e ainda não fez nada.
5. Confira contra a nota e clique em **Confirmar**.

```
RASCUNHO ──confirmar──► CONFIRMADO   (a mercadoria entrou no estoque)
```

**Recebimento parcial é a regra, não a exceção.** 500 t pedidas podem chegar
em três caminhões, em três dias. Cada viagem é um recebimento; o saldo do
pedido diminui a cada um.

Se o pesado divergir do previsto, **não trava**: o que chegou, chegou. A
diferença fica registrada no item para a conferência com o fornecedor.

---

### 5.3 Fumigar

**Quando:** a carga vai ser fumigada.
**Onde:** botão **Fumigar**.

1. Lance a fumigação: produto, quantidade, local, fumigadora, início.
2. Ela nasce **RASCUNHO**.
3. Quando a fumigadora entregar o **número do Comunicado de Fumigação**,
   edite a fumigação, preencha o comunicado e as datas de início e término
   (exaustão), e clique em **Validar**.

```
RASCUNHO ──validar──► VALIDADO   (gera saldo fumigado)
```

> **Sem o número do Comunicado, a fumigação não valida.** Sem validar, não
> existe saldo fumigado, e sem saldo fumigado não se emite certificado. Não
> é burocracia do sistema — é a regra da fumigação, e ela está no sistema
> justamente para não ser esquecida.

A fumigação funciona como **conta-corrente**: cada validação é uma entrada
de saldo, cada certificado emitido é uma saída. O saldo nunca fica negativo.

---

### 5.4 Certificar

**Quando:** a fumigação foi validada e você precisa do certificado.
**Onde:** botão **Certificar**.

1. Escolha uma **fumigação validada com saldo**.
2. Informe a quantidade a certificar — ela consome o saldo daquela fumigação.
3. Grave e **Valide**.

O certificado depois é vinculado ao carregamento. Quando é, o sistema
confere três coisas e recusa se alguma falhar:

- o certificado não pode estar cancelado;
- tem que ser **do mesmo produto** do carregamento;
- a quantidade não pode passar do saldo ainda não vinculado do certificado.

---

### 5.5 Vender — pedido de venda

**Quando:** você fechou uma venda.
**Onde:** botão **Vender**.

Três etapas, como na compra: **Cliente → Mercadoria → Conferir**.

Na etapa de mercadoria você escolhe **de qual armazém** cada item sai. Se
faltar estoque disponível em qualquer linha, o pedido inteiro não aprova —
de propósito.

```
RASCUNHO ──enviar──► AGUARDANDO APROVAÇÃO ──aprovar──► APROVADO
                                                          │
                                     carregamentos atendem o pedido
                                                          ▼
                                    PARCIALMENTE ATENDIDO ──► ATENDIDO
```

> **Aprovar faz duas coisas de uma vez:** reserva a mercadoria e gera o
> **título a receber**. A mercadoria reservada continua no armazém, mas
> ninguém mais consegue vender a mesma carga.

**Reservado não é o mesmo que vendido.** Na tela de estoque você vê três
números: *físico* (o que está lá), *reservado* (comprometido com pedidos) e
*disponível* (físico menos reservado — o que ainda dá para vender).

---

### 5.6 Carregar — ordem de carregamento

**Quando:** a carga vai sair.
**Onde:** botão **Carregar**.

```
RASCUNHO ──programar──► PROGRAMADO ──expedir──► EXPEDIDO
   │                        │                       │
não toca                 reserva              baixa física
no estoque             o estoque             no estoque
```

1. **Criar** — produto, local, quantidade, veículo, motorista, destino e,
   se for exportação, o certificado.
2. **Programar** — a ordem entra na fila e o estoque fica comprometido.
3. **Expedir** — a baixa física acontece **aqui, uma vez só**.

Há dois casos, e a diferença importa:

- **Ordem ligada a um pedido de venda** — quem reservou foi o pedido, na
  aprovação. A ordem apenas **consome um pedaço** dessa reserva na
  expedição. Se as duas reservassem, o mesmo grão apareceria comprometido
  duas vezes e o "disponível" travaria vendas que poderiam ser feitas.
- **Ordem avulsa, sem pedido** — ela reserva por conta própria.

---

### 5.7 Pagar e receber

**Onde:** botões **A pagar** e **A receber**.

Os títulos aparecem sozinhos: a aprovação de uma compra gera o título a
pagar, a de uma venda gera o título a receber. Também dá para lançar título
avulso, para a despesa que não veio de pedido.

Para quitar: abra o título e clique em **Baixar**. Informe **data**,
**valor** e **conta bancária**.

```
ABERTO ──baixa parcial──► PARCIAL ──baixa final──► PAGO / RECEBIDO
```

**Baixa parcial é permitida.** Um título de R$ 100.000 pode receber uma
baixa de R$ 40.000: ele fica PARCIAL, com R$ 60.000 de saldo, e o panorama
mostra R$ 40.000 como dinheiro que passou pelo caixa e R$ 60.000 como
compromisso.

> **É a baixa — e só ela — que vira dinheiro no panorama.** Título aprovado
> e não pago aparece em *ainda a pagar*, nunca em *pago*.

Outras telas do Financeiro: **Caixa e bancos** (saldo por conta) e
**Transferência entre contas**.

---

## 6. As sete regras que o sistema não deixa quebrar

Vale conhecer, porque quando uma mensagem de erro aparecer, é uma delas.

1. **Pedido não move estoque.** Só recebimento confirmado e carregamento
   expedido movem.
2. **Título em aberto não é dinheiro.** Só a baixa é.
3. **Não se vende o que não está disponível.** Reservado não conta como
   disponível.
4. **Fumigação sem número de Comunicado não valida.**
5. **Certificado só cobre o próprio produto e o próprio saldo.**
6. **Nada se apaga.** Correção é por estorno ou cancelamento, e os dois
   ficam registrados.
7. **Todo documento tem número sequencial anual** — `0001-2026`,
   `0002-2026`. O sistema numera; você não escolhe.

---

## 7. Quando errar

Errar é normal. O que o sistema não permite é **esconder** o erro. Não
existe botão de apagar em nenhum documento confirmado. Existe:

| Situação | O que fazer |
|---|---|
| Documento ainda em **rascunho** | Edite à vontade, ou cancele. Nada aconteceu ainda |
| **Recebimento confirmado** errado | Cancelar. Estorna a entrada e devolve o saldo ao pedido |
| **Carregamento expedido** errado | Cancelar. Estorna a baixa e devolve a mercadoria ao estoque |
| **Pedido de venda aprovado** errado | Cancelar. Libera a reserva e cancela o título previsto |
| **Baixa** lançada errada | Estornar a baixa. O título volta ao saldo anterior |
| **Movimento de estoque** errado | *Armazém → Movimentações* → Estornar |
| Estoque não bate com o pátio | *Armazém → Ajuste de estoque*, com o motivo escrito |

Todo cancelamento pede **motivo**, e o motivo fica gravado. Em
**Sistema → Auditoria** está tudo: quem fez, o que fez, quando, e o valor
antes e depois. Esse registro é imutável — nem o administrador apaga.

---

## 8. Quem faz o quê

Cada pessoa tem um usuário e um perfil. O perfil decide o que ela vê: o
operador de pátio nem enxerga o menu de aprovação. Seis perfis vêm prontos,
e dá para ajustar qualquer um em *Sistema → Usuários e perfis*.

| Perfil | Para quem | O que pode |
|---|---|---|
| **Administrador** | Você e mais ninguém | Tudo, inclusive usuários e perfis |
| **Diretoria** | O Suécio | Vê tudo, aprova compra e venda, opera o financeiro |
| **Financeiro** | Quem cuida do caixa | Contas a pagar e receber, baixas, aprova pedidos. Não mexe em estoque |
| **Estoque / Pátio** | Quem recebe e carrega | Lança recebimento e carregamento, ajusta estoque. **Não aprova compra** |
| **Fumigação** | Quem cuida da fumigação | Fumigações, comunicados e certificados |
| **Consulta / Auditoria** | Contador, auditor | Só leitura, em tudo |

A separação que mais importa é a do **Estoque / Pátio**: quem recebe a
mercadoria não é quem aprova a compra. É a regra mais velha de controle
interno que existe, e ela está no sistema.

---

## 9. Perguntas rápidas

**Comprei 500 t mas só chegaram 320 t. E agora?**
Nada de especial. Confirme o recebimento de 320 t; o pedido fica
*Parcialmente recebido* com 180 t de saldo. Quando o resto chegar, lance
outro recebimento contra o mesmo pedido.

**Cadastrei um pedido na operação errada.**
Se estiver em rascunho, edite. Se já foi aprovado, cancele e refaça — a
operação é o que separa o panorama das duas empresas, então vale a
retrabalhada.

**O estoque disponível está menor do que o que eu vejo no pátio.**
Tem mercadoria reservada por pedido de venda aprovado. Olhe a coluna
*Reservado* na posição de estoque.

**Posso usar no celular?**
Pode. O sistema se adapta à tela e dá para instalar como aplicativo pelo
próprio navegador. A barra de ícones rola para o lado — é o que se usa de
pé, no pátio.

**Preciso de internet?**
Para operar, sim. O sistema abre rápido mesmo com internet ruim porque tudo
— fontes, ícones, estilos — vem do próprio servidor, sem depender de
terceiros.

**Onde vejo quem fez alguma coisa?**
*Sistema → Auditoria*. Ou, em qualquer documento, a aba de histórico no pé
da tela.

**Esqueci a senha.**
O administrador redefine em *Sistema → Usuários e perfis*.

---

## 10. Atalhos que valem decorar

| Onde | O quê |
|---|---|
| Barra de ícones | O caminho do dia, na ordem em que a operação acontece: Comprar → Receber → Estoque → Fumigar → Certificar → Vender → Carregar |
| Bolinha vermelha em *A pagar* | Quantidade de títulos vencidos. Se aparecer, é para hoje |
| Campo de busca das listas | Filtra enquanto você digita, sem recarregar |
| Botão de lua / sol | Tema claro e escuro |
| Clique em qualquer linha do extrato | Vai direto ao documento que gerou aquele número |
| Imprimir (Ctrl+P) | Toda tela tem versão de impressão limpa, sem menus |
