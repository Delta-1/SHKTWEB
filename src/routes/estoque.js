import { Router } from 'express';
import { exigir } from '../lib/auth.js';
import { carregar } from '../lib/referencias.js';
import * as estoque from '../services/estoque.js';
import * as validar from '../lib/validar.js';
import { hojeISO } from '../lib/formato.js';

const router = Router();
const ctx = (req) => ({ ip: req.ip, sessao: req.sessionID });

// -------------------------------------------------------------- posicao
router.get('/', exigir('estoque.visualizar'), async (req, res, next) => {
  try {
    const filtros = {
      produtoId: req.query.produto || null,
      localId: req.query.local || null,
      incluirZerados: req.query.zerados === '1',
    };
    const [posicao, totais, ref] = await Promise.all([
      estoque.posicao(filtros),
      estoque.totais(),
      carregar(['produtos', 'locais']),
    ]);

    res.render('estoque/posicao', { titulo: 'Estoque', posicao, totais, ref, filtros });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------- movimentacoes
router.get('/movimentos', exigir('estoque.visualizar'), async (req, res, next) => {
  try {
    const filtros = {
      produtoId: req.query.produto || null,
      localId: req.query.local || null,
      tipo: req.query.tipo || null,
      de: req.query.de || null,
      ate: req.query.ate || null,
    };
    const [movimentos, ref] = await Promise.all([
      estoque.movimentos(filtros),
      carregar(['produtos', 'locais']),
    ]);

    res.render('estoque/movimentos', {
      titulo: 'Movimentações de estoque',
      movimentos,
      ref,
      filtros,
    });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------- ajuste
router.get('/ajuste', exigir('estoque.criar'), async (req, res, next) => {
  try {
    const ref = await carregar(['produtos', 'locais', 'unidades', 'lotes']);
    res.render('estoque/ajuste', {
      titulo: 'Ajuste de estoque',
      ref,
      hoje: hojeISO(),
      tipo: req.query.tipo === 'saida' ? 'AJUSTE_SAIDA' : 'AJUSTE_ENTRADA',
    });
  } catch (e) {
    next(e);
  }
});

router.post('/ajuste', exigir('estoque.criar'), async (req, res, next) => {
  try {
    const dados = {
      tipo: validar.escolha(req.body.tipo, 'Tipo', ['AJUSTE_ENTRADA', 'AJUSTE_SAIDA', 'SALDO_INICIAL'], {
        obrigatorio: true,
      }),
      produtoId: validar.id(req.body.produto_id, 'Produto', { obrigatorio: true }),
      localId: validar.id(req.body.local_id, 'Local', { obrigatorio: true }),
      loteId: validar.id(req.body.lote_id, 'Lote'),
      quantidade: validar.quantidade(req.body.quantidade, 'Quantidade', { obrigatorio: true }),
      unidadeId: validar.id(req.body.unidade_id, 'Unidade', { obrigatorio: true }),
      dataMovimento: validar.data(req.body.data, 'Data'),
      motivo: validar.texto(req.body.motivo, 'Motivo', { obrigatorio: true, min: 5 }),
      observacoes: validar.texto(req.body.observacoes, 'Observações'),
    };

    const r = await estoque.ajustar(dados, req.usuario, ctx(req));
    res.avisar(`Ajuste ${r.numero} registrado.`);
    req.session.save(() => res.redirect('/estoque/movimentos'));
  } catch (e) {
    next(e);
  }
});

// --------------------------------------------------------- transferencia
router.get('/transferencia', exigir('estoque.criar'), async (req, res, next) => {
  try {
    const ref = await carregar(['produtos', 'locais', 'unidades', 'lotes']);
    res.render('estoque/transferencia', { titulo: 'Transferência entre locais', ref, hoje: hojeISO() });
  } catch (e) {
    next(e);
  }
});

router.post('/transferencia', exigir('estoque.criar'), async (req, res, next) => {
  try {
    const dados = {
      produtoId: validar.id(req.body.produto_id, 'Produto', { obrigatorio: true }),
      localOrigemId: validar.id(req.body.local_origem_id, 'Local de origem', { obrigatorio: true }),
      localDestinoId: validar.id(req.body.local_destino_id, 'Local de destino', { obrigatorio: true }),
      loteId: validar.id(req.body.lote_id, 'Lote'),
      quantidade: validar.quantidade(req.body.quantidade, 'Quantidade', { obrigatorio: true }),
      unidadeId: validar.id(req.body.unidade_id, 'Unidade', { obrigatorio: true }),
      dataMovimento: validar.data(req.body.data, 'Data'),
      observacoes: validar.texto(req.body.observacoes, 'Observações'),
    };

    const r = await estoque.transferir(dados, req.usuario, ctx(req));
    res.avisar(`Transferência ${r.numero} registrada.`);
    req.session.save(() => res.redirect('/estoque'));
  } catch (e) {
    next(e);
  }
});

// --------------------------------------------------------------- estorno
router.post('/movimentos/:id/estornar', exigir('estoque.cancelar'), async (req, res, next) => {
  try {
    const motivo = validar.texto(req.body.motivo, 'Motivo do estorno', { obrigatorio: true, min: 5 });
    await estoque.estornar(req.params.id, motivo, req.usuario, ctx(req));
    res.avisar('Movimento estornado. O lançamento original foi preservado no histórico.');
    req.session.save(() => res.redirect('/estoque/movimentos'));
  } catch (e) {
    next(e);
  }
});

export default router;
