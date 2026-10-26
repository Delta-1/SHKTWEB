import { Router } from 'express';
import { query, um } from '../db/index.js';
import { temPermissao } from '../lib/auth.js';

const router = Router();
const modulos = { compras: 'compras.criar', vendas: 'vendas.criar', recebimentos: 'recebimentos.criar' };
function validar(req, res, next) {
  const modulo = req.params.modulo;
  const chave = req.params.chave;
  if (!Object.hasOwn(modulos, modulo) || !/^[a-zA-Z0-9_-]{1,80}$/.test(chave || ''))
    return res.status(400).json({ erro: 'Rascunho inválido.' });
  if (!temPermissao(req.usuario, modulos[modulo]))
    return res.status(403).json({ erro: 'Sem permissão para este formulário.' });
  req.chaveRascunho = modulo + ':' + chave;
  next();
}
router.get('/:modulo/:chave', validar, async (req, res, next) => {
  try {
    const r = await um('SELECT dados, atualizado_em, versao FROM rascunhos_formulario WHERE usuario_id=$1 AND chave=$2',
      [req.usuario.id, req.chaveRascunho]);
    res.set('Cache-Control', 'no-store');
    res.json({ rascunho: r || null });
  } catch (e) { next(e); }
});
router.put('/:modulo/:chave', validar, async (req, res, next) => {
  try {
    const dados = req.body?.dados;
    if (!dados || Array.isArray(dados) || typeof dados !== 'object')
      return res.status(400).json({ erro: 'Formato de rascunho inválido.' });
    if (Buffer.byteLength(JSON.stringify(dados)) > 100000)
      return res.status(413).json({ erro: 'Rascunho muito grande.' });
    const { rows } = await query(`
      INSERT INTO rascunhos_formulario(usuario_id,chave,dados) VALUES($1,$2,$3::jsonb)
      ON CONFLICT(usuario_id,chave) DO UPDATE SET dados=EXCLUDED.dados,
        atualizado_em=NOW(),versao=rascunhos_formulario.versao+1
      RETURNING atualizado_em,versao`,
      [req.usuario.id, req.chaveRascunho, JSON.stringify(dados)]);
    res.json({ salvo: true, ...rows[0] });
  } catch (e) { next(e); }
});
router.delete('/:modulo/:chave', validar, async (req, res, next) => {
  try {
    await query('DELETE FROM rascunhos_formulario WHERE usuario_id=$1 AND chave=$2',
      [req.usuario.id, req.chaveRascunho]);
    res.json({ removido: true });
  } catch (e) { next(e); }
});
export default router;
