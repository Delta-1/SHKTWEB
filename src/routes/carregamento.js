import { Router } from 'express';
import { exigir } from '../lib/auth.js';
import { carregar } from '../lib/referencias.js';
import * as carregamento from '../services/carregamento.js';
import * as certificadosSvc from '../services/certificados.js';
import * as validar from '../lib/validar.js';
import { ErroNaoEncontrado } from '../lib/erros.js';
import { hojeISO } from '../lib/formato.js';

const router = Router();
const ctx = (req) => ({ ip: req.ip, sessao: req.sessionID });

function lerFormulario(corpo) {
  return {
    data: validar.data(corpo.data, 'Data', { obrigatorio: true }),
    dataHoraCarga: validar.dataHora(corpo.data_hora_carga, 'Data/hora do carregamento'),
    clienteId: validar.id(corpo.cliente_id, 'Cliente'),
    produtoId: validar.id(corpo.produto_id, 'Produto', { obrigatorio: true }),
    localId: validar.id(corpo.local_id, 'Local de origem', { obrigatorio: true }),
    loteId: validar.id(corpo.lote_id, 'Lote'),
    quantidade: validar.quantidade(corpo.quantidade, 'Quantidade', { obrigatorio: true }),
    unidadeId: validar.id(corpo.unidade_id, 'Unidade', { obrigatorio: true }),
    pesoBruto: validar.decimal(corpo.peso_bruto, 'Peso bruto', { escala: 3 }),
    pesoTara: validar.decimal(corpo.peso_tara, 'Tara', { escala: 3 }),
    pesoLiquido: validar.decimal(corpo.peso_liquido, 'Peso líquido', { escala: 3 }),
    veiculoId: validar.id(corpo.veiculo_id, 'Veículo'),
    placa: validar.placa(corpo.placa, 'Placa'),
    placaReboque: validar.placa(corpo.placa_reboque, 'Placa do reboque'),
    motoristaId: validar.id(corpo.motorista_id, 'Motorista'),
    transportadoraId: validar.id(corpo.transportadora_id, 'Transportadora'),
    origem: validar.texto(corpo.origem, 'Origem'),
    destino: validar.texto(corpo.destino, 'Destino'),
    paisDestinoId: validar.id(corpo.pais_destino_id, 'País de destino'),
    incotermId: validar.id(corpo.incoterm_id, 'Incoterm'),
    certificadoId: validar.id(corpo.certificado_id, 'Certificado de fumigação'),
    tipoOperacao: validar.escolha(
      corpo.tipo_operacao,
      'Tipo de operação',
      ['EXPORTACAO', 'VENDA_INTERNA', 'TRANSFERENCIA', 'OUTRO'],
      { obrigatorio: true }
    ),
    responsavel: validar.texto(corpo.responsavel, 'Responsável'),
    observacoes: validar.texto(corpo.observacoes, 'Observações'),
  };
}

const listasFormulario = () =>
  carregar([
    'produtos', 'locais', 'unidades', 'lotes', 'clientes', 'transportadoras',
    'veiculos', 'motoristas', 'paises', 'incoterms',
  ]);

// --------------------------------------------------------------- listagem
router.get('/', exigir('carregamento.visualizar'), async (req, res, next) => {
  try {
    const filtros = {
      status: req.query.status || null,
      clienteId: req.query.cliente || null,
      produtoId: req.query.produto || null,
      de: req.query.de || null,
      ate: req.query.ate || null,
      busca: req.query.busca || null,
    };

    const [lista, ref, totais] = await Promise.all([
      carregamento.listar(filtros),
      carregar(['clientes', 'produtos']),
      carregamento.totaisPeriodo(filtros.de, filtros.ate),
    ]);

    res.render('carregamento/lista', { titulo: 'Carregamentos', lista, ref, filtros, totais });
  } catch (e) {
    next(e);
  }
});

// ------------------------------------------------------------------- novo
router.get('/novo', exigir('carregamento.criar'), async (req, res, next) => {
  try {
    const [ref, certificados] = await Promise.all([
      listasFormulario(),
      certificadosSvc.disponiveis(),
    ]);

    res.render('carregamento/form', {
      titulo: 'Nova ordem de carregamento',
      ref,
      certificados,
      carregamento: {
        data: hojeISO(),
        tipo_operacao: 'EXPORTACAO',
        responsavel: req.usuario.nome,
        certificado_id: req.query.certificado || null,
      },
      novo: true,
    });
  } catch (e) {
    next(e);
  }
});

router.post('/novo', exigir('carregamento.criar'), async (req, res, next) => {
  try {
    const c = await carregamento.criar(lerFormulario(req.body), req.usuario, ctx(req));
    res.avisar(`Ordem de carregamento ${c.numero} criada.`);
    req.session.save(() => res.redirect(`/carregamentos/${c.id}`));
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------- detalhe
router.get('/:id', exigir('carregamento.visualizar'), async (req, res, next) => {
  try {
    const c = await carregamento.buscar(req.params.id);
    if (!c) throw new ErroNaoEncontrado('Carregamento não encontrado.');
    res.render('carregamento/detalhe', { titulo: `Carregamento ${c.numero}`, carregamento: c });
  } catch (e) {
    next(e);
  }
});

router.get('/:id/editar', exigir('carregamento.editar'), async (req, res, next) => {
  try {
    const c = await carregamento.buscar(req.params.id);
    if (!c) throw new ErroNaoEncontrado('Carregamento não encontrado.');

    const [ref, certificados] = await Promise.all([
      listasFormulario(),
      certificadosSvc.disponiveis(),
    ]);

    res.render('carregamento/form', {
      titulo: `Editar carregamento ${c.numero}`,
      ref,
      certificados,
      carregamento: c,
      novo: false,
    });
  } catch (e) {
    next(e);
  }
});

router.post('/:id/editar', exigir('carregamento.editar'), async (req, res, next) => {
  try {
    await carregamento.atualizar(req.params.id, lerFormulario(req.body), req.usuario, ctx(req));
    res.avisar('Carregamento atualizado.');
    req.session.save(() => res.redirect(`/carregamentos/${req.params.id}`));
  } catch (e) {
    next(e);
  }
});

// -------------------------------------------------------------- programar
router.post('/:id/programar', exigir('carregamento.aprovar'), async (req, res, next) => {
  try {
    await carregamento.programar(req.params.id, req.usuario, ctx(req));
    res.avisar('Carregamento programado. A quantidade foi reservada no estoque.');
    req.session.save(() => res.redirect(`/carregamentos/${req.params.id}`));
  } catch (e) {
    next(e);
  }
});

// ----------------------------------------------------------------- expedir
router.post('/:id/expedir', exigir('carregamento.aprovar'), async (req, res, next) => {
  try {
    const dados = {
      quantidade: validar.quantidade(req.body.quantidade, 'Quantidade expedida'),
      unidadeId: validar.id(req.body.unidade_id, 'Unidade'),
      data: validar.data(req.body.data, 'Data da expedição'),
      dataHoraCarga: validar.dataHora(req.body.data_hora_carga, 'Data/hora do carregamento'),
      pesoBruto: validar.decimal(req.body.peso_bruto, 'Peso bruto', { escala: 3 }),
      pesoTara: validar.decimal(req.body.peso_tara, 'Tara', { escala: 3 }),
      pesoLiquido: validar.decimal(req.body.peso_liquido, 'Peso líquido', { escala: 3 }),
    };

    const c = await carregamento.expedir(req.params.id, dados, req.usuario, ctx(req));
    res.avisar(
      `Carregamento ${c.numero} expedido. Baixa de ` +
        `${(Number(c.quantidade_kg) / 1000).toLocaleString('pt-BR', { minimumFractionDigits: 3 })} t no estoque.`
    );
    req.session.save(() => res.redirect(`/carregamentos/${req.params.id}`));
  } catch (e) {
    next(e);
  }
});

// --------------------------------------------------------------- cancelar
router.post('/:id/cancelar', exigir('carregamento.cancelar'), async (req, res, next) => {
  try {
    const motivo = validar.texto(req.body.motivo, 'Motivo do cancelamento', {
      obrigatorio: true,
      min: 5,
    });
    await carregamento.cancelar(req.params.id, motivo, req.usuario, ctx(req));
    res.avisar('Carregamento cancelado.');
    req.session.save(() => res.redirect(`/carregamentos/${req.params.id}`));
  } catch (e) {
    next(e);
  }
});

// -------------------------------------------------------------- documentos
router.post('/:id/documentos', exigir('carregamento.editar'), async (req, res, next) => {
  try {
    const dados = {
      tipo: validar.escolha(
        req.body.tipo,
        'Tipo de documento',
        ['DANFE', 'NFE', 'MIC_DTA', 'CRT', 'PACKING_LIST', 'CONHECIMENTO', 'OUTRO'],
        { obrigatorio: true }
      ),
      numero: validar.texto(req.body.numero, 'Número', { obrigatorio: true }),
      data: validar.data(req.body.data, 'Data'),
      observacoes: validar.texto(req.body.observacoes, 'Observações'),
    };

    await carregamento.adicionarDocumento(req.params.id, dados, req.usuario);
    res.avisar('Documento registrado.');
    req.session.save(() => res.redirect(`/carregamentos/${req.params.id}`));
  } catch (e) {
    next(e);
  }
});

// -------------------------------------------------------- romaneio (papel)
router.get('/:id/documento', exigir('carregamento.visualizar'), async (req, res, next) => {
  try {
    const c = await carregamento.buscar(req.params.id);
    if (!c) throw new ErroNaoEncontrado('Carregamento não encontrado.');
    res.render('docs/carregamento', { titulo: `Ordem de Carregamento ${c.numero}`, carregamento: c });
  } catch (e) {
    next(e);
  }
});

export default router;
