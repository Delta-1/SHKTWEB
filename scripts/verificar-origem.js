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
  if(r.registros>0)throw new Error('A origem anterior possui dados. Faça a migração e conferência antes de ativar SHKT_ORIGEM_CONFERIDA=true. Nenhum dado foi apagado.');
  console.log('Origem anterior conferida: sem operações ou cadastros adicionais. O Supabase existente será utilizado.');
 }finally{await origem.end();}
}
