import { Router } from 'express';
import { exigir } from '../lib/auth.js';
import { muitos } from '../db/index.js';
import { MODULOS } from '../lib/permissoes.js';
import { ACOES } from '../lib/auditoria.js';

const router = Router();

router.get('/', exigir('auditoria.visualizar'), async (req, res, next) => {
  try {
    const cond = [];
    const params = [];

    if (req.query.modulo) {
      params.push(req.query.modulo);
      cond.push(`a.modulo = $${params.length}`);
    }
    if (req.query.acao) {
      params.push(req.query.acao);
      cond.push(`a.acao = $${params.length}`);
    }
    if (req.query.usuario) {
      params.push(req.query.usuario);
      cond.push(`a.usuario_id = $${params.length}`);
    }
    if (req.query.de) {
      params.push(req.query.de);
      cond.push(`a.data_hora >= $${params.length}::DATE`);
    }
    if (req.query.ate) {
      params.push(req.query.ate);
      cond.push(`a.data_hora < ($${params.length}::DATE + 1)`);
    }
    if (req.query.busca) {
      params.push(`%${req.query.busca}%`);
      cond.push(`(a.descricao ILIKE $${params.length} OR a.registro_numero ILIKE $${params.length})`);
    }

    params.push(Number(req.query.limite || 200));

    const [registros, usuarios] = await Promise.all([
      muitos(
        `SELECT a.* FROM auditoria a
          ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''}
          ORDER BY a.data_hora DESC, a.id DESC
          LIMIT $${params.length}`,
        params
      ),
      muitos('SELECT id, nome FROM usuarios ORDER BY nome'),
    ]);

    res.render('auditoria', {
      titulo: 'Auditoria',
      registros,
      usuarios,
      modulos: MODULOS,
      acoes: Object.keys(ACOES),
      filtros: req.query,
    });
  } catch (e) {
    next(e);
  }
});

export default router;
