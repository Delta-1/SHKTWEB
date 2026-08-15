-- =====================================================================
-- ERP SHKT - Migration 003
-- Estoque por movimentacoes. O saldo NUNCA e digitado: ele e o resultado
-- da soma das movimentacoes, cada uma com origem, documento e usuario.
-- Unidade interna unica: KG.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Lotes
-- ---------------------------------------------------------------------
CREATE TABLE lotes (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    codigo        TEXT NOT NULL,
    produto_id    BIGINT NOT NULL REFERENCES produtos(id),
    safra         TEXT,
    origem        TEXT,
    data_entrada  DATE NOT NULL DEFAULT CURRENT_DATE,
    observacoes   TEXT,
    ativo         BOOLEAN NOT NULL DEFAULT TRUE,
    criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
    criado_por    BIGINT REFERENCES usuarios(id),
    CONSTRAINT uq_lotes_codigo_produto UNIQUE (produto_id, codigo)
);

-- ---------------------------------------------------------------------
-- Saldos consolidados (uma linha por produto + local + lote).
-- Serve como ponto de bloqueio (SELECT FOR UPDATE) para impedir
-- saldo negativo em operacoes simultaneas.
-- ---------------------------------------------------------------------
CREATE TABLE estoque_saldos (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    produto_id    BIGINT NOT NULL REFERENCES produtos(id),
    local_id      BIGINT NOT NULL REFERENCES locais_estoque(id),
    lote_id       BIGINT REFERENCES lotes(id),
    lote_key      BIGINT GENERATED ALWAYS AS (COALESCE(lote_id, 0)) STORED,
    quantidade_kg NUMERIC(18,3) NOT NULL DEFAULT 0,
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_estoque_saldos ON estoque_saldos (produto_id, local_id, lote_key);

-- ---------------------------------------------------------------------
-- Movimentacoes
-- ---------------------------------------------------------------------
CREATE TABLE estoque_movimentos (
    id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    data_hora         TIMESTAMPTZ NOT NULL DEFAULT now(),
    data_movimento    DATE NOT NULL DEFAULT CURRENT_DATE,
    tipo              TEXT NOT NULL CHECK (tipo IN (
                          'RECEBIMENTO','AJUSTE_ENTRADA','AJUSTE_SAIDA',
                          'TRANSFERENCIA_SAIDA','TRANSFERENCIA_ENTRADA',
                          'CARREGAMENTO','ESTORNO','SALDO_INICIAL')),
    produto_id        BIGINT NOT NULL REFERENCES produtos(id),
    local_id          BIGINT NOT NULL REFERENCES locais_estoque(id),
    lote_id           BIGINT REFERENCES lotes(id),
    quantidade_kg     NUMERIC(18,3) NOT NULL CHECK (quantidade_kg <> 0), -- positivo = entrada
    quantidade_origem NUMERIC(18,3),           -- quantidade como foi digitada
    unidade_id        BIGINT REFERENCES unidades_medida(id),
    saldo_apos_kg     NUMERIC(18,3) NOT NULL,
    documento_tipo    TEXT,                    -- CARREGAMENTO, RECEBIMENTO, AJUSTE...
    documento_id      BIGINT,
    documento_numero  TEXT,
    motivo            TEXT,
    observacoes       TEXT,
    estorno_de_id     BIGINT REFERENCES estoque_movimentos(id),
    usuario_id        BIGINT REFERENCES usuarios(id)
);
CREATE INDEX idx_estmov_produto_local ON estoque_movimentos (produto_id, local_id, data_movimento DESC);
CREATE INDEX idx_estmov_documento ON estoque_movimentos (documento_tipo, documento_id);
CREATE INDEX idx_estmov_data ON estoque_movimentos (data_movimento DESC, id DESC);
CREATE INDEX idx_estmov_lote ON estoque_movimentos (lote_id);

-- ---------------------------------------------------------------------
-- Reservas: quantidade comprometida por documentos ainda nao expedidos.
-- Estoque disponivel = fisico - reservado.
-- ---------------------------------------------------------------------
CREATE TABLE estoque_reservas (
    id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    produto_id       BIGINT NOT NULL REFERENCES produtos(id),
    local_id         BIGINT NOT NULL REFERENCES locais_estoque(id),
    lote_id          BIGINT REFERENCES lotes(id),
    quantidade_kg    NUMERIC(18,3) NOT NULL CHECK (quantidade_kg > 0),
    documento_tipo   TEXT NOT NULL,
    documento_id     BIGINT NOT NULL,
    documento_numero TEXT,
    status           TEXT NOT NULL DEFAULT 'ATIVA'
                     CHECK (status IN ('ATIVA','CONSUMIDA','CANCELADA')),
    criado_em        TIMESTAMPTZ NOT NULL DEFAULT now(),
    criado_por       BIGINT REFERENCES usuarios(id),
    baixado_em       TIMESTAMPTZ
);
CREATE INDEX idx_reservas_ativas ON estoque_reservas (produto_id, local_id)
    WHERE status = 'ATIVA';
CREATE UNIQUE INDEX uq_reservas_documento ON estoque_reservas (documento_tipo, documento_id)
    WHERE status = 'ATIVA';

-- =====================================================================
-- FUNCAO CENTRAL DE MOVIMENTACAO DE ESTOQUE
-- Toda entrada/saida do ERP passa por aqui. Bloqueia a linha de saldo,
-- recalcula, impede saldo negativo e grava o historico - tudo dentro da
-- transacao do chamador.
-- =====================================================================
CREATE OR REPLACE FUNCTION fn_estoque_movimentar(
    p_tipo              TEXT,
    p_produto_id        BIGINT,
    p_local_id          BIGINT,
    p_lote_id           BIGINT,
    p_quantidade_kg     NUMERIC,               -- positivo = entrada, negativo = saida
    p_documento_tipo    TEXT,
    p_documento_id      BIGINT,
    p_documento_numero  TEXT,
    p_usuario_id        BIGINT,
    p_quantidade_origem NUMERIC DEFAULT NULL,
    p_unidade_id        BIGINT DEFAULT NULL,
    p_data_movimento    DATE DEFAULT NULL,
    p_motivo            TEXT DEFAULT NULL,
    p_observacoes       TEXT DEFAULT NULL,
    p_permite_negativo  BOOLEAN DEFAULT FALSE,
    p_estorno_de_id     BIGINT DEFAULT NULL
) RETURNS BIGINT AS $$
DECLARE
    v_saldo_id    BIGINT;
    v_saldo_atual NUMERIC(18,3);
    v_saldo_novo  NUMERIC(18,3);
    v_mov_id      BIGINT;
    v_produto     TEXT;
    v_local       TEXT;
BEGIN
    IF p_quantidade_kg IS NULL OR p_quantidade_kg = 0 THEN
        RAISE EXCEPTION 'Quantidade da movimentacao nao pode ser zero.';
    END IF;

    -- Garante a existencia da linha de saldo e a bloqueia ate o fim da transacao
    INSERT INTO estoque_saldos (produto_id, local_id, lote_id, quantidade_kg)
         VALUES (p_produto_id, p_local_id, p_lote_id, 0)
    ON CONFLICT (produto_id, local_id, lote_key) DO NOTHING;

    SELECT id, quantidade_kg INTO v_saldo_id, v_saldo_atual
      FROM estoque_saldos
     WHERE produto_id = p_produto_id
       AND local_id = p_local_id
       AND lote_key = COALESCE(p_lote_id, 0)
       FOR UPDATE;

    v_saldo_novo := v_saldo_atual + p_quantidade_kg;

    IF v_saldo_novo < 0 AND NOT p_permite_negativo THEN
        SELECT descricao INTO v_produto FROM produtos WHERE id = p_produto_id;
        SELECT nome INTO v_local FROM locais_estoque WHERE id = p_local_id;
        RAISE EXCEPTION
            'Estoque insuficiente: % em %. Saldo atual % kg, saida solicitada % kg.',
            COALESCE(v_produto, '?'), COALESCE(v_local, '?'),
            trim(to_char(v_saldo_atual, 'FM999999990.999')),
            trim(to_char(abs(p_quantidade_kg), 'FM999999990.999'))
            USING ERRCODE = 'check_violation';
    END IF;

    UPDATE estoque_saldos
       SET quantidade_kg = v_saldo_novo,
           atualizado_em = now()
     WHERE id = v_saldo_id;

    INSERT INTO estoque_movimentos (
        data_movimento, tipo, produto_id, local_id, lote_id,
        quantidade_kg, quantidade_origem, unidade_id, saldo_apos_kg,
        documento_tipo, documento_id, documento_numero,
        motivo, observacoes, estorno_de_id, usuario_id
    ) VALUES (
        COALESCE(p_data_movimento, CURRENT_DATE), p_tipo, p_produto_id, p_local_id, p_lote_id,
        p_quantidade_kg, p_quantidade_origem, p_unidade_id, v_saldo_novo,
        p_documento_tipo, p_documento_id, p_documento_numero,
        p_motivo, p_observacoes, p_estorno_de_id, p_usuario_id
    ) RETURNING id INTO v_mov_id;

    RETURN v_mov_id;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------
-- Bloqueia alteracao/exclusao manual de movimentos ja gravados.
-- Correcao se faz por estorno, preservando o historico.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_estoque_movimento_imutavel() RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Movimentos de estoque nao podem ser alterados ou excluidos. Utilize estorno.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_estoque_movimento_imutavel
    BEFORE UPDATE OR DELETE ON estoque_movimentos
    FOR EACH ROW EXECUTE FUNCTION fn_estoque_movimento_imutavel();
