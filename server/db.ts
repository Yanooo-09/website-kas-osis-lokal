import mysql, { type Pool, type PoolConnection, type RowDataPacket, type ResultSetHeader } from 'mysql2/promise';

export type { PoolConnection, RowDataPacket, ResultSetHeader };

export const dbConfig = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD ?? '',
  database: process.env.DB_NAME || 'kas_osis_smkn7'
};

export const pool: Pool = mysql.createPool({
  host: dbConfig.host,
  port: dbConfig.port,
  user: dbConfig.user,
  password: dbConfig.password,
  database: dbConfig.database,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  dateStrings: true,
  charset: 'utf8mb4'
});

export function isDbUnavailableError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = (err as { code?: string }).code;
  return (
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND' ||
    code === 'ETIMEDOUT' ||
    code === 'ER_BAD_DB_ERROR' ||
    code === 'ER_NO_SUCH_TABLE' ||
    code === 'ER_ACCESS_DENIED_ERROR'
  );
}

export function formatDbErrorMessage(err: unknown): string {
  const code = err && typeof err === 'object' ? (err as { code?: string }).code : undefined;
  if (code === 'ER_BAD_DB_ERROR' || code === 'ER_NO_SUCH_TABLE') {
    return `Database "${dbConfig.database}" belum di-import. Silakan buka phpMyAdmin lalu import file database/kas_osis_smkn7_samarinda.sql terlebih dahulu.`;
  }
  if (code === 'ER_ACCESS_DENIED_ERROR') {
    return `Akses ke MySQL ditolak untuk user "${dbConfig.user}". Periksa pengaturan DB_USER / DB_PASSWORD di file .env.`;
  }
  if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'ETIMEDOUT') {
    return `Server MySQL (${dbConfig.host}:${dbConfig.port}) belum aktif. Jalankan MySQL di XAMPP terlebih dahulu lalu muat ulang halaman.`;
  }
  return 'Gagal terhubung ke database MySQL lokal.';
}

export async function verifyDatabaseReady(): Promise<{ ready: boolean; error?: string }> {
  try {
    await pool.query('SELECT 1 FROM pengaturan LIMIT 1');
    return { ready: true };
  } catch (err) {
    return { ready: false, error: formatDbErrorMessage(err) };
  }
}
