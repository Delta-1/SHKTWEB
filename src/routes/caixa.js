import { Router } from 'express';
import { exigir } from '../lib/auth.js';
import * as caixa from '../services/caixa.js';
import * as validar from '../lib/validar.js';
import { ErroNaoEncontrado } from '../lib/erros.js';
import { hojeISO } from '../lib/formato.js';

const router = Router();
const ctx = (req) => ({ ip: req.ip, sessao: req.sessionID });

router.get('/', exigir('caixa.visualizar'), async (req, res, next) => {
  try {
    const [abertos, atual] = await Promise.all([
      caixa.listarCaixasAbertos(),
      caixa.caixaAtual(validar.id(req.query.caixa, 'Caixa')),
    ]);
    const referencias = atual ? null : await caixa.referenciasAbertura();
    res.render('caixa/atual', {
      titulo: 'Caixa atual',
      aba: 'atual',
      abertos,
      caixa: atual,
      referencias,
    });
  } catch (e) { next(e); }
});

router.post('/abrir', exigir('caixa.criar'), async (req, res, next) => {
  try {
    const aberto = await caixa.abrirCaixa({
      contaBancariaId: validar.id(req.body.conta_bancaria_id, 'Conta de caixa', { obrigatorio: true }),
      operacaoId: validar.id(req.body.operacao_id, 'Operação'),
      saldoInicial: validar.dinheiro(req.body.saldo_inicial || '0', 'Saldo inicial', {
        obrigatorio: true, min: '0',
      }),
      observacoes: validar.texto(req.body.observacoes, 'Observações', { max: 500 }),
    }, req.usuario, ctx(req));
    res.avisar(`Caixa ${aberto.numero} aberto. As movimentações financeiras entrarão automaticamente.`);
    req.session.save(() => res.redirect(`/caixa?caixa=${aberto.id}`));
  } catch (e) { next(e); }
});

router.get('/anteriores', exigir('caixa.visualizar'), async (req, res, next) => {
  try {
    const filtros = {
      de: validar.data(req.query.de, 'Data inicial') || hojeISO().slice(0, 8) + '01',
      ate: validar.data(req.query.ate, 'Data final') || hojeISO(),
      contaId: validar.id(req.query.conta, 'Conta'),
    };
    const [lista, referencias] = await Promise.all([
      caixa.listarHistorico(filtros),
      caixa.referenciasAbertura(),
    ]);
    res.render('caixa/historico', {
      titulo: 'Caixas anteriores', aba: 'anteriores', lista, filtros, referencias,
    });
  } catch (e) { next(e); }
});

function filtrosConferencia(req) {
  return {
    de: validar.data(req.query.de, 'Data inicial') || hojeISO().slice(0, 8) + '01',
    ate: validar.data(req.query.ate, 'Data final') || hojeISO(),
    formaId: validar.id(req.query.forma, 'Forma de pagamento'),
    caixaId: validar.id(req.query.caixa, 'Caixa'),
  };
}

router.get('/conferencia', exigir('caixa.visualizar'), async (req, res, next) => {
  try {
    const filtros = filtrosConferencia(req);
    const [movimentos, formas] = await Promise.all([
      caixa.listarConferencia(filtros), caixa.listarFormas(),
    ]);
    res.render('caixa/conferencia', {
      titulo: 'Conferir meios de pagamento',
      aba: 'conferencia',
      movimentos,
      formas,
      filtros,
      saldoFiltrado: caixa.resumirMovimentos('0', movimentos).saldoFinal,
    });
  } catch (e) { next(e); }
});

const celulaCsv = (valor) => {
  let texto = valor === null || valor === undefined ? '' : String(valor);
  if (/^[=+\-@]/.test(texto)) texto = `'${texto}`;
  return `"${texto.replace(/"/g, '""')}"`;
};

router.get('/conferencia.csv', exigir('caixa.exportar'), async (req, res, next) => {
  try {
    const movimentos = await caixa.listarConferencia(filtrosConferencia(req));
    const linhas = [
      ['Data','Hora','Meio de pagamento','Valor','Tipo','Transação','Caixa','Usuário'],
      ...movimentos.map((m) => [
        String(m.data).slice(0,10),
        new Date(m.criado_em).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}),
        m.forma_pagamento || '',
        `${m.tipo === 'SAIDA' ? '-' : ''}${m.valor}`,
        m.historico,
        m.transacao_numero || m.id,
        m.caixa_numero,
        m.usuario || '',
      ]),
    ];
    const csv = linhas.map((l) => l.map(celulaCsv).join(';')).join('\r\n');
    res.setHeader('Content-Type','text/csv; charset=utf-8');
    res.setHeader('Content-Disposition',`attachment; filename="shkt-conferencia-caixa-${hojeISO()}.csv"`);
    res.send('\ufeff' + csv);
  } catch (e) { next(e); }
});

router.get('/contador', exigir('caixa.visualizar'), (_req, res) => {
  res.render('caixa/contador', { titulo: 'Contador de dinheiro', aba: 'contador' });
});

router.post('/:id/suprimento', exigir('caixa.liquidar'), async (req, res, next) => {
  try {
    await caixa.registrarMovimentoManual(req.params.id, 'SUPRIMENTO', {
      valor: validar.dinheiro(req.body.valor, 'Valor', { obrigatorio: true, positivo: true }),
      motivo: validar.texto(req.body.motivo, 'Motivo', { obrigatorio: true, min: 5, max: 300 }),
    }, req.usuario, ctx(req));
    res.avisar('Dinheiro adicionado ao caixa.');
    req.session.save(() => res.redirect(`/caixa?caixa=${req.params.id}`));
  } catch (e) { next(e); }
});

router.post('/:id/sangria', exigir('caixa.liquidar'), async (req, res, next) => {
  try {
    await caixa.registrarMovimentoManual(req.params.id, 'SANGRIA', {
      valor: validar.dinheiro(req.body.valor, 'Valor', { obrigatorio: true, positivo: true }),
      motivo: validar.texto(req.body.motivo, 'Motivo', { obrigatorio: true, min: 5, max: 300 }),
    }, req.usuario, ctx(req));
    res.avisar('Sangria registrada.');
    req.session.save(() => res.redirect(`/caixa?caixa=${req.params.id}`));
  } catch (e) { next(e); }
});

router.get('/:id/fechar', exigir('caixa.liquidar'), async (req, res, next) => {
  try {
    const registro = await caixa.buscarCaixa(req.params.id);
    if (!registro) throw new ErroNaoEncontrado('Caixa não encontrado.');
    if (registro.status !== 'ABERTO') return res.redirect(`/caixa/${registro.id}`);
    res.render('caixa/fechar', { titulo: `Fechar caixa ${registro.numero}`, aba: null, caixa: registro });
  } catch (e) { next(e); }
});

router.post('/:id/fechar', exigir('caixa.liquidar'), async (req, res, next) => {
  try {
    const registro = await caixa.buscarCaixa(req.params.id);
    if (!registro) throw new ErroNaoEncontrado('Caixa não encontrado.');
    const informados = {};
    for (const forma of registro.formas) {
      informados[String(forma.id)] = validar.dinheiro(
        req.body[`forma_${forma.id}`], forma.nome,
        { obrigatorio: true, min: '0' }
      );
    }
    const fechado = await caixa.fecharCaixa(
      registro.id,
      informados,
      validar.texto(req.body.observacoes, 'Observações', { max: 500 }),
      req.usuario,
      ctx(req)
    );
    res.avisar(`Caixa ${fechado.numero} fechado. Diferença: ${fechado.diferenca}.`);
    req.session.save(() => res.redirect(`/caixa/${fechado.id}`));
  } catch (e) { next(e); }
});

router.get('/:id', exigir('caixa.visualizar'), async (req, res, next) => {
  try {
    const registro = await caixa.buscarCaixa(req.params.id);
    if (!registro) throw new ErroNaoEncontrado('Caixa não encontrado.');
    if (registro.status === 'ABERTO') return res.redirect(`/caixa?caixa=${registro.id}`);
    res.render('caixa/detalhe', { titulo: `Caixa ${registro.numero}`, aba: 'anteriores', caixa: registro });
  } catch (e) { next(e); }
});

export default router;
