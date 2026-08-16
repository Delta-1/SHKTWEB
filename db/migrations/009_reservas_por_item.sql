-- =====================================================================
-- ERP SHKT - Migration 009
-- Reserva de estoque por POSICAO, nao por documento
--
-- Ate a Fase 1 todo documento que reservava tinha uma linha so (a ordem de
-- carregamento), entao "uma reserva ativa por documento" bastava.
--
-- O pedido de venda quebra essa suposicao: um pedido pode reservar milho no
-- Armazem 1 e soja no Armazem 2. Sao duas reservas do mesmo documento, e as
-- duas sao legitimas.
--
-- A regra correta e: um documento nao reserva DUAS VEZES A MESMA POSICAO
-- (produto + local + lote). Continua impedindo reserva duplicada, sem
-- impedir pedido com varios itens.
-- =====================================================================

DROP INDEX IF EXISTS uq_reservas_documento;

CREATE UNIQUE INDEX uq_reservas_documento ON estoque_reservas
    (documento_tipo, documento_id, produto_id, local_id, COALESCE(lote_id, 0))
    WHERE status = 'ATIVA';

-- =====================================================================
-- Reposicao de reserva.
--
-- Ao cancelar um carregamento ja expedido de um pedido de venda, a
-- mercadoria volta ao estoque e o compromisso com o cliente volta a valer:
-- a reserva precisa ser reposta.
--
-- Se ainda existe reserva ativa daquela posicao, a quantidade e SOMADA a
-- ela. Inserir outra linha criaria duas reservas ativas da mesma posicao
-- para o mesmo documento - exatamente o que o indice acima proibe, e com
-- razao: duas linhas para a mesma coisa e como o saldo se perde.
-- =====================================================================
CREATE OR REPLACE FUNCTION fn_reserva_repor(
    p_documento_tipo   TEXT,
    p_documento_id     BIGINT,
    p_documento_numero TEXT,
    p_produto_id       BIGINT,
    p_local_id         BIGINT,
    p_lote_id          BIGINT,
    p_quantidade_kg    NUMERIC,
    p_usuario_id       BIGINT
) RETURNS BIGINT AS $$
DECLARE
    v_id BIGINT;
BEGIN
    IF p_quantidade_kg IS NULL OR p_quantidade_kg <= 0 THEN
        RETURN NULL;
    END IF;

    SELECT id INTO v_id FROM estoque_reservas
     WHERE documento_tipo = p_documento_tipo
       AND documento_id   = p_documento_id
       AND produto_id     = p_produto_id
       AND local_id       = p_local_id
       AND COALESCE(lote_id, 0) = COALESCE(p_lote_id, 0)
       AND status = 'ATIVA'
       FOR UPDATE;

    IF v_id IS NOT NULL THEN
        UPDATE estoque_reservas
           SET quantidade_kg = quantidade_kg + p_quantidade_kg
         WHERE id = v_id;
        RETURN v_id;
    END IF;

    INSERT INTO estoque_reservas
        (produto_id, local_id, lote_id, quantidade_kg,
         documento_tipo, documento_id, documento_numero, criado_por)
    VALUES (p_produto_id, p_local_id, p_lote_id, p_quantidade_kg,
            p_documento_tipo, p_documento_id, p_documento_numero, p_usuario_id)
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$$ LANGUAGE plpgsql;
