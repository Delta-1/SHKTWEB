import pg from 'pg';
// A origem antiga fica intacta e configurada para permitir recuperação.
// Só alterna automaticamente instalações sem dados operacionais.
export async function verificarOrigem(){
 if(!process.env.SHKT_SUPABASE_URL||!process.env.DATABASE_URL||process.env.SHKT_SUPABASE_URL===process.env.DATABASE_URL)return;
 if(process.env.SHKT_ORIGEM_CONFERIDA==='true')return;
 const origem=new pg.Pool({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:10000,max:1});
 try{
  const {rows:[r]}=await origem.query(`SELECT
   ((SELECT count(*) FROM pedidos_compra)+(SELECT count(*) FROM pedidos_venda)+(SELECT count(*) FROM estoque_movimentos)+
    (SELECT count(*) FROM fumigacoes)+(SELECT count(*) FROM certificados_fumigacao)+(SELECT count(*) FROM carregamentos)+
    (SELECT count(*) FROM contas_pagar)+(SELECT count(*) FROM contas_receber)+(SELECT count(*) FROM viagens)+
    (SELECT count(*) FROM folhas_competencia)+(SELECT count(*) FROM obrigacoes)+(SELECT count(*) FROM parceiros)+
    (SELECT count(*) FROM funcionarios)+(SELECT count(*) FROM veiculos)+(SELECT count(*) FROM motoristas)+
    (SELECT count(*) FROM produtos WHERE codigo<>'MILHO-AD')+(SELECT count(*) FROM anexos))::int AS registros`);
  if(r.registros>0){
   const tabelas=['parceiros','produtos','funcionarios','veiculos','motoristas','pedidos_compra','pedidos_venda','estoque_movimentos','fumigacoes','certificados_fumigacao','carregamentos','contas_pagar','contas_receber','viagens','folhas_competencia','obrigacoes','anexos'];
   const contagens={};for(const tabela of tabelas){const {rows:[n]}=await origem.query(`SELECT count(*)::int AS n FROM ${tabela}`);contagens[tabela]=n.n;}
   console.log('Conferência da origem:',JSON.stringify(contagens));
   const destino=new pg.Pool({connectionString:process.env.SHKT_SUPABASE_URL,ssl:{rejectUnauthorized:false},connectionTimeoutMillis:15000,max:1});
   try{const {rows:[d]}=await destino.query('SELECT current_user,current_database()');console.log('Destino Supabase acessível:',d.current_user,d.current_database);}finally{await destino.end();}
  }
  if(r.registros>0)throw new Error('A origem anterior possui dados. Faça a migração e conferência antes de ativar SHKT_ORIGEM_CONFERIDA=true. Nenhum dado foi apagado.');
  console.log('Origem anterior conferida: sem operações ou cadastros adicionais. O Supabase existente será utilizado.');
 }finally{await origem.end();}
}
