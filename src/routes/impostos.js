import { Router } from 'express';
import { exigir } from '../lib/auth.js';
import { carregar } from '../lib/referencias.js';
import * as validar from '../lib/validar.js';
import * as impostos from '../services/impostos.js';
import { ErroNaoEncontrado } from '../lib/erros.js';
import { hojeISO } from '../lib/formato.js';

const router=Router(); const ctx=req=>({ip:req.ip,sessao:req.sessionID});
router.get('/',exigir('impostos.visualizar'),async(req,res,next)=>{try{
  res.render('impostos/lista',{titulo:'Impostos e obrigações',lista:await impostos.listar()});
}catch(e){next(e);}});
router.get('/nova',exigir('impostos.criar'),async(req,res,next)=>{try{
  const [ref,tipos]=await Promise.all([carregar(['operacoes','moedas','centrosCusto']),impostos.tipos()]);
  res.render('impostos/form',{titulo:'Nova obrigação',ref,tipos,hoje:hojeISO()});
}catch(e){next(e);}});
router.post('/nova',exigir('impostos.criar'),async(req,res,next)=>{try{
  const o=await impostos.criar({tipoId:validar.id(req.body.tipo_id,'Tipo',{obrigatorio:true}),
    operacaoId:validar.id(req.body.operacao_id,'Operação',{obrigatorio:true}),
    competencia:validar.data(req.body.competencia,'Competência',{obrigatorio:true}),
    vencimento:validar.data(req.body.vencimento,'Vencimento',{obrigatorio:true}),
    descricao:validar.texto(req.body.descricao,'Descrição',{obrigatorio:true,max:200}),
    documento:validar.texto(req.body.documento,'Documento'),
    parcela:validar.inteiro(req.body.parcela||'1','Parcela',{min:1}),
    totalParcelas:validar.inteiro(req.body.total_parcelas||'1','Total de parcelas',{min:1}),
    valor:validar.dinheiro(req.body.valor,'Valor',{obrigatorio:true,positivo:true}),
    moedaId:validar.id(req.body.moeda_id,'Moeda',{obrigatorio:true}),
    taxaCambio:validar.decimal(req.body.taxa_cambio||'1','Cotação',{obrigatorio:true,positivo:true,escala:8}),
    centroCustoId:validar.id(req.body.centro_custo_id,'Centro de custo'),
    observacoes:validar.texto(req.body.observacoes,'Observações')},req.usuario,ctx(req));
  res.avisar('Obrigação registrada em rascunho.');req.session.save(()=>res.redirect(`/impostos/${o.id}`));
}catch(e){next(e);}});
router.get('/:id',exigir('impostos.visualizar'),async(req,res,next)=>{try{
  const o=await impostos.buscar(req.params.id);if(!o)throw new ErroNaoEncontrado('Obrigação não encontrada.');
  res.render('impostos/detalhe',{titulo:`Obrigação ${o.numero}`,o});
}catch(e){next(e);}});
router.post('/:id/aprovar',exigir('impostos.aprovar'),async(req,res,next)=>{try{
  await impostos.aprovar(req.params.id,req.usuario,ctx(req));res.avisar('Obrigação aprovada e enviada ao Contas a Pagar.');
  req.session.save(()=>res.redirect(`/impostos/${req.params.id}`));
}catch(e){next(e);}});
router.post('/:id/cancelar',exigir('impostos.cancelar'),async(req,res,next)=>{try{
  await impostos.cancelar(req.params.id,validar.texto(req.body.motivo,'Motivo',{obrigatorio:true,min:5}),req.usuario,ctx(req));
  res.avisar('Obrigação cancelada; o histórico foi preservado.');req.session.save(()=>res.redirect(`/impostos/${req.params.id}`));
}catch(e){next(e);}});
export default router;
