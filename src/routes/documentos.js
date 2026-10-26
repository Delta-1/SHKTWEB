import { Router } from 'express';
import * as documentos from '../services/documentos.js';
import { ErroNegocio } from '../lib/erros.js';
const router=Router();
router.get('/',async(req,res,next)=>{try{
 const tarefas=await documentos.listar(req.usuario);
 if(req.accepts(['html','json'])==='json')return res.set('Cache-Control','no-store').json({tarefas});
 res.render('documentos/indice',{titulo:'Meus arquivos',tarefas});
}catch(e){next(e);}});
router.post('/:tipo/:id',async(req,res,next)=>{try{
 const tarefa=await documentos.solicitar(req.params.tipo,req.params.id,req.usuario,{ip:req.ip,sessao:req.sessionID});
 if(req.accepts(['html','json'])==='json')return res.status(202).json({tarefa});
 res.avisar('Arquivo solicitado. Você pode continuar trabalhando.');res.redirect('/documentos');
}catch(e){next(e);}});
router.get('/:id/status',async(req,res,next)=>{try{
 res.set('Cache-Control','no-store').json({tarefa:await documentos.buscar(req.params.id,req.usuario)});
}catch(e){next(e);}});
router.get('/:id/baixar',async(req,res,next)=>{try{
 const t=await documentos.buscar(req.params.id,req.usuario,true);
 if(t.status!=='CONCLUIDO')throw new ErroNegocio('O arquivo ainda está sendo preparado.');
 res.set({'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="${t.nome_arquivo}"`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}).send(t.arquivo);
}catch(e){next(e);}});
router.post('/:id/tentar-novamente',async(req,res,next)=>{try{
 await documentos.tentarNovamente(req.params.id,req.usuario);
 if(req.accepts(['html','json'])==='json')return res.status(202).json({solicitado:true});res.redirect('/documentos');
}catch(e){next(e);}});
export default router;
