import { Pool, types } from 'pg';

// DATE is a calendar day. Keep it independent of the server and browser time zones.
types.setTypeParser(types.builtins.DATE, value => value);

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL não configurada');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: process.env.VERCEL ? 2 : 10,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
});

pool.on('error', error => console.error('Conexão PostgreSQL encerrada:', error.code || error.name));

export const query = (sql, parameters = []) => pool.query(sql, parameters);
export const closeDatabase = () => pool.end();
