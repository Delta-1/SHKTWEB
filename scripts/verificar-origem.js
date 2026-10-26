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
  // Bancos semeados em momentos diferentes podem ter IDs distintos para o mesmo código.
  const mapas=new Map();
  for(const tabela of REFERENCIAS){
   const mapa=new Map();
   for(const linha of dadosOrigem[tabela]){
    const equivalente=dadosDestino[tabela].find(x=>linha.codigo?x.codigo===linha.codigo:String(x.id)===String(linha.id));
    if(!equivalente)throw new Error(`Referência incompatível em ${tabela}. A transferência foi cancelada sem alterar dados.`);
    mapa.set(String(linha.id),equivalente.id);
   }
   mapas.set(tabela,mapa);
  }
  await destino.query(`INSERT INTO shkt_transferencia.salvaguardas(chave,dados_origem,dados_destino)
   VALUES('railway_20261026',$1::jsonb,$2::jsonb) ON CONFLICT DO NOTHING`,[JSON.stringify(dadosOrigem),JSON.stringify(dadosDestino)]);
  const mapaUsuario=new Map();mapas.set('usuarios',mapaUsuario);
  for(const u of dadosOrigem.usuarios){
   const existente=dadosDestino.usuarios.find(x=>x.email.toLowerCase()===u.email.toLowerCase());
   if(existente){
    mapaUsuario.set(String(u.id),existente.id);
    // Preserva o acesso que já era utilizado no sistema de origem. O acesso anterior fica na salvaguarda.
    await destino.query('UPDATE usuarios SET nome=$1,senha_hash=$2,perfil_id=$3,ativo=$4,trocar_senha=$5 WHERE id=$6',[u.nome,u.senha_hash,mapas.get('perfis').get(String(u.perfil_id)),u.ativo,u.trocar_senha,existente.id]);
   }else{
    const {rows:[novo]}=await destino.query(`INSERT INTO usuarios(nome,email,senha_hash,perfil_id,ativo,trocar_senha)
     VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,[u.nome,u.email,u.senha_hash,mapas.get('perfis').get(String(u.perfil_id)),u.ativo,u.trocar_senha]);
    mapaUsuario.set(String(u.id),novo.id);
   }
  }
  for(const tabela of CADASTROS.filter(t=>t!=='usuarios')){
   const {rows:metadados}=await destino.query(`SELECT column_name,is_generated FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`,[tabela]);
   const {rows:fks}=await destino.query(`SELECT a.attname AS coluna,rt.relname AS referencia
    FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_class rt ON rt.oid=c.confrelid
    JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=c.conkey[1]
    WHERE c.contype='f' AND t.relnamespace='public'::regnamespace AND t.relname=$1 AND array_length(c.conkey,1)=1`,[tabela]);
   const permitidas=new Set(metadados.filter(x=>x.is_generated==='NEVER').map(x=>x.column_name));
   const mapa=new Map();mapas.set(tabela,mapa);
   for(const row of dadosOrigem[tabela]){
    const linha={...row};
    for(const fk of fks){
     if(linha[fk.coluna]==null)continue;
     const m=mapas.get(fk.referencia);
     if(!m?.has(String(linha[fk.coluna])))throw new Error(`Vínculo não mapeado em ${tabela}.${fk.coluna}; nenhuma alteração foi aplicada.`);
     linha[fk.coluna]=m.get(String(linha[fk.coluna]));
    }
    const pk=tabela==='parametros'?'chave':'id';
    const existente=tabela==='auditoria'?null:dadosDestino[tabela].find(x=>pk==='chave'?x.chave===linha.chave:(linha.codigo?x.codigo===linha.codigo:false));
    if(pk==='id'){if(existente)linha.id=existente.id;else delete linha.id;}
    if(tabela==='auditoria'&&linha.registro_id!=null){
     const entidades={PARCEIRO:'parceiros',PARCEIROS:'parceiros',PRODUTO:'produtos',PRODUTOS:'produtos',LOCAL_ESTOQUE:'locais_estoque',LOCAIS_ESTOQUE:'locais_estoque',CONTA_BANCARIA:'contas_bancarias',CONTAS_BANCARIAS:'contas_bancarias',USUARIO:'usuarios',USUARIOS:'usuarios'};
     const m=mapas.get(entidades[linha.registro_tipo]);
     if(m?.has(String(linha.registro_id)))linha.registro_id=m.get(String(linha.registro_id));
    }
    const colunas=Object.keys(linha).filter(k=>permitidas.has(k));
    const atualizar=colunas.filter(k=>k!==pk).map(k=>`${quote(k)}=EXCLUDED.${quote(k)}`).join(',');
    const {rows:[gravado]}=await destino.query(`INSERT INTO public.${quote(tabela)}(${colunas.map(quote).join(',')}) OVERRIDING SYSTEM VALUE
      VALUES(${colunas.map((_,i)=>'$'+(i+1)).join(',')}) ON CONFLICT(${quote(pk)}) ${tabela==='auditoria'?'DO NOTHING':'DO UPDATE SET '+atualizar} RETURNING ${quote(pk)}`,colunas.map(k=>linha[k]));
    if(pk==='id')mapa.set(String(row.id),gravado.id);
   }
  }
  const registroMapas=Object.fromEntries([...mapas].map(([t,m])=>[t,Object.fromEntries(m)]));
  await destino.query("UPDATE shkt_transferencia.salvaguardas SET dados_origem=dados_origem || jsonb_build_object('_mapas',$1::jsonb) WHERE chave='railway_20261026'",[JSON.stringify(registroMapas)]);
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
