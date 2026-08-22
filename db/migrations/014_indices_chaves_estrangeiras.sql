-- =====================================================================
-- ERP SHKT - Migration 014
-- Indices das chaves estrangeiras
--
-- O ERP navega muito entre documento, parceiro, operacao e origem. Este
-- bloco cria somente os indices que ainda nao existem e evita varreduras
-- completas ao consultar ou proteger exclusoes de registros referenciados.
-- =====================================================================

DO $$
DECLARE
  fk RECORD;
  colunas TEXT;
  nome_indice TEXT;
BEGIN
  FOR fk IN
    SELECT c.oid, c.conname, c.conrelid, c.conkey, n.nspname, t.relname
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE c.contype = 'f' AND n.nspname = 'public'
       AND NOT EXISTS (
         SELECT 1
           FROM pg_index i
          WHERE i.indrelid = c.conrelid
            AND i.indisvalid
            AND i.indkey::SMALLINT[] @> c.conkey
       )
  LOOP
    SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY u.ord)
      INTO colunas
      FROM unnest(fk.conkey) WITH ORDINALITY AS u(attnum, ord)
      JOIN pg_attribute a ON a.attrelid = fk.conrelid AND a.attnum = u.attnum;

    nome_indice := 'idx_fk_' || left(fk.relname, 38) || '_' || substr(md5(fk.conname), 1, 8);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I.%I (%s)',
                   nome_indice, fk.nspname, fk.relname, colunas);
  END LOOP;
END $$;

