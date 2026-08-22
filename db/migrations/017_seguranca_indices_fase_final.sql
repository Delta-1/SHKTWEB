-- =====================================================================
-- ERP SHKT - Migration 017
-- RLS/revogacoes e indices de integridade para as tabelas da fase final.
-- =====================================================================

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'cotacoes_moeda','folhas_competencia','folha_funcionarios','provisoes_rh',
    'tipos_obrigacao','obrigacoes','viagem_acertos','importacoes','importacao_linhas'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  END LOOP;
END $$;

ALTER VIEW vw_titulos SET (security_invoker = true);
ALTER VIEW vw_viagens_resultado SET (security_invoker = true);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON cotacoes_moeda,folhas_competencia,folha_funcionarios,provisoes_rh,
      tipos_obrigacao,obrigacoes,viagem_acertos,importacoes,importacao_linhas FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON cotacoes_moeda,folhas_competencia,folha_funcionarios,provisoes_rh,
      tipos_obrigacao,obrigacoes,viagem_acertos,importacoes,importacao_linhas FROM authenticated;
  END IF;
END $$;

CREATE INDEX idx_cotacoes_moeda_fk ON cotacoes_moeda(moeda_id);
CREATE INDEX idx_folhas_operacao_fk ON folhas_competencia(operacao_id);
CREATE INDEX idx_folhas_moeda_fk ON folhas_competencia(moeda_id);
CREATE INDEX idx_folhas_criado_por_fk ON folhas_competencia(criado_por);
CREATE INDEX idx_folhas_fechada_por_fk ON folhas_competencia(fechada_por);
CREATE INDEX idx_folha_itens_folha_fk ON folha_funcionarios(folha_id);
CREATE INDEX idx_folha_itens_cp_fk ON folha_funcionarios(conta_pagar_id);
CREATE INDEX idx_provisoes_funcionario_fk ON provisoes_rh(funcionario_id);
CREATE INDEX idx_tipos_obrigacao_categoria_fk ON tipos_obrigacao(categoria_id);
CREATE INDEX idx_obrigacoes_tipo_fk ON obrigacoes(tipo_id);
CREATE INDEX idx_obrigacoes_operacao_fk ON obrigacoes(operacao_id);
CREATE INDEX idx_obrigacoes_moeda_fk ON obrigacoes(moeda_id);
CREATE INDEX idx_obrigacoes_centro_fk ON obrigacoes(centro_custo_id);
CREATE INDEX idx_acertos_cp_fk ON viagem_acertos(conta_pagar_id);
CREATE INDEX idx_acertos_cr_fk ON viagem_acertos(conta_receber_id);
CREATE INDEX idx_importacoes_criado_por_fk ON importacoes(criado_por);
