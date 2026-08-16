# Guia de operação — ERP SHKT

Como usar o sistema no dia a dia. Escrito para quem opera, não para quem
programa.

---

## Antes de começar

O sistema abre no navegador: `https://erp.shkt.com.br` (ou o endereço que a
empresa configurou). Funciona no computador e no celular, com o mesmo login.

Cada pessoa deve ter **o seu próprio usuário**. Tudo que é feito fica registrado
com nome, data e hora — e isso só protege a empresa se ninguém usar o login de
outro.

---

## Ordem de implantação (faça uma vez)

1. **Administração → Usuários**: crie um acesso para cada pessoa e escolha o
   perfil (Financeiro, Estoque/Pátio, Fumigação, Diretoria...).
2. **Administração → parâmetros**: preencha CNPJ, endereço e telefone. Esses
   dados aparecem no cabeçalho de todos os documentos impressos.
3. **Cadastros → Produtos**: confira o *Milho Amarelo Duro* já cadastrado.
   Marque **"Exige certificado de fumigação para exportar"** nos produtos em que
   isso vale — o sistema passa a bloquear expedição sem certificado.
4. **Cadastros → Tabelas de apoio → Locais de estoque**: cadastre os armazéns.
5. **Cadastros → Fumigadoras**: cadastre com o **custo por tonelada** — ele é
   sugerido sozinho em cada fumigação.
6. **Cadastros → Clientes / Transportadoras / Veículos / Motoristas**.
7. **Estoque → Ajuste → "Saldo inicial de implantação"**: lance o que existe
   hoje no armazém. É o único momento em que se digita saldo direto.

---

## O fluxo do dia a dia

### 1. Comprar

**Pedidos de compra → Novo pedido**. Escolha o fornecedor, o tipo (mercadoria,
frete ou serviço), o local de entrega e lance os itens com quantidade e preço.
O total é somado sozinho.

Salve, confira, e clique em **Aprovar**. A aprovação faz três coisas de uma vez:
trava o pedido (preço e quantidade não mudam mais), gera o **Contas a Pagar**
previsto e libera o pedido para receber mercadoria.

> **O pedido não coloca nada no estoque.** Ele é um compromisso com o
> fornecedor. O grão só entra quando o caminhão chega — no passo 2.

Para saldo inicial, ou para uma entrada sem pedido nenhum, continua valendo
**Estoque → Ajuste → Entrada**, sempre com o motivo preenchido.

### 2. Receber a mercadoria

**Recebimentos → Novo recebimento**, ou o botão **Receber** direto no pedido —
por ele, os itens em aberto já vêm preenchidos.

Informe a nota fiscal, a placa, a pesagem na balança e o que efetivamente
chegou. Salve: o recebimento nasce como **rascunho** e ainda não mexeu em nada.
Confira com calma e clique em **Confirmar entrada no estoque**.

Chegou menos do que o pedido previa? Não tem problema — lance o que chegou. O
sistema registra a diferença como divergência e deixa o saldo em aberto no
pedido. O resto entra em outro recebimento, depois.

### 3. Pedido de fumigação

**Fumigação → Nova fumigação**. Informe produto, local, quantidade e a empresa
fumigadora. O custo por tonelada vem do cadastro dela.

Pode salvar sem o comunicado — ele costuma chegar depois.

### 4. Informar o comunicado e validar

Quando a fumigadora enviar o **Comunicado de Fumigação**, abra a fumigação,
preencha o número, a data/hora de término (exaustão) e clique em
**Validar fumigação**.

> **Sem o número do comunicado o sistema não valida.** Não é teimosia da tela:
> a regra está no banco de dados. Sem validar, não existe saldo fumigado e
> nenhum certificado pode ser emitido.

Ao validar, aparece o **saldo fumigado disponível**. Ex.: 500 t.

### 5. Emitir certificado

**Certificados → Novo certificado**. Escolha a fumigação (só aparecem as
validadas com saldo), informe a quantidade e o número do certificado que a
fumigadora emitiu.

O certificado nasce como **rascunho**. Confira e clique em
**Validar e gerar contas a pagar**. Nesse momento o sistema, de uma vez só:

- baixa a quantidade do saldo fumigado (500 t − 100 t = **400 t**);
- gera o **Contas a Pagar** da fumigadora, com vencimento em 10 dias;
- registra tudo na auditoria.

Se o valor estiver errado, **cancele o certificado** — o saldo volta e o título
é cancelado junto. Nunca há necessidade de "acertar na mão".

### 6. Vender

**Pedidos de venda → Novo pedido**. Cliente, destino, condição de pagamento e
os itens (produto, local de saída, quantidade e preço).

Ao **Aprovar**, o sistema confere o estoque disponível de cada item e
**reserva** a quantidade. Reservar não é dar baixa: o físico continua o mesmo,
mas aquela mercadoria deixa de aparecer como disponível para qualquer outro
pedido. Também nasce aí o **Contas a Receber**.

Se faltar estoque em qualquer linha, a aprovação inteira é recusada. É de
propósito: um pedido meio aprovado seria pior do que nenhum.

### 7. Carregamento e expedição

**Carregamentos → Nova ordem**, ou o botão **Criar carregamento** dentro do
pedido de venda. Informe cliente, produto, quantidade, veículo, motorista,
destino e **vincule o certificado**.

Se a ordem atende um pedido de venda, escolha o pedido no campo do topo. Aí a
mercadoria **já está reservada pelo pedido** — a ordem apenas consome esse
saldo na hora de expedir. Ordem avulsa, sem pedido, reserva por conta própria.

Depois:

1. **Programar** — reserva a quantidade no estoque (ou confere o saldo do
   pedido, se a ordem estiver vinculada a um). O físico não muda ainda;
   o disponível diminui, para ninguém prometer a mesma carga duas vezes.
2. **Imprimir romaneio** — leve para a balança e para o motorista.
3. **Confirmar expedição** — informe o peso real, se diferente. **É aqui que o
   estoque é baixado**, uma única vez.

Registre DANFE, MIC-DTA e CRT na própria ordem, na aba de documentos.

### 8. Pagar e receber

**Financeiro → Contas a pagar** → abra o título → **Registrar pagamento**.
Escolha a conta de saída. Pode pagar em partes: o saldo continua em aberto.

Em **Contas a receber** é o mesmo caminho para o dinheiro que entra. Os
títulos gerados pelos pedidos de compra e de venda já aparecem aqui,
apontando de volta para o documento que os criou.

---

## Coisas que o sistema não deixa fazer (e por quê)

| Situação | O que acontece | Por quê |
|---|---|---|
| Validar fumigação sem comunicado | Bloqueado | Sem comunicado não há fumigação oficial |
| Certificado maior que o saldo fumigado | Bloqueado, mostrando o saldo real | Impede certificar mercadoria que não foi fumigada |
| Expedir mais do que existe no armazém | Bloqueado | Estoque nunca fica negativo |
| Exportar produto que exige fumigação sem certificado | Bloqueado | Exigência da operação de exportação |
| Validar o mesmo certificado duas vezes | Bloqueado | Impede título financeiro em duplicidade |
| Apagar movimento de estoque ou registro de auditoria | Impossível | Histórico é prova; correção se faz por estorno |
| Editar documento já validado | Bloqueado | Cancele e emita outro — o histórico fica |
| Mudar preço ou quantidade de pedido já aprovado | Bloqueado no banco | O compromisso com o fornecedor ou cliente já foi assumido |
| Receber contra pedido que ninguém aprovou | Bloqueado | Recebimento é a execução de um compromisso, não a criação dele |
| Vender mais do que está disponível | Bloqueado, mostrando o disponível real | O que já está reservado para um cliente não pode ser vendido a outro |
| Cancelar pedido de compra que já teve recebimento | Bloqueado | Cancele o recebimento primeiro — é ele que devolve o estoque |
| Cancelar pedido de venda com carregamento em andamento | Bloqueado | Cancele o carregamento primeiro |

Toda mensagem de bloqueio diz **o número real e a quantidade disponível**, para
o operador resolver sem chamar ninguém.

---

## Corrigir erros

Nada se apaga. Cada tipo de erro tem o seu caminho:

| Errou em | Faça |
|---|---|
| Quantidade lançada no estoque | **Estornar** o movimento, com motivo |
| Certificado (valor ou quantidade) | **Cancelar** o certificado (devolve saldo e cancela o título) e emitir outro |
| Fumigação | Cancele os certificados dela, depois cancele a fumigação |
| Carregamento já expedido | **Cancelar** — a mercadoria volta ao estoque por estorno |
| Pagamento lançado errado | **Estornar a baixa** no título |

Todo cancelamento pede motivo, e o motivo aparece na auditoria.

---

## Relatórios e documentos

Em **Relatórios**, todos aceitam filtro por período e têm dois botões:

- **Imprimir / PDF** — abre a caixa de impressão do navegador. Escolha
  "Salvar como PDF" para gerar o arquivo.
- **Exportar planilha** — baixa um `.csv` que abre direto no Excel.

Documentos operacionais com cabeçalho da empresa e campos de assinatura:
Pedido de Fumigação, Certificado de Fumigação e Ordem de Carregamento
(romaneio). O botão **Imprimir** fica no topo de cada documento.

---

## Rastrear uma operação

Abra qualquer certificado: no topo aparece a trilha completa

```
Fumigação 0001-2026 → Comunicado COM-2026-0457 → Certificado CF-2026-1180
→ Contas a pagar 0001-2026 → Carregamento 0001-2026
```

Cada item é clicável. Dá para começar pelo título financeiro e chegar até a
fumigação, ou o contrário. Para ver quem fez o quê, use **Auditoria**, filtrando
por documento, usuário, módulo ou período.

---

## Dúvidas frequentes

**Posso digitar em toneladas e em sacos?**
Sim. Escolha a unidade ao lado da quantidade; o sistema converte e mostra o
equivalente em kg e t embaixo do campo. Internamente tudo é kg, então nunca há
divergência entre telas.

**Como escrevo os valores?**
No padrão brasileiro: `1.234,56`. O sistema formata sozinho ao sair do campo.

**Alguém alterou um documento e eu não sei quem.**
**Auditoria** → filtre pelo número do documento. Aparece o usuário, a data/hora
e o que mudou (valor anterior → valor posterior).

**Esqueci a senha.**
O administrador redefine em **Administração → Usuários → Redefinir senha**.
Você troca por uma sua no acesso seguinte.

**O sistema funciona no celular no pátio?**
Sim. As tabelas viram fichas empilhadas e os botões ficam grandes o suficiente
para uso com a mão.
