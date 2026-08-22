-- Categoria de receita usada quando o motorista devolve saldo de
-- adiantamento. Fica em OUTRAS para reduzir o efeito líquido do acerto sem
-- transformar a devolução em novo custo de veículo.
INSERT INTO categorias_financeiras (codigo,nome,tipo,grupo_dre,ordem_dre)
VALUES ('RECUPERACAO_DESPESA','Recuperacao de despesas','RECEITA','OUTRAS',120)
ON CONFLICT (codigo) DO NOTHING;
