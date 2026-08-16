# Arquitetura do ERP SHKT

Documento técnico. Para instalar e usar, veja o [README](../README.md);
para o dia a dia da operação, [OPERACAO.md](OPERACAO.md).

---

## 1. Princípio que organiza tudo

> **Uma informação é digitada uma única vez. Depois de registrada e validada,
> ela alimenta automaticamente todos os módulos que dependem dela.**

Três decisões concretas seguem daí:

1. **Parceiros em tabela única.** Cliente, fornecedor, transportadora,
   fumigadora e oficina são a mesma tabela `parceiros`, diferenciados por
   marcadores de papel (`is_cliente`, `is_fumigadora`, ...). Uma empresa que é
   fornecedora e transportadora é cadastrada uma vez só. Cada menu é uma visão
   filtrada da mesma base.

2. **Estoque em quilogramas, sempre.** O usuário digita em tonelada ou saco; o
   sistema converte na entrada e reconverte na exibição. Não existe conversão
   manual em lugar nenhum — é a origem clássica de divergência em planilhas.

3. **Títulos financeiros carregam a origem.** Todo lançamento automático guarda
   `origem_tipo` + `origem_id` + `origem_numero`, o que permite navegar do
   Contas a Pagar até o certificado, a fumigação e o comunicado — e vice-versa.

---

## 2. Onde cada regra vive

O sistema tem três camadas de defesa. As regras que **não podem** ser violadas
ficam na mais profunda.

| Camada | Papel | Exemplos |
|---|---|---|
| **Banco de dados** | Regras estruturais, impossíveis de burlar por qualquer caminho | saldo de estoque nunca negativo; comunicado obrigatório para validar fumigação; um título por origem; auditoria imutável |
| **Serviços** (`src/services`) | Regras de negócio com mensagem clara e transação | certificado só de fumigação validada; expedição exige certificado quando o produto pede; cancelamento devolve saldos |
| **Rotas** (`src/routes`) | Permissão, validação de formulário e navegação | `exigir('certificados.aprovar')`, conversão de "1.234,56" |

### Regras que o próprio PostgreSQL garante

```sql
-- Fumigação nunca fica VALIDADA sem número de comunicado
CONSTRAINT ck_fumigacao_comunicado CHECK (
  status <> 'VALIDADA' OR (numero_comunicado IS NOT NULL AND btrim(numero_comunicado) <> '')
)

-- Nunca certificar mais do que foi fumigado
CONSTRAINT ck_fumigacao_saldo CHECK (quantidade_certificada_kg <= quantidade_kg)

-- A mesma origem nunca gera dois títulos financeiros
CREATE UNIQUE INDEX uq_cp_origem ON contas_pagar (origem_tipo, origem_id)
  WHERE origem_tipo IS NOT NULL AND status <> 'CANCELADO';

-- Movimentos de estoque e auditoria não podem ser alterados nem excluídos
CREATE TRIGGER trg_estoque_movimento_imutavel BEFORE UPDATE OR DELETE ...
CREATE TRIGGER trg_auditoria_imutavel        BEFORE UPDATE OR DELETE ...

-- Preço e quantidade de pedido aprovado não se reescrevem (só o saldo muda)
CREATE TRIGGER trg_pci_proteger BEFORE INSERT OR UPDATE OR DELETE
  ON pedido_compra_itens ...
CREATE TRIGGER trg_pvi_proteger BEFORE INSERT OR UPDATE OR DELETE
  ON pedido_venda_itens ...

-- O total do cabeçalho é sempre a soma dos itens: não existe caminho pelo
-- qual um pedido mostre um valor que os itens não sustentem
CREATE TRIGGER trg_pci_total AFTER INSERT OR UPDATE OR DELETE
  ON pedido_compra_itens EXECUTE FUNCTION fn_pc_recalcular_total();

-- Um documento nunca reserva DUAS VEZES a mesma posição de estoque
CREATE UNIQUE INDEX uq_reservas_documento ON estoque_reservas
  (documento_tipo, documento_id, produto_id, local_id, COALESCE(lote_id, 0))
  WHERE status = 'ATIVA';
```

Algumas funções PL/pgSQL concentram as operações críticas, porque precisam
bloquear linhas e conferir saldos de forma atômica:

| Função | Garante |
|---|---|
| `fn_proximo_numero(tipo, ano)` | Numeração `0001-2026` sem duplicidade, mesmo com vários usuários criando documentos ao mesmo tempo |
| `fn_estoque_movimentar(...)` | Bloqueia a linha de saldo, recalcula, recusa saldo negativo e grava o histórico |
| `fn_fumigacao_consumir(...)` | Bloqueia a fumigação, recusa certificado acima do saldo e lança a saída na conta-corrente |
| `fn_pedido_compra_recalcular(id)` | A situação do pedido sai do saldo recebido, nunca é digitada |
| `fn_pedido_venda_recalcular(id)` | Idem, a partir do saldo embarcado |
| `fn_reserva_consumir_parcial(...)` | Baixa só o pedaço da reserva que está saindo agora |
| `fn_reserva_repor(...)` | Devolve reserva somando à que existe, em vez de criar uma segunda linha para o mesmo saldo |

---

## 3. Modelo de dados

### Núcleo
`usuarios`, `perfis`, `perfil_permissoes`, `sessoes`, `auditoria`,
`documento_sequencias`, `anexos`, `parametros`.

### Cadastros
`parceiros` (com os papéis), `produtos`, `lotes`, `funcionarios`, `motoristas`,
`veiculos`, `locais_estoque`, `contas_bancarias`, `categorias_financeiras`,
`centros_custo`, `moedas`, `paises`, `incoterms`, `unidades_medida`,
`formas_pagamento`, `condicoes_pagamento`, `tipos_combustivel`.

### Operação
| Tabela | Papel |
|---|---|
| `estoque_movimentos` | Razão do estoque: append-only, cada linha com origem, documento, usuário e saldo resultante |
| `estoque_saldos` | Saldo consolidado por produto+local+lote; serve de ponto de bloqueio contra concorrência |
| `estoque_reservas` | Quantidade comprometida por pedidos de venda aprovados e carregamentos ainda não expedidos |
| `fumigacoes` | Pedido, comunicado, quantidade e quanto já foi certificado |
| `fumigacao_movimentos` | Conta-corrente: entradas (validação) e saídas (certificados) |
| `certificados_fumigacao` | Certificado emitido, custo e vínculo com o título financeiro |
| `carregamentos` + `carregamento_documentos` | Ordem de carregamento e documentos da operação |

### Comercial (Fase 2)
| Tabela | Papel |
|---|---|
| `pedidos_compra` + `pedido_compra_itens` | Compromisso com o fornecedor. O item guarda `recebido_kg`: o saldo em aberto é `quantidade_kg − recebido_kg` |
| `recebimentos` + `recebimento_itens` | Entrada física. Guarda o previsto ao lado do recebido, para a divergência ficar registrada |
| `pedidos_venda` + `pedido_venda_itens` | Compromisso com o cliente. O item guarda `atendido_kg` |

`carregamentos` ganhou `pedido_venda_id` e `pedido_venda_item_id`: uma ordem
pode nascer de um pedido ou ser avulsa.

### Financeiro
`contas_pagar`, `contas_receber`, `financeiro_baixas`, `caixa_movimentos`,
`caixa_transferencias`.

### Visões
`vw_estoque_posicao`, `vw_fumigacao_saldos`, `vw_contas_saldos`, `vw_titulos`,
`vw_rastreabilidade`, `vw_compras_saldo`, `vw_vendas_saldo`.

**Tipos:** valores monetários em `NUMERIC(18,4)`, quantidades em
`NUMERIC(18,3)`. Nunca ponto flutuante binário. No JavaScript, o cálculo passa
por `src/lib/decimal.js`, que usa inteiros `BigInt` escalonados — `0.1 + 0.2`
resulta exatamente `0.3`.

---

## 4. Estados dos documentos

### Fumigação
```
RASCUNHO ──(informa comunicado)──► EM_ANDAMENTO ──(validar)──► VALIDADA
    └──────────────────────────────────────────────────────► CANCELADA
```
Validar exige **comunicado** e **data/hora de término**. A validação lança a
entrada na conta-corrente: é ela que cria o saldo fumigado.

### Certificado
```
RASCUNHO ──(validar)──► VALIDADO ──(cancelar)──► CANCELADO
```
Validar exige o número emitido pela fumigadora e executa, **em uma única
transação**: confere saldo → consome a conta-corrente → gera o Contas a Pagar →
registra a auditoria. Se qualquer etapa falhar, nada é gravado.

### Pedido de compra
```
RASCUNHO ──► AGUARDANDO_APROVACAO ──(aprovar)──► APROVADO
                                                    │
                              (recebimento parcial) ▼
                                          PARCIALMENTE_RECEBIDO ──► RECEBIDO
    └────────────────────────────────────────────────────────────► CANCELADO
```
Aprovar gera o Contas a Pagar previsto e **congela os itens**: um gatilho no
banco recusa mudança de produto, quantidade, preço ou descrição depois disso —
só o saldo recebido continua podendo mudar, que é o que a operação faz. A
situação após APROVADO nunca é digitada: sai de `fn_pedido_compra_recalcular`,
que compara pedido e recebido.

### Recebimento — quem move o estoque na entrada
```
RASCUNHO    não toca no estoque
CONFIRMADO  ENTRADA no estoque + abate o saldo do pedido   ◄── único evento que entra
CANCELADO   estorna a entrada e devolve o saldo ao pedido
```

### Pedido de venda
```
RASCUNHO ──► AGUARDANDO_APROVACAO ──(aprovar)──► APROVADO
                                     reserva estoque + gera Contas a Receber
                                                    │
                                 (carregamento) ────▼
                                        PARCIALMENTE_ATENDIDO ──► ATENDIDO
    └────────────────────────────────────────────────────────────► CANCELADO
```

### Carregamento — quem move o estoque na saída
```
RASCUNHO         não toca no estoque
PROGRAMADO       RESERVA a quantidade (comprometido)
EM_CARREGAMENTO  mantém a reserva
EXPEDIDO         consome a reserva e dá a BAIXA FÍSICA   ◄── único evento que baixa
CANCELADO        libera a reserva; se já expedido, estorna a baixa
```
Isso responde à seção 13 do documento de requisitos: a baixa acontece **uma vez
só**, na confirmação da expedição.

**Reserva de quem?** Se a ordem está ligada a um pedido de venda, quem reservou
foi o *pedido*, na aprovação — a ordem apenas consome um pedaço dessa reserva
na expedição (`fn_reserva_consumir_parcial`). Se as duas reservassem, o mesmo
grão apareceria comprometido duas vezes e o disponível ficaria menor do que o
armazém, travando vendas possíveis. Ordem avulsa reserva por conta própria.

---

## 5. Cadeia de integração

```
Pedido de compra 0001-2026 (600 t) ──► APROVADO
   ├─► Contas a Pagar 0001-2026 (previsão)
   └─► não move estoque
   │
   ▼
Recebimento 0001-2026 ──► CONFIRMADO
   └─► ENTRADA de 600 t no armazém        ◄── aqui o grão existe no sistema
   │
   ▼
Estoque (600 t)
   │
   ▼
Fumigação 0001-2026  ── comunicado COM-2026-0457 ──► VALIDADA (500 t)
   │                                                  saldo fumigado: 500 t
   ▼
Certificado 0001-2026 (100 t) ──► VALIDADO
   ├─► conta-corrente de fumigação: saída de 100 t  → saldo 400 t
   └─► Contas a Pagar 0001-2026: R$ 1.250,00, vence em 10 dias
   │
   ▼
Pedido de venda 0001-2026 (100 t) ──► APROVADO
   ├─► reserva 100 t                (físico 600 · disponível 500)
   └─► Contas a Receber 0001-2026
   │
   ▼
Carregamento 0001-2026 (100 t, certificado + pedido de venda vinculados)
   ├─► PROGRAMADO: não reserva de novo — já está reservado pelo pedido
   └─► EXPEDIDO:   baixa 100 t      (físico 500 · expedido 100)
       └─► consome a reserva do pedido e soma ao atendido
```

Cada seta acima é uma transação única e auditada. A visão
`vw_rastreabilidade` reconstrói essa cadeia inteira em uma consulta.

---

## 6. Permissões

RBAC com permissões no formato `modulo.acao`
(`estoque.criar`, `certificados.aprovar`, `financeiro.liquidar`...).

Ações: visualizar, criar, editar, aprovar, cancelar, liquidar, exportar,
administrar. O catálogo está em `src/lib/permissoes.js` e a tela de perfis é
gerada a partir dele — adicionar um módulo novo aparece na tela sozinho.

A verificação é **sempre no servidor**, via `exigir('modulo.acao')` em cada
rota. O menu esconder um item é conforto visual, não segurança: digitar o
endereço direto continua bloqueado.

Perfis iniciais: Administrador, Diretoria, Financeiro, Estoque/Pátio,
Fumigação, Consulta/Auditoria. Todos editáveis.

---

## 7. Transações

`transacao()` em `src/db/index.js` é o único caminho para operações que tocam
mais de uma tabela. Qualquer exceção dentro do callback provoca `ROLLBACK`
completo — incluindo o registro de auditoria, para nunca auditar algo que não
aconteceu.

Esse mesmo ponto traduz erros do PostgreSQL em mensagens de negócio em
português (`src/lib/erros.js`), de modo que nenhum caminho de código consegue
devolver um erro cru para a tela.

---

## 8. Decisões e seus motivos

| Decisão | Por quê |
|---|---|
| Renderização no servidor (EJS), sem framework de front-end | Telas de formulário abrem rápido em conexão ruim e em celular antigo; não há build para o cliente quebrar |
| Regras críticas dentro do banco | Sobrevivem a bug de aplicação, script manual e integração futura |
| Estoque como razão append-only | Auditável até a origem; correção por estorno, nunca por edição |
| Motor declarativo para cadastros (`src/lib/crud.js`) | 15 telas quase idênticas viram metadados; o esforço fica nos módulos onde as regras importam |
| Reserva separada da baixa física | Permite programar carregamento sem mentir sobre o estoque físico |
| Dinheiro em `NUMERIC` + `BigInt` | Centavo somado errado destrói a confiança no sistema inteiro |

---

## 9. Como adicionar um módulo

Roteiro usado nas fases seguintes:

1. **Migração** em `db/migrations/NNN_nome.sql` com as tabelas, índices e as
   regras estruturais (constraints).
2. **Serviço** em `src/services/nome.js` com as operações em `transacao()`,
   chamando `registrar()` para auditoria.
3. **Permissões**: acrescente o módulo em `src/lib/permissoes.js`.
4. **Rotas** em `src/routes/nome.js`, cada ação com `exigir('modulo.acao')` e
   validação via `src/lib/validar.js`.
5. **Telas** em `src/views/nome/`, reaproveitando os componentes do CSS.
6. **Menu**: acrescente o item em `src/views/partials/menu.ejs`.
7. **Testes** em `tests/` para as regras que não podem falhar.

Antes de criar um campo novo, vale a pergunta da seção 37 do documento de
requisitos: *essa informação já existe em algum lugar do sistema?*
