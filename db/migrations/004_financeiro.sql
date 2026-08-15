-- =====================================================================
-- ERP SHKT - Migration 004
-- Financeiro central. Todo titulo gerado automaticamente guarda a
-- referencia do documento que o originou (origem_tipo + origem_id),
-- permitindo navegar do titulo ate a origem e vice-versa.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Contas a Pagar
-- ---------------------------------------------------------------------
CREATE TABLE contas_pagar (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    numero          TEXT NOT NULL UNIQUE,      -- 0001-2026
    descricao       TEXT NOT NULL,
    origem          TEXT NOT NULL DEFAULT 'MANUAL' CHECK (origem IN (
                        'MANUAL','COMPRA','FUMIGACAO','RH','MANUTENCAO',
                        'ABASTECIMENTO','VIAGEM','IMPOSTO','ADMINISTRATIVO','FRETE')),
    origem_tipo     TEXT,                      -- tabela de origem (ex.: CERTIFICADO_FUMIGACAO)
    origem_id       BIGINT,                    -- id do registro de origem
    origem_numero   TEXT,                      -- numero do documento de origem
    parceiro_id     BIGINT REFERENCES parceiros(id),
    funcionario_id  BIGINT REFERENCES funcionarios(id),
    beneficiario    TEXT,                      -- usado quando nao ha cadastro vinculado
    categoria_id    BIGINT REFERENCES categorias_financeiras(id),
    centro_custo_id BIGINT REFERENCES centros_custo(id),
    emissao         DATE NOT NULL DEFAULT CURRENT_DATE,
    vencimento      DATE NOT NULL,
    competencia     DATE,
    valor           NUMERIC(18,4) NOT NULL CHECK (valor > 0),
    moeda_id        BIGINT NOT NULL REFERENCES moedas(id),
    valor_pago      NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (valor_pago >= 0),
    data_pagamento  DATE,
    status          TEXT NOT NULL DEFAULT 'ABERTO'
                    CHECK (status IN ('ABERTO','PARCIAL','PAGO','CANCELADO')),
    motivo_cancelamento TEXT,
    documento_fiscal    TEXT,
    observacoes     TEXT,
    criado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
    criado_por      BIGINT REFERENCES usuarios(id),
    atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_por  BIGINT REFERENCES usuarios(id)
);
CREATE INDEX idx_cp_vencimento ON contas_pagar (vencimento) WHERE status IN ('ABERTO','PARCIAL');
CREATE INDEX idx_cp_status ON contas_pagar (status);
CREATE INDEX idx_cp_parceiro ON contas_pagar (parceiro_id);
CREATE INDEX idx_cp_origem ON contas_pagar (origem_tipo, origem_id);

-- REGRA CRITICA: impede lancamento financeiro duplicado a partir da mesma
-- origem (ex.: dois Contas a Pagar para o mesmo Certificado de Fumigacao).
CREATE UNIQUE INDEX uq_cp_origem ON contas_pagar (origem_tipo, origem_id)
    WHERE origem_tipo IS NOT NULL AND status <> 'CANCELADO';

-- ---------------------------------------------------------------------
-- Contas a Receber
-- ---------------------------------------------------------------------
CREATE TABLE contas_receber (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    numero          TEXT NOT NULL UNIQUE,
    descricao       TEXT NOT NULL,
    origem          TEXT NOT NULL DEFAULT 'MANUAL'
                    CHECK (origem IN ('MANUAL','VENDA','OUTROS')),
    origem_tipo     TEXT,
    origem_id       BIGINT,
    origem_numero   TEXT,
    parceiro_id     BIGINT REFERENCES parceiros(id),
    pagador         TEXT,
    categoria_id    BIGINT REFERENCES categorias_financeiras(id),
    centro_custo_id BIGINT REFERENCES centros_custo(id),
    emissao         DATE NOT NULL DEFAULT CURRENT_DATE,
    vencimento      DATE NOT NULL,
    competencia     DATE,
    valor           NUMERIC(18,4) NOT NULL CHECK (valor > 0),
    moeda_id        BIGINT NOT NULL REFERENCES moedas(id),
    valor_recebido  NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (valor_recebido >= 0),
    data_recebimento DATE,
    status          TEXT NOT NULL DEFAULT 'ABERTO'
                    CHECK (status IN ('ABERTO','PARCIAL','RECEBIDO','CANCELADO')),
    motivo_cancelamento TEXT,
    documento_fiscal    TEXT,
    observacoes     TEXT,
    criado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
    criado_por      BIGINT REFERENCES usuarios(id),
    atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_por  BIGINT REFERENCES usuarios(id)
);
CREATE INDEX idx_cr_vencimento ON contas_receber (vencimento) WHERE status IN ('ABERTO','PARCIAL');
CREATE INDEX idx_cr_status ON contas_receber (status);
CREATE INDEX idx_cr_parceiro ON contas_receber (parceiro_id);
CREATE UNIQUE INDEX uq_cr_origem ON contas_receber (origem_tipo, origem_id)
    WHERE origem_tipo IS NOT NULL AND status <> 'CANCELADO';

-- ---------------------------------------------------------------------
-- Baixas (pagamentos e recebimentos). Permite baixa parcial.
-- ---------------------------------------------------------------------
CREATE TABLE financeiro_baixas (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    titulo_tipo         TEXT NOT NULL CHECK (titulo_tipo IN ('CP','CR')),
    conta_pagar_id      BIGINT REFERENCES contas_pagar(id),
    conta_receber_id    BIGINT REFERENCES contas_receber(id),
    data                DATE NOT NULL DEFAULT CURRENT_DATE,
    valor               NUMERIC(18,4) NOT NULL CHECK (valor > 0),
    juros               NUMERIC(18,4) NOT NULL DEFAULT 0,
    desconto            NUMERIC(18,4) NOT NULL DEFAULT 0,
    conta_bancaria_id   BIGINT NOT NULL REFERENCES contas_bancarias(id),
    forma_pagamento_id  BIGINT REFERENCES formas_pagamento(id),
    observacoes         TEXT,
    estornada           BOOLEAN NOT NULL DEFAULT FALSE,
    estornada_em        TIMESTAMPTZ,
    estornada_por       BIGINT REFERENCES usuarios(id),
    motivo_estorno      TEXT,
    criado_em           TIMESTAMPTZ NOT NULL DEFAULT now(),
    criado_por          BIGINT REFERENCES usuarios(id),
    CONSTRAINT ck_baixa_titulo CHECK (
        (titulo_tipo = 'CP' AND conta_pagar_id IS NOT NULL AND conta_receber_id IS NULL) OR
        (titulo_tipo = 'CR' AND conta_receber_id IS NOT NULL AND conta_pagar_id IS NULL)
    )
);
CREATE INDEX idx_baixas_cp ON financeiro_baixas (conta_pagar_id);
CREATE INDEX idx_baixas_cr ON financeiro_baixas (conta_receber_id);
CREATE INDEX idx_baixas_data ON financeiro_baixas (data DESC);

-- ---------------------------------------------------------------------
-- Movimentos de caixa/banco. Alimentado pelas baixas e por transferencias.
-- ---------------------------------------------------------------------
CREATE TABLE caixa_movimentos (
    id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    conta_bancaria_id BIGINT NOT NULL REFERENCES contas_bancarias(id),
    data              DATE NOT NULL DEFAULT CURRENT_DATE,
    tipo              TEXT NOT NULL CHECK (tipo IN ('ENTRADA','SAIDA')),
    valor             NUMERIC(18,4) NOT NULL CHECK (valor > 0),
    historico         TEXT NOT NULL,
    origem_tipo       TEXT,
    origem_id         BIGINT,
    baixa_id          BIGINT REFERENCES financeiro_baixas(id),
    transferencia_id  BIGINT,
    conciliado        BOOLEAN NOT NULL DEFAULT FALSE,
    conciliado_em     TIMESTAMPTZ,
    estornado         BOOLEAN NOT NULL DEFAULT FALSE,
    criado_em         TIMESTAMPTZ NOT NULL DEFAULT now(),
    criado_por        BIGINT REFERENCES usuarios(id)
);
CREATE INDEX idx_caixamov_conta_data ON caixa_movimentos (conta_bancaria_id, data DESC);
CREATE INDEX idx_caixamov_origem ON caixa_movimentos (origem_tipo, origem_id);

CREATE TABLE caixa_transferencias (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    numero          TEXT NOT NULL UNIQUE,
    data            DATE NOT NULL DEFAULT CURRENT_DATE,
    conta_origem_id BIGINT NOT NULL REFERENCES contas_bancarias(id),
    conta_destino_id BIGINT NOT NULL REFERENCES contas_bancarias(id),
    valor           NUMERIC(18,4) NOT NULL CHECK (valor > 0),
    observacoes     TEXT,
    estornada       BOOLEAN NOT NULL DEFAULT FALSE,
    criado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
    criado_por      BIGINT REFERENCES usuarios(id),
    CONSTRAINT ck_transf_contas CHECK (conta_origem_id <> conta_destino_id)
);

CREATE TRIGGER trg_cp_atualizado BEFORE UPDATE ON contas_pagar
    FOR EACH ROW EXECUTE FUNCTION fn_set_atualizado_em();
CREATE TRIGGER trg_cr_atualizado BEFORE UPDATE ON contas_receber
    FOR EACH ROW EXECUTE FUNCTION fn_set_atualizado_em();

-- ---------------------------------------------------------------------
-- Saldo por conta bancaria
-- ---------------------------------------------------------------------
CREATE VIEW vw_contas_saldos AS
SELECT cb.id,
       cb.codigo,
       cb.nome,
       cb.tipo,
       cb.moeda_id,
       m.codigo AS moeda,
       m.simbolo AS moeda_simbolo,
       cb.saldo_inicial,
       COALESCE(SUM(CASE WHEN cm.tipo = 'ENTRADA' THEN cm.valor ELSE -cm.valor END), 0) AS movimentacao,
       cb.saldo_inicial
         + COALESCE(SUM(CASE WHEN cm.tipo = 'ENTRADA' THEN cm.valor ELSE -cm.valor END), 0) AS saldo_atual,
       cb.ativo
  FROM contas_bancarias cb
  JOIN moedas m ON m.id = cb.moeda_id
  LEFT JOIN caixa_movimentos cm ON cm.conta_bancaria_id = cb.id AND NOT cm.estornado
 GROUP BY cb.id, m.codigo, m.simbolo;
