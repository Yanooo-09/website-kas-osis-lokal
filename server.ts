import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import {
  pool,
  isDbUnavailableError,
  formatDbErrorMessage,
  verifyDatabaseReady,
  type PoolConnection,
  type RowDataPacket
} from './server/db.ts';
import {
  hashPasswordScrypt,
  verifyPasswordHash,
  timingSafeEqualStrings,
  issueSessionToken,
  verifySessionToken,
  checkAuthRateLimit,
  recordAuthFailure,
  clearAuthRateLimit,
  type SessionPayload
} from './server/auth.ts';

interface AuthenticatedRequest extends Request {
  session?: SessionPayload;
}

const USERNAME_REGEX = /^[a-zA-Z0-9_.-]{3,50}$/;
const SAFE_ID_REGEX = /^[a-zA-Z0-9_-]{1,128}$/;

function asyncRoute(
  fn: (req: AuthenticatedRequest, res: Response, next: NextFunction) => Promise<void>
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req as AuthenticatedRequest, res, next)).catch(next);
  };
}

function sanitizeText(value: unknown, maxLength = 300): string {
  if (typeof value !== 'string') return '';
  const cleaned = value.replace(/[\u0000-\u001F\u007F]/g, '').trim();
  return cleaned.length > maxLength ? cleaned.slice(0, maxLength) : cleaned;
}

function isValidYYYYMMDD(dateStr: unknown): dateStr is string {
  if (typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return false;
  }
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

function isValidPositiveInt(value: unknown, min: number, max: number): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= min &&
    value <= max
  );
}

function formatRupiahServer(nominal: number): string {
  return 'Rp' + Math.round(nominal).toLocaleString('id-ID');
}

const BULAN_PENDEK = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

function formatTanggalPendek(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return `${d} ${BULAN_PENDEK[(m || 1) - 1]} ${y}`;
}

function formatRentangMingguServer(daftarMinggu: string[]): string {
  if (daftarMinggu.length === 0) return '';
  const sorted = [...daftarMinggu].sort();
  if (sorted.length === 1) {
    return `minggu ${formatTanggalPendek(sorted[0])}`;
  }
  return `minggu ${formatTanggalPendek(sorted[0])} s/d ${formatTanggalPendek(sorted[sorted.length - 1])}, ${sorted.length} minggu`;
}

function getTodayYYYYMMDD(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function toMySqlDateTime(date = new Date()): string {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function normalizeDateTimeString(val: unknown): string {
  if (!val) return '';
  const str = String(val).trim();
  if (!str) return '';
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(str)) {
    return str.replace(' ', 'T') + 'Z';
  }
  return str;
}

function parseJsonField<T>(raw: unknown, fallback: T): T {
  if (raw === null || raw === undefined) return fallback;
  if (typeof raw === 'string') {
    if (!raw.trim()) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }
  if (typeof raw === 'object') {
    return raw as T;
  }
  return fallback;
}

function parseMingguLiburKas(raw: unknown): Record<string, string> {
  const parsed = parseJsonField<unknown>(raw, {});
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (isValidYYYYMMDD(k) && typeof v === 'string') {
      out[k] = sanitizeText(v, 100) || 'Tidak ada tarikan kas';
    }
  }
  return out;
}

function sanitizeMingguLiburKas(input: unknown): Record<string, string> | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const entries = Object.entries(input as Record<string, unknown>);
  if (entries.length > 120) return null;
  const result: Record<string, string> = {};
  for (const [key, val] of entries) {
    const cleanDate = sanitizeText(key, 10);
    if (!isValidYYYYMMDD(cleanDate)) return null;
    const cleanReason = sanitizeText(val, 100) || 'Tidak ada tarikan kas';
    result[cleanDate] = cleanReason;
  }
  return result;
}

async function appendRiwayat(
  conn: PoolConnection,
  aksi: 'tambah' | 'ubah' | 'hapus' | 'seed',
  jenisData: 'setoran' | 'transaksi' | 'kelas' | 'pengaturan' | 'tahun_ajaran',
  ringkasan: string,
  alasan: string,
  nilaiLama = '',
  nilaiBaru = ''
): Promise<void> {
  const id = crypto.randomUUID().replace(/-/g, '').slice(0, 20);
  await conn.execute(
    `INSERT INTO riwayat (id, waktu, aksi, jenis_data, ringkasan, nilai_lama, nilai_baru, alasan, actor_role)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      toMySqlDateTime(),
      aksi,
      jenisData,
      sanitizeText(ringkasan, 300) || 'Aktivitas sistem',
      sanitizeText(nilaiLama, 1000),
      sanitizeText(nilaiBaru, 1000),
      sanitizeText(alasan, 300) || 'Tidak ada alasan khusus',
      'Bendahara OSIS'
    ]
  );
}

function getEnvAdminPasscode(): string {
  return (process.env.ADMIN_PASSCODE || '').trim();
}

interface AdminUserRow extends RowDataPacket {
  id: number;
  username: string;
  nama_lengkap: string;
  password_hash: string | null;
}

async function getPrimaryAdminRow(conn?: PoolConnection): Promise<AdminUserRow | null> {
  const executor = conn || pool;
  const [rows] = await executor.query<AdminUserRow[]>(
    'SELECT id, username, nama_lengkap, password_hash FROM admin_users WHERE is_active = 1 ORDER BY id ASC LIMIT 1'
  );
  return rows[0] || null;
}

function isAdminRowConfigured(admin: AdminUserRow | null): boolean {
  if (getEnvAdminPasscode() !== '') return true;
  return Boolean(admin && admin.password_hash);
}

function requireViewerOrAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const session = verifySessionToken(req.headers.authorization);
  if (!session) {
    res.status(401).json({ message: 'Sesi tidak valid atau telah berakhir. Silakan masuk kembali.' });
    return;
  }
  req.session = session;
  next();
}

function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const session = verifySessionToken(req.headers.authorization);
  if (!session || session.role !== 'admin') {
    res.status(403).json({ message: 'Akses ditolak: Hak akses Admin diperlukan.' });
    return;
  }
  req.session = session;
  next();
}

async function withTransaction<T>(fn: (conn: PoolConnection) => Promise<T>): Promise<T> {
  const conn = await pool.getConnection();
  await conn.beginTransaction();
  try {
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function startServer() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '256kb' }));

  // Browser security headers
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: https:; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'self';"
    );
    next();
  });

  // =========================================================================
  // PUBLIC CONFIG (Never exposes hashes, credentials, or financial records)
  // =========================================================================
  app.get(
    '/api/config/public',
    asyncRoute(async (_req, res) => {
      try {
        const [pengRows] = await pool.execute<RowDataPacket[]>(
          'SELECT nama_sekolah, nama_bendahara, tahun_ajaran_aktif_id FROM pengaturan WHERE id = ?',
          ['main']
        );
        const peng = pengRows[0];
        if (!peng) {
          res.status(503).json({
            dbReady: false,
            dbError:
              'Tabel pengaturan belum terisi. Silakan import file database/kas_osis_smkn7_samarinda.sql melalui phpMyAdmin terlebih dahulu.',
            namaSekolah: 'SMKN 7 SAMARINDA',
            namaBendahara: 'Alkiyano Parintak',
            tahunAjaranAktifId: '2026_2027',
            adminUsername: 'alkiyano',
            adminConfigured: true
          });
          return;
        }

        const admin = await getPrimaryAdminRow();
        res.json({
          dbReady: true,
          namaSekolah: String(peng.nama_sekolah || 'SMKN 7 SAMARINDA'),
          namaBendahara: String(peng.nama_bendahara || 'Alkiyano Parintak'),
          tahunAjaranAktifId: String(peng.tahun_ajaran_aktif_id || '2026_2027'),
          adminUsername: admin?.username || 'alkiyano',
          adminConfigured: isAdminRowConfigured(admin)
        });
      } catch (err) {
        if (isDbUnavailableError(err)) {
          res.status(503).json({
            dbReady: false,
            dbError: formatDbErrorMessage(err),
            namaSekolah: 'SMKN 7 SAMARINDA',
            namaBendahara: 'Alkiyano Parintak',
            tahunAjaranAktifId: '2026_2027',
            adminUsername: 'alkiyano',
            adminConfigured: true
          });
          return;
        }
        throw err;
      }
    })
  );

  // =========================================================================
  // AUTHENTICATION ROUTES
  // =========================================================================
  app.post(
    '/api/auth/viewer/login',
    asyncRoute(async (req, res) => {
      const ip = req.ip || req.socket.remoteAddress || 'unknown';
      const rateKey = `viewer:${ip}`;
      const rate = checkAuthRateLimit(rateKey);
      if (!rate.allowed) {
        res.status(429).json({
          success: false,
          message: `Terlalu banyak percobaan gagal. Tunggu ${rate.remainingSeconds} detik.`
        });
        return;
      }

      const code = sanitizeText(req.body?.code, 100);
      if (!code) {
        res.status(400).json({ success: false, message: 'Masukkan kode akses terlebih dahulu.' });
        return;
      }

      const [rows] = await pool.execute<RowDataPacket[]>(
        'SELECT viewer_passcode_hash FROM pengaturan WHERE id = ?',
        ['main']
      );
      const row = rows[0];
      if (!row || !row.viewer_passcode_hash) {
        res.status(503).json({
          success: false,
          message:
            'Database belum di-import. Silakan import file database/kas_osis_smkn7_samarinda.sql terlebih dahulu.'
        });
        return;
      }

      const storedHash = String(row.viewer_passcode_hash);
      if (verifyPasswordHash(code, storedHash)) {
        clearAuthRateLimit(rateKey);
        const token = issueSessionToken('viewer');
        res.json({ success: true, token, role: 'viewer' });
        return;
      }

      const failStatus = recordAuthFailure(rateKey);
      res.status(401).json({
        success: false,
        message: failStatus.locked
          ? `Terlalu banyak percobaan salah. Coba lagi dalam ${failStatus.remainingSeconds} detik.`
          : 'Kode akses salah. Silakan tanyakan kepada Bendahara OSIS.'
      });
    })
  );

  // First-run one-time Admin password claim (only active if admin_users.password_hash is NULL)
  app.post(
    '/api/auth/admin/setup',
    asyncRoute(async (req, res) => {
      const cleanUsername = sanitizeText(req.body?.username, 50);
      const password = typeof req.body?.password === 'string' ? req.body.password : '';

      if (!USERNAME_REGEX.test(cleanUsername)) {
        res.status(400).json({
          success: false,
          message: 'Username harus 3–50 karakter (huruf, angka, titik, garis bawah, atau tanda hubung).'
        });
        return;
      }
      if (password.length < 8 || password.length > 128) {
        res.status(400).json({
          success: false,
          message: 'Password admin minimal 8 karakter.'
        });
        return;
      }

      const passwordHash = hashPasswordScrypt(password);
      const nowSql = toMySqlDateTime();

      const outcome = await withTransaction(async (conn) => {
        const existing = await getPrimaryAdminRow(conn);
        if (getEnvAdminPasscode() !== '' || (existing && existing.password_hash)) {
          return { conflict: true };
        }

        if (existing) {
          const [result] = await conn.execute(
            `UPDATE admin_users
             SET username = ?, password_hash = ?, updated_at = ?
             WHERE id = ? AND password_hash IS NULL`,
            [cleanUsername, passwordHash, nowSql, existing.id]
          );
          const affected = (result as { affectedRows?: number }).affectedRows || 0;
          if (affected !== 1) return { conflict: true };
        } else {
          await conn.execute(
            `INSERT INTO admin_users (username, nama_lengkap, email, password_hash, role, is_active, created_at, updated_at)
             VALUES (?, ?, NULL, ?, 'admin', 1, ?, ?)`,
            [cleanUsername, 'Bendahara OSIS', passwordHash, nowSql, nowSql]
          );
        }

        return { conflict: false };
      });

      if (outcome.conflict) {
        res.status(409).json({
          success: false,
          message: 'Akun Admin sudah diaktifkan sebelumnya. Silakan langsung login menggunakan username dan password.'
        });
        return;
      }

      const token = issueSessionToken('admin', cleanUsername);
      res.json({ success: true, token, role: 'admin', username: cleanUsername });
    })
  );

  app.post(
    '/api/auth/admin/login',
    asyncRoute(async (req, res) => {
      const ip = req.ip || req.socket.remoteAddress || 'unknown';
      const rateKey = `admin:${ip}`;
      const rate = checkAuthRateLimit(rateKey);
      if (!rate.allowed) {
        res.status(429).json({
          success: false,
          message: `Terlalu banyak percobaan login. Tunggu ${rate.remainingSeconds} detik.`
        });
        return;
      }

      const admin = await getPrimaryAdminRow();
      if (!isAdminRowConfigured(admin)) {
        res.status(409).json({
          success: false,
          requiresSetup: true,
          message: 'Password Admin belum diatur. Gunakan form Aktivasi Akun Admin Pertama.'
        });
        return;
      }

      const cleanUsername = sanitizeText(req.body?.username, 50);
      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      if (!cleanUsername || !password) {
        res.status(400).json({ success: false, message: 'Masukkan username dan password admin.' });
        return;
      }

      const expectedUsername = admin?.username || 'alkiyano';
      const usernameMatch = timingSafeEqualStrings(
        cleanUsername.toLowerCase(),
        expectedUsername.toLowerCase()
      );

      const envPasscode = getEnvAdminPasscode();
      let passwordMatch = false;
      if (envPasscode !== '') {
        passwordMatch = timingSafeEqualStrings(password, envPasscode);
      } else if (admin?.password_hash) {
        passwordMatch = verifyPasswordHash(password, admin.password_hash);
      }

      if (usernameMatch && passwordMatch) {
        clearAuthRateLimit(rateKey);
        const token = issueSessionToken('admin', expectedUsername);
        res.json({ success: true, token, role: 'admin', username: expectedUsername });
        return;
      }

      const failStatus = recordAuthFailure(rateKey);
      res.status(401).json({
        success: false,
        message: failStatus.locked
          ? `Terlalu banyak percobaan salah. Coba lagi dalam ${failStatus.remainingSeconds} detik.`
          : 'Username atau password admin salah.'
      });
    })
  );

  app.get('/api/auth/me', requireViewerOrAdmin, (req: AuthenticatedRequest, res) => {
    res.json({
      authenticated: true,
      role: req.session?.role,
      username: req.session?.username || null
    });
  });

  app.put(
    '/api/auth/admin/credentials',
    requireAdmin,
    asyncRoute(async (req, res) => {
      const cleanUsername = sanitizeText(req.body?.usernameBaru, 50);
      const passwordSaatIni = typeof req.body?.passwordSaatIni === 'string' ? req.body.passwordSaatIni : '';
      const passwordBaru = typeof req.body?.passwordBaru === 'string' ? req.body.passwordBaru : '';
      const cleanAlasan = sanitizeText(req.body?.alasan, 300) || 'Pembaruan kredensial login Admin';

      if (!USERNAME_REGEX.test(cleanUsername)) {
        res.status(400).json({
          message: 'Username admin harus 3–50 karakter (huruf, angka, titik, garis bawah, atau tanda hubung).'
        });
        return;
      }

      const admin = await getPrimaryAdminRow();
      if (!admin) {
        res.status(404).json({ message: 'Data admin tidak ditemukan.' });
        return;
      }

      const envPasscode = getEnvAdminPasscode();
      const changedItems: string[] = [];
      const nowSql = toMySqlDateTime();

      let nextPasswordHash = admin.password_hash;
      if (passwordBaru.trim() !== '') {
        if (passwordBaru.length < 8 || passwordBaru.length > 128) {
          res.status(400).json({ message: 'Password admin baru harus antara 8 hingga 128 karakter.' });
          return;
        }
        if (!passwordSaatIni) {
          res.status(400).json({ message: 'Masukkan password admin saat ini untuk mengganti password.' });
          return;
        }
        if (envPasscode !== '') {
          res.status(400).json({
            message: 'Password admin sedang dikunci oleh variabel lingkungan ADMIN_PASSCODE pada server.'
          });
          return;
        }
        if (!admin.password_hash || !verifyPasswordHash(passwordSaatIni, admin.password_hash)) {
          res.status(401).json({ message: 'Password admin saat ini salah.' });
          return;
        }
        nextPasswordHash = hashPasswordScrypt(passwordBaru);
        changedItems.push('Password admin diperbarui');
      }

      if (cleanUsername !== admin.username) {
        changedItems.push(`Username diubah dari "${admin.username}" menjadi "${cleanUsername}"`);
      }

      if (changedItems.length > 0) {
        await withTransaction(async (conn) => {
          await conn.execute(
            `UPDATE admin_users SET username = ?, password_hash = ?, updated_at = ? WHERE id = ?`,
            [cleanUsername, nextPasswordHash, nowSql, admin.id]
          );

          await appendRiwayat(
            conn,
            'ubah',
            'pengaturan',
            'Memperbarui kredensial login Admin OSIS',
            cleanAlasan,
            '',
            changedItems.join('; ')
          );
        });
      }

      const newToken = issueSessionToken('admin', cleanUsername);
      res.json({ success: true, token: newToken, adminUsername: cleanUsername });
    })
  );

  // =========================================================================
  // PROTECTED DATA READ ROUTE (Requires Viewer or Admin Bearer Token)
  // =========================================================================
  app.get(
    '/api/data',
    requireViewerOrAdmin,
    asyncRoute(async (_req, res) => {
      const [pengRows] = await pool.execute<RowDataPacket[]>('SELECT * FROM pengaturan WHERE id = ?', ['main']);
      const pengRow = pengRows[0];
      const admin = await getPrimaryAdminRow();

      const [tahunRows] = await pool.query<RowDataPacket[]>(
        'SELECT * FROM tahun_ajaran ORDER BY tanggal_mulai DESC'
      );
      const [kelasRows] = await pool.query<RowDataPacket[]>('SELECT * FROM kelas ORDER BY urutan ASC');
      const [setoranRows] = await pool.query<RowDataPacket[]>(
        'SELECT * FROM setoran ORDER BY tanggal_setor DESC, dibuat_pada DESC'
      );
      const [transaksiRows] = await pool.query<RowDataPacket[]>(
        'SELECT * FROM transaksi ORDER BY tanggal ASC, dibuat_pada ASC'
      );
      const [riwayatRows] = await pool.query<RowDataPacket[]>(
        'SELECT * FROM riwayat ORDER BY waktu DESC'
      );

      const pengaturan = pengRow
        ? {
            namaSekolah: String(pengRow.nama_sekolah),
            namaBendahara: String(pengRow.nama_bendahara),
            adminUsername: admin?.username || 'alkiyano',
            adminConfigured: isAdminRowConfigured(admin),
            tarifPerSiswa: Number(pengRow.tarif_per_siswa),
            tahunAjaranAktifId: String(pengRow.tahun_ajaran_aktif_id),
            tanggalMulaiTahunAjaran: String(pengRow.tanggal_mulai_tahun_ajaran),
            tanggalAkhirTahunAjaran: String(pengRow.tanggal_akhir_tahun_ajaran),
            tanggalMulaiPencatatanPerKelas: String(pengRow.tanggal_mulai_pencatatan_per_kelas),
            viewerPasscodeHash: '',
            kategoriPemasukan: parseJsonField<string[]>(pengRow.kategori_pemasukan, []),
            kategoriPengeluaran: parseJsonField<string[]>(pengRow.kategori_pengeluaran, []),
            mingguLiburKas: parseMingguLiburKas(pengRow.minggu_libur_kas),
            seedLoaded: Boolean(pengRow.seed_loaded),
            updatedAt: normalizeDateTimeString(pengRow.updated_at)
          }
        : null;

      res.json({
        pengaturan,
        tahunAjaranList: tahunRows.map((r) => ({
          id: String(r.id),
          label: String(r.label),
          tanggalMulai: String(r.tanggal_mulai),
          tanggalAkhir: String(r.tanggal_akhir),
          isAktif: Boolean(r.is_aktif),
          createdAt: normalizeDateTimeString(r.created_at)
        })),
        kelasList: kelasRows.map((r) => ({
          id: String(r.id),
          nama: String(r.nama),
          tingkat: String(r.tingkat) as 'X' | 'XI',
          urutan: Number(r.urutan),
          jumlahSiswa: Number(r.jumlah_siswa),
          riwayatSiswa: parseJsonField(r.riwayat_siswa, []),
          updatedAt: normalizeDateTimeString(r.updated_at)
        })),
        setoranList: setoranRows.map((r) => ({
          id: String(r.id),
          kelasId: String(r.kelas_id),
          kelasNama: String(r.kelas_nama),
          daftarMinggu: parseJsonField<string[]>(r.daftar_minggu, []),
          jumlahMinggu: Number(r.jumlah_minggu),
          jumlahSiswaSnapshot: Number(r.jumlah_siswa_snapshot),
          tarifSnapshot: Number(r.tarif_snapshot),
          total: Number(r.total),
          tanggalSetor: String(r.tanggal_setor),
          tahunAjaranId: String(r.tahun_ajaran_id),
          transaksiId: r.transaksi_id ? String(r.transaksi_id) : undefined,
          dibuatPada: normalizeDateTimeString(r.dibuat_pada)
        })),
        transaksiList: transaksiRows.map((r) => ({
          id: String(r.id),
          jenis: String(r.jenis) as 'pemasukan' | 'pengeluaran',
          tanggal: String(r.tanggal),
          keterangan: String(r.keterangan),
          nominal: Number(r.nominal),
          kategori: String(r.kategori),
          setoranId: r.setoran_id ? String(r.setoran_id) : undefined,
          tahunAjaranId: String(r.tahun_ajaran_id),
          dibuatPada: normalizeDateTimeString(r.dibuat_pada)
        })),
        riwayatList: riwayatRows.map((r) => ({
          id: String(r.id),
          waktu: normalizeDateTimeString(r.waktu),
          aksi: String(r.aksi) as 'tambah' | 'ubah' | 'hapus' | 'seed',
          jenisData: String(r.jenis_data) as
            | 'setoran'
            | 'transaksi'
            | 'kelas'
            | 'pengaturan'
            | 'tahun_ajaran',
          ringkasan: String(r.ringkasan),
          nilaiLama: String(r.nilai_lama || ''),
          nilaiBaru: String(r.nilai_baru || ''),
          alasan: String(r.alasan),
          actorRole: String(r.actor_role || 'Bendahara OSIS')
        }))
      });
    })
  );

  // =========================================================================
  // ADMIN MUTATION ROUTES (All protected by requireAdmin + parameterized SQL)
  // =========================================================================

  // 1. Tambah Setoran
  app.post(
    '/api/setoran',
    requireAdmin,
    asyncRoute(async (req, res) => {
      const kelasId = sanitizeText(req.body?.kelasId, 50);
      const daftarMingguRaw: unknown[] = Array.isArray(req.body?.daftarMinggu) ? req.body.daftarMinggu : [];
      const tanggalSetor = sanitizeText(req.body?.tanggalSetor, 10);
      const tahunAjaranId = sanitizeText(req.body?.tahunAjaranId, 50);
      const alasan = sanitizeText(req.body?.alasan, 300) || 'Pencatatan setoran kas mingguan kelas';

      if (!SAFE_ID_REGEX.test(kelasId)) {
        res.status(400).json({ message: 'ID kelas tidak valid.' });
        return;
      }
      if (!isValidYYYYMMDD(tanggalSetor)) {
        res.status(400).json({ message: 'Format tanggal setor tidak valid (YYYY-MM-DD).' });
        return;
      }

      const cleanWeeks: string[] = Array.from(
        new Set<string>(
          daftarMingguRaw
            .filter((w): w is string => typeof w === 'string')
            .map((w) => sanitizeText(w, 10))
        )
      ).sort();

      if (cleanWeeks.length === 0 || cleanWeeks.length > 60) {
        res.status(400).json({ message: 'Pilih antara 1 hingga 60 minggu untuk disetor.' });
        return;
      }
      for (const w of cleanWeeks) {
        if (!isValidYYYYMMDD(w)) {
          res.status(400).json({ message: `Format tanggal minggu tidak valid: ${w}` });
          return;
        }
      }

      const [kelasRows] = await pool.execute<RowDataPacket[]>(
        'SELECT id, nama, jumlah_siswa FROM kelas WHERE id = ?',
        [kelasId]
      );
      const kelas = kelasRows[0];
      if (!kelas) {
        res.status(404).json({ message: 'Kelas tidak ditemukan.' });
        return;
      }

      const [pengRows] = await pool.execute<RowDataPacket[]>(
        'SELECT tarif_per_siswa, tahun_ajaran_aktif_id, minggu_libur_kas FROM pengaturan WHERE id = ?',
        ['main']
      );
      const peng = pengRows[0];
      const mingguLiburKas = parseMingguLiburKas(peng?.minggu_libur_kas);
      for (const w of cleanWeeks) {
        if (mingguLiburKas[w]) {
          res.status(400).json({
            message: `Minggu ${w} sedang dinonaktifkan penarikan kasnya (${mingguLiburKas[w]}).`
          });
          return;
        }
      }

      const effectiveTahunId = tahunAjaranId || String(peng?.tahun_ajaran_aktif_id || '2026_2027');
      const [tahunRows] = await pool.execute<RowDataPacket[]>(
        'SELECT id FROM tahun_ajaran WHERE id = ?',
        [effectiveTahunId]
      );
      if (tahunRows.length === 0) {
        res.status(404).json({ message: 'Tahun ajaran tidak ditemukan.' });
        return;
      }

      const tarifSnapshot = Number(peng?.tarif_per_siswa || 1000);
      const jumlahSiswaSnapshot = Number(kelas.jumlah_siswa);
      const jumlahMinggu = cleanWeeks.length;
      const total = jumlahMinggu * jumlahSiswaSnapshot * tarifSnapshot;

      const setoranId = crypto.randomUUID().replace(/-/g, '').slice(0, 20);
      const transaksiId = crypto.randomUUID().replace(/-/g, '').slice(0, 20);
      const nowSql = toMySqlDateTime();
      const rentangText = formatRentangMingguServer(cleanWeeks);

      const conflictWeek = await withTransaction(async (conn) => {
        for (const m of cleanWeeks) {
          const [existingSm] = await conn.execute<RowDataPacket[]>(
            `SELECT 1 FROM setoran_minggu WHERE kelas_id = ? AND tahun_ajaran_id = ? AND minggu_senin = ? LIMIT 1`,
            [kelasId, effectiveTahunId, m]
          );
          if (existingSm.length > 0) {
            return m;
          }
        }

        await conn.execute(
          `INSERT INTO setoran (
            id, kelas_id, kelas_nama, daftar_minggu, jumlah_minggu, jumlah_siswa_snapshot,
            tarif_snapshot, total, tanggal_setor, tahun_ajaran_id, transaksi_id, dibuat_pada
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            setoranId,
            kelasId,
            String(kelas.nama),
            JSON.stringify(cleanWeeks),
            jumlahMinggu,
            jumlahSiswaSnapshot,
            tarifSnapshot,
            total,
            tanggalSetor,
            effectiveTahunId,
            transaksiId,
            nowSql
          ]
        );

        for (const m of cleanWeeks) {
          await conn.execute(
            `INSERT INTO setoran_minggu (setoran_id, kelas_id, tahun_ajaran_id, minggu_senin) VALUES (?, ?, ?, ?)`,
            [setoranId, kelasId, effectiveTahunId, m]
          );
        }

        await conn.execute(
          `INSERT INTO transaksi (
            id, jenis, tanggal, keterangan, nominal, kategori, setoran_id, tahun_ajaran_id, dibuat_pada
          ) VALUES (?, 'pemasukan', ?, ?, ?, 'Kas Mingguan', ?, ?, ?)`,
          [
            transaksiId,
            tanggalSetor,
            sanitizeText(`Kas mingguan - ${String(kelas.nama)} (${rentangText})`, 300),
            total,
            setoranId,
            effectiveTahunId,
            nowSql
          ]
        );

        await appendRiwayat(
          conn,
          'tambah',
          'setoran',
          `Setoran kas ${String(kelas.nama)} (${jumlahMinggu} minggu: ${rentangText}) senilai ${formatRupiahServer(total)}`,
          alasan,
          '',
          JSON.stringify({ total, daftarMinggu: cleanWeeks, tanggalSetor })
        );

        return null;
      });

      if (conflictWeek) {
        res.status(409).json({
          message: `Minggu ${conflictWeek} sudah pernah disetor untuk ${String(kelas.nama)}. Tidak boleh disetor dua kali.`
        });
        return;
      }

      res.json({ success: true, id: setoranId });
    })
  );

  // 2. Ubah Setoran
  app.put(
    '/api/setoran/:id',
    requireAdmin,
    asyncRoute(async (req, res) => {
      const setoranId = sanitizeText(req.params.id, 128);
      if (!SAFE_ID_REGEX.test(setoranId)) {
        res.status(400).json({ message: 'ID setoran tidak valid.' });
        return;
      }

      const cleanAlasan = sanitizeText(req.body?.alasan, 300);
      if (!cleanAlasan) {
        res.status(400).json({ message: 'Alasan perubahan setoran wajib diisi.' });
        return;
      }

      const daftarMingguRaw: unknown[] = Array.isArray(req.body?.daftarMingguBaru)
        ? req.body.daftarMingguBaru
        : [];
      const cleanTanggal = sanitizeText(req.body?.tanggalSetorBaru, 10);
      if (!isValidYYYYMMDD(cleanTanggal)) {
        res.status(400).json({ message: 'Format tanggal setor baru tidak valid.' });
        return;
      }

      const cleanWeeks: string[] = Array.from(
        new Set<string>(
          daftarMingguRaw
            .filter((w): w is string => typeof w === 'string')
            .map((w) => sanitizeText(w, 10))
        )
      ).sort();

      if (cleanWeeks.length === 0 || cleanWeeks.length > 60) {
        res.status(400).json({ message: 'Setoran harus memiliki antara 1 hingga 60 minggu.' });
        return;
      }
      for (const w of cleanWeeks) {
        if (!isValidYYYYMMDD(w)) {
          res.status(400).json({ message: `Format tanggal minggu tidak valid: ${w}` });
          return;
        }
      }

      const [setoranRows] = await pool.execute<RowDataPacket[]>(
        'SELECT * FROM setoran WHERE id = ?',
        [setoranId]
      );
      const setoranLama = setoranRows[0];
      if (!setoranLama) {
        res.status(404).json({ message: 'Setoran tidak ditemukan.' });
        return;
      }

      const [pengRows] = await pool.execute<RowDataPacket[]>(
        'SELECT minggu_libur_kas FROM pengaturan WHERE id = ?',
        ['main']
      );
      const mingguLiburKas = parseMingguLiburKas(pengRows[0]?.minggu_libur_kas);
      const previousWeeks = new Set<string>(parseJsonField<string[]>(setoranLama.daftar_minggu, []));
      for (const w of cleanWeeks) {
        if (!previousWeeks.has(w) && mingguLiburKas[w]) {
          res.status(400).json({
            message: `Minggu ${w} sedang dinonaktifkan penarikan kasnya (${mingguLiburKas[w]}).`
          });
          return;
        }
      }

      const kelasId = String(setoranLama.kelas_id);
      const kelasNama = String(setoranLama.kelas_nama);
      const tahunAjaranId = String(setoranLama.tahun_ajaran_id);
      const jumlahSiswaSnapshot = Number(setoranLama.jumlah_siswa_snapshot);
      const tarifSnapshot = Number(setoranLama.tarif_snapshot);
      const transaksiId = setoranLama.transaksi_id ? String(setoranLama.transaksi_id) : null;

      const jumlahMingguBaru = cleanWeeks.length;
      const totalBaru = jumlahMingguBaru * jumlahSiswaSnapshot * tarifSnapshot;
      const rentangBaruText = formatRentangMingguServer(cleanWeeks);

      const conflictWeek = await withTransaction(async (conn) => {
        for (const m of cleanWeeks) {
          const [otherRows] = await conn.execute<RowDataPacket[]>(
            `SELECT 1 FROM setoran_minggu
             WHERE kelas_id = ? AND tahun_ajaran_id = ? AND minggu_senin = ? AND setoran_id != ? LIMIT 1`,
            [kelasId, tahunAjaranId, m, setoranId]
          );
          if (otherRows.length > 0) {
            return m;
          }
        }

        await conn.execute(
          `UPDATE setoran
           SET daftar_minggu = ?, jumlah_minggu = ?, total = ?, tanggal_setor = ?
           WHERE id = ?`,
          [JSON.stringify(cleanWeeks), jumlahMingguBaru, totalBaru, cleanTanggal, setoranId]
        );

        await conn.execute('DELETE FROM setoran_minggu WHERE setoran_id = ?', [setoranId]);
        for (const m of cleanWeeks) {
          await conn.execute(
            `INSERT INTO setoran_minggu (setoran_id, kelas_id, tahun_ajaran_id, minggu_senin) VALUES (?, ?, ?, ?)`,
            [setoranId, kelasId, tahunAjaranId, m]
          );
        }

        if (transaksiId) {
          await conn.execute(
            `UPDATE transaksi SET nominal = ?, tanggal = ?, keterangan = ? WHERE id = ?`,
            [
              totalBaru,
              cleanTanggal,
              sanitizeText(`Kas mingguan - ${kelasNama} (${rentangBaruText})`, 300),
              transaksiId
            ]
          );
        }

        await appendRiwayat(
          conn,
          'ubah',
          'setoran',
          `Mengubah setoran ${kelasNama} menjadi ${jumlahMingguBaru} minggu (${formatRupiahServer(totalBaru)})`,
          cleanAlasan,
          JSON.stringify({
            total: Number(setoranLama.total),
            minggu: parseJsonField<string[]>(setoranLama.daftar_minggu, []),
            tanggal: String(setoranLama.tanggal_setor)
          }),
          JSON.stringify({ total: totalBaru, minggu: cleanWeeks, tanggal: cleanTanggal })
        );

        return null;
      });

      if (conflictWeek) {
        res.status(409).json({
          message: `Minggu ${conflictWeek} sudah tercatat pada setoran lain untuk ${kelasNama}.`
        });
        return;
      }

      res.json({ success: true });
    })
  );

  // 3. Hapus Setoran
  app.delete(
    '/api/setoran/:id',
    requireAdmin,
    asyncRoute(async (req, res) => {
      const setoranId = sanitizeText(req.params.id, 128);
      if (!SAFE_ID_REGEX.test(setoranId)) {
        res.status(400).json({ message: 'ID setoran tidak valid.' });
        return;
      }

      const cleanAlasan = sanitizeText(req.body?.alasan, 300);
      if (!cleanAlasan) {
        res.status(400).json({ message: 'Alasan penghapusan setoran wajib diisi.' });
        return;
      }

      const [setoranRows] = await pool.execute<RowDataPacket[]>(
        'SELECT * FROM setoran WHERE id = ?',
        [setoranId]
      );
      const setoranLama = setoranRows[0];
      if (!setoranLama) {
        res.status(404).json({ message: 'Setoran tidak ditemukan.' });
        return;
      }

      const transaksiId = setoranLama.transaksi_id ? String(setoranLama.transaksi_id) : null;

      await withTransaction(async (conn) => {
        if (transaksiId) {
          await conn.execute('DELETE FROM transaksi WHERE id = ?', [transaksiId]);
        }
        await conn.execute('DELETE FROM setoran WHERE id = ?', [setoranId]);

        await appendRiwayat(
          conn,
          'hapus',
          'setoran',
          `Menghapus setoran ${String(setoranLama.kelas_nama)} senilai ${formatRupiahServer(
            Number(setoranLama.total)
          )} (${Number(setoranLama.jumlah_minggu)} minggu)`,
          cleanAlasan,
          JSON.stringify({
            id: setoranId,
            kelasNama: String(setoranLama.kelas_nama),
            total: Number(setoranLama.total),
            jumlahMinggu: Number(setoranLama.jumlah_minggu)
          }),
          ''
        );
      });

      res.json({ success: true });
    })
  );

  // 4. Tambah Transaksi
  app.post(
    '/api/transaksi',
    requireAdmin,
    asyncRoute(async (req, res) => {
      const jenis = req.body?.jenis;
      const tanggal = sanitizeText(req.body?.tanggal, 10);
      const keterangan = sanitizeText(req.body?.keterangan, 300);
      const kategori = sanitizeText(req.body?.kategori, 100);
      const tahunAjaranId = sanitizeText(req.body?.tahunAjaranId, 50) || '2026_2027';
      const alasan = sanitizeText(req.body?.alasan, 300) || 'Pencatatan transaksi kas';
      const nominal = Math.round(Number(req.body?.nominal));

      if (jenis !== 'pemasukan' && jenis !== 'pengeluaran') {
        res.status(400).json({ message: 'Jenis transaksi tidak valid.' });
        return;
      }
      if (!isValidYYYYMMDD(tanggal)) {
        res.status(400).json({ message: 'Format tanggal transaksi tidak valid.' });
        return;
      }
      if (!keterangan) {
        res.status(400).json({ message: 'Keterangan transaksi wajib diisi.' });
        return;
      }
      if (!kategori) {
        res.status(400).json({ message: 'Kategori transaksi wajib diisi.' });
        return;
      }
      if (!isValidPositiveInt(nominal, 1, 1000000000)) {
        res.status(400).json({
          message: 'Nominal transaksi harus bilangan bulat positif antara 1 hingga 1.000.000.000.'
        });
        return;
      }

      const [tahunRows] = await pool.execute<RowDataPacket[]>(
        'SELECT id FROM tahun_ajaran WHERE id = ?',
        [tahunAjaranId]
      );
      if (tahunRows.length === 0) {
        res.status(404).json({ message: 'Tahun ajaran tidak ditemukan.' });
        return;
      }

      const id = crypto.randomUUID().replace(/-/g, '').slice(0, 20);
      const nowSql = toMySqlDateTime();

      await withTransaction(async (conn) => {
        await conn.execute(
          `INSERT INTO transaksi (
            id, jenis, tanggal, keterangan, nominal, kategori, setoran_id, tahun_ajaran_id, dibuat_pada
          ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
          [id, jenis, tanggal, keterangan, nominal, kategori, tahunAjaranId, nowSql]
        );

        await appendRiwayat(
          conn,
          'tambah',
          'transaksi',
          `Tambah transaksi ${jenis.toUpperCase()}: ${keterangan} (${formatRupiahServer(nominal)}) [Kategori: ${kategori}]`,
          alasan,
          '',
          JSON.stringify({ jenis, tanggal, keterangan, nominal, kategori, tahunAjaranId })
        );
      });

      res.json({ success: true, id });
    })
  );

  // 5. Ubah Transaksi
  app.put(
    '/api/transaksi/:id',
    requireAdmin,
    asyncRoute(async (req, res) => {
      const transaksiId = sanitizeText(req.params.id, 128);
      if (!SAFE_ID_REGEX.test(transaksiId)) {
        res.status(400).json({ message: 'ID transaksi tidak valid.' });
        return;
      }

      const cleanAlasan = sanitizeText(req.body?.alasan, 300);
      if (!cleanAlasan) {
        res.status(400).json({ message: 'Alasan perubahan wajib diisi.' });
        return;
      }

      const [txRows] = await pool.execute<RowDataPacket[]>(
        'SELECT * FROM transaksi WHERE id = ?',
        [transaksiId]
      );
      const transLama = txRows[0];
      if (!transLama) {
        res.status(404).json({ message: 'Transaksi tidak ditemukan.' });
        return;
      }

      const nextJenis = req.body?.jenis !== undefined ? req.body.jenis : String(transLama.jenis);
      if (nextJenis !== 'pemasukan' && nextJenis !== 'pengeluaran') {
        res.status(400).json({ message: 'Jenis transaksi tidak valid.' });
        return;
      }

      const nextTanggal =
        req.body?.tanggal !== undefined ? sanitizeText(req.body.tanggal, 10) : String(transLama.tanggal);
      if (!isValidYYYYMMDD(nextTanggal)) {
        res.status(400).json({ message: 'Format tanggal tidak valid.' });
        return;
      }

      const nextKeterangan =
        req.body?.keterangan !== undefined
          ? sanitizeText(req.body.keterangan, 300)
          : String(transLama.keterangan);
      if (!nextKeterangan) {
        res.status(400).json({ message: 'Keterangan tidak boleh kosong.' });
        return;
      }

      const nextKategori =
        req.body?.kategori !== undefined
          ? sanitizeText(req.body.kategori, 100)
          : String(transLama.kategori);
      if (!nextKategori) {
        res.status(400).json({ message: 'Kategori tidak boleh kosong.' });
        return;
      }

      const nextNominal =
        req.body?.nominal !== undefined ? Math.round(Number(req.body.nominal)) : Number(transLama.nominal);
      if (!isValidPositiveInt(nextNominal, 1, 1000000000)) {
        res.status(400).json({ message: 'Nominal tidak valid.' });
        return;
      }

      await withTransaction(async (conn) => {
        await conn.execute(
          `UPDATE transaksi SET jenis = ?, tanggal = ?, keterangan = ?, nominal = ?, kategori = ? WHERE id = ?`,
          [nextJenis, nextTanggal, nextKeterangan, nextNominal, nextKategori, transaksiId]
        );

        await appendRiwayat(
          conn,
          'ubah',
          'transaksi',
          `Ubah transaksi ${String(transLama.keterangan)}`,
          cleanAlasan,
          JSON.stringify({
            jenis: String(transLama.jenis),
            tanggal: String(transLama.tanggal),
            keterangan: String(transLama.keterangan),
            nominal: Number(transLama.nominal),
            kategori: String(transLama.kategori)
          }),
          JSON.stringify({
            jenis: nextJenis,
            tanggal: nextTanggal,
            keterangan: nextKeterangan,
            nominal: nextNominal,
            kategori: nextKategori
          })
        );
      });

      res.json({ success: true });
    })
  );

  // 6. Hapus Transaksi
  app.delete(
    '/api/transaksi/:id',
    requireAdmin,
    asyncRoute(async (req, res) => {
      const transaksiId = sanitizeText(req.params.id, 128);
      if (!SAFE_ID_REGEX.test(transaksiId)) {
        res.status(400).json({ message: 'ID transaksi tidak valid.' });
        return;
      }

      const cleanAlasan = sanitizeText(req.body?.alasan, 300);
      if (!cleanAlasan) {
        res.status(400).json({ message: 'Alasan penghapusan wajib diisi.' });
        return;
      }

      const [txRows] = await pool.execute<RowDataPacket[]>(
        'SELECT * FROM transaksi WHERE id = ?',
        [transaksiId]
      );
      const transLama = txRows[0];
      if (!transLama) {
        res.status(404).json({ message: 'Transaksi tidak ditemukan.' });
        return;
      }
      if (transLama.setoran_id) {
        res.status(400).json({
          message:
            'Transaksi ini terhubung ke setoran kas mingguan. Silakan hapus melalui tab Daftar Setoran agar status kas kelas tetap sinkron.'
        });
        return;
      }

      await withTransaction(async (conn) => {
        await conn.execute('DELETE FROM transaksi WHERE id = ?', [transaksiId]);

        await appendRiwayat(
          conn,
          'hapus',
          'transaksi',
          `Hapus transaksi ${String(transLama.keterangan)} (${formatRupiahServer(Number(transLama.nominal))})`,
          cleanAlasan,
          JSON.stringify({
            id: transaksiId,
            keterangan: String(transLama.keterangan),
            nominal: Number(transLama.nominal)
          }),
          ''
        );
      });

      res.json({ success: true });
    })
  );

  // 7. Kelola Kelas (Ubah nama dan/atau jumlah siswa)
  app.put(
    '/api/kelas/:id',
    requireAdmin,
    asyncRoute(async (req, res) => {
      const kelasId = sanitizeText(req.params.id, 50);
      if (!SAFE_ID_REGEX.test(kelasId)) {
        res.status(400).json({ message: 'ID kelas tidak valid.' });
        return;
      }

      const [kelasRows] = await pool.execute<RowDataPacket[]>(
        'SELECT * FROM kelas WHERE id = ?',
        [kelasId]
      );
      const kelas = kelasRows[0];
      if (!kelas) {
        res.status(404).json({ message: 'Kelas tidak ditemukan.' });
        return;
      }

      const cleanAlasan = sanitizeText(req.body?.alasan, 300);
      if (!cleanAlasan) {
        res.status(400).json({ message: 'Alasan perubahan kelas wajib diisi.' });
        return;
      }

      const oldNama = String(kelas.nama);
      const oldCount = Number(kelas.jumlah_siswa);
      const oldHistory = parseJsonField<Array<Record<string, unknown>>>(kelas.riwayat_siswa, []);

      const nextNama =
        req.body?.namaBaru !== undefined ? sanitizeText(req.body.namaBaru, 50) : oldNama;
      if (!nextNama) {
        res.status(400).json({ message: 'Nama kelas tidak boleh kosong.' });
        return;
      }

      const nextCount =
        req.body?.jumlahSiswaBaru !== undefined
          ? Math.round(Number(req.body.jumlahSiswaBaru))
          : oldCount;
      if (!isValidPositiveInt(nextCount, 1, 60)) {
        res.status(400).json({ message: 'Jumlah siswa harus bilangan bulat antara 1 sampai 60.' });
        return;
      }

      let nextHistory = oldHistory;
      if (nextCount !== oldCount) {
        nextHistory = [
          ...oldHistory.slice(-99),
          {
            tanggal: getTodayYYYYMMDD(),
            jumlahSebelumnya: oldCount,
            jumlahBaru: nextCount,
            alasan: cleanAlasan
          }
        ];
      }

      const nowSql = toMySqlDateTime();

      await withTransaction(async (conn) => {
        await conn.execute(
          `UPDATE kelas SET nama = ?, jumlah_siswa = ?, riwayat_siswa = ?, updated_at = ? WHERE id = ?`,
          [nextNama, nextCount, JSON.stringify(nextHistory), nowSql, kelasId]
        );

        if (nextNama !== oldNama) {
          await appendRiwayat(
            conn,
            'ubah',
            'kelas',
            `Ubah nama kelas dari "${oldNama}" menjadi "${nextNama}"`,
            cleanAlasan,
            oldNama,
            nextNama
          );
        }

        if (nextCount !== oldCount) {
          await appendRiwayat(
            conn,
            'ubah',
            'kelas',
            `Ubah jumlah siswa ${nextNama} dari ${oldCount} menjadi ${nextCount} siswa`,
            cleanAlasan,
            `${oldCount} siswa`,
            `${nextCount} siswa`
          );
        }
      });

      res.json({ success: true });
    })
  );

  // 8. Simpan Pengaturan Umum
  app.put(
    '/api/pengaturan',
    requireAdmin,
    asyncRoute(async (req, res) => {
      const cleanAlasan = sanitizeText(req.body?.alasan, 300) || 'Update pengaturan sistem';
      const [pengRows] = await pool.execute<RowDataPacket[]>(
        'SELECT * FROM pengaturan WHERE id = ?',
        ['main']
      );
      const peng = pengRows[0];
      if (!peng) {
        res.status(404).json({ message: 'Pengaturan tidak ditemukan.' });
        return;
      }

      let nextTarif = Number(peng.tarif_per_siswa);
      let nextTglCatat = String(peng.tanggal_mulai_pencatatan_per_kelas);
      let nextNamaSekolah = String(peng.nama_sekolah);
      let nextNamaBendahara = String(peng.nama_bendahara);
      let nextMingguLiburKas = parseMingguLiburKas(peng.minggu_libur_kas);

      const summary: Record<string, unknown> = {};

      if (req.body?.tarifPerSiswa !== undefined) {
        const tarif = Math.round(Number(req.body.tarifPerSiswa));
        if (!isValidPositiveInt(tarif, 100, 1000000)) {
          res.status(400).json({ message: 'Tarif per siswa harus antara Rp100 hingga Rp1.000.000.' });
          return;
        }
        nextTarif = tarif;
        summary.tarifPerSiswa = tarif;
      }

      if (req.body?.tanggalMulaiPencatatanPerKelas !== undefined) {
        const tgl = sanitizeText(req.body.tanggalMulaiPencatatanPerKelas, 10);
        if (!isValidYYYYMMDD(tgl)) {
          res.status(400).json({ message: 'Format tanggal mulai pencatatan tidak valid.' });
          return;
        }
        nextTglCatat = tgl;
        summary.tanggalMulaiPencatatanPerKelas = tgl;
      }

      if (req.body?.namaSekolah !== undefined) {
        const nama = sanitizeText(req.body.namaSekolah, 100);
        if (!nama) {
          res.status(400).json({ message: 'Nama sekolah tidak boleh kosong.' });
          return;
        }
        nextNamaSekolah = nama;
        summary.namaSekolah = nama;
      }

      if (req.body?.namaBendahara !== undefined) {
        const bendahara = sanitizeText(req.body.namaBendahara, 100);
        if (!bendahara) {
          res.status(400).json({ message: 'Nama bendahara tidak boleh kosong.' });
          return;
        }
        nextNamaBendahara = bendahara;
        summary.namaBendahara = bendahara;
      }

      if (req.body?.mingguLiburKas !== undefined) {
        const sanitized = sanitizeMingguLiburKas(req.body.mingguLiburKas);
        if (!sanitized) {
          res.status(400).json({ message: 'Format daftar minggu libur kas tidak valid.' });
          return;
        }
        nextMingguLiburKas = sanitized;
        summary.mingguLiburKas = Object.keys(sanitized);
      }

      await withTransaction(async (conn) => {
        await conn.execute(
          `UPDATE pengaturan
           SET tarif_per_siswa = ?, tanggal_mulai_pencatatan_per_kelas = ?, nama_sekolah = ?, nama_bendahara = ?, minggu_libur_kas = ?, updated_at = ?
           WHERE id = 'main'`,
          [
            nextTarif,
            nextTglCatat,
            nextNamaSekolah,
            nextNamaBendahara,
            JSON.stringify(nextMingguLiburKas),
            toMySqlDateTime()
          ]
        );

        await appendRiwayat(
          conn,
          'ubah',
          'pengaturan',
          req.body?.mingguLiburKas !== undefined && Object.keys(summary).length === 1
            ? `Memperbarui jadwal minggu bebas tarikan kas (${Object.keys(nextMingguLiburKas).length} minggu)`
            : 'Memperbarui konfigurasi sistem KAS OSIS',
          cleanAlasan,
          '',
          JSON.stringify(summary)
        );
      });

      res.json({ success: true });
    })
  );

  // 9. Ganti Kode Akses Bendahara Kelas (Viewer)
  app.put(
    '/api/pengaturan/viewer-passcode',
    requireAdmin,
    asyncRoute(async (req, res) => {
      const cleanCode = sanitizeText(req.body?.passcodeBaru, 100);
      const cleanAlasan = sanitizeText(req.body?.alasan, 300) || 'Memperbarui kode akses Bendahara Kelas';

      if (!cleanCode || cleanCode.length < 8) {
        res.status(400).json({ message: 'Kode akses Bendahara Kelas minimal 8 karakter.' });
        return;
      }

      const hash = hashPasswordScrypt(cleanCode);

      await withTransaction(async (conn) => {
        await conn.execute(
          `UPDATE pengaturan SET viewer_passcode_hash = ?, updated_at = ? WHERE id = 'main'`,
          [hash, toMySqlDateTime()]
        );

        await appendRiwayat(
          conn,
          'ubah',
          'pengaturan',
          'Memperbarui kode akses Bendahara Kelas',
          cleanAlasan,
          '',
          JSON.stringify({ kodeAksesViewer: 'Diperbarui (tersandi scrypt)' })
        );
      });

      res.json({ success: true });
    })
  );

  // 10. Buat Tahun Ajaran Baru
  app.post(
    '/api/tahun-ajaran',
    requireAdmin,
    asyncRoute(async (req, res) => {
      const cleanLabel = sanitizeText(req.body?.label, 50);
      const cleanMulai = sanitizeText(req.body?.tanggalMulai, 10);
      const cleanAkhir = sanitizeText(req.body?.tanggalAkhir, 10);
      const bawaModalAwal = Boolean(req.body?.bawaModalAwal);
      const cleanAlasan = sanitizeText(req.body?.alasan, 300) || 'Pembukaan tahun ajaran baru';

      if (!cleanLabel || !isValidYYYYMMDD(cleanMulai) || !isValidYYYYMMDD(cleanAkhir)) {
        res.status(400).json({ message: 'Label dan format tanggal tahun ajaran tidak valid.' });
        return;
      }
      if (cleanAkhir < cleanMulai) {
        res.status(400).json({ message: 'Tanggal akhir harus setelah tanggal mulai.' });
        return;
      }

      const newId = cleanLabel.replace(/[^a-zA-Z0-9]/g, '_');
      if (!SAFE_ID_REGEX.test(newId)) {
        res.status(400).json({ message: 'Label tahun ajaran tidak valid.' });
        return;
      }

      const [existingTahun] = await pool.execute<RowDataPacket[]>(
        'SELECT id FROM tahun_ajaran WHERE id = ?',
        [newId]
      );
      if (existingTahun.length > 0) {
        res.status(409).json({ message: `Tahun ajaran ${cleanLabel} sudah ada.` });
        return;
      }

      const [pengRows] = await pool.execute<RowDataPacket[]>(
        'SELECT tahun_ajaran_aktif_id FROM pengaturan WHERE id = ?',
        ['main']
      );
      const prevTahunId = String(pengRows[0]?.tahun_ajaran_aktif_id || '2026_2027');

      const [saldoRows] = await pool.execute<RowDataPacket[]>(
        `SELECT COALESCE(SUM(CASE WHEN jenis = 'pemasukan' THEN nominal ELSE -nominal END), 0) AS saldo
         FROM transaksi WHERE tahun_ajaran_id = ?`,
        [prevTahunId]
      );
      const saldoSekarang = Number(saldoRows[0]?.saldo || 0);
      const nowSql = toMySqlDateTime();

      await withTransaction(async (conn) => {
        await conn.execute('UPDATE tahun_ajaran SET is_aktif = 0');
        await conn.execute(
          `INSERT INTO tahun_ajaran (id, label, tanggal_mulai, tanggal_akhir, is_aktif, created_at)
           VALUES (?, ?, ?, ?, 1, ?)`,
          [newId, cleanLabel, cleanMulai, cleanAkhir, nowSql]
        );

        if (bawaModalAwal && saldoSekarang > 0) {
          const txId = crypto.randomUUID().replace(/-/g, '').slice(0, 20);
          await conn.execute(
            `INSERT INTO transaksi (
              id, jenis, tanggal, keterangan, nominal, kategori, setoran_id, tahun_ajaran_id, dibuat_pada
            ) VALUES (?, 'pemasukan', ?, ?, ?, 'Modal', NULL, ?, ?)`,
            [
              txId,
              cleanMulai,
              sanitizeText(`Modal awal tahun ajaran ${cleanLabel} (saldo sisa tahun sebelumnya)`, 300),
              saldoSekarang,
              newId,
              nowSql
            ]
          );
        }

        await conn.execute(
          `UPDATE pengaturan
           SET tahun_ajaran_aktif_id = ?, tanggal_mulai_tahun_ajaran = ?, tanggal_akhir_tahun_ajaran = ?, updated_at = ?
           WHERE id = 'main'`,
          [newId, cleanMulai, cleanAkhir, nowSql]
        );

        await appendRiwayat(
          conn,
          'tambah',
          'tahun_ajaran',
          `Membuat tahun ajaran baru ${cleanLabel} (${cleanMulai} s/d ${cleanAkhir})${
            bawaModalAwal ? ` dengan saldo awal ${formatRupiahServer(saldoSekarang)}` : ''
          }`,
          cleanAlasan
        );
      });

      res.json({ success: true, id: newId });
    })
  );

  // 11. Muat Data Awal Excel (sudah dimuat via file .sql)
  app.post(
    '/api/seed-excel',
    requireAdmin,
    asyncRoute(async (_req, res) => {
      res.status(400).json({
        message: 'Data awal dimuat langsung melalui file database/kas_osis_smkn7_samarinda.sql.'
      });
    })
  );

  // Error handler for /api/* (never leaks stack traces)
  app.use('/api', (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (isDbUnavailableError(err)) {
      res.status(503).json({ message: formatDbErrorMessage(err) });
      return;
    }
    console.error('API Error:', err instanceof Error ? err.message : err);
    res.status(500).json({ message: 'Terjadi kesalahan pada server.' });
  });

  // Frontend serving: static dist/ in production, Vite middleware in dev
  const distDir = path.resolve(process.cwd(), 'dist');
  const distIndex = path.join(distDir, 'index.html');
  const isProd = process.env.NODE_ENV === 'production' && fs.existsSync(distIndex);

  if (isProd) {
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(distIndex);
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  }

  const dbCheck = await verifyDatabaseReady();
  if (!dbCheck.ready) {
    console.warn(`[PERINGATAN DB] ${dbCheck.error}`);
  } else {
    console.log('Database MySQL lokal terhubung dan siap.');
  }

  const port = Number(process.env.PORT) || 3000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`Server KAS OSIS berjalan pada http://0.0.0.0:${port}`);
  });
}

startServer();
