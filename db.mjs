import { Pool, types } from 'pg';
import net from 'node:net';
import { once } from 'node:events';
import ssh2 from 'ssh2';

// DATE is a calendar day. Keep it independent of the server and browser time zones.
types.setTypeParser(types.builtins.DATE, value => value);

let tunnel;
let poolPromise;

async function openPool() {
  let connection = { connectionString: process.env.DATABASE_URL };
  if (process.env.CRM_VPS_CONNECTION) {
    const config = JSON.parse(process.env.CRM_VPS_CONNECTION);
    tunnel = net.createServer(socket => {
      const ssh = new ssh2.Client();
      socket.on('error', () => ssh.destroy());
      socket.on('close', () => ssh.end());
      ssh.on('error', () => socket.destroy());
      ssh.on('close', () => socket.destroy());
      ssh.once('ready', () => {
        if (socket.destroyed) return ssh.end();
        ssh.forwardOut('127.0.0.1', 0, config.dbHost, 5432, (err, channel) => {
          if (err || socket.destroyed) { socket.destroy(); ssh.end(); return; }
          channel.on('error', () => socket.destroy());
          channel.on('close', () => socket.destroy());
          socket.pipe(channel).pipe(socket);
        });
      });
      ssh.connect({
        host: config.host, username: config.sshUser, privateKey: config.privateKey,
        algorithms: { serverHostKey: ['ssh-ed25519'] }, hostHash: 'sha256',
        hostVerifier: hash => hash === config.hostFingerprint, readyTimeout: 8000,
      });
    });
    tunnel.listen(0, '127.0.0.1');
    await once(tunnel, 'listening');
    tunnel.unref();
    connection = { host: '127.0.0.1', port: tunnel.address().port, database: config.database,
      user: config.user, password: config.password, ssl: false };
  } else if (!connection.connectionString) {
    throw new Error('Conexão PostgreSQL não configurada');
  }
  const pool = new Pool({
    ...connection,
    max: process.env.VERCEL ? 2 : 10,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
  });
  pool.on('error', error => console.error('Conexão PostgreSQL encerrada:', error.code || error.name));
  return pool;
}
function getPool() {
  return poolPromise ??= openPool().catch(error => { poolPromise = undefined; throw error; });
}

export const query = async (sql, parameters = []) => (await getPool()).query(sql, parameters);
export async function transaction(operation) {
  const client = await (await getPool()).connect();
  try {
    await client.query('BEGIN');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
export async function closeDatabase() {
  if (poolPromise) await (await poolPromise).end();
  if (tunnel?.listening) tunnel.close();
  poolPromise = undefined;
}
