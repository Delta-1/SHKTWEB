-- =====================================================================
-- 011 — cores das operações na paleta do sistema
-- ---------------------------------------------------------------------
-- A cor de cada operação não é enfeite: é o que faz a pessoa reconhecer,
-- de relance, de qual empresa é a linha do extrato. Por isso ela sai do
-- banco e não do CSS — quando o Suécio criar uma terceira operação, a
-- cor dela vem junto.
--
-- As duas cores originais (#039855, #1570ef) eram do tema antigo e
-- destoavam da tela: verde e azul de saturação alta sobre papel quente.
-- Trocadas pelas duas cores da paleta atual, que continuam distinguindo
-- uma operação da outra sem gritar.
-- =====================================================================

UPDATE operacoes SET cor = '#47704f' WHERE codigo = 'SHKT'        AND cor = '#039855';
UPDATE operacoes SET cor = '#4a6b7c' WHERE codigo = 'SHKT-TRANSP' AND cor = '#1570ef';
