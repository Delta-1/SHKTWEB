/**
 * Prepara o banco: aplica as migrações pendentes e faz a carga inicial.
 *
 *   node scripts/preparar-banco.js
 *
 * É um comando único de propósito: hospedagens executam o "pre-deploy" como
 * lista de argumentos, sem shell, então encadear com "&&" não funciona em
 * todas elas. Aqui as duas etapas acontecem no mesmo processo, na ordem certa,
 * e o código de saída reflete o resultado real.
 *
 * As duas etapas são idempotentes: rodar a cada deploy é seguro.
 */
import { migrar } from '../src/db/migrate.js';
import { semear } from '../src/db/seed.js';
import { pool } from '../src/db/index.js';

try {
  console.log('Preparando o banco do ERP SHKT...\n');

  console.log('1/2 Migrações');
  await migrar();

  console.log('\n2/2 Carga inicial');
  await semear();

  const { rows } = await pool.query(`
    SELECT (SELECT COUNT(*)::INT FROM usuarios) AS usuarios,
           (SELECT COUNT(*)::INT FROM perfis)   AS perfis,
           (SELECT COUNT(*)::INT FROM produtos) AS produtos
  `);
  const r = rows[0];
  console.log(
    `\nBanco pronto: ${r.usuarios} usuário(s), ${r.perfis} perfil(is), ${r.produtos} produto(s).`
  );

  if (r.usuarios === 0) {
    console.error('Nenhum usuário foi criado — ninguém conseguirá entrar no sistema.');
    await pool.end();
    process.exit(1);
  }

  await pool.end();
  process.exit(0);
} catch (erro) {
  console.error('\nFalha ao preparar o banco:', erro.message);
  console.error(erro.stack);
  try {
    await pool.end();
  } catch {
    /* pool já encerrado */
  }
  process.exit(1);
}
