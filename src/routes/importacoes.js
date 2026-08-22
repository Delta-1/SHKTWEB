import { Router } from 'express';
import multer from 'multer';
import writeXlsxFile from 'write-excel-file/node';
import { exigir } from '../lib/auth.js';
import * as importar from '../services/importacoes.js';
import { ErroNegocio, ErroNaoEncontrado } from '../lib/erros.js';

const router=Router(); const ctx=req=>({ip:req.ip,sessao:req.sessionID});
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:10*1024*1024}});
router.get('/',exigir('importacoes.visualizar'),async(req,res,next)=>{try{res.render('importacoes/lista',{titulo:'Importar planilhas',lista:await importar.listar()});}catch(e){next(e);}});
router.get('/nova',exigir('importacoes.criar'),(req,res)=>res.render('importacoes/form',{titulo:'Nova importação'}));
router.get('/modelo/:entidade',exigir('importacoes.visualizar'),async(req,res,next)=>{try{
  const entidade=String(req.params.entidade).toUpperCase();const dados=importar.modelo(entidade);
  const planilha=dados.map((linha,i)=>linha.map(valor=>({value:String(valor),type:String,
    fontWeight:i===0?'bold':undefined,width:24})));
  const arq=await writeXlsxFile(planilha,{sheet:'Modelo',buffer:true});res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition',`attachment; filename="modelo-${entidade.toLowerCase()}.xlsx"`);res.send(arq);
}catch(e){next(e);}});
router.post('/nova',exigir('importacoes.criar'),upload.single('arquivo'),async(req,res,next)=>{try{
  if(!req.file)throw new ErroNegocio('Escolha uma planilha Excel ou CSV.');
  if(!/\.(xlsx|csv)$/i.test(req.file.originalname))throw new ErroNegocio('Formato inválido. Use XLSX ou CSV.');
  const imp=await importar.criarPrevia(String(req.body.entidade||'').toUpperCase(),
    await importar.lerArquivo(req.file.buffer,req.file.originalname),req.usuario,ctx(req));
  res.avisar('Prévia criada. Confira as linhas antes de confirmar.');req.session.save(()=>res.redirect(`/importacoes/${imp.id}`));
}catch(e){next(e);}});
router.get('/:id',exigir('importacoes.visualizar'),async(req,res,next)=>{try{const imp=await importar.buscar(req.params.id);
  if(!imp)throw new ErroNaoEncontrado('Importação não encontrada.');res.render('importacoes/detalhe',{titulo:`Importação ${imp.numero}`,imp});
}catch(e){next(e);}});
router.post('/:id/confirmar',exigir('importacoes.aprovar'),async(req,res,next)=>{try{await importar.confirmar(req.params.id,req.usuario,ctx(req));
  res.avisar('Importação concluída. Os cadastros já estão disponíveis.');req.session.save(()=>res.redirect(`/importacoes/${req.params.id}`));
}catch(e){next(e);}});
export default router;
