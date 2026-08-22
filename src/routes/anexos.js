import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Router } from 'express';
import multer from 'multer';
import config from '../config.js';
import { temPermissao } from '../lib/auth.js';
import { ErroNegocio, ErroNaoEncontrado, ErroPermissao } from '../lib/erros.js';
import { muitos, um, transacao } from '../db/index.js';
import { registrar, ACOES } from '../lib/auditoria.js';

const router=Router();
const TIPOS={
  VIAGEM:{tabela:'viagens',modulo:'frota'},DESPESA_VIAGEM:{tabela:'viagem_despesas',modulo:'frota'},
  ABASTECIMENTO:{tabela:'abastecimentos',modulo:'frota'},MANUTENCAO:{tabela:'ordens_manutencao',modulo:'frota'},
  OBRIGACAO:{tabela:'obrigacoes',modulo:'impostos'},FOLHA:{tabela:'folhas_competencia',modulo:'rh'},
  CERTIFICADO:{tabela:'certificados_fumigacao',modulo:'certificados'},
  CARREGAMENTO:{tabela:'carregamentos',modulo:'carregamento'}
};
function def(req,acao='visualizar'){
  const d=TIPOS[String(req.params.tipo||'').toUpperCase()];if(!d)throw new ErroNegocio('Tipo de documento inválido.');
  if(!temPermissao(req.usuario,`${d.modulo}.${acao}`))throw new ErroPermissao();return d;
}
const upload=multer({storage:multer.diskStorage({destination(_req,_file,cb){
  fs.mkdirSync(config.uploads.diretorio,{recursive:true});cb(null,config.uploads.diretorio);},
  filename(_req,file,cb){cb(null,`${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`);}}),
  limits:{fileSize:config.uploads.tamanhoMaxMb*1024*1024},fileFilter(_req,file,cb){
    const ok=/^(application\/pdf|image\/(jpeg|png|webp)|text\/csv|application\/(vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet|vnd\.ms-excel))$/.test(file.mimetype);
    cb(ok?null:new ErroNegocio('Arquivo inválido. Use PDF, imagem, CSV ou Excel.'),ok);}});

router.get('/:tipo/:id',async(req,res,next)=>{try{const d=def(req);const registro=await um(`SELECT id,numero FROM ${d.tabela} WHERE id=$1`,[req.params.id]);
  if(!registro)throw new ErroNaoEncontrado('Documento não encontrado.');const anexos=await muitos(`SELECT a.*,u.nome AS usuario_nome FROM anexos a
    LEFT JOIN usuarios u ON u.id=a.criado_por WHERE entidade_tipo=$1 AND entidade_id=$2 AND excluido_em IS NULL ORDER BY a.id DESC`,[String(req.params.tipo).toUpperCase(),req.params.id]);
  res.render('anexos/indice',{titulo:'Documentos e comprovantes',tipo:String(req.params.tipo).toUpperCase(),registro,anexos,modulo:d.modulo});
}catch(e){next(e);}});
router.post('/:tipo/:id',upload.single('arquivo'),async(req,res,next)=>{try{const d=def(req,'editar');if(!req.file)throw new ErroNegocio('Escolha um arquivo.');
  const registro=await um(`SELECT id,numero FROM ${d.tabela} WHERE id=$1`,[req.params.id]);if(!registro)throw new ErroNaoEncontrado('Documento não encontrado.');
  await transacao(async cx=>{const {rows:[a]}=await cx.query(`INSERT INTO anexos
    (entidade_tipo,entidade_id,nome_original,caminho,mime,tamanho,descricao,criado_por)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,[String(req.params.tipo).toUpperCase(),req.params.id,
    req.file.originalname,req.file.filename,req.file.mimetype,req.file.size,req.body.descricao||null,req.usuario.id]);
    await registrar(cx,{usuario:req.usuario,acao:ACOES.CRIAR,modulo:d.modulo,registroTipo:'ANEXO',registroId:a.id,
      registroNumero:registro.numero,descricao:`Anexo "${req.file.originalname}" incluído.`,depois:a,ip:req.ip,sessao:req.sessionID});});
  res.avisar('Arquivo anexado ao documento.');req.session.save(()=>res.redirect(`/anexos/${req.params.tipo}/${req.params.id}`));
}catch(e){if(req.file?.path)fs.unlink(req.file.path,()=>{});next(e);}});
router.get('/arquivo/:tipo/:id',async(req,res,next)=>{try{def(req);const a=await um('SELECT * FROM anexos WHERE id=$1 AND entidade_tipo=$2 AND excluido_em IS NULL',[req.params.id,String(req.params.tipo).toUpperCase()]);
  if(!a)throw new ErroNaoEncontrado('Anexo não encontrado.');const arquivo=path.join(config.uploads.diretorio,path.basename(a.caminho));
  if(!fs.existsSync(arquivo))throw new ErroNaoEncontrado('O arquivo não está disponível no armazenamento.');res.download(arquivo,a.nome_original);
}catch(e){next(e);}});
router.post('/arquivo/:tipo/:id/excluir',async(req,res,next)=>{try{const d=def(req,'editar');const motivo=String(req.body.motivo||'').trim();
  if(motivo.length<5)throw new ErroNegocio('Informe o motivo da retirada do anexo.');await transacao(async cx=>{const {rows:[a]}=await cx.query('SELECT * FROM anexos WHERE id=$1 AND entidade_tipo=$2 AND excluido_em IS NULL FOR UPDATE',[req.params.id,String(req.params.tipo).toUpperCase()]);
    if(!a)throw new ErroNaoEncontrado('Anexo não encontrado.');await cx.query('UPDATE anexos SET excluido_em=now(),excluido_por=$1,motivo_exclusao=$2 WHERE id=$3',[req.usuario.id,motivo,a.id]);
    await registrar(cx,{usuario:req.usuario,acao:ACOES.CANCELAR,modulo:d.modulo,registroTipo:'ANEXO',registroId:a.id,
      descricao:`Anexo "${a.nome_original}" retirado. Motivo: ${motivo}`,antes:{excluido_em:null},depois:{excluido_em:new Date(),motivo},ip:req.ip,sessao:req.sessionID});});
  res.avisar('Anexo retirado da visualização; o histórico foi preservado.');res.redirect(req.get('referer')||'/');
}catch(e){next(e);}});
export default router;
