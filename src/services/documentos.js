import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import SVGtoPDF from 'svg-to-pdfkit';
import { ROOT, config } from '../config.js';
import { query, um, muitos, transacao } from '../db/index.js';
import { carregarUsuario, temPermissao } from '../lib/auth.js';
import { ErroNegocio, ErroNaoEncontrado, ErroPermissao } from '../lib/erros.js';
import { registrar, ACOES } from '../lib/auditoria.js';
import * as f from '../lib/formato.js';
import * as compras from './compras.js';
import * as vendas from './vendas.js';
import * as recebimentos from './recebimento.js';
import * as fumigacao from './fumigacao.js';
import * as certificados from './certificados.js';
import * as carregamentos from './carregamento.js';
import { empresaAtual } from './onboarding.js';

export const TIPOS_DOCUMENTO={
 compras:{titulo:'Pedido de compra',permissao:'compras.visualizar',buscar:compras.buscar},
 vendas:{titulo:'Pedido de venda',permissao:'vendas.visualizar',buscar:vendas.buscar},
 recebimentos:{titulo:'Recebimento de mercadoria',permissao:'compras.visualizar',buscar:recebimentos.buscar},
 fumigacao:{titulo:'Controle de fumigação',permissao:'fumigacao.visualizar',buscar:fumigacao.buscar},
 certificados:{titulo:'Certificado de fumigação',permissao:'certificados.visualizar',buscar:certificados.buscar},
 carregamentos:{titulo:'Ordem de carregamento',permissao:'carregamento.visualizar',buscar:carregamentos.buscar},
};
export function definir(tipo,usuario){
 const d=TIPOS_DOCUMENTO[tipo];if(!d)throw new ErroNegocio('Tipo de documento inválido.');
 if(!temPermissao(usuario,d.permissao))throw new ErroPermissao();return d;
}
const CAMPOS={
 data_hora_inicio:'Início',data_hora_termino:'Término',numero_pedido_shkt:'Pedido SHKT',peso_tara_kg:'Tara (kg)',peso_bruto_kg:'Peso bruto (kg)',peso_liquido_kg:'Peso líquido (kg)',
 numero:'Controle SHKT',numero_certificado:'Certificado',status:'Situação',data:'Data',
 fornecedor:'Fornecedor',fornecedor_nome:'Fornecedor',cliente:'Cliente',cliente_nome:'Cliente',
 fornecedor_documento:'Documento do fornecedor',cliente_documento:'Documento do cliente',
 produto:'Produto',nome_cientifico:'Nome científico',local:'Local de estoque',lote:'Lote',
 operacao:'Operação',fumigadora:'Empresa fumigadora',fumigacao_numero:'Fumigação',numero_comunicado:'Comunicado',
 quantidade_kg:'Quantidade (kg)',quantidade_t:'Quantidade (t)',peso_bruto:'Peso bruto (kg)',peso_tara:'Tara (kg)',peso_liquido:'Peso líquido (kg)',
 inicio:'Início',termino:'Término',inicio_em:'Início',termino_em:'Término',data_inicio:'Início',data_fim:'Término',
 origem:'Origem',destino:'Destino',motorista:'Motorista',motorista_nome:'Motorista',placa:'Placa',veiculo_placa:'Placa',
 transportadora:'Transportadora',moeda:'Moeda',moeda_codigo:'Moeda',incoterm:'Incoterm',
 condicao_pagamento:'Condição de pagamento',previsao_entrega:'Previsão de entrega',
 custo_tonelada:'Custo por tonelada',valor_total:'Valor total',vencimento:'Vencimento',
 conta_pagar_numero:'Contas a pagar',conta_receber_numero:'Contas a receber',pedido_numero:'Pedido',
 observacoes:'Observações',motivo_cancelamento:'Motivo do cancelamento',
};
function valor(chave,v){
 if(v instanceof Date)return f.data(v);
 if(/^(data|vencimento|previsao)/.test(chave))return f.data(v);
 if(chave==='status')return f.rotuloStatus(v);
 if(/quantidade|peso/.test(chave))return f.formatar(v,3);
 if(/valor|custo/.test(chave))return f.formatar(v,2);
 return String(v);
}
export async function solicitar(tipo,id,usuario,ctx={}){
 const d=definir(tipo,usuario);
 if(!/^\d+$/.test(String(id)))throw new ErroNegocio('Documento inválido.');
 const registro=await d.buscar(id);if(!registro)throw new ErroNaoEncontrado();
 const emp=await empresaAtual();
 const dados={titulo:d.titulo,numero:registro.numero,status:registro.status,
  empresa:{...config.empresa,...Object.fromEntries(Object.entries(emp).filter(([,v])=>v))},
  campos:Object.entries(CAMPOS).filter(([k])=>registro[k]!==undefined&&registro[k]!==null&&registro[k]!=='')
   .map(([k,rotulo])=>({rotulo,valor:valor(k,registro[k])})),
  itens:(registro.lista_itens||registro.itens||[]).map(i=>({
   descricao:i.descricao||i.produto||i.produto_nome||'',
   quantidade:f.formatar(i.quantidade_origem??i.quantidade??i.quantidade_recebida??i.quantidade_kg,3),
   unidade:i.unidade_codigo||i.unidade||'kg',preco:f.formatar(i.preco_unitario||0,4),total:f.formatar(i.valor_total||0,2),
  })),
 };
 const chave=crypto.createHash('sha256').update(tipo+':'+id+':'+JSON.stringify(dados)).digest('hex');
 return transacao(async cx=>{
  // Idempotência pela versão dos dados: clique duplo devolve o mesmo trabalho.
  const {rows:[t]}=await cx.query(`INSERT INTO tarefas_documentos(id,usuario_id,tipo,registro_id,titulo,chave,dados)
   VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)
   ON CONFLICT(usuario_id,chave) DO UPDATE SET chave=EXCLUDED.chave
   RETURNING id,status,titulo,criado_em`,[crypto.randomUUID(),usuario.id,tipo,id,`${d.titulo} ${registro.numero}`,chave,JSON.stringify(dados)]);
  await registrar(cx,{usuario,acao:ACOES.EXPORTAR,modulo:tipo==='recebimentos'?'compras':tipo==='carregamentos'?'carregamento':tipo,
   registroTipo:'DOCUMENTO_PDF',registroId:id,registroNumero:registro.numero,descricao:'PDF solicitado para geração em segundo plano.',...ctx});
  return t;
 });
}
export async function listar(usuario){
 const linhas=await muitos(`SELECT id,tipo,registro_id,titulo,status,tentativas,erro,criado_em,concluido_em,nome_arquivo
  FROM tarefas_documentos WHERE usuario_id=$1 ORDER BY criado_em DESC LIMIT 50`,[usuario.id]);
 return linhas.filter(t=>temPermissao(usuario,TIPOS_DOCUMENTO[t.tipo]?.permissao));
}
export async function buscar(id,usuario,arquivo=false){
 if(!/^[\da-f-]{36}$/i.test(String(id)))throw new ErroNaoEncontrado();
 const t=await um(`SELECT id,usuario_id,tipo,titulo,status,erro,tentativas,criado_em,concluido_em,nome_arquivo${arquivo?',arquivo':''}
  FROM tarefas_documentos WHERE id=$1 AND usuario_id=$2`,[id,usuario.id]);
 if(!t)throw new ErroNaoEncontrado('Arquivo não encontrado.');definir(t.tipo,usuario);return t;
}
export async function tentarNovamente(id,usuario){
 const t=await buscar(id,usuario);if(t.status!=='FALHOU')throw new ErroNegocio('Este arquivo não precisa ser reprocessado.');
 await query(`UPDATE tarefas_documentos SET status='PENDENTE',tentativas=0,erro=null,token=null,disponivel_em=now(),atualizado_em=now()
 WHERE id=$1 AND usuario_id=$2 AND status='FALHOU'`,[id,usuario.id]);
}
// Atribuição atômica, com lease e token: múltiplas instâncias não processam a mesma tarefa.
export async function reservar(){
 return um(`WITH proxima AS (
  SELECT id FROM tarefas_documentos WHERE
   (status='PENDENTE' AND disponivel_em<=now()) OR
   (status='PROCESSANDO' AND iniciado_em<now()-interval '5 minutes')
  ORDER BY criado_em FOR UPDATE SKIP LOCKED LIMIT 1
 ) UPDATE tarefas_documentos t SET status='PROCESSANDO',tentativas=t.tentativas+1,
 iniciado_em=now(),atualizado_em=now(),token=$1 FROM proxima p WHERE t.id=p.id RETURNING t.*`,[crypto.randomUUID()]);
}
const logo=fs.readFileSync(path.join(ROOT,'src/public/img/logo.svg'),'utf8');
export function gerarPDF(dados){
 return new Promise((resolve,reject)=>{
  const doc=new PDFDocument({size:'A4',margin:44,bufferPages:true,info:{Title:`${dados.titulo} ${dados.numero}`,Author:dados.empresa.nome}});
  const partes=[];doc.on('data',c=>partes.push(c));doc.on('error',reject);doc.on('end',()=>resolve(Buffer.concat(partes)));
  try {
   function cabecalho(){
    doc.save();SVGtoPDF(doc,logo,44,35,{width:44,height:44});doc.restore();
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#163c37').text(dados.empresa.nome,100,38,{width:450});
    doc.font('Helvetica').fontSize(8).fillColor('#52615e').text([dados.empresa.cnpj&&'CNPJ '+dados.empresa.cnpj,dados.empresa.endereco,dados.empresa.cidade].filter(Boolean).join(' · '),100,57,{width:450});
    doc.moveTo(44,93).lineTo(551,93).strokeColor('#2d6f62').stroke();
    doc.font('Helvetica-Bold').fontSize(18).fillColor('#163c37').text(dados.titulo,44,110,{width:507});
    doc.font('Helvetica').fontSize(9).fillColor('#52615e').text(`Nº ${dados.numero}  |  ${f.rotuloStatus(dados.status)}`,44,138);
    doc.y=166;
   }
   cabecalho();
   doc.on('pageAdded',cabecalho);
   for(const campo of dados.campos){
    const h=Math.max(18,doc.font('Helvetica').fontSize(10).heightOfString(campo.valor,{width:330})+8);
    if(doc.y+h>740)doc.addPage();
    const y=doc.y;doc.font('Helvetica').fontSize(8).fillColor('#62726d').text(campo.rotulo.toUpperCase(),44,y,{width:155});
    doc.font('Helvetica').fontSize(10).fillColor('#172e29').text(campo.valor,207,y,{width:344});doc.y=y+h;
   }
   if(dados.itens.length){
    doc.moveDown();doc.font('Helvetica-Bold').fontSize(11).text('ITENS',44,doc.y);
    for(let i=0;i<dados.itens.length;i++){
     const item=dados.itens[i];const linha=`${i+1}. ${item.descricao}\n${item.quantidade} ${item.unidade}   |   Unitário: ${item.preco}   |   Total: ${item.total}`;
     const h=doc.font('Helvetica').fontSize(10).heightOfString(linha,{width:490})+16;
     if(doc.y+h>730)doc.addPage();const y=doc.y+8;
     doc.fillColor('#172e29').text(linha,44,y,{width:507});doc.moveTo(44,doc.y+6).lineTo(551,doc.y+6).strokeColor('#e1e7e4').stroke();doc.moveDown();
    }
   }
   if(doc.y>650)doc.addPage();doc.y=Math.max(doc.y+35,650);
   doc.moveTo(44,doc.y).lineTo(270,doc.y).moveTo(325,doc.y).lineTo(551,doc.y).strokeColor('#a9b9b2').stroke();
   doc.fontSize(8).text('Responsável pela operação',44,doc.y+8,{width:226,align:'center'}).text('Conferência / recebimento',325,doc.y-9,{width:226,align:'center'});
   const paginas=doc.bufferedPageRange();
   for(let i=0;i<paginas.count;i++){
    doc.switchToPage(i);doc.font('Helvetica').fontSize(7).fillColor('#62726d');
    doc.text(`SHKT · Cópia gerada em ${f.dataHora(new Date())}`,44,785,{lineBreak:false});
    doc.text(`Página ${i+1} de ${paginas.count}`,430,785,{width:121,align:'right',lineBreak:false});
   }
   doc.end();
  }catch(e){doc.destroy();reject(e);}
 });
}
export async function processarUma({gerar=gerarPDF}={}){
 const t=await reservar();if(!t)return false;
 try {
  const usuario=await carregarUsuario(t.usuario_id);definir(t.tipo,usuario);
  const arquivo=await gerar(t.dados);
  if(arquivo.length>10485760)throw new Error('Arquivo excedeu o limite.');
  const nome=`SHKT-${t.tipo}-${t.dados.numero.replace(/[^\w-]/g,'-')}.pdf`;
  await query(`UPDATE tarefas_documentos SET status='CONCLUIDO',arquivo=$3,nome_arquivo=$4,
   concluido_em=now(),atualizado_em=now(),erro=null WHERE id=$1 AND token=$2 AND status='PROCESSANDO'`,[t.id,t.token,arquivo,nome]);
 }catch(e){
  console.error('[documentos]',t.id,e.message);
  const permanente=e instanceof ErroPermissao||t.tentativas>=3;
  await query(`UPDATE tarefas_documentos SET status=$3,erro=$4,disponivel_em=now()+interval '10 seconds',atualizado_em=now()
   WHERE id=$1 AND token=$2`,[t.id,t.token,permanente?'FALHOU':'PENDENTE',permanente?'Não foi possível gerar o arquivo. Confira sua permissão e tente novamente.':'Preparando nova tentativa…']);
 }
 return true;
}
export function iniciarProcessador(){
 let parado=false,rodando=null,timer;
 async function ciclo(){
  if(parado)return;
  rodando=(async()=>{try{for(let i=0;i<10&&!parado;i++){if(!await processarUma())break;}}catch(e){console.error('[fila]',e.message);}})();
  await rodando;rodando=null;if(!parado){timer=setTimeout(ciclo,2000);timer.unref();}
 }
 ciclo();return async()=>{parado=true;clearTimeout(timer);if(rodando)await rodando;};
}
