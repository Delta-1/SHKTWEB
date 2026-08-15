/**
 * Executor de migracoes.
 * Aplica, em ordem, todos os arquivos .sql de db/migrations que ainda nao
 * foram aplicados neste banco. Cada arquivo roda dentro de uma transacao.
 *
 *   npm run migrate
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { pool, transacao } from './index.js';
import { ROOT } from '../config.js';

const DIR = path.join(ROOT, 'db', 'migrations');

async function garantirTabelaControle() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migracoes (
      arquivo     TEXT PRIMARY KEY,
      aplicada_em TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

export async function migrar({ silencioso = false } = {}) {
  const log = (...a) => !silencioso && console.log(...a);

  await garantirTabelaControle();

  const { rows } = await pool.query('SELECT arquivo FROM _migracoes');
  const aplicadas = new Set(rows.map((r) => r.arquivo));

  const arquivos = (await fs.readdir(DIR)).filter((f) => f.endsWith('.sql')).sort();

  let novas = 0;
  for (const arquivo of arquivos) {
    if (aplicadas.has(arquivo)) continue;

    const sql = await fs.readFile(path.join(DIR, arquivo), 'utf8');
    log(`  -> aplicando ${arquivo}`);

    await transacao(async (cx) => {
      await cx.query(sql);
      await cx.query('INSERT INTO _migracoes (arquivo) VALUES ($1)', [arquivo]);
    });

    novas += 1;
  }

  if (novas === 0) log('  Banco de dados já está atualizado.');
  else log(`  ${novas} migração(ões) aplicada(s).`);

  return novas;
}

const executadoDiretamente =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);

if (executadoDiretamente) {
  console.log('Migrando banco de dados do ERP SHKT...');
  migrar()
    .then(() => pool.end())
    .then(() => process.exit(0))
    .catch((e) => {
      console.error('\nFalha na migração:', e.message);
      console.error(e.stack);
      process.exit(1);
    });
}
