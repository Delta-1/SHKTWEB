-- Indices em local_id que nao eram a primeira coluna de indices compostos.
CREATE INDEX IF NOT EXISTS idx_carregamentos_local ON carregamentos (local_id);
CREATE INDEX IF NOT EXISTS idx_estoque_movimentos_local ON estoque_movimentos (local_id);
CREATE INDEX IF NOT EXISTS idx_estoque_reservas_local ON estoque_reservas (local_id);
CREATE INDEX IF NOT EXISTS idx_estoque_saldos_local ON estoque_saldos (local_id);
CREATE INDEX IF NOT EXISTS idx_fumigacoes_local ON fumigacoes (local_id);
CREATE INDEX IF NOT EXISTS idx_pedido_venda_itens_local ON pedido_venda_itens (local_id);

