/**
 * Administracao: usuarios, perfis de acesso e parametros da empresa.
 */
import { Router } from 'express';
import { exigir, gerarHash } from '../lib/auth.js';
import { muitos, um, transacao, query } from '../db/index.js';
import { registrar, ACOES, diferenca } from '../lib/auditoria.js';
import { MODULOS, ACOES as ACOES_PERM, TODAS_PERMISSOES, permissaoValida } from '../lib/permissoes.js';
import { ErroNegocio, ErroNaoEncontrado } from '../lib/erros.js';
import * as validar from '../lib/validar.js';

const router = Router();
const ctx = (req) => ({ ip: req.ip, sessao: req.sessionID });

router.get('/', exigir('admin.visualizar'), async (req, res, next) => {
  try {
    const [usuarios, perfis, parametros] = await Promise.all([
      muitos(
        `SELECT u.id, u.nome, u.email, u.ativo, u.ultimo_acesso, p.nome AS perfil
           FROM usuarios u JOIN perfis p ON p.id = u.perfil_id ORDER BY u.nome`
      ),
      muitos(
        `SELECT p.*, (SELECT COUNT(*)::INT FROM usuarios u WHERE u.perfil_id = p.id) AS usuarios,
                (SELECT COUNT(*)::INT FROM perfil_permissoes pp WHERE pp.perfil_id = p.id) AS permissoes
           FROM perfis p ORDER BY p.nome`
      ),
      muitos('SELECT * FROM parametros ORDER BY grupo, chave'),
    ]);

    res.render('admin/indice', { titulo: 'Administração', usuarios, perfis, parametros });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------- usuarios
router.get('/usuarios/novo', exigir('admin.administrar'), async (req, res, next) => {
  try {
    const perfis = await muitos('SELECT id, nome FROM perfis WHERE ativo ORDER BY nome');
    res.render('admin/usuario', { titulo: 'Novo usuário', perfis, registro: { ativo: true }, novo: true });
  } catch (e) {
    next(e);
  }
});

router.get('/usuarios/:id', exigir('admin.administrar'), async (req, res, next) => {
  try {
    const [registro, perfis] = await Promise.all([
      um('SELECT id, nome, email, telefone, perfil_id, ativo, trocar_senha, ultimo_acesso FROM usuarios WHERE id = $1',
        [req.params.id]),
      muitos('SELECT id, nome FROM perfis WHERE ativo ORDER BY nome'),
    ]);
    if (!registro) throw new ErroNaoEncontrado('Usuário não encontrado.');

    res.render('admin/usuario', { titulo: `Usuário: ${registro.nome}`, perfis, registro, novo: false });
  } catch (e) {
    next(e);
  }
});

router.post('/usuarios/novo', exigir('admin.administrar'), async (req, res, next) => {
  try {
    const dados = {
      nome: validar.texto(req.body.nome, 'Nome', { obrigatorio: true }),
      email: validar.email(req.body.email, 'E-mail', { obrigatorio: true }),
      telefone: validar.texto(req.body.telefone, 'Telefone'),
      perfilId: validar.id(req.body.perfil_id, 'Perfil', { obrigatorio: true }),
      ativo: validar.booleano(req.body.ativo),
    };
    const senha = validar.texto(req.body.senha, 'Senha inicial', { obrigatorio: true, min: 8 });

    const hash = await gerarHash(senha);
    const usuario = await transacao(async (cx) => {
      const { rows } = await cx.query(
        `INSERT INTO usuarios (nome, email, telefone, senha_hash, perfil_id, ativo, trocar_senha, criado_por)
              VALUES ($1,$2,$3,$4,$5,$6,TRUE,$7) RETURNING id, nome, email`,
        [dados.nome, dados.email, dados.telefone, hash, dados.perfilId, dados.ativo, req.usuario.id]
      );
      await registrar(cx, {
        usuario: req.usuario,
        acao: ACOES.CRIAR,
        modulo: 'admin',
        registroTipo: 'USUARIO',
        registroId: rows[0].id,
        descricao: `Usuário criado: ${dados.nome} (${dados.email}).`,
        depois: { nome: dados.nome, email: dados.email, perfil_id: dados.perfilId },
        ...ctx(req),
      });
      return rows[0];
    });

    res.avisar(`Usuário ${usuario.nome} criado. Ele deverá trocar a senha no primeiro acesso.`);
    req.session.save(() => res.redirect(`/admin/usuarios/${usuario.id}`));
  } catch (e) {
    next(e);
  }
});

router.post('/usuarios/:id', exigir('admin.administrar'), async (req, res, next) => {
  try {
    const atual = await um('SELECT * FROM usuarios WHERE id = $1', [req.params.id]);
    if (!atual) throw new ErroNaoEncontrado('Usuário não encontrado.');

    const dados = {
      nome: validar.texto(req.body.nome, 'Nome', { obrigatorio: true }),
      email: validar.email(req.body.email, 'E-mail', { obrigatorio: true }),
      telefone: validar.texto(req.body.telefone, 'Telefone'),
      perfilId: validar.id(req.body.perfil_id, 'Perfil', { obrigatorio: true }),
      ativo: validar.booleano(req.body.ativo),
    };

    // Não permitir que o administrador se auto-inative e perca o acesso
    if (Number(req.params.id) === req.usuario.id && !dados.ativo)
      throw new ErroNegocio('Você não pode inativar o seu próprio usuário.');

    await transacao(async (cx) => {
      const { rows } = await cx.query(
        `UPDATE usuarios SET nome = $1, email = $2, telefone = $3, perfil_id = $4,
                             ativo = $5, atualizado_por = $6
          WHERE id = $7 RETURNING *`,
        [dados.nome, dados.email, dados.telefone, dados.perfilId, dados.ativo, req.usuario.id, req.params.id]
      );
      const dif = diferenca(atual, rows[0]);
      if (dif) {
        await registrar(cx, {
          usuario: req.usuario,
          acao: ACOES.ALTERAR,
          modulo: 'admin',
          registroTipo: 'USUARIO',
          registroId: Number(req.params.id),
          descricao: `Usuário alterado: ${dados.nome}.`,
          antes: dif.antes,
          depois: dif.depois,
          ...ctx(req),
        });
      }
    });

    res.avisar('Usuário atualizado.');
    req.session.save(() => res.redirect(`/admin/usuarios/${req.params.id}`));
  } catch (e) {
    next(e);
  }
});

router.post('/usuarios/:id/senha', exigir('admin.administrar'), async (req, res, next) => {
  try {
    const senha = validar.texto(req.body.senha, 'Nova senha', { obrigatorio: true, min: 8 });
    const hash = await gerarHash(senha);

    await transacao(async (cx) => {
      const { rowCount } = await cx.query(
        'UPDATE usuarios SET senha_hash = $1, trocar_senha = TRUE, atualizado_por = $2 WHERE id = $3',
        [hash, req.usuario.id, req.params.id]
      );
      if (!rowCount) throw new ErroNaoEncontrado('Usuário não encontrado.');

      await registrar(cx, {
        usuario: req.usuario,
        acao: ACOES.ALTERAR,
        modulo: 'admin',
        registroTipo: 'USUARIO',
        registroId: Number(req.params.id),
        descricao: 'Senha redefinida pelo administrador.',
        ...ctx(req),
      });
    });

    res.avisar('Senha redefinida. O usuário deverá trocá-la no próximo acesso.');
    req.session.save(() => res.redirect(`/admin/usuarios/${req.params.id}`));
  } catch (e) {
    next(e);
  }
});

// ------------------------------------------------------------------ perfis
router.get('/perfis/:id', exigir('admin.administrar'), async (req, res, next) => {
  try {
    const perfil = await um('SELECT * FROM perfis WHERE id = $1', [req.params.id]);
    if (!perfil) throw new ErroNaoEncontrado('Perfil não encontrado.');

    const permissoes = (
      await muitos('SELECT permissao FROM perfil_permissoes WHERE perfil_id = $1', [req.params.id])
    ).map((r) => r.permissao);

    res.render('admin/perfil', {
      titulo: `Perfil: ${perfil.nome}`,
      perfil,
      permissoes,
      modulos: MODULOS,
      acoesPermissao: ACOES_PERM,
    });
  } catch (e) {
    next(e);
  }
});

router.post('/perfis/:id', exigir('admin.administrar'), async (req, res, next) => {
  try {
    const perfil = await um('SELECT * FROM perfis WHERE id = $1', [req.params.id]);
    if (!perfil) throw new ErroNaoEncontrado('Perfil não encontrado.');

    const enviadas = []
      .concat(req.body.permissoes || [])
      .filter((p) => permissaoValida(p));

    if (perfil.codigo === 'ADMIN' && !enviadas.includes('admin.administrar'))
      throw new ErroNegocio(
        'O perfil Administrador precisa manter a permissão de administrar o sistema — ' +
          'sem ela ninguém conseguiria gerenciar usuários.'
      );

    const antes = (
      await muitos('SELECT permissao FROM perfil_permissoes WHERE perfil_id = $1', [req.params.id])
    ).map((r) => r.permissao);

    await transacao(async (cx) => {
      await cx.query('DELETE FROM perfil_permissoes WHERE perfil_id = $1', [req.params.id]);
      for (const p of enviadas) {
        await cx.query('INSERT INTO perfil_permissoes (perfil_id, permissao) VALUES ($1,$2)', [
          req.params.id,
          p,
        ]);
      }

      await cx.query('UPDATE perfis SET nome = $1, descricao = $2 WHERE id = $3', [
        validar.texto(req.body.nome, 'Nome', { obrigatorio: true }),
        validar.texto(req.body.descricao, 'Descrição'),
        req.params.id,
      ]);

      const adicionadas = enviadas.filter((p) => !antes.includes(p));
      const removidas = antes.filter((p) => !enviadas.includes(p));

      await registrar(cx, {
        usuario: req.usuario,
        acao: ACOES.ALTERAR,
        modulo: 'admin',
        registroTipo: 'PERFIL',
        registroId: Number(req.params.id),
        descricao:
          `Permissões do perfil ${perfil.nome} atualizadas ` +
          `(+${adicionadas.length} / −${removidas.length}).`,
        antes: { permissoes: antes },
        depois: { permissoes: enviadas },
        ...ctx(req),
      });
    });

    res.avisar('Perfil atualizado. As mudanças valem no próximo clique de cada usuário.');
    req.session.save(() => res.redirect(`/admin/perfis/${req.params.id}`));
  } catch (e) {
    next(e);
  }
});

router.post('/perfis', exigir('admin.administrar'), async (req, res, next) => {
  try {
    const codigo = validar
      .texto(req.body.codigo, 'Código', { obrigatorio: true, max: 30 })
      .toUpperCase()
      .replace(/[^A-Z0-9_]/g, '_');
    const nome = validar.texto(req.body.nome, 'Nome', { obrigatorio: true });

    const perfil = await transacao(async (cx) => {
      const { rows } = await cx.query(
        'INSERT INTO perfis (codigo, nome, descricao) VALUES ($1,$2,$3) RETURNING *',
        [codigo, nome, validar.texto(req.body.descricao, 'Descrição')]
      );
      await cx.query(
        `INSERT INTO perfil_permissoes (perfil_id, permissao)
              SELECT $1, unnest($2::TEXT[])`,
        [rows[0].id, ['dashboard.visualizar', 'cadastros.visualizar']]
      );
      await registrar(cx, {
        usuario: req.usuario,
        acao: ACOES.CRIAR,
        modulo: 'admin',
        registroTipo: 'PERFIL',
        registroId: rows[0].id,
        descricao: `Perfil criado: ${nome}.`,
        ...ctx(req),
      });
      return rows[0];
    });

    res.avisar('Perfil criado. Defina as permissões.');
    req.session.save(() => res.redirect(`/admin/perfis/${perfil.id}`));
  } catch (e) {
    next(e);
  }
});

// -------------------------------------------------------------- parametros
router.post('/parametros', exigir('admin.administrar'), async (req, res, next) => {
  try {
    const alterados = [];
    for (const [chave, valor] of Object.entries(req.body)) {
      if (!chave.startsWith('p_')) continue;
      const real = chave.slice(2);
      const { rowCount } = await query(
        'UPDATE parametros SET valor = $1, atualizado_em = now() WHERE chave = $2 AND valor IS DISTINCT FROM $1',
        [String(valor), real]
      );
      if (rowCount) alterados.push(real);
    }

    if (alterados.length) {
      await transacao((cx) =>
        registrar(cx, {
          usuario: req.usuario,
          acao: ACOES.ALTERAR,
          modulo: 'admin',
          registroTipo: 'PARAMETROS',
          descricao: `Parâmetros alterados: ${alterados.join(', ')}.`,
          ...ctx(req),
        })
      );
    }

    res.avisar(alterados.length ? 'Parâmetros salvos.' : 'Nenhuma alteração.');
    req.session.save(() => res.redirect('/admin'));
  } catch (e) {
    next(e);
  }
});

export default router;
