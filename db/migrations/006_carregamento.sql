-- =====================================================================
-- ERP SHKT - Migration 006
-- Ordem de Carregamento / Expedicao / Exportacao
-- Evento que efetivamente da baixa no estoque fisico.
-- =====================================================================

CREATE TABLE carregamentos (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    numero              TEXT NOT NULL UNIQUE,          -- 0001-2026
    data                DATE NOT NULL DEFAULT CURRENT_DATE,
    data_hora_carga     TIMESTAMPTZ,
    cliente_id          BIGINT REFERENCES parceiros(id),
    produto_id          BIGINT NOT NULL REFERENCES produtos(id),
    local_id            BIGINT NOT NULL REFERENCES locais_estoque(id),
    lote_id             BIGINT REFERENCES lotes(id),
    quantidade_kg       NUMERIC(18,3) NOT NULL CHECK (quantidade_kg > 0),
    quantidade_origem   NUMERIC(18,3),
    unidade_id          BIGINT REFERENCES unidades_medida(id),
    -- pesagem
    peso_bruto_kg       NUMERIC(18,3),
    peso_tara_kg        NUMERIC(18,3),
    peso_liquido_kg     NUMERIC(18,3),
    -- logistica
    veiculo_id          BIGINT REFERENCES veiculos(id),
    placa               TEXT,
    placa_reboque       TEXT,
    motorista_id        BIGINT REFERENCES motoristas(id),
    transportadora_id   BIGINT REFERENCES parceiros(id),
    origem              TEXT,
    destino             TEXT,
    pais_destino_id     BIGINT REFERENCES paises(id),
    incoterm_id         BIGINT REFERENCES incoterms(id),
    -- rastreabilidade de fumigacao
    certificado_id      BIGINT REFERENCES certificados_fumigacao(id),
    -- controle
    tipo_operacao       TEXT NOT NULL DEFAULT 'EXPORTACAO'
                        CHECK (tipo_operacao IN ('EXPORTACAO','VENDA_INTERNA','TRANSFERENCIA','OUTRO')),
    observacoes         TEXT,
    responsavel         TEXT,
    status              TEXT NOT NULL DEFAULT 'RASCUNHO' CHECK (status IN (
                            'RASCUNHO','PROGRAMADO','EM_CARREGAMENTO','EXPEDIDO','CANCELADO')),
    expedido_em         TIMESTAMPTZ,
    expedido_por        BIGINT REFERENCES usuarios(id),
    cancelado_em        TIMESTAMPTZ,
    cancelado_por       BIGINT REFERENCES usuarios(id),
    motivo_cancelamento TEXT,
    criado_em           TIMESTAMPTZ NOT NULL DEFAULT now(),
    criado_por          BIGINT REFERENCES usuarios(id),
    atualizado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_por      BIGINT REFERENCES usuarios(id)
);
CREATE INDEX idx_carreg_status ON carregamentos (status);
CREATE INDEX idx_carreg_data ON carregamentos (data DESC);
CREATE INDEX idx_carreg_cliente ON carregamentos (cliente_id);
CREATE INDEX idx_carreg_produto ON carregamentos (produto_id, local_id);
CREATE INDEX idx_carreg_certificado ON carregamentos (certificado_id);

-- Documentos operacionais anexos a operacao (DANFE/NF-e, MIC-DTA, CRT...)
CREATE TABLE carregamento_documentos (
    id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    carregamento_id  BIGINT NOT NULL REFERENCES carregamentos(id) ON DELETE CASCADE,
    tipo             TEXT NOT NULL,     -- DANFE, NFE, MIC_DTA, CRT, PACKING_LIST, OUTRO
    numero           TEXT,
    data             DATE,
    observacoes      TEXT,
    criado_em        TIMESTAMPTZ NOT NULL DEFAULT now(),
    criado_por       BIGINT REFERENCES usuarios(id)
);
CREATE INDEX idx_carregdoc_carregamento ON carregamento_documentos (carregamento_id);

CREATE TRIGGER trg_carregamentos_atualizado BEFORE UPDATE ON carregamentos
    FOR EACH ROW EXECUTE FUNCTION fn_set_atualizado_em();
