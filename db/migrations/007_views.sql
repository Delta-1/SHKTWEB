-- =====================================================================
-- ERP SHKT - Migration 007
-- Visoes consolidadas usadas por telas, dashboard e relatorios.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Posicao de estoque por produto + local + lote
--   fisico     = soma das movimentacoes
--   reservado  = comprometido por carregamentos abertos
--   disponivel = fisico - reservado
--   fumigado   = saldo fumigado validado ainda nao certificado
-- ---------------------------------------------------------------------
CREATE VIEW vw_estoque_posicao AS
WITH reservas AS (
    SELECT produto_id, local_id, COALESCE(lote_id, 0) AS lote_key,
           SUM(quantidade_kg) AS reservado_kg
      FROM estoque_reservas
     WHERE status = 'ATIVA'
     GROUP BY produto_id, local_id, COALESCE(lote_id, 0)
),
fumigado AS (
    SELECT produto_id, local_id, COALESCE(lote_id, 0) AS lote_key,
           SUM(quantidade_kg - quantidade_certificada_kg) AS fumigado_saldo_kg,
           SUM(quantidade_kg) AS fumigado_total_kg
      FROM fumigacoes
     WHERE status = 'VALIDADA'
     GROUP BY produto_id, local_id, COALESCE(lote_id, 0)
),
expedido AS (
    SELECT produto_id, local_id, COALESCE(lote_id, 0) AS lote_key,
           SUM(-quantidade_kg) AS expedido_kg
      FROM estoque_movimentos
     WHERE tipo = 'CARREGAMENTO'
     GROUP BY produto_id, local_id, COALESCE(lote_id, 0)
)
SELECT s.id,
       s.produto_id,
       p.codigo    AS produto_codigo,
       p.descricao AS produto_descricao,
       p.estoque_minimo_kg,
       s.local_id,
       l.codigo    AS local_codigo,
       l.nome      AS local_nome,
       s.lote_id,
       lt.codigo   AS lote_codigo,
       s.quantidade_kg                                                    AS fisico_kg,
       COALESCE(r.reservado_kg, 0)::NUMERIC(18,3)                         AS reservado_kg,
       (s.quantidade_kg - COALESCE(r.reservado_kg, 0))::NUMERIC(18,3)     AS disponivel_kg,
       COALESCE(f.fumigado_saldo_kg, 0)::NUMERIC(18,3)                    AS fumigado_saldo_kg,
       COALESCE(f.fumigado_total_kg, 0)::NUMERIC(18,3)                    AS fumigado_total_kg,
       COALESCE(e.expedido_kg, 0)::NUMERIC(18,3)                          AS expedido_kg
  FROM estoque_saldos s
  JOIN produtos p        ON p.id = s.produto_id
  JOIN locais_estoque l  ON l.id = s.local_id
  LEFT JOIN lotes lt     ON lt.id = s.lote_id
  LEFT JOIN reservas r   ON r.produto_id = s.produto_id AND r.local_id = s.local_id AND r.lote_key = s.lote_key
  LEFT JOIN fumigado f   ON f.produto_id = s.produto_id AND f.local_id = s.local_id AND f.lote_key = s.lote_key
  LEFT JOIN expedido e   ON e.produto_id = s.produto_id AND e.local_id = s.local_id AND e.lote_key = s.lote_key;

-- ---------------------------------------------------------------------
-- Titulos financeiros unificados (para dashboard e fluxo de caixa)
-- ---------------------------------------------------------------------
CREATE VIEW vw_titulos AS
SELECT 'CP'::TEXT AS tipo,
       cp.id, cp.numero, cp.descricao, cp.origem, cp.origem_tipo, cp.origem_id, cp.origem_numero,
       cp.parceiro_id, cp.emissao, cp.vencimento, cp.valor, cp.moeda_id,
       cp.valor_pago AS valor_liquidado,
       cp.valor - cp.valor_pago AS saldo,
       cp.status, cp.categoria_id, cp.centro_custo_id
  FROM contas_pagar cp
 WHERE cp.status <> 'CANCELADO'
UNION ALL
SELECT 'CR'::TEXT AS tipo,
       cr.id, cr.numero, cr.descricao, cr.origem, cr.origem_tipo, cr.origem_id, cr.origem_numero,
       cr.parceiro_id, cr.emissao, cr.vencimento, cr.valor, cr.moeda_id,
       cr.valor_recebido AS valor_liquidado,
       cr.valor - cr.valor_recebido AS saldo,
       cr.status, cr.categoria_id, cr.centro_custo_id
  FROM contas_receber cr
 WHERE cr.status <> 'CANCELADO';

-- ---------------------------------------------------------------------
-- Rastreabilidade completa: Fumigacao -> Certificado -> Carregamento -> CP
-- ---------------------------------------------------------------------
CREATE VIEW vw_rastreabilidade AS
SELECT f.id            AS fumigacao_id,
       f.numero        AS fumigacao_numero,
       f.numero_comunicado,
       f.status        AS fumigacao_status,
       f.quantidade_kg AS fumigacao_kg,
       f.quantidade_certificada_kg,
       f.quantidade_kg - f.quantidade_certificada_kg AS fumigacao_saldo_kg,
       c.id            AS certificado_id,
       c.numero        AS certificado_numero,
       c.numero_certificado,
       c.quantidade_kg AS certificado_kg,
       c.status        AS certificado_status,
       c.valor_total   AS certificado_valor,
       cp.id           AS conta_pagar_id,
       cp.numero       AS conta_pagar_numero,
       cp.status       AS conta_pagar_status,
       cp.vencimento   AS conta_pagar_vencimento,
       cg.id           AS carregamento_id,
       cg.numero       AS carregamento_numero,
       cg.status       AS carregamento_status,
       cg.quantidade_kg AS carregamento_kg,
       cg.destino
  FROM fumigacoes f
  LEFT JOIN certificados_fumigacao c ON c.fumigacao_id = f.id AND c.status <> 'CANCELADO'
  LEFT JOIN contas_pagar cp          ON cp.id = c.conta_pagar_id
  LEFT JOIN carregamentos cg         ON cg.certificado_id = c.id AND cg.status <> 'CANCELADO';
