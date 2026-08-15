-- =====================================================================
-- ERP SHKT - Migration 005
-- Fumigacao, conta-corrente de fumigacao e certificados.
-- Modulo critico: rastreabilidade Fumigacao -> Certificado -> Carregamento.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Pedido / Controle de Fumigacao
-- ---------------------------------------------------------------------
CREATE TABLE fumigacoes (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    numero              TEXT NOT NULL UNIQUE,        -- Pedido de Fumigacao SHKT: 0001-2026
    numero_comunicado   TEXT,                        -- OBRIGATORIO para validar
    fumigadora_id       BIGINT NOT NULL REFERENCES parceiros(id),
    produto_id          BIGINT NOT NULL REFERENCES produtos(id),
    local_id            BIGINT NOT NULL REFERENCES locais_estoque(id),
    lote_id             BIGINT REFERENCES lotes(id),
    quantidade_kg       NUMERIC(18,3) NOT NULL CHECK (quantidade_kg > 0),
    quantidade_origem   NUMERIC(18,3),
    unidade_id          BIGINT REFERENCES unidades_medida(id),
    -- Conta-corrente: quanto ja foi consumido por certificados validados
    quantidade_certificada_kg NUMERIC(18,3) NOT NULL DEFAULT 0
                        CHECK (quantidade_certificada_kg >= 0),
    data_hora_inicio    TIMESTAMPTZ,
    data_hora_termino   TIMESTAMPTZ,               -- exaustao
    custo_tonelada      NUMERIC(18,4),
    moeda_id            BIGINT REFERENCES moedas(id),
    responsavel         TEXT,
    observacoes         TEXT,
    status              TEXT NOT NULL DEFAULT 'RASCUNHO' CHECK (status IN (
                            'RASCUNHO','EM_ANDAMENTO','AGUARDANDO_COMUNICADO',
                            'VALIDADA','CANCELADA')),
    validada_em         TIMESTAMPTZ,
    validada_por        BIGINT REFERENCES usuarios(id),
    cancelada_em        TIMESTAMPTZ,
    cancelada_por       BIGINT REFERENCES usuarios(id),
    motivo_cancelamento TEXT,
    criado_em           TIMESTAMPTZ NOT NULL DEFAULT now(),
    criado_por          BIGINT REFERENCES usuarios(id),
    atualizado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_por      BIGINT REFERENCES usuarios(id),

    -- Regra estrutural: nao existe fumigacao validada sem Comunicado.
    CONSTRAINT ck_fumigacao_comunicado CHECK (
        status <> 'VALIDADA'
        OR (numero_comunicado IS NOT NULL AND btrim(numero_comunicado) <> '')
    ),
    -- Regra estrutural: nunca certificar mais do que foi fumigado.
    CONSTRAINT ck_fumigacao_saldo CHECK (quantidade_certificada_kg <= quantidade_kg)
);
CREATE INDEX idx_fumigacoes_status ON fumigacoes (status);
CREATE INDEX idx_fumigacoes_produto ON fumigacoes (produto_id, local_id);
CREATE INDEX idx_fumigacoes_fumigadora ON fumigacoes (fumigadora_id);
CREATE UNIQUE INDEX uq_fumigacoes_comunicado ON fumigacoes (numero_comunicado)
    WHERE numero_comunicado IS NOT NULL AND btrim(numero_comunicado) <> ''
      AND status <> 'CANCELADA';

-- ---------------------------------------------------------------------
-- Conta-corrente de fumigacao (razao de entradas e saidas)
-- ---------------------------------------------------------------------
CREATE TABLE fumigacao_movimentos (
    id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    fumigacao_id     BIGINT NOT NULL REFERENCES fumigacoes(id),
    data_hora        TIMESTAMPTZ NOT NULL DEFAULT now(),
    tipo             TEXT NOT NULL CHECK (tipo IN ('ENTRADA','SAIDA','ESTORNO')),
    quantidade_kg    NUMERIC(18,3) NOT NULL,   -- positivo = entrada, negativo = saida
    saldo_apos_kg    NUMERIC(18,3) NOT NULL,
    documento_tipo   TEXT,
    documento_id     BIGINT,
    documento_numero TEXT,
    historico        TEXT,
    usuario_id       BIGINT REFERENCES usuarios(id)
);
CREATE INDEX idx_fummov_fumigacao ON fumigacao_movimentos (fumigacao_id, id);

-- ---------------------------------------------------------------------
-- Certificados de Fumigacao
-- ---------------------------------------------------------------------
CREATE TABLE certificados_fumigacao (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    numero              TEXT NOT NULL UNIQUE,      -- controle interno SHKT: 0001-2026
    numero_certificado  TEXT,                      -- numero emitido pela fumigadora
    fumigacao_id        BIGINT NOT NULL REFERENCES fumigacoes(id),
    fumigadora_id       BIGINT NOT NULL REFERENCES parceiros(id),
    produto_id          BIGINT NOT NULL REFERENCES produtos(id),
    quantidade_kg       NUMERIC(18,3) NOT NULL CHECK (quantidade_kg > 0),
    quantidade_origem   NUMERIC(18,3),
    unidade_id          BIGINT REFERENCES unidades_medida(id),
    data                DATE NOT NULL DEFAULT CURRENT_DATE,
    custo_tonelada      NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (custo_tonelada >= 0),
    valor_total         NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (valor_total >= 0),
    moeda_id            BIGINT NOT NULL REFERENCES moedas(id),
    vencimento          DATE,                      -- padrao: data + 10 dias
    cliente_id          BIGINT REFERENCES parceiros(id),
    destino             TEXT,
    observacoes         TEXT,
    status              TEXT NOT NULL DEFAULT 'RASCUNHO'
                        CHECK (status IN ('RASCUNHO','VALIDADO','CANCELADO')),
    conta_pagar_id      BIGINT REFERENCES contas_pagar(id),
    validado_em         TIMESTAMPTZ,
    validado_por        BIGINT REFERENCES usuarios(id),
    cancelado_em        TIMESTAMPTZ,
    cancelado_por       BIGINT REFERENCES usuarios(id),
    motivo_cancelamento TEXT,
    criado_em           TIMESTAMPTZ NOT NULL DEFAULT now(),
    criado_por          BIGINT REFERENCES usuarios(id),
    atualizado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_por      BIGINT REFERENCES usuarios(id)
);
CREATE INDEX idx_certif_fumigacao ON certificados_fumigacao (fumigacao_id);
CREATE INDEX idx_certif_status ON certificados_fumigacao (status);
CREATE INDEX idx_certif_data ON certificados_fumigacao (data DESC);
CREATE UNIQUE INDEX uq_certif_numero_externo
    ON certificados_fumigacao (fumigadora_id, numero_certificado)
    WHERE numero_certificado IS NOT NULL AND btrim(numero_certificado) <> ''
      AND status <> 'CANCELADO';

-- =====================================================================
-- FUNCAO: consumir saldo fumigado (usada ao validar um certificado)
-- Bloqueia a fumigacao, valida o saldo e grava o movimento da
-- conta-corrente. Impede certificado acima do saldo fumigado disponivel.
-- =====================================================================
CREATE OR REPLACE FUNCTION fn_fumigacao_consumir(
    p_fumigacao_id     BIGINT,
    p_quantidade_kg    NUMERIC,
    p_documento_tipo   TEXT,
    p_documento_id     BIGINT,
    p_documento_numero TEXT,
    p_usuario_id       BIGINT,
    p_historico        TEXT DEFAULT NULL
) RETURNS NUMERIC AS $$
DECLARE
    v_total       NUMERIC(18,3);
    v_certificada NUMERIC(18,3);
    v_status      TEXT;
    v_numero      TEXT;
    v_saldo       NUMERIC(18,3);
BEGIN
    IF p_quantidade_kg IS NULL OR p_quantidade_kg <= 0 THEN
        RAISE EXCEPTION 'Quantidade do certificado deve ser maior que zero.';
    END IF;

    SELECT quantidade_kg, quantidade_certificada_kg, status, numero
      INTO v_total, v_certificada, v_status, v_numero
      FROM fumigacoes
     WHERE id = p_fumigacao_id
       FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Fumigacao nao encontrada.';
    END IF;

    IF v_status <> 'VALIDADA' THEN
        RAISE EXCEPTION
            'A fumigacao % nao esta validada (status atual: %). Informe o Comunicado de Fumigacao e valide antes de emitir certificados.',
            v_numero, v_status USING ERRCODE = 'check_violation';
    END IF;

    v_saldo := v_total - v_certificada;

    IF p_quantidade_kg > v_saldo THEN
        RAISE EXCEPTION
            'Saldo fumigado insuficiente na fumigacao %. Disponivel: % t, solicitado: % t.',
            v_numero,
            trim(to_char(v_saldo / 1000, 'FM999999990.999')),
            trim(to_char(p_quantidade_kg / 1000, 'FM999999990.999'))
            USING ERRCODE = 'check_violation';
    END IF;

    UPDATE fumigacoes
       SET quantidade_certificada_kg = v_certificada + p_quantidade_kg,
           atualizado_em = now()
     WHERE id = p_fumigacao_id;

    INSERT INTO fumigacao_movimentos (
        fumigacao_id, tipo, quantidade_kg, saldo_apos_kg,
        documento_tipo, documento_id, documento_numero, historico, usuario_id
    ) VALUES (
        p_fumigacao_id, 'SAIDA', -p_quantidade_kg, v_saldo - p_quantidade_kg,
        p_documento_tipo, p_documento_id, p_documento_numero,
        COALESCE(p_historico, 'Certificado ' || COALESCE(p_documento_numero, '')), p_usuario_id
    );

    RETURN v_saldo - p_quantidade_kg;
END;
$$ LANGUAGE plpgsql;

-- =====================================================================
-- FUNCAO: devolver saldo fumigado (usada ao cancelar um certificado)
-- =====================================================================
CREATE OR REPLACE FUNCTION fn_fumigacao_devolver(
    p_fumigacao_id     BIGINT,
    p_quantidade_kg    NUMERIC,
    p_documento_tipo   TEXT,
    p_documento_id     BIGINT,
    p_documento_numero TEXT,
    p_usuario_id       BIGINT,
    p_historico        TEXT DEFAULT NULL
) RETURNS NUMERIC AS $$
DECLARE
    v_total       NUMERIC(18,3);
    v_certificada NUMERIC(18,3);
    v_saldo       NUMERIC(18,3);
BEGIN
    SELECT quantidade_kg, quantidade_certificada_kg
      INTO v_total, v_certificada
      FROM fumigacoes
     WHERE id = p_fumigacao_id
       FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Fumigacao nao encontrada.';
    END IF;

    IF p_quantidade_kg > v_certificada THEN
        RAISE EXCEPTION 'Estorno maior que a quantidade certificada da fumigacao.';
    END IF;

    UPDATE fumigacoes
       SET quantidade_certificada_kg = v_certificada - p_quantidade_kg,
           atualizado_em = now()
     WHERE id = p_fumigacao_id;

    v_saldo := v_total - (v_certificada - p_quantidade_kg);

    INSERT INTO fumigacao_movimentos (
        fumigacao_id, tipo, quantidade_kg, saldo_apos_kg,
        documento_tipo, documento_id, documento_numero, historico, usuario_id
    ) VALUES (
        p_fumigacao_id, 'ESTORNO', p_quantidade_kg, v_saldo,
        p_documento_tipo, p_documento_id, p_documento_numero,
        COALESCE(p_historico, 'Estorno de certificado'), p_usuario_id
    );

    RETURN v_saldo;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_fumigacoes_atualizado BEFORE UPDATE ON fumigacoes
    FOR EACH ROW EXECUTE FUNCTION fn_set_atualizado_em();
CREATE TRIGGER trg_certificados_atualizado BEFORE UPDATE ON certificados_fumigacao
    FOR EACH ROW EXECUTE FUNCTION fn_set_atualizado_em();

-- ---------------------------------------------------------------------
-- Saldo fumigado por fumigacao e consolidado por produto/local
-- ---------------------------------------------------------------------
CREATE VIEW vw_fumigacao_saldos AS
SELECT f.id,
       f.numero,
       f.numero_comunicado,
       f.produto_id,
       f.local_id,
       f.lote_id,
       f.fumigadora_id,
       f.status,
       f.data_hora_termino,
       f.quantidade_kg,
       f.quantidade_certificada_kg,
       f.quantidade_kg - f.quantidade_certificada_kg AS saldo_kg
  FROM fumigacoes f
 WHERE f.status = 'VALIDADA';
