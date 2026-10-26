import pg from 'pg';
const quote=s=>'"'+String(s).replaceAll('"','""')+'"';
const NEGOCIO=['pedidos_compra','pedidos_venda','estoque_movimentos','fumigacoes','certificados_fumigacao','carregamentos','contas_pagar','contas_receber','viagens','folhas_competencia','obrigacoes','anexos','funcionarios','veiculos','motoristas'];
const REFERENCIAS=['perfis','paises','moedas','incoterms','unidades_medida','formas_pagamento','condicoes_pagamento','categorias_financeiras','centros_custo','tipos_combustivel','operacoes'];
const CADASTROS=['usuarios','parceiros','produtos','locais_estoque','contas_bancarias','parametros','auditoria'];
export async function migrarCadastros(origem,destino){
 await origem.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 await destino.query('BEGIN');
 try{
  await destino.query("SELECT pg_advisory_xact_lock(hashtext('shkt-transferencia-cadastros'))");
  const {rows:[anterior]}=await destino.query("SELECT concluido FROM shkt_transferencia.salvaguardas WHERE chave='railway_20261026'");
  if(anterior?.concluido){await origem.query('COMMIT');await destino.query('COMMIT');return;}
  for(const tabela of NEGOCIO){
   const a=await origem.query(`SELECT count(*)::int n FROM public.${quote(tabela)}`);
   const b=await destino.query(`SELECT count(*)::int n FROM public.${quote(tabela)}`);
   if(a.rows[0].n||b.rows[0].n)throw new Error(`A tabela ${tabela} possui operações. É necessária uma migração operacional específica; nenhuma alteração foi aplicada.`);
  }
  const dadosOrigem={},dadosDestino={};
  for(const tabela of [...REFERENCIAS,...CADASTROS]){
   dadosOrigem[tabela]=(await origem.query(`SELECT * FROM public.${quote(tabela)}`)).rows;
   dadosDestino[tabela]=(await destino.query(`SELECT * FROM public.${quote(tabela)}`)).rows;
  }
  // Toda referência usada pelo cadastro deve representar a mesma entidade nos dois bancos.
  for(const tabela of REFERENCIAS){
   for(const linha of dadosOrigem[tabela]){
    const existente=dadosDestino[tabela].find(x=>String(x.id)===String(linha.id));
    if(!existente || (linha.codigo && existente.codigo!==linha.codigo))throw new Error(`Referência incompatível em ${tabela}. A transferência foi cancelada sem alterar dados.`);
   }
  }
  await destino.query(`INSERT INTO shkt_transferencia.salvaguardas(chave,dados_origem,dados_destino)
   VALUES('railway_20261026',$1::jsonb,$2::jsonb) ON CONFLICT DO NOTHING`,[JSON.stringify(dadosOrigem),JSON.stringify(dadosDestino)]);
  const mapaUsuario=new Map();
  for(const u of dadosOrigem.usuarios){
   const existente=dadosDestino.usuarios.find(x=>x.email.toLowerCase()===u.email.toLowerCase());
   if(existente){
    mapaUsuario.set(String(u.id),existente.id);
    // Preserva o acesso que já era utilizado no sistema de origem. O acesso anterior fica na salvaguarda.
    await destino.query('UPDATE usuarios SET senha_hash=$1,trocar_senha=$2 WHERE id=$3',[u.senha_hash,u.trocar_senha,existente.id]);
   }else{
    const {rows:[novo]}=await destino.query(`INSERT INTO usuarios(nome,email,senha_hash,perfil_id,ativo,trocar_senha)
     VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,[u.nome,u.email,u.senha_hash,u.perfil_id,u.ativo,u.trocar_senha]);
    mapaUsuario.set(String(u.id),novo.id);
   }
  }
  for(const tabela of CADASTROS.filter(t=>t!=='usuarios')){
   const {rows:metadados}=await destino.query(`SELECT column_name,is_generated FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`,[tabela]);
   const permitidas=new Set(metadados.filter(x=>x.is_generated==='NEVER').map(x=>x.column_name));
   for(const row of dadosOrigem[tabela]){
    const linha={...row};
    for(const k of ['criado_por','atualizado_por','usuario_id'])if(linha[k]!=null&&mapaUsuario.has(String(linha[k])))linha[k]=mapaUsuario.get(String(linha[k]));
    if(tabela==='auditoria')delete linha.id;
    const colunas=Object.keys(linha).filter(k=>permitidas.has(k));
    const pk=tabela==='parametros'?'chave':'id';
    const existentes=dadosDestino[tabela];
    const mesmoId=existentes.find(x=>String(x[pk])===String(linha[pk]));
    if(mesmoId&&linha.codigo&&mesmoId.codigo!==linha.codigo)throw new Error(`Código divergente em ${tabela}. A transferência foi cancelada sem alterar dados.`);
    const atualizar=colunas.filter(k=>k!==pk).map(k=>`${quote(k)}=EXCLUDED.${quote(k)}`).join(',');
    await destino.query(`INSERT INTO public.${quote(tabela)}(${colunas.map(quote).join(',')}) OVERRIDING SYSTEM VALUE
      VALUES(${colunas.map((_,i)=>'$'+(i+1)).join(',')}) ON CONFLICT(${quote(pk)}) ${tabela==='auditoria'?'DO NOTHING':'DO UPDATE SET '+atualizar}`,colunas.map(k=>linha[k]));
   }
   if(tabela!=='parametros')await destino.query(`SELECT setval(pg_get_serial_sequence($1,'id'), GREATEST(COALESCE((SELECT max(id) FROM public.${quote(tabela)}),0),1),true)`,['public.'+tabela]);
  }
  await destino.query("UPDATE shkt_transferencia.salvaguardas SET concluido=true WHERE chave='railway_20261026'");
  await origem.query('COMMIT');await destino.query('COMMIT');
  console.log('Transferência concluída: cadastros e acesso preservados, com salvaguarda da origem e do destino. Nenhum registro da origem foi removido.');
 }catch(e){await origem.query('ROLLBACK');await destino.query('ROLLBACK');throw e;}
}
export async function verificarOrigem(){
 if(!process.env.SHKT_SUPABASE_URL||!process.env.DATABASE_URL||process.env.SHKT_SUPABASE_URL===process.env.DATABASE_URL||process.env.SHKT_ORIGEM_CONFERIDA==='true')return;
 const origemPool=new pg.Pool({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:10000,max:1});
 const destinoPool=new pg.Pool({connectionString:process.env.SHKT_SUPABASE_URL,ssl:{rejectUnauthorized:false},connectionTimeoutMillis:15000,max:1});
 const origem=await origemPool.connect();let destino;
 try{destino=await destinoPool.connect();await migrarCadastros(origem,destino);}
 finally{origem.release();destino?.release();await origemPool.end();await destinoPool.end();}
}
