import crypto from 'node:crypto';
import readXlsxFile from 'read-excel-file/node';
import { muitos, um, transacao } from '../db/index.js';
import { registrar, ACOES } from '../lib/auditoria.js';
import { ErroNegocio, ErroNaoEncontrado } from '../lib/erros.js';
import { proximoNumero, TIPOS_DOCUMENTO } from '../lib/numeracao.js';

const chave = v => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
  .trim().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'');
const texto = v => v===undefined||v===null ? '' : String(v).trim();
const sim = v => ['1','true','sim','s','yes','x'].includes(texto(v).toLowerCase());

const ALIASES={
  codigo:['codigo','cod','sku'], descricao:['descricao','produto','nome'], unidade:['unidade','unidade_codigo','und'],
  razao_social:['razao_social','nome','empresa','cliente','fornecedor'], nome_fantasia:['nome_fantasia','fantasia'],
  documento:['documento','cpf_cnpj','cpf','cnpj','ruc'], email:['email','e_mail'], telefone:['telefone','fone','celular'],
  controla_lote:['controla_lote','lote'], exige_fumigacao:['exige_fumigacao','fumigacao']
};
function ler(linha,campo){const achou=ALIASES[campo].find(a=>Object.hasOwn(linha,a));return achou?linha[achou]:'';}

export function modelo(entidade){
  if(entidade==='PRODUTOS') return [['codigo','descricao','unidade','controla_lote','exige_fumigacao'],['PROD-001','Produto exemplo','KG','SIM','NAO']];
  return [['codigo','razao_social','nome_fantasia','documento','email','telefone'],['PARC-001','Empresa exemplo','','','','']];
}

export async function lerArquivo(buffer,nome){
  const matriz=/\.csv$/i.test(nome) ? lerCsv(buffer.toString('utf8')) : await readXlsxFile(buffer);
  if(!matriz.length) throw new ErroNegocio('A planilha não possui linhas.');
  const cabecalhos=matriz[0].map(chave);
  const brutas=[];
  for(let n=1;n<matriz.length;n++){
    const valores=matriz[n];const linha={};let preenchida=false;
    cabecalhos.forEach((h,i)=>{const v=valores[i]??'';linha[h]=v;preenchida ||= texto(v)!=='';});
    if(preenchida)brutas.push(linha);
  }
  if(!brutas.length) throw new ErroNegocio('A primeira aba está vazia.');
  if(brutas.length>1000) throw new ErroNegocio('Importe no máximo 1.000 linhas por arquivo.');
  return { hash:crypto.createHash('sha256').update(buffer).digest('hex'),
    linhas:brutas,nome };
}

function lerCsv(conteudo){
  const primeira=(conteudo.split(/\r?\n/,1)[0]||'');const sep=(primeira.match(/;/g)||[]).length>(primeira.match(/,/g)||[]).length?';':',';
  const linhas=[];let linha=[],campo='',aspas=false;
  for(let i=0;i<conteudo.length;i++){const c=conteudo[i];
    if(c==='"'){if(aspas&&conteudo[i+1]==='"'){campo+='"';i++;}else aspas=!aspas;}
    else if(c===sep&&!aspas){linha.push(campo);campo='';}
    else if((c==='\n'||c==='\r')&&!aspas){if(c==='\r'&&conteudo[i+1]==='\n')i++;linha.push(campo);if(linha.some(x=>x!==''))linhas.push(linha);linha=[];campo='';}
    else campo+=c;
  }
  linha.push(campo);if(linha.some(x=>x!==''))linhas.push(linha);return linhas;
}

export function criarPrevia(entidade,arquivo,usuario,contexto={}){return transacao(async cx=>{
  if(!['PRODUTOS','CLIENTES','FORNECEDORES'].includes(entidade)) throw new ErroNegocio('Tipo de importação inválido.');
  const duplicada=await cx.query('SELECT id FROM importacoes WHERE entidade=$1 AND arquivo_hash=$2',[entidade,arquivo.hash]);
  if(duplicada.rows[0]) throw new ErroNegocio('Este mesmo arquivo já foi enviado. Abra a importação existente.');
  const existentes=entidade==='PRODUTOS'
    ? await cx.query('SELECT lower(codigo) chave FROM produtos')
    : await cx.query("SELECT lower(codigo) chave FROM parceiros UNION SELECT documento FROM parceiros WHERE documento IS NOT NULL AND documento<>''");
  const usados=new Set(existentes.rows.map(x=>texto(x.chave).toLowerCase()));
  const unidades=entidade==='PRODUTOS'?await cx.query('SELECT id,lower(codigo) codigo FROM unidades_medida WHERE ativo'): {rows:[]};
  const mapaUnidades=new Map(unidades.rows.map(x=>[x.codigo,x.id]));
  const preparadas=arquivo.linhas.map((l,i)=>{
    const dados={codigo:texto(ler(l,'codigo')),descricao:texto(ler(l,'descricao')),
      unidade:texto(ler(l,'unidade')).toLowerCase(),razao_social:texto(ler(l,'razao_social')),
      nome_fantasia:texto(ler(l,'nome_fantasia')),documento:texto(ler(l,'documento')),
      email:texto(ler(l,'email')),telefone:texto(ler(l,'telefone')),
      controla_lote:sim(ler(l,'controla_lote')),exige_fumigacao:sim(ler(l,'exige_fumigacao'))};
    const erros=[]; if(!dados.codigo)erros.push('Código obrigatório.');
    if(entidade==='PRODUTOS'){if(!dados.descricao)erros.push('Descrição obrigatória.');
      if(!mapaUnidades.has(dados.unidade))erros.push('Unidade não cadastrada (ex.: KG).');}
    else if(!dados.razao_social)erros.push('Razão social obrigatória.');
    const ch=dados.codigo.toLowerCase(); if(ch&&usados.has(ch))erros.push('Código duplicado no arquivo ou já cadastrado.');
    if(ch)usados.add(ch); if(dados.documento&&usados.has(dados.documento))erros.push('Documento já cadastrado.');
    if(dados.documento)usados.add(dados.documento);
    if(entidade==='PRODUTOS')dados.unidade_id=mapaUnidades.get(dados.unidade)||null;
    return {linha:i+2,dados,erros,valido:!erros.length};
  });
  const numero=await proximoNumero(cx,TIPOS_DOCUMENTO.IMPORTACAO);
  const validas=preparadas.filter(x=>x.valido).length;
  const {rows:[imp]}=await cx.query(`INSERT INTO importacoes
    (numero,entidade,arquivo_nome,arquivo_hash,total_linhas,linhas_validas,linhas_erros,criado_por)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [numero,entidade,arquivo.nome,arquivo.hash,preparadas.length,validas,preparadas.length-validas,usuario.id]);
  for(const x of preparadas) await cx.query(`INSERT INTO importacao_linhas(importacao_id,linha,dados,valido,erros)
    VALUES($1,$2,$3,$4,$5)`,[imp.id,x.linha,JSON.stringify(x.dados),x.valido,JSON.stringify(x.erros)]);
  await registrar(cx,{usuario,acao:ACOES.CRIAR,modulo:'importacoes',registroTipo:'IMPORTACAO',registroId:imp.id,
    registroNumero:numero,descricao:`Prévia ${numero}: ${preparadas.length} linha(s), ${validas} válida(s).`,
    depois:imp,ip:contexto.ip,sessao:contexto.sessao}); return imp;
});}

export async function buscar(id){const imp=await um('SELECT * FROM importacoes WHERE id=$1',[id]);if(!imp)return null;
  imp.linhas=await muitos('SELECT * FROM importacao_linhas WHERE importacao_id=$1 ORDER BY linha',[id]);return imp;}
export const listar=()=>muitos('SELECT * FROM importacoes ORDER BY id DESC');

export function confirmar(id,usuario,contexto={}){return transacao(async cx=>{
  const {rows:[imp]}=await cx.query('SELECT * FROM importacoes WHERE id=$1 FOR UPDATE',[id]);
  if(!imp)throw new ErroNaoEncontrado('Importação não encontrada.');
  if(imp.status!=='PREVIA')throw new ErroNegocio('Esta importação já foi finalizada.');
  if(imp.linhas_erros>0)throw new ErroNegocio('Corrija a planilha e envie novamente; há linhas com erro.');
  const {rows:linhas}=await cx.query('SELECT * FROM importacao_linhas WHERE importacao_id=$1 AND valido ORDER BY linha',[id]);
  for(const l of linhas){const d=l.dados;let novo;
    if(imp.entidade==='PRODUTOS')({rows:[novo]}=await cx.query(`INSERT INTO produtos
      (codigo,descricao,unidade_id,controla_lote,exige_fumigacao,criado_por)
      VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,[d.codigo,d.descricao,d.unidade_id,d.controla_lote,d.exige_fumigacao,usuario.id]));
    else {const cliente=imp.entidade==='CLIENTES';({rows:[novo]}=await cx.query(`INSERT INTO parceiros
      (codigo,razao_social,nome_fantasia,documento,email,telefone,is_cliente,is_fornecedor,criado_por)
      VALUES($1,$2,$3,NULLIF($4,''),$5,$6,$7,$8,$9) RETURNING id`,
      [d.codigo,d.razao_social,d.nome_fantasia,d.documento,d.email,d.telefone,cliente,!cliente,usuario.id]));}
    await cx.query('UPDATE importacao_linhas SET importado_id=$1 WHERE id=$2',[novo.id,l.id]);
  }
  await cx.query("UPDATE importacoes SET status='IMPORTADA',confirmado_em=now(),confirmado_por=$1 WHERE id=$2",[usuario.id,id]);
  await registrar(cx,{usuario,acao:ACOES.IMPORTAR,modulo:'importacoes',registroTipo:'IMPORTACAO',registroId:id,
    registroNumero:imp.numero,descricao:`Importação ${imp.numero} confirmada: ${linhas.length} registro(s).`,
    antes:{status:'PREVIA'},depois:{status:'IMPORTADA'},ip:contexto.ip,sessao:contexto.sessao});
});}
