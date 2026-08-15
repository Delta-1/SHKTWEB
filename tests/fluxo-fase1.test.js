/**
 * Teste de aceite da FASE 1 (seção 32 do documento de requisitos).
 *
 * Executa exatamente o roteiro pedido, ponta a ponta:
 *   1. cadastrar produto
 *   2. registrar estoque válido
 *   3. criar fumigação
 *   4. informar Comunicado
 *   5. validar 500 t fumigadas
 *   6. emitir certificado de 100 t
 *   7. verificar saldo fumigado = 400 t
 *   8. verificar geração automática do Contas a Pagar
 *   9. vincular certificado a carregamento
 *  10. confirmar expedição
 *  11. verificar estoque e histórico
 *  12. conferir auditoria
 */
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  prepararBanco,
  limparOperacional,
  usuarioTeste,
  referencias,
  um,
  muitos,
  encerrar,
  t,
} from './ambiente.js';

const estoque = await import('../src/services/estoque.js');
const fumigacaoSvc = await import('../src/services/fumigacao.js');
const certificadoSvc = await import('../src/services/certificados.js');
const carregamentoSvc = await import('../src/services/carregamento.js');

let usuario;
let ref;

before(async () => {
  await prepararBanco();
  usuario = await usuarioTeste();
  ref = await referencias();
});

beforeEach(async () => {
  await limparOperacional();
});

after(async () => {
  await encerrar();
});

test('fluxo completo: estoque → fumigação → certificado → carregamento → financeiro', async () => {
  // ---------------------------------------------------------------- passo 2
  // Registrar estoque válido: 600 t de Milho Amarelo Duro
  await estoque.ajustar(
    {
      tipo: 'SALDO_INICIAL',
      produtoId: ref.produtoId,
      localId: ref.localId,
      quantidade: '600',
      unidadeId: ref.tonId,
      motivo: 'Carga inicial do teste de aceite',
    },
    usuario
  );

  let posicao = await um(
    'SELECT * FROM vw_estoque_posicao WHERE produto_id = $1 AND local_id = $2',
    [ref.produtoId, ref.localId]
  );
  assert.equal(posicao.fisico_kg, t(600), 'estoque físico deve ser 600 t');
  assert.equal(posicao.disponivel_kg, t(600), 'estoque disponível deve ser 600 t');

  // ---------------------------------------------------------------- passo 3
  // Criar fumigação de 500 t (ainda sem comunicado)
  const fum = await fumigacaoSvc.criar(
    {
      fumigadoraId: ref.fumigadoraId,
      produtoId: ref.produtoId,
      localId: ref.localId,
      quantidade: '500',
      unidadeId: ref.tonId,
      moedaId: ref.brlId,
      custoTonelada: '12.50',
      inicio: new Date().toISOString(),
    },
    usuario
  );
  assert.equal(fum.status, 'RASCUNHO');
  assert.match(fum.numero, /^\d{4}-\d{4}$/, 'numeração deve seguir o padrão 0001-2026');

  // Sem comunicado, a validação precisa ser recusada
  await assert.rejects(
    () => fumigacaoSvc.validar(fum.id, { termino: new Date().toISOString() }, usuario),
    /Comunicado de Fumigação é obrigatório/,
    'não pode validar fumigação sem Comunicado'
  );

  // ------------------------------------------------------------ passos 4 e 5
  // Informar Comunicado e validar as 500 t
  const validada = await fumigacaoSvc.validar(
    fum.id,
    { numeroComunicado: 'COM-2026-0001', termino: new Date().toISOString() },
    usuario
  );
  assert.equal(validada.status, 'VALIDADA');
  assert.equal(validada.quantidade_kg, t(500));

  const saldoInicial = await um('SELECT * FROM vw_fumigacao_saldos WHERE id = $1', [fum.id]);
  assert.equal(saldoInicial.saldo_kg, t(500), 'saldo fumigado inicial deve ser 500 t');

  // ---------------------------------------------------------------- passo 6
  // Emitir certificado de 100 t
  const cert = await certificadoSvc.criar(
    {
      fumigacaoId: fum.id,
      quantidade: '100',
      unidadeId: ref.tonId,
      moedaId: ref.brlId,
      custoTonelada: '12.50',
      numeroCertificado: 'CF-9001',
      clienteId: ref.clienteId,
      destino: 'Lima / Peru',
    },
    usuario
  );
  assert.equal(cert.status, 'RASCUNHO');
  assert.equal(cert.quantidade_kg, t(100));
  assert.equal(cert.valor_total, '1250.0000', '100 t × R$ 12,50/t = R$ 1.250,00');

  const validacao = await certificadoSvc.validar(cert.id, usuario);
  assert.equal(validacao.certificado.status, 'VALIDADO');

  // ---------------------------------------------------------------- passo 7
  // Saldo fumigado deve ser 400 t
  const saldoApos = await um('SELECT * FROM vw_fumigacao_saldos WHERE id = $1', [fum.id]);
  assert.equal(saldoApos.saldo_kg, t(400), 'saldo fumigado após o certificado deve ser 400 t');
  assert.equal(validacao.saldoRestante, t(400));

  // ---------------------------------------------------------------- passo 8
  // Contas a Pagar gerado automaticamente, com vencimento em 10 dias
  const cp = await um('SELECT * FROM contas_pagar WHERE origem_id = $1', [cert.id]);
  assert.ok(cp, 'o certificado validado deve gerar um Contas a Pagar');
  assert.equal(cp.origem, 'FUMIGACAO');
  assert.equal(cp.origem_tipo, 'CERTIFICADO_FUMIGACAO');
  assert.equal(cp.origem_numero, cert.numero, 'o título deve referenciar o número do certificado');
  assert.equal(cp.valor, '1250.0000');
  assert.equal(cp.status, 'ABERTO');

  const dia = (d) => new Date(`${new Date(d).toISOString().slice(0, 10)}T12:00:00Z`);
  const diasAteVencimento = Math.round((dia(cp.vencimento) - dia(cert.data)) / 86_400_000);
  assert.equal(diasAteVencimento, 10, 'vencimento padrão de 10 dias');

  // Navegação de volta: do título para a origem
  assert.equal(validacao.certificado.conta_pagar_id, cp.id);

  // ------------------------------------------------------------ passos 9 e 10
  // Vincular o certificado a um carregamento e confirmar a expedição
  const carreg = await carregamentoSvc.criar(
    {
      clienteId: ref.clienteId,
      produtoId: ref.produtoId,
      localId: ref.localId,
      quantidade: '100',
      unidadeId: ref.tonId,
      certificadoId: cert.id,
      destino: 'Lima / Peru',
      tipoOperacao: 'EXPORTACAO',
      placa: 'ABC1D23',
    },
    usuario
  );
  assert.equal(carreg.status, 'RASCUNHO');

  await carregamentoSvc.programar(carreg.id, usuario);

  // Enquanto programado, a quantidade fica reservada, não baixada
  posicao = await um(
    'SELECT * FROM vw_estoque_posicao WHERE produto_id = $1 AND local_id = $2',
    [ref.produtoId, ref.localId]
  );
  assert.equal(posicao.fisico_kg, t(600), 'programar não pode baixar o estoque físico');
  assert.equal(posicao.reservado_kg, t(100), 'programar deve reservar 100 t');
  assert.equal(posicao.disponivel_kg, t(500), 'disponível = físico − reservado');

  const expedido = await carregamentoSvc.expedir(carreg.id, {}, usuario);
  assert.equal(expedido.status, 'EXPEDIDO');

  // --------------------------------------------------------------- passo 11
  // Estoque e histórico
  posicao = await um(
    'SELECT * FROM vw_estoque_posicao WHERE produto_id = $1 AND local_id = $2',
    [ref.produtoId, ref.localId]
  );
  assert.equal(posicao.fisico_kg, t(500), 'estoque físico após expedição: 600 − 100 = 500 t');
  assert.equal(posicao.reservado_kg, '0.000', 'a reserva deve ser consumida na expedição');
  assert.equal(posicao.disponivel_kg, t(500));
  assert.equal(posicao.expedido_kg, t(100));

  const movimentos = await muitos(
    `SELECT * FROM estoque_movimentos WHERE produto_id = $1 ORDER BY id`,
    [ref.produtoId]
  );
  assert.equal(movimentos.length, 2, 'deve haver exatamente 2 movimentos: entrada e carregamento');
  assert.equal(movimentos[0].tipo, 'SALDO_INICIAL');
  assert.equal(movimentos[1].tipo, 'CARREGAMENTO');
  assert.equal(movimentos[1].quantidade_kg, `-${t(100)}`);
  assert.equal(movimentos[1].saldo_apos_kg, t(500), 'o movimento guarda o saldo resultante');
  assert.equal(movimentos[1].documento_numero, carreg.numero, 'movimento rastreia o documento');

  // --------------------------------------------------------------- passo 12
  // Auditoria das ações críticas
  const auditoria = await muitos('SELECT * FROM auditoria ORDER BY id');
  const acoes = auditoria.map((a) => `${a.modulo}.${a.acao}`);

  for (const esperado of [
    'estoque.CRIAR',
    'fumigacao.CRIAR',
    'fumigacao.VALIDAR',
    'certificados.CRIAR',
    'certificados.VALIDAR',
    'financeiro.CRIAR',
    'carregamento.CRIAR',
    'carregamento.APROVAR',
    'carregamento.EXPEDIR',
  ]) {
    assert.ok(acoes.includes(esperado), `auditoria deve conter ${esperado} (obtido: ${acoes.join(', ')})`);
  }

  const logValidacao = auditoria.find((a) => a.modulo === 'certificados' && a.acao === 'VALIDAR');
  assert.ok(logValidacao.usuario_id, 'auditoria registra o usuário');
  assert.ok(logValidacao.data_hora, 'auditoria registra a data/hora');
  assert.match(logValidacao.descricao, /saldo fumigado restante/);

  // Rastreabilidade ponta a ponta
  const rastro = await um('SELECT * FROM vw_rastreabilidade WHERE certificado_id = $1', [cert.id]);
  assert.equal(rastro.fumigacao_numero, fum.numero);
  assert.equal(rastro.numero_comunicado, 'COM-2026-0001');
  assert.equal(rastro.conta_pagar_numero, cp.numero);
  assert.equal(rastro.carregamento_numero, carreg.numero);
});
