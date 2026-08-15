import pg from 'pg';
import config from '../config.js';
import { traduzirErroBanco } from '../lib/erros.js';

const { Pool, types } = pg;

// NUMERIC do Postgres chega como string por padrao (para nao perder precisao).
// Mantemos assim: valores monetarios e quantidades sao tratados como string/Decimal
// no codigo e convertidos apenas na exibicao. Ver src/lib/decimal.js.
types.setTypeParser(20, (v) => (v === null ? null : Number(v))); // int8 -> number

export const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: config.dbSsl ? { rejectUnauthorized: false } : false,
  max: Number(process.env.DB_POOL_MAX || 10),
  idleTimeoutMillis: 30_000,
});

pool.on('error', (err) => {
  console.error('[db] erro inesperado no pool de conexoes:', err.message);
});

/**
 * Ponto unico de traducao de erros do banco.
 * Qualquer violacao de regra que o PostgreSQL reporte (saldo negativo,
 * duplicidade de origem financeira, comunicado ausente...) sai daqui ja como
 * ErroNegocio com mensagem em portugues - nao ha caminho de codigo que
 * consiga devolver um erro cru do Postgres para a tela.
 */
function traduzir(erro) {
  throw traduzirErroBanco(erro);
}

/** Executa uma consulta simples usando o pool. */
export function query(text, params) {
  return pool.query(text, params).catch(traduzir);
}

/** Retorna a primeira linha ou null. */
export async function um(text, params) {
  const { rows } = await pool.query(text, params);
  return rows[0] || null;
}

/** Retorna todas as linhas. */
export async function muitos(text, params) {
  const { rows } = await pool.query(text, params);
  return rows;
}

/**
 * Executa uma funcao dentro de uma transacao.
 * Qualquer excecao lancada dentro do callback provoca ROLLBACK completo -
 * e assim que garantimos que operacoes multi-modulo (certificado -> saldo
 * fumigado -> contas a pagar -> auditoria) nunca fiquem pela metade.
 *
 *   await transacao(async (cx) => {
 *     await cx.query('...');
 *   });
 */
export async function transacao(callback) {
  const cx = await pool.connect();
  try {
    await cx.query('BEGIN');
    const resultado = await callback(cx);
    await cx.query('COMMIT');
    return resultado;
  } catch (erro) {
    try {
      await cx.query('ROLLBACK');
    } catch {
      /* conexao ja perdida */
    }
    throw traduzirErroBanco(erro);
  } finally {
    cx.release();
  }
}

/** Helpers que funcionam tanto no pool quanto dentro de uma transacao. */
export async function umEm(cx, text, params) {
  const { rows } = await cx.query(text, params);
  return rows[0] || null;
}

export async function muitosEm(cx, text, params) {
  const { rows } = await cx.query(text, params);
  return rows;
}

export async function fecharPool() {
  await pool.end();
}

export default { pool, query, um, muitos, transacao, umEm, muitosEm, fecharPool };
