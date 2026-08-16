-- =====================================================================
-- ERP SHKT - Migration 008
-- FASE 2 - Ciclo comercial: Compras, Recebimento e Vendas
--
-- Regra estrutural que atravessa todo este arquivo:
--   O PEDIDO NAO MOVE ESTOQUE. Quem move e o recebimento (entrada) e o
--   carregamento (saida). O pedido registra compromisso e dinheiro previsto.
--
-- Assim como no restante do sistema, o que nao pode acontecer esta
-- impedido aqui dentro do banco, e nao apenas na tela.
-- =====================================================================

-- ---------------------------------------------------------------------
-- COMPRAS
-- ---------------------------------------------------------------------
CREATE TABLE pedidos_compra (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    numero              TEXT NOT NULL UNIQUE,               -- 0001-2026
    data                DATE NOT NULL DEFAULT CURRENT_DATE,
    fornecedor_id       BIGINT NOT NULL REFERENCES parceiros(id),
    tipo                TEXT NOT NULL DEFAULT 'MERCADORIA'
                        CHECK (tipo IN ('MERCADORIA','FRETE','SERVICO')),
    incoterm_id         BIGINT REFERENCES incoterms(id),
    moeda               TEXT NOT NULL DEFAULT 'BRL',
    condicao_pagamento  TEXT,
    prazo_dias          INTEGER CHECK (prazo_dias IS NULL OR prazo_dias >= 0),
    previsao_entrega    DATE,
    local_entrega_id    BIGINT REFERENCES locais_estoque(id),
    valor_total         NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (valor_total >= 0),
    observacoes         TEXT,
    status              TEXT NOT NULL DEFAULT 'RASCUNHO' CHECK (status IN (
                            'RASCUNHO','AGUARDANDO_APROVACAO','APROVADO',
                            'PARCIALMENTE_RECEBIDO','RECEBIDO','CANCELADO')),
    aprovado_em         TIMESTAMPTZ,
    aprovado_por        BIGINT REFERENCES usuarios(id),
    cancelado_em        TIMESTAMPTZ,
    cancelado_por       BIGINT REFERENCES usuarios(id),
    motivo_cancelamento TEXT,
    criado_em           TIMESTAMPTZ NOT NULL DEFAULT now(),
    criado_por          BIGINT REFERENCES usuarios(id),
    atualizado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_por      BIGINT REFERENCES usuarios(id),

    -- Pedido em situacao de aprovado tem que ter registro de quem aprovou:
    -- sem isto, "aprovado" e uma palavra sem responsavel.
    CONSTRAINT ck_pc_aprovacao CHECK (
        status NOT IN ('APROVADO','PARCIALMENTE_RECEBIDO','RECEBIDO')
        OR (aprovado_em IS NOT NULL AND aprovado_por IS NOT NULL)),
    CONSTRAINT ck_pc_cancelamento CHECK (
        status <> 'CANCELADO'
        OR (cancelado_em IS NOT NULL AND btrim(COALESCE(motivo_cancelamento,'')) <> ''))
);
CREATE INDEX idx_pc_status ON pedidos_compra (status);
CREATE INDEX idx_pc_data ON pedidos_compra (data DESC);
CREATE INDEX idx_pc_fornecedor ON pedidos_compra (fornecedor_id);
CREATE INDEX idx_pc_entrega ON pedidos_compra (previsao_entrega)
    WHERE status IN ('APROVADO','PARCIALMENTE_RECEBIDO');

CREATE TABLE pedido_compra_itens (
    id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    pedido_id         BIGINT NOT NULL REFERENCES pedidos_compra(id) ON DELETE CASCADE,
    produto_id        BIGINT REFERENCES produtos(id),   -- nulo em frete/servico
    descricao         TEXT NOT NULL,
    quantidade_kg     NUMERIC(18,3) NOT NULL CHECK (quantidade_kg > 0),
    quantidade_origem NUMERIC(18,3),
    unidade_id        BIGINT REFERENCES unidades_medida(id),
    preco_unitario    NUMERIC(18,6) NOT NULL DEFAULT 0 CHECK (preco_unitario >= 0),
    valor_total       NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (valor_total >= 0),
    recebido_kg       NUMERIC(18,3) NOT NULL DEFAULT 0 CHECK (recebido_kg >= 0),
    observacoes       TEXT
);
CREATE INDEX idx_pci_pedido ON pedido_compra_itens (pedido_id);
CREATE INDEX idx_pci_produto ON pedido_compra_itens (produto_id);

-- ---------------------------------------------------------------------
-- RECEBIMENTO - a entrada fisica de mercadoria
-- ---------------------------------------------------------------------
CREATE TABLE recebimentos (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    numero              TEXT NOT NULL UNIQUE,
    data                DATE NOT NULL DEFAULT CURRENT_DATE,
    data_hora_chegada   TIMESTAMPTZ,
    pedido_compra_id    BIGINT REFERENCES pedidos_compra(id),   -- nulo: entrada avulsa
    fornecedor_id       BIGINT NOT NULL REFERENCES parceiros(id),
    local_id            BIGINT NOT NULL REFERENCES locais_estoque(id),
    -- transporte
    veiculo_id          BIGINT REFERENCES veiculos(id),
    placa               TEXT,
    motorista_id        BIGINT REFERENCES motoristas(id),
    transportadora_id   BIGINT REFERENCES parceiros(id),
    -- documento fiscal de entrada
    documento_fiscal    TEXT,
    documento_serie     TEXT,
    documento_data      DATE,
    -- pesagem na balanca
    peso_bruto_kg       NUMERIC(18,3),
    peso_tara_kg        NUMERIC(18,3),
    peso_liquido_kg     NUMERIC(18,3),
    observacoes         TEXT,
    conferente          TEXT,
    status              TEXT NOT NULL DEFAULT 'RASCUNHO'
                        CHECK (status IN ('RASCUNHO','CONFIRMADO','CANCELADO')),
    confirmado_em       TIMESTAMPTZ,
    confirmado_por      BIGINT REFERENCES usuarios(id),
    cancelado_em        TIMESTAMPTZ,
    cancelado_por       BIGINT REFERENCES usuarios(id),
    motivo_cancelamento TEXT,
    criado_em           TIMESTAMPTZ NOT NULL DEFAULT now(),
    criado_por          BIGINT REFERENCES usuarios(id),
    atualizado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_por      BIGINT REFERENCES usuarios(id),

    CONSTRAINT ck_rec_confirmacao CHECK (
        status <> 'CONFIRMADO'
        OR (confirmado_em IS NOT NULL AND confirmado_por IS NOT NULL)),
    CONSTRAINT ck_rec_cancelamento CHECK (
        status <> 'CANCELADO'
        OR (cancelado_em IS NOT NULL AND btrim(COALESCE(motivo_cancelamento,'')) <> ''))
);
CREATE INDEX idx_rec_status ON recebimentos (status);
CREATE INDEX idx_rec_data ON recebimentos (data DESC);
CREATE INDEX idx_rec_pedido ON recebimentos (pedido_compra_id);
CREATE INDEX idx_rec_fornecedor ON recebimentos (fornecedor_id);

CREATE TABLE recebimento_itens (
    id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    recebimento_id        BIGINT NOT NULL REFERENCES recebimentos(id) ON DELETE CASCADE,
    pedido_compra_item_id BIGINT REFERENCES pedido_compra_itens(id),
    produto_id            BIGINT NOT NULL REFERENCES produtos(id),
    lote_id               BIGINT REFERENCES lotes(id),
    quantidade_kg         NUMERIC(18,3) NOT NULL CHECK (quantidade_kg > 0),
    quantidade_origem     NUMERIC(18,3),
    unidade_id            BIGINT REFERENCES unidades_medida(id),
    quantidade_prevista_kg NUMERIC(18,3),     -- o que o pedido dizia, para comparar
    divergencia           TEXT,               -- descricao da diferenca constatada
    observacoes           TEXT
);
CREATE INDEX idx_reci_recebimento ON recebimento_itens (recebimento_id);
CREATE INDEX idx_reci_pedido_item ON recebimento_itens (pedido_compra_item_id);

-- ---------------------------------------------------------------------
-- VENDAS
-- ---------------------------------------------------------------------
CREATE TABLE pedidos_venda (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    numero              TEXT NOT NULL UNIQUE,
    data                DATE NOT NULL DEFAULT CURRENT_DATE,
    cliente_id          BIGINT NOT NULL REFERENCES parceiros(id),
    incoterm_id         BIGINT REFERENCES incoterms(id),
    pais_destino_id     BIGINT REFERENCES paises(id),
    destino             TEXT,
    moeda               TEXT NOT NULL DEFAULT 'BRL',
    condicao_pagamento  TEXT,
    prazo_dias          INTEGER CHECK (prazo_dias IS NULL OR prazo_dias >= 0),
    previsao_embarque   DATE,
    valor_total         NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (valor_total >= 0),
    observacoes         TEXT,
    status              TEXT NOT NULL DEFAULT 'RASCUNHO' CHECK (status IN (
                            'RASCUNHO','AGUARDANDO_APROVACAO','APROVADO',
                            'PARCIALMENTE_ATENDIDO','ATENDIDO','CANCELADO')),
    aprovado_em         TIMESTAMPTZ,
    aprovado_por        BIGINT REFERENCES usuarios(id),
    cancelado_em        TIMESTAMPTZ,
    cancelado_por       BIGINT REFERENCES usuarios(id),
    motivo_cancelamento TEXT,
    criado_em           TIMESTAMPTZ NOT NULL DEFAULT now(),
    criado_por          BIGINT REFERENCES usuarios(id),
    atualizado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_por      BIGINT REFERENCES usuarios(id),

    CONSTRAINT ck_pv_aprovacao CHECK (
        status NOT IN ('APROVADO','PARCIALMENTE_ATENDIDO','ATENDIDO')
        OR (aprovado_em IS NOT NULL AND aprovado_por IS NOT NULL)),
    CONSTRAINT ck_pv_cancelamento CHECK (
        status <> 'CANCELADO'
        OR (cancelado_em IS NOT NULL AND btrim(COALESCE(motivo_cancelamento,'')) <> ''))
);
CREATE INDEX idx_pv_status ON pedidos_venda (status);
CREATE INDEX idx_pv_data ON pedidos_venda (data DESC);
CREATE INDEX idx_pv_cliente ON pedidos_venda (cliente_id);
CREATE INDEX idx_pv_embarque ON pedidos_venda (previsao_embarque)
    WHERE status IN ('APROVADO','PARCIALMENTE_ATENDIDO');

CREATE TABLE pedido_venda_itens (
    id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    pedido_id         BIGINT NOT NULL REFERENCES pedidos_venda(id) ON DELETE CASCADE,
    produto_id        BIGINT NOT NULL REFERENCES produtos(id),
    local_id          BIGINT NOT NULL REFERENCES locais_estoque(id),
    lote_id           BIGINT REFERENCES lotes(id),
    quantidade_kg     NUMERIC(18,3) NOT NULL CHECK (quantidade_kg > 0),
    quantidade_origem NUMERIC(18,3),
    unidade_id        BIGINT REFERENCES unidades_medida(id),
    preco_unitario    NUMERIC(18,6) NOT NULL DEFAULT 0 CHECK (preco_unitario >= 0),
    valor_total       NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (valor_total >= 0),
    atendido_kg       NUMERIC(18,3) NOT NULL DEFAULT 0 CHECK (atendido_kg >= 0),
    observacoes       TEXT
);
CREATE INDEX idx_pvi_pedido ON pedido_venda_itens (pedido_id);
CREATE INDEX idx_pvi_produto ON pedido_venda_itens (produto_id, local_id);

-- O carregamento passa a poder nascer de um pedido de venda.
ALTER TABLE carregamentos
    ADD COLUMN pedido_venda_id      BIGINT REFERENCES pedidos_venda(id),
    ADD COLUMN pedido_venda_item_id BIGINT REFERENCES pedido_venda_itens(id);
CREATE INDEX idx_carreg_pedido_venda ON carregamentos (pedido_venda_id);

-- =====================================================================
-- Totais do cabecalho sempre iguais a soma dos itens.
-- Nao existe caminho pelo qual um pedido mostre um valor que os itens nao
-- sustentem: quem grava item, grava o total junto.
-- =====================================================================
CREATE OR REPLACE FUNCTION fn_pc_recalcular_total() RETURNS TRIGGER AS $$
DECLARE v_pedido BIGINT;
BEGIN
    v_pedido := COALESCE(NEW.pedido_id, OLD.pedido_id);
    UPDATE pedidos_compra p
       SET valor_total = COALESCE(
             (SELECT SUM(i.valor_total) FROM pedido_compra_itens i WHERE i.pedido_id = v_pedido), 0)
     WHERE p.id = v_pedido;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_pci_total AFTER INSERT OR UPDATE OR DELETE ON pedido_compra_itens
    FOR EACH ROW EXECUTE FUNCTION fn_pc_recalcular_total();

CREATE OR REPLACE FUNCTION fn_pv_recalcular_total() RETURNS TRIGGER AS $$
DECLARE v_pedido BIGINT;
BEGIN
    v_pedido := COALESCE(NEW.pedido_id, OLD.pedido_id);
    UPDATE pedidos_venda p
       SET valor_total = COALESCE(
             (SELECT SUM(i.valor_total) FROM pedido_venda_itens i WHERE i.pedido_id = v_pedido), 0)
     WHERE p.id = v_pedido;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_pvi_total AFTER INSERT OR UPDATE OR DELETE ON pedido_venda_itens
    FOR EACH ROW EXECUTE FUNCTION fn_pv_recalcular_total();

-- =====================================================================
-- Itens de pedido aprovado sao imutaveis no que diz respeito ao negocio.
-- O saldo recebido/atendido continua podendo mudar - e justamente o que a
-- operacao faz. Preco, quantidade e produto, nao: isso seria reescrever um
-- compromisso ja assumido com o fornecedor ou com o cliente.
-- =====================================================================
CREATE OR REPLACE FUNCTION fn_pci_proteger() RETURNS TRIGGER AS $$
DECLARE v_status TEXT;
BEGIN
    SELECT status INTO v_status FROM pedidos_compra
     WHERE id = COALESCE(NEW.pedido_id, OLD.pedido_id);

    -- Pai ja removido: e o ON DELETE CASCADE em andamento, nao uma tentativa
    -- de reescrever um pedido vivo.
    IF v_status IS NULL THEN
        RETURN COALESCE(NEW, OLD);
    END IF;

    IF v_status IN ('RASCUNHO','AGUARDANDO_APROVACAO') THEN
        RETURN COALESCE(NEW, OLD);
    END IF;

    IF TG_OP = 'UPDATE'
       AND NEW.produto_id     IS NOT DISTINCT FROM OLD.produto_id
       AND NEW.descricao      IS NOT DISTINCT FROM OLD.descricao
       AND NEW.quantidade_kg  IS NOT DISTINCT FROM OLD.quantidade_kg
       AND NEW.preco_unitario IS NOT DISTINCT FROM OLD.preco_unitario
       AND NEW.valor_total    IS NOT DISTINCT FROM OLD.valor_total THEN
        RETURN NEW;    -- so mudou o saldo recebido: permitido
    END IF;

    RAISE EXCEPTION
        'Os itens de um pedido de compra aprovado nao podem ser alterados. Cancele o pedido e emita outro.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_pci_proteger BEFORE INSERT OR UPDATE OR DELETE ON pedido_compra_itens
    FOR EACH ROW EXECUTE FUNCTION fn_pci_proteger();

CREATE OR REPLACE FUNCTION fn_pvi_proteger() RETURNS TRIGGER AS $$
DECLARE v_status TEXT;
BEGIN
    SELECT status INTO v_status FROM pedidos_venda
     WHERE id = COALESCE(NEW.pedido_id, OLD.pedido_id);

    IF v_status IS NULL THEN
        RETURN COALESCE(NEW, OLD);   -- ON DELETE CASCADE do pai
    END IF;

    IF v_status IN ('RASCUNHO','AGUARDANDO_APROVACAO') THEN
        RETURN COALESCE(NEW, OLD);
    END IF;

    IF TG_OP = 'UPDATE'
       AND NEW.produto_id     IS NOT DISTINCT FROM OLD.produto_id
       AND NEW.local_id       IS NOT DISTINCT FROM OLD.local_id
       AND NEW.quantidade_kg  IS NOT DISTINCT FROM OLD.quantidade_kg
       AND NEW.preco_unitario IS NOT DISTINCT FROM OLD.preco_unitario
       AND NEW.valor_total    IS NOT DISTINCT FROM OLD.valor_total THEN
        RETURN NEW;    -- so mudou o saldo atendido: permitido
    END IF;

    RAISE EXCEPTION
        'Os itens de um pedido de venda aprovado nao podem ser alterados. Cancele o pedido e emita outro.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_pvi_proteger BEFORE INSERT OR UPDATE OR DELETE ON pedido_venda_itens
    FOR EACH ROW EXECUTE FUNCTION fn_pvi_proteger();

-- Recebimento confirmado e um fato: a mercadoria entrou. Nao se reescreve.
CREATE OR REPLACE FUNCTION fn_reci_proteger() RETURNS TRIGGER AS $$
DECLARE v_status TEXT;
BEGIN
    SELECT status INTO v_status FROM recebimentos
     WHERE id = COALESCE(NEW.recebimento_id, OLD.recebimento_id);

    IF v_status IS NULL THEN
        RETURN COALESCE(NEW, OLD);   -- ON DELETE CASCADE do pai
    END IF;

    IF v_status <> 'RASCUNHO' THEN
        RAISE EXCEPTION
            'Os itens de um recebimento ja confirmado nao podem ser alterados. Cancele o recebimento e lance outro.';
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_reci_proteger BEFORE INSERT OR UPDATE OR DELETE ON recebimento_itens
    FOR EACH ROW EXECUTE FUNCTION fn_reci_proteger();

-- =====================================================================
-- Situacao do pedido derivada dos saldos, nunca digitada.
-- Chamadas dentro da transacao que confirma ou cancela a movimentacao.
-- =====================================================================
CREATE OR REPLACE FUNCTION fn_pedido_compra_recalcular(p_id BIGINT)
RETURNS TEXT AS $$
DECLARE
    v_status    TEXT;
    v_pedido    NUMERIC(18,3);
    v_recebido  NUMERIC(18,3);
    v_novo      TEXT;
BEGIN
    SELECT status INTO v_status FROM pedidos_compra WHERE id = p_id FOR UPDATE;
    IF v_status IS NULL THEN
        RAISE EXCEPTION 'Pedido de compra % nao encontrado.', p_id;
    END IF;

    -- Rascunho, aguardando aprovacao e cancelado nao sao afetados por saldo.
    IF v_status IN ('RASCUNHO','AGUARDANDO_APROVACAO','CANCELADO') THEN
        RETURN v_status;
    END IF;

    SELECT COALESCE(SUM(quantidade_kg), 0), COALESCE(SUM(recebido_kg), 0)
      INTO v_pedido, v_recebido
      FROM pedido_compra_itens WHERE pedido_id = p_id;

    v_novo := CASE
        WHEN v_recebido <= 0        THEN 'APROVADO'
        WHEN v_recebido >= v_pedido THEN 'RECEBIDO'
        ELSE 'PARCIALMENTE_RECEBIDO'
    END;

    IF v_novo <> v_status THEN
        UPDATE pedidos_compra SET status = v_novo WHERE id = p_id;
    END IF;
    RETURN v_novo;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_pedido_venda_recalcular(p_id BIGINT)
RETURNS TEXT AS $$
DECLARE
    v_status    TEXT;
    v_pedido    NUMERIC(18,3);
    v_atendido  NUMERIC(18,3);
    v_novo      TEXT;
BEGIN
    SELECT status INTO v_status FROM pedidos_venda WHERE id = p_id FOR UPDATE;
    IF v_status IS NULL THEN
        RAISE EXCEPTION 'Pedido de venda % nao encontrado.', p_id;
    END IF;

    IF v_status IN ('RASCUNHO','AGUARDANDO_APROVACAO','CANCELADO') THEN
        RETURN v_status;
    END IF;

    SELECT COALESCE(SUM(quantidade_kg), 0), COALESCE(SUM(atendido_kg), 0)
      INTO v_pedido, v_atendido
      FROM pedido_venda_itens WHERE pedido_id = p_id;

    v_novo := CASE
        WHEN v_atendido <= 0        THEN 'APROVADO'
        WHEN v_atendido >= v_pedido THEN 'ATENDIDO'
        ELSE 'PARCIALMENTE_ATENDIDO'
    END;

    IF v_novo <> v_status THEN
        UPDATE pedidos_venda SET status = v_novo WHERE id = p_id;
    END IF;
    RETURN v_novo;
END;
$$ LANGUAGE plpgsql;

-- =====================================================================
-- Baixa parcial de reserva.
-- O pedido de venda aprovado reserva o estoque; cada carregamento
-- vinculado consome um pedaco dessa reserva. Sem isto, o mesmo grao
-- apareceria reservado duas vezes - uma pelo pedido, outra pela ordem de
-- carregamento - e o disponivel ficaria menor do que a realidade.
-- =====================================================================
CREATE OR REPLACE FUNCTION fn_reserva_consumir_parcial(
    p_documento_tipo TEXT,
    p_documento_id   BIGINT,
    p_produto_id     BIGINT,
    p_local_id       BIGINT,
    p_lote_id        BIGINT,
    p_quantidade_kg  NUMERIC
) RETURNS NUMERIC AS $$
DECLARE
    v_restante NUMERIC(18,3) := p_quantidade_kg;
    r          RECORD;
    v_usar     NUMERIC(18,3);
BEGIN
    IF p_quantidade_kg IS NULL OR p_quantidade_kg <= 0 THEN
        RETURN 0;
    END IF;

    FOR r IN
        SELECT id, quantidade_kg FROM estoque_reservas
         WHERE documento_tipo = p_documento_tipo
           AND documento_id   = p_documento_id
           AND produto_id     = p_produto_id
           AND local_id       = p_local_id
           AND COALESCE(lote_id, 0) = COALESCE(p_lote_id, 0)
           AND status = 'ATIVA'
         ORDER BY id
           FOR UPDATE
    LOOP
        EXIT WHEN v_restante <= 0;
        v_usar := LEAST(r.quantidade_kg, v_restante);

        IF v_usar >= r.quantidade_kg THEN
            UPDATE estoque_reservas
               SET status = 'CONSUMIDA', baixado_em = now()
             WHERE id = r.id;
        ELSE
            UPDATE estoque_reservas
               SET quantidade_kg = quantidade_kg - v_usar
             WHERE id = r.id;
        END IF;

        v_restante := v_restante - v_usar;
    END LOOP;

    -- Devolve quanto SOBROU sem cobertura de reserva. O chamador decide o
    -- que fazer: normalmente e carga a mais do que o pedido previa.
    RETURN v_restante;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------
-- Carimbo de atualizacao
-- ---------------------------------------------------------------------
CREATE TRIGGER trg_pedidos_compra_atualizado BEFORE UPDATE ON pedidos_compra
    FOR EACH ROW EXECUTE FUNCTION fn_set_atualizado_em();
CREATE TRIGGER trg_recebimentos_atualizado BEFORE UPDATE ON recebimentos
    FOR EACH ROW EXECUTE FUNCTION fn_set_atualizado_em();
CREATE TRIGGER trg_pedidos_venda_atualizado BEFORE UPDATE ON pedidos_venda
    FOR EACH ROW EXECUTE FUNCTION fn_set_atualizado_em();

-- =====================================================================
-- Visoes de saldo em aberto - o que a operacao pergunta todo dia:
-- "quanto ainda falta chegar?" e "quanto ainda falta embarcar?"
-- =====================================================================
CREATE OR REPLACE VIEW vw_compras_saldo AS
SELECT p.id                AS pedido_id,
       p.numero,
       p.data,
       p.status,
       p.previsao_entrega,
       f.razao_social      AS fornecedor,
       i.id                AS item_id,
       i.descricao,
       pr.codigo           AS produto_codigo,
       pr.descricao        AS produto,
       i.quantidade_kg::NUMERIC(18,3)                       AS pedido_kg,
       i.recebido_kg::NUMERIC(18,3)                         AS recebido_kg,
       GREATEST(i.quantidade_kg - i.recebido_kg, 0)::NUMERIC(18,3) AS saldo_kg,
       i.valor_total
  FROM pedidos_compra p
  JOIN parceiros f            ON f.id = p.fornecedor_id
  JOIN pedido_compra_itens i  ON i.pedido_id = p.id
  LEFT JOIN produtos pr       ON pr.id = i.produto_id
 WHERE p.status IN ('APROVADO','PARCIALMENTE_RECEBIDO');

CREATE OR REPLACE VIEW vw_vendas_saldo AS
SELECT p.id                AS pedido_id,
       p.numero,
       p.data,
       p.status,
       p.previsao_embarque,
       c.razao_social      AS cliente,
       i.id                AS item_id,
       pr.codigo           AS produto_codigo,
       pr.descricao        AS produto,
       l.nome              AS local,
       i.quantidade_kg::NUMERIC(18,3)                        AS pedido_kg,
       i.atendido_kg::NUMERIC(18,3)                          AS atendido_kg,
       GREATEST(i.quantidade_kg - i.atendido_kg, 0)::NUMERIC(18,3) AS saldo_kg,
       i.valor_total
  FROM pedidos_venda p
  JOIN parceiros c            ON c.id = p.cliente_id
  JOIN pedido_venda_itens i   ON i.pedido_id = p.id
  JOIN produtos pr            ON pr.id = i.produto_id
  JOIN locais_estoque l       ON l.id = i.local_id
 WHERE p.status IN ('APROVADO','PARCIALMENTE_ATENDIDO');
