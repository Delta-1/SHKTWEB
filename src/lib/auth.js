import bcrypt from 'bcryptjs';
import { um, muitos } from '../db/index.js';
import { ErroPermissao } from './erros.js';

const RODADAS = 10;

export function gerarHash(senha) {
  return bcrypt.hash(senha, RODADAS);
}

export function conferirSenha(senha, hash) {
  return bcrypt.compare(senha, hash);
}

/**
 * Valida credenciais. Retorna o usuario com suas permissoes, ou null.
 * A mensagem de erro nunca revela se foi o e-mail ou a senha que errou.
 */
export async function autenticar(email, senha) {
  const usuario = await um(
    `SELECT u.*, p.codigo AS perfil_codigo, p.nome AS perfil_nome
       FROM usuarios u
       JOIN perfis p ON p.id = u.perfil_id
      WHERE lower(u.email) = lower($1)`,
    [String(email || '').trim()]
  );

  if (!usuario) {
    // Executa um hash mesmo assim para nao vazar, pelo tempo de resposta,
    // se o e-mail existe ou nao.
    await bcrypt.compare(String(senha || ''), '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinv');
    return null;
  }

  if (!usuario.ativo) return { bloqueado: true };

  const ok = await conferirSenha(String(senha || ''), usuario.senha_hash);
  if (!ok) return null;

  usuario.permissoes = await carregarPermissoes(usuario.perfil_id);
  delete usuario.senha_hash;
  return usuario;
}

export async function carregarPermissoes(perfilId) {
  const linhas = await muitos('SELECT permissao FROM perfil_permissoes WHERE perfil_id = $1', [
    perfilId,
  ]);
  return linhas.map((l) => l.permissao);
}

/** Recarrega o usuario a cada requisicao: mudancas de perfil valem na hora. */
export async function carregarUsuario(id) {
  const usuario = await um(
    `SELECT u.id, u.nome, u.email, u.ativo, u.trocar_senha, u.perfil_id,
            p.codigo AS perfil_codigo, p.nome AS perfil_nome
       FROM usuarios u
       JOIN perfis p ON p.id = u.perfil_id
      WHERE u.id = $1`,
    [id]
  );
  if (!usuario || !usuario.ativo) return null;
  usuario.permissoes = await carregarPermissoes(usuario.perfil_id);
  return usuario;
}

export function temPermissao(usuario, permissao) {
  if (!usuario || !usuario.permissoes) return false;
  if (usuario.permissoes.includes('admin.administrar')) return true; // superusuario
  return usuario.permissoes.includes(permissao);
}

// ---------------------------------------------------------------------------
// Middlewares
// ---------------------------------------------------------------------------

/** Popula req.usuario a partir da sessao. */
export async function injetarUsuario(req, res, next) {
  try {
    if (req.session?.usuarioId) {
      const usuario = await carregarUsuario(req.session.usuarioId);
      if (usuario) {
        req.usuario = usuario;
        res.locals.usuario = usuario;
      } else {
        req.session.destroy(() => {});
      }
    }
    res.locals.pode = (p) => temPermissao(req.usuario, p);
    next();
  } catch (e) {
    next(e);
  }
}

/** Exige sessao ativa. */
export function exigirLogin(req, res, next) {
  if (!req.usuario) {
    if (req.accepts('html')) {
      const destino = encodeURIComponent(req.originalUrl);
      return res.redirect(`/login?destino=${destino}`);
    }
    return res.status(401).json({ erro: 'Sessão expirada. Faça login novamente.' });
  }
  next();
}

/**
 * Exige uma permissao especifica. Validacao de back-end - e a barreira real,
 * independente do que o front-end mostra ou esconde.
 *
 *   router.post('/certificados/:id/validar', exigir('certificados.aprovar'), ...)
 */
export function exigir(permissao) {
  return (req, res, next) => {
    if (!req.usuario) return exigirLogin(req, res, next);
    if (!temPermissao(req.usuario, permissao)) {
      return next(
        new ErroPermissao(
          `Seu perfil (${req.usuario.perfil_nome}) não tem a permissão necessária para esta ação.`
        )
      );
    }
    next();
  };
}

export default {
  gerarHash,
  conferirSenha,
  autenticar,
  carregarUsuario,
  temPermissao,
  injetarUsuario,
  exigirLogin,
  exigir,
};
