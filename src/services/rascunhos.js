import { query, um, muitos } from '../db/index.js';
import { ErroNegocio } from '../lib/erros.js';
import { temPermissao } from '../lib/auth.js';

export const MODULOS_RASCUNHO = {
 compras:'compras', vendas:'vendas', recebimentos:'compras', fumigacao:'fumigacao',
 certificados:'certificados', carregamentos:'carregamento', frota:'frota',
 financeiro:'financeiro', rh:'rh', impostos:'impostos', cadastros:'cadastros',
};
export function validarAcesso(usuario, modulo, chave) {
 const permissao = MODULOS_RASCUNHO[modulo];
 if (!permissao || !/^[a-zA-Z0-9_-]{1,80}$/.test(chave || ''))
  throw new ErroNegocio('Rascunho inválido.', {status:400});
 const acao = chave.includes('editar') || (modulo==='cadastros' && /-\d+$/.test(chave)) ? 'editar' : 'criar';
 if (!temPermissao(usuario,`${permissao}.${acao}`))
  throw new ErroNegocio('Sem permissão para este formulário.', {status:403});
 return `${modulo}:${chave}`;
}
export function buscar(usuarioId, chave) {
 return um('SELECT dados, atualizado_em, versao FROM rascunhos_formulario WHERE usuario_id=$1 AND chave=$2',[usuarioId,chave]);
}
export async function salvar(usuarioId, chave, dados, versao) {
 if (!dados || Array.isArray(dados) || typeof dados !== 'object' || !Number.isSafeInteger(versao) || versao<0)
  throw new ErroNegocio('Formato de rascunho inválido.', {status:400});
 if (Buffer.byteLength(JSON.stringify(dados))>100000) throw new ErroNegocio('Rascunho muito grande.', {status:413});
 const {rows} = await query(`INSERT INTO rascunhos_formulario(usuario_id,chave,dados)
  SELECT $1,$2,$3::jsonb WHERE $4::bigint=0
  ON CONFLICT(usuario_id,chave) DO NOTHING RETURNING atualizado_em,versao`,[usuarioId,chave,JSON.stringify(dados),versao]);
 if(rows[0]) return rows[0];
 const {rows:alteradas} = await query(`UPDATE rascunhos_formulario SET dados=$3::jsonb, atualizado_em=now(),versao=versao+1
  WHERE usuario_id=$1 AND chave=$2 AND versao=$4 RETURNING atualizado_em,versao`,[usuarioId,chave,JSON.stringify(dados),versao]);
 if(!alteradas[0]) throw new ErroNegocio('Este rascunho foi alterado em outra aba. Recarregue para recuperar a versão mais recente.', {status:409});
 return alteradas[0];
}
export async function remover(usuarioId,chave,versao) {
 return query('DELETE FROM rascunhos_formulario WHERE usuario_id=$1 AND chave=$2 AND versao=$3',[usuarioId,chave,versao]);
}
export async function listar(usuario) {
 const linhas=await muitos(`SELECT chave,atualizado_em,versao,dados->>'url' AS url,dados->>'titulo' AS titulo
  FROM rascunhos_formulario WHERE usuario_id=$1 ORDER BY atualizado_em DESC LIMIT 30`,[usuario.id]);
 return linhas.filter(r=>{try {const [m,c]=r.chave.split(':');validarAcesso(usuario,m,c);return true;}catch{return false;}});
}
// Executado apenas depois de uma gravação de negócio bem-sucedida.
export function limparAposGravar(req,res,next) {
 const redirect=res.redirect.bind(res);
 res.redirect=function(...args){
  if(req.method==='POST' && req.body?._rascunho_chave && !req.session?.mensagemErro){
   const [modulo,chave]=String(req.body._rascunho_chave).split(':');
   const versao=Number(req.body._rascunho_versao);
   const segmento=req.originalUrl.split('?')[0].split('/')[1];
   if(segmento===modulo && Number.isSafeInteger(versao) && versao>0){
    try {const k=validarAcesso(req.usuario,modulo,chave);
     remover(req.usuario.id,k,versao).then(()=>redirect(...args)).catch(e=>{console.warn('[rascunho]',e.message);redirect(...args);});
     return res;
    }catch { /* a rota de negócio já aplicou a autorização */ }
   }
  }
  return redirect(...args);
 };
 next();
}
