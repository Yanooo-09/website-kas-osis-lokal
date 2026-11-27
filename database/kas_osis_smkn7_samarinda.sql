-- ============================================================================
-- DATABASE : KAS OSIS - SMKN 7 SAMARINDA
-- ENGINE   : MySQL 8.0+ / MariaDB 10.4+ (UTF8MB4 / InnoDB)
-- GENERATED: 2026-11-26 (Snapshot Pembukuan Lengkap KAS OSIS Lokal)
-- VERIFIKASI DATA:
--   * Kelas          : 16 kelas
--   * Tahun Ajaran   : 1 periode
--   * Setoran        : 29 catatan setoran
--   * Transaksi      : 46 baris buku kas
--   * Riwayat Audit  : 18 log aktivitas
--   * Total Pemasukan: Rp 6.248.000
--   * Total Keluar   : Rp 1.984.500
--   * Saldo Akhir    : Rp 4.263.500
-- ============================================================================

SET NAMES utf8mb4;
SET time_zone = '+08:00';
SET FOREIGN_KEY_CHECKS = 0;

CREATE DATABASE IF NOT EXISTS `kas_osis_smkn7`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
USE `kas_osis_smkn7`;

DROP VIEW IF EXISTS `v_ringkasan_kas`;
DROP TABLE IF EXISTS `riwayat`;
DROP TABLE IF EXISTS `transaksi`;
DROP TABLE IF EXISTS `setoran_minggu`;
DROP TABLE IF EXISTS `setoran`;
DROP TABLE IF EXISTS `kelas`;
DROP TABLE IF EXISTS `tahun_ajaran`;
DROP TABLE IF EXISTS `pengaturan`;
DROP TABLE IF EXISTS `admin_users`;

-- 1. Tabel Akun Admin (Password wajib disimpan dalam bentuk hash aman, bukan plaintext)
CREATE TABLE `admin_users` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `username` VARCHAR(50) NOT NULL,
  `nama_lengkap` VARCHAR(100) NOT NULL,
  `email` VARCHAR(120) DEFAULT NULL,
  `password_hash` VARCHAR(255) DEFAULT NULL COMMENT 'Hash scrypt default akun admin (user: alkiyano)',
  `role` ENUM('admin', 'auditor') NOT NULL DEFAULT 'admin',
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_admin_username` (`username`),
  UNIQUE KEY `uq_admin_email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Tabel Tahun Ajaran
CREATE TABLE `tahun_ajaran` (
  `id` VARCHAR(50) NOT NULL,
  `label` VARCHAR(50) NOT NULL,
  `tanggal_mulai` DATE NOT NULL,
  `tanggal_akhir` DATE NOT NULL,
  `is_aktif` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT `chk_tahun_ajaran_dates` CHECK (`tanggal_akhir` >= `tanggal_mulai`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Tabel Pengaturan Sistem (Tanpa menyimpan password admin plaintext)
CREATE TABLE `pengaturan` (
  `id` VARCHAR(50) NOT NULL,
  `nama_sekolah` VARCHAR(100) NOT NULL,
  `nama_bendahara` VARCHAR(100) NOT NULL,
  `tarif_per_siswa` INT UNSIGNED NOT NULL DEFAULT 1000,
  `tahun_ajaran_aktif_id` VARCHAR(50) NOT NULL,
  `tanggal_mulai_tahun_ajaran` DATE NOT NULL,
  `tanggal_akhir_tahun_ajaran` DATE NOT NULL,
  `tanggal_mulai_pencatatan_per_kelas` DATE NOT NULL,
  `viewer_passcode_hash` VARCHAR(255) NOT NULL,
  `kategori_pemasukan` JSON NOT NULL,
  `kategori_pengeluaran` JSON NOT NULL,
  `minggu_libur_kas` JSON NOT NULL,
  `seed_loaded` TINYINT(1) NOT NULL DEFAULT 1,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_pengaturan_tahun` FOREIGN KEY (`tahun_ajaran_aktif_id`) REFERENCES `tahun_ajaran`(`id`) ON UPDATE CASCADE,
  CONSTRAINT `chk_tarif_positif` CHECK (`tarif_per_siswa` >= 100)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Tabel Daftar Kelas (16 Kelas SMKN 7 Samarinda)
CREATE TABLE `kelas` (
  `id` VARCHAR(50) NOT NULL,
  `nama` VARCHAR(50) NOT NULL,
  `tingkat` ENUM('X', 'XI') NOT NULL,
  `urutan` TINYINT UNSIGNED NOT NULL,
  `jumlah_siswa` SMALLINT UNSIGNED NOT NULL,
  `riwayat_siswa` JSON DEFAULT NULL,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_kelas_urutan` (`urutan`),
  CONSTRAINT `chk_jumlah_siswa` CHECK (`jumlah_siswa` BETWEEN 1 AND 60)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. Tabel Setoran Kas Mingguan Kelas (Dengan Snapshot Siswa & Tarif)
CREATE TABLE `setoran` (
  `id` VARCHAR(64) NOT NULL,
  `kelas_id` VARCHAR(50) NOT NULL,
  `kelas_nama` VARCHAR(50) NOT NULL,
  `daftar_minggu` JSON NOT NULL,
  `jumlah_minggu` SMALLINT UNSIGNED NOT NULL,
  `jumlah_siswa_snapshot` SMALLINT UNSIGNED NOT NULL,
  `tarif_snapshot` INT UNSIGNED NOT NULL,
  `total` BIGINT UNSIGNED NOT NULL,
  `tanggal_setor` DATE NOT NULL,
  `tahun_ajaran_id` VARCHAR(50) NOT NULL,
  `transaksi_id` VARCHAR(64) DEFAULT NULL,
  `dibuat_pada` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_setoran_kelas` (`kelas_id`),
  KEY `idx_setoran_tahun` (`tahun_ajaran_id`),
  KEY `idx_setoran_tanggal` (`tanggal_setor`),
  CONSTRAINT `fk_setoran_kelas` FOREIGN KEY (`kelas_id`) REFERENCES `kelas`(`id`) ON UPDATE CASCADE,
  CONSTRAINT `fk_setoran_tahun` FOREIGN KEY (`tahun_ajaran_id`) REFERENCES `tahun_ajaran`(`id`) ON UPDATE CASCADE,
  CONSTRAINT `chk_setoran_total` CHECK (`total` > 0 AND `jumlah_minggu` > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6. Tabel Relasi Minggu Setoran (Mencegah Pembayaran Ganda untuk Minggu yang Sama)
CREATE TABLE `setoran_minggu` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `setoran_id` VARCHAR(64) NOT NULL,
  `kelas_id` VARCHAR(50) NOT NULL,
  `tahun_ajaran_id` VARCHAR(50) NOT NULL,
  `minggu_senin` DATE NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_kelas_tahun_minggu` (`kelas_id`, `tahun_ajaran_id`, `minggu_senin`),
  KEY `idx_sm_setoran` (`setoran_id`),
  CONSTRAINT `fk_sm_setoran` FOREIGN KEY (`setoran_id`) REFERENCES `setoran`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_sm_kelas` FOREIGN KEY (`kelas_id`) REFERENCES `kelas`(`id`) ON UPDATE CASCADE,
  CONSTRAINT `fk_sm_tahun` FOREIGN KEY (`tahun_ajaran_id`) REFERENCES `tahun_ajaran`(`id`) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 7. Tabel Transaksi Buku Kas Umum
CREATE TABLE `transaksi` (
  `id` VARCHAR(64) NOT NULL,
  `jenis` ENUM('pemasukan', 'pengeluaran') NOT NULL,
  `tanggal` DATE NOT NULL,
  `keterangan` VARCHAR(300) NOT NULL,
  `nominal` BIGINT UNSIGNED NOT NULL,
  `kategori` VARCHAR(100) NOT NULL,
  `setoran_id` VARCHAR(64) DEFAULT NULL,
  `tahun_ajaran_id` VARCHAR(50) NOT NULL,
  `dibuat_pada` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_tx_tahun_tanggal` (`tahun_ajaran_id`, `tanggal`),
  KEY `idx_tx_jenis` (`jenis`),
  KEY `idx_tx_setoran` (`setoran_id`),
  CONSTRAINT `fk_tx_tahun` FOREIGN KEY (`tahun_ajaran_id`) REFERENCES `tahun_ajaran`(`id`) ON UPDATE CASCADE,
  CONSTRAINT `fk_tx_setoran` FOREIGN KEY (`setoran_id`) REFERENCES `setoran`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `chk_tx_nominal` CHECK (`nominal` > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 8. Tabel Audit Log Transparansi
CREATE TABLE `riwayat` (
  `id` VARCHAR(64) NOT NULL,
  `waktu` DATETIME NOT NULL,
  `aksi` ENUM('tambah', 'ubah', 'hapus', 'seed') NOT NULL,
  `jenis_data` VARCHAR(50) NOT NULL,
  `ringkasan` VARCHAR(300) NOT NULL,
  `nilai_lama` TEXT DEFAULT NULL,
  `nilai_baru` TEXT DEFAULT NULL,
  `alasan` VARCHAR(300) NOT NULL,
  `actor_role` VARCHAR(100) NOT NULL DEFAULT 'Bendahara OSIS',
  PRIMARY KEY (`id`),
  KEY `idx_riwayat_waktu` (`waktu`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- DATA PRODUKSI TERBARU (SNAPSHOT LENGKAP KAS OSIS)
-- ============================================================================

INSERT INTO `admin_users` (`username`, `nama_lengkap`, `email`, `password_hash`, `role`, `is_active`) VALUES
  ('alkiyano', 'Alkiyano Parintak', 'alkiyano123@gmail.com', 'scrypt$8ce20006853a18ead3cd2dc6d95ed7e6$92b95049bdae41738570e852c98592ee99bb097248f97ecead704fa55bb7b32fae7851a572049230377cf21a7504ce25a3cf46ca035883046991af2d7cb83b73', 'admin', 1);

INSERT INTO `tahun_ajaran` (`id`, `label`, `tanggal_mulai`, `tanggal_akhir`, `is_aktif`) VALUES
  ('2026_2027', '2026/2027', '2026-08-03', '2027-06-27', 1);

INSERT INTO `pengaturan` (`id`, `nama_sekolah`, `nama_bendahara`, `tarif_per_siswa`, `tahun_ajaran_aktif_id`, `tanggal_mulai_tahun_ajaran`, `tanggal_akhir_tahun_ajaran`, `tanggal_mulai_pencatatan_per_kelas`, `viewer_passcode_hash`, `kategori_pemasukan`, `kategori_pengeluaran`, `minggu_libur_kas`, `seed_loaded`, `updated_at`) VALUES
  ('main', 'SMKN 7 SAMARINDA', 'Alkiyano Parintak', 1000, '2026_2027', '2026-08-03', '2027-06-27', '2026-08-03', '405c6f7316fcb974ef09959569ac72982256d7067413ff5d742262b57f44f82c', '[\"Modal\",\"Uang Pelanggaran\",\"Kas Mingguan (rekap lama)\",\"Kas Mingguan\",\"Lainnya\"]', '[\"Konsumsi\",\"Hadiah & Lomba\",\"Perlengkapan\",\"Lainnya\"]', '{}', 1, '2026-11-09 12:36:32');

INSERT INTO `kelas` (`id`, `nama`, `tingkat`, `urutan`, `jumlah_siswa`, `riwayat_siswa`, `updated_at`) VALUES
  ('kelas_x_tjkt_1', 'X TJKT 1', 'X', 1, 34, '[{\"alasan\":\"keluar 1 murid\",\"jumlahBaru\":34,\"tanggal\":\"2026-11-16\",\"jumlahSebelumnya\":35}]', '2026-11-16 08:50:18'),
  ('kelas_x_tjkt_2', 'X TJKT 2', 'X', 2, 34, '[]', '2026-11-09 12:36:32'),
  ('kelas_x_tjkt_3', 'X TJKT 3', 'X', 3, 33, '[]', '2026-11-09 12:36:32'),
  ('kelas_x_pplg_1', 'X PPLG 1', 'X', 4, 34, '[]', '2026-11-09 12:36:32'),
  ('kelas_x_pplg_2', 'X PPLG 2', 'X', 5, 36, '[]', '2026-11-09 12:36:32'),
  ('kelas_x_dkv_1', 'X DKV 1', 'X', 6, 36, '[]', '2026-11-09 12:36:32'),
  ('kelas_x_dkv_2', 'X DKV 2', 'X', 7, 35, '[]', '2026-11-09 12:36:32'),
  ('kelas_x_animasi', 'X ANIMASI', 'X', 8, 35, '[]', '2026-11-09 12:36:32'),
  ('kelas_xi_tjkt_1', 'XI TJKT 1', 'XI', 9, 35, '[]', '2026-11-09 12:36:32'),
  ('kelas_xi_tjkt_2', 'XI TJKT 2', 'XI', 10, 32, '[]', '2026-11-09 12:36:32'),
  ('kelas_xi_tjkt_3', 'XI TJKT 3', 'XI', 11, 35, '[{\"alasan\":\"siswanya membludak\",\"tanggal\":\"2026-11-10\",\"jumlahBaru\":60,\"jumlahSebelumnya\":35},{\"jumlahSebelumnya\":60,\"jumlahBaru\":35,\"tanggal\":\"2026-11-10\",\"alasan\":\"yang benernya\"}]', '2026-11-10 05:09:27'),
  ('kelas_xi_pplg_1', 'XI PPLG 1', 'XI', 12, 34, '[]', '2026-11-09 12:36:32'),
  ('kelas_xi_pplg_2', 'XI PPLG 2', 'XI', 13, 35, '[]', '2026-11-09 12:36:32'),
  ('kelas_xi_dkv_1', 'XI DKV 1', 'XI', 14, 34, '[]', '2026-11-09 12:36:32'),
  ('kelas_xi_dkv_2', 'XI DKV 2', 'XI', 15, 31, '[]', '2026-11-09 12:36:32'),
  ('kelas_xi_animasi', 'XI ANIMASI', 'XI', 16, 29, '[]', '2026-11-09 12:36:32');

INSERT INTO `setoran` (`id`, `kelas_id`, `kelas_nama`, `daftar_minggu`, `jumlah_minggu`, `jumlah_siswa_snapshot`, `tarif_snapshot`, `total`, `tanggal_setor`, `tahun_ajaran_id`, `transaksi_id`, `dibuat_pada`) VALUES
  ('setoran_x_tjkt_3', 'kelas_x_tjkt_3', 'X TJKT 3', '[\"2026-08-03\",\"2026-08-10\",\"2026-08-17\"]', 3, 33, 1000, 99000, '2026-08-17', '2026_2027', NULL, '2026-08-17 08:00:00'),
  ('setoran_xi_dkv_2', 'kelas_xi_dkv_2', 'XI DKV 2', '[\"2026-08-03\",\"2026-08-10\",\"2026-08-17\"]', 3, 31, 1000, 93000, '2026-08-17', '2026_2027', NULL, '2026-08-17 08:00:00'),
  ('setoran_x_tjkt_2', 'kelas_x_tjkt_2', 'X TJKT 2', '[\"2026-08-03\",\"2026-08-10\",\"2026-08-17\",\"2026-08-24\"]', 4, 34, 1000, 136000, '2026-08-24', '2026_2027', NULL, '2026-08-24 08:00:00'),
  ('setoran_xi_animasi', 'kelas_xi_animasi', 'XI ANIMASI', '[\"2026-08-03\",\"2026-08-10\",\"2026-08-17\",\"2026-08-24\"]', 4, 29, 1000, 116000, '2026-08-24', '2026_2027', NULL, '2026-08-24 08:00:00'),
  ('setoran_xi_pplg_2', 'kelas_xi_pplg_2', 'XI PPLG 2', '[\"2026-08-03\",\"2026-08-10\",\"2026-08-17\",\"2026-08-24\"]', 4, 35, 1000, 140000, '2026-08-24', '2026_2027', NULL, '2026-08-24 08:00:00'),
  ('setoran_x_animasi', 'kelas_x_animasi', 'X ANIMASI', '[\"2026-08-03\",\"2026-08-10\",\"2026-08-17\",\"2026-08-24\",\"2026-08-31\"]', 5, 35, 1000, 175000, '2026-09-02', '2026_2027', NULL, '2026-09-02 08:00:00'),
  ('setoran_x_pplg_1', 'kelas_x_pplg_1', 'X PPLG 1', '[\"2026-08-03\",\"2026-08-10\",\"2026-08-17\",\"2026-08-24\",\"2026-08-31\"]', 5, 34, 1000, 170000, '2026-09-02', '2026_2027', NULL, '2026-09-02 08:00:00'),
  ('setoran_x_tjkt_1', 'kelas_x_tjkt_1', 'X TJKT 1', '[\"2026-08-03\",\"2026-08-10\",\"2026-08-17\",\"2026-08-24\",\"2026-08-31\"]', 5, 35, 1000, 175000, '2026-09-02', '2026_2027', NULL, '2026-09-02 08:00:00'),
  ('setoran_xi_pplg_1', 'kelas_xi_pplg_1', 'XI PPLG 1', '[\"2026-08-03\",\"2026-08-10\",\"2026-08-17\",\"2026-08-24\",\"2026-08-31\"]', 5, 34, 1000, 170000, '2026-09-02', '2026_2027', NULL, '2026-09-02 08:00:00'),
  ('setoran_xi_tjkt_3', 'kelas_xi_tjkt_3', 'XI TJKT 3', '[\"2026-08-03\",\"2026-08-10\",\"2026-08-17\",\"2026-08-24\",\"2026-08-31\"]', 5, 35, 1000, 175000, '2026-09-02', '2026_2027', NULL, '2026-09-02 08:00:00'),
  ('setoran_x_dkv_1', 'kelas_x_dkv_1', 'X DKV 1', '[\"2026-08-03\",\"2026-08-10\",\"2026-08-17\",\"2026-08-24\",\"2026-08-31\",\"2026-09-07\"]', 6, 36, 1000, 216000, '2026-09-14', '2026_2027', NULL, '2026-09-14 08:00:00'),
  ('setoran_x_pplg_2', 'kelas_x_pplg_2', 'X PPLG 2', '[\"2026-08-03\",\"2026-08-10\",\"2026-08-17\",\"2026-08-24\",\"2026-08-31\",\"2026-09-07\"]', 6, 36, 1000, 216000, '2026-09-14', '2026_2027', NULL, '2026-09-14 08:00:00'),
  ('setoran_xi_tjkt_1', 'kelas_xi_tjkt_1', 'XI TJKT 1', '[\"2026-08-03\",\"2026-08-10\",\"2026-08-17\",\"2026-08-24\",\"2026-08-31\",\"2026-09-07\"]', 6, 35, 1000, 210000, '2026-09-14', '2026_2027', NULL, '2026-09-14 08:00:00'),
  ('setoran_x_dkv_2', 'kelas_x_dkv_2', 'X DKV 2', '[\"2026-08-03\",\"2026-08-10\",\"2026-08-17\",\"2026-08-24\",\"2026-08-31\",\"2026-09-14\"]', 6, 35, 1000, 210000, '2026-09-16', '2026_2027', NULL, '2026-09-16 08:00:00'),
  ('setoran_xi_dkv_1', 'kelas_xi_dkv_1', 'XI DKV 1', '[\"2026-08-03\",\"2026-08-10\",\"2026-08-17\",\"2026-08-24\",\"2026-08-31\",\"2026-09-07\",\"2026-09-14\"]', 7, 34, 1000, 238000, '2026-09-16', '2026_2027', NULL, '2026-09-16 08:00:00'),
  ('setoran_xi_tjkt_2', 'kelas_xi_tjkt_2', 'XI TJKT 2', '[\"2026-08-03\",\"2026-08-10\",\"2026-08-17\",\"2026-08-24\",\"2026-08-31\",\"2026-09-07\",\"2026-09-14\",\"2026-09-21\"]', 8, 32, 1000, 256000, '2026-09-26', '2026_2027', NULL, '2026-09-26 08:00:00'),
  ('VWF7UIbAaVaf78Q9U3gy', 'kelas_x_pplg_1', 'X PPLG 1', '[\"2026-09-07\",\"2026-09-14\",\"2026-09-21\"]', 3, 34, 1000, 102000, '2026-11-09', '2026_2027', 'gy8dFCP9eeOxQGBOw6rs', '2026-11-09 12:31:32'),
  ('8hzAHzcmLq0MmARM1AGP', 'kelas_xi_animasi', 'XI ANIMASI', '[\"2026-08-31\",\"2026-09-07\",\"2026-09-14\",\"2026-09-21\"]', 4, 29, 1000, 116000, '2026-11-09', '2026_2027', 'ZrUHBIGq5fUtPV13wNpG', '2026-11-09 12:38:03'),
  ('6afZPIJyzsJAVICtQHnV', 'kelas_xi_tjkt_2', 'XI TJKT 2', '[\"2026-09-28\",\"2026-10-05\",\"2026-10-12\",\"2026-10-19\"]', 4, 32, 1000, 128000, '2026-11-13', '2026_2027', 'Ov7ZUD2I0s2UQXQwHNNz', '2026-11-13 02:12:41'),
  ('9Upo8ZlUdytmoE5jQTCY', 'kelas_xi_pplg_2', 'XI PPLG 2', '[\"2026-08-31\",\"2026-09-07\"]', 2, 35, 1000, 70000, '2026-11-13', '2026_2027', 'K5mbwX5sTmRij12rkLfo', '2026-11-13 07:01:53'),
  ('XKUiD9XIX0GTVWA0CGeB', 'kelas_x_tjkt_2', 'X TJKT 2', '[\"2026-08-31\",\"2026-09-07\"]', 2, 34, 1000, 68000, '2026-11-13', '2026_2027', 'xZT7mereWp8zqDux4jOV', '2026-11-13 07:06:10'),
  ('QHvYXNVm2RPb2VVbZq7R', 'kelas_x_tjkt_1', 'X TJKT 1', '[\"2026-09-07\",\"2026-09-14\",\"2026-09-21\",\"2026-09-28\",\"2026-10-05\",\"2026-10-12\",\"2026-10-19\",\"2026-10-26\",\"2026-11-02\"]', 9, 34, 1000, 306000, '2026-11-17', '2026_2027', '9F5ReYj0mTmEKYjjC0UQ', '2026-11-17 04:26:07'),
  ('G3NJNR2q6rKkOrfT9PJ6', 'kelas_xi_tjkt_3', 'XI TJKT 3', '[\"2026-09-07\",\"2026-09-14\",\"2026-09-21\",\"2026-09-28\",\"2026-10-05\"]', 5, 35, 1000, 175000, '2026-11-17', '2026_2027', 'qlEFyHSF9awK20WvlUMP', '2026-11-17 04:57:28'),
  ('XUGwtRg4RtlAvTeDwnTJ', 'kelas_xi_pplg_1', 'XI PPLG 1', '[\"2026-09-07\",\"2026-09-14\"]', 2, 34, 1000, 68000, '2026-11-17', '2026_2027', 'YNBhixexQmnp1vbvzfoZ', '2026-11-17 11:15:47'),
  ('THd2bRlFCbirS497ndtf', 'kelas_x_dkv_1', 'X DKV 1', '[\"2027-05-17\"]', 1, 36, 1000, 36000, '2026-11-18', '2026_2027', 'awHfAgL3zlQ6tXIoZhGs', '2026-11-18 04:26:03'),
  ('v9uWhdyUPdXkWOwTGhnt', 'kelas_xi_dkv_2', 'XI DKV 2', '[\"2026-08-24\",\"2026-08-31\",\"2026-09-07\",\"2026-09-14\",\"2026-09-21\",\"2026-09-28\",\"2026-10-05\",\"2026-10-12\",\"2026-10-19\",\"2026-10-26\",\"2026-11-02\",\"2026-11-09\",\"2026-11-16\"]', 13, 31, 1000, 403000, '2026-11-18', '2026_2027', 'EKluBSt16HJTZp5qeZFL', '2026-11-18 04:40:32'),
  ('LwssUC3wpyrWTCMDoq62', 'kelas_x_dkv_1', 'X DKV 1', '[\"2026-09-14\"]', 1, 36, 1000, 36000, '2026-11-19', '2026_2027', 'QJ0U0R8cBseZFzAysIp1', '2026-11-19 14:34:52'),
  ('gpW53HrGyOf8b2iW2S2f', 'kelas_xi_pplg_1', 'XI PPLG 1', '[\"2026-09-21\",\"2026-09-28\"]', 2, 34, 1000, 68000, '2026-11-23', '2026_2027', 'rcBKN6u4ALWmN71Ck0Pd', '2026-11-23 07:32:53'),
  ('gzE0Tw9szQZmCVfDfUhb', 'kelas_x_dkv_2', 'X DKV 2', '[\"2026-09-07\",\"2026-09-21\",\"2026-09-28\",\"2026-10-05\",\"2026-10-12\"]', 5, 35, 1000, 175000, '2026-11-26', '2026_2027', 'EFkETHc8hznKIglWFTDi', '2026-11-26 00:50:19');

INSERT INTO `setoran_minggu` (`setoran_id`, `kelas_id`, `tahun_ajaran_id`, `minggu_senin`) VALUES
  ('setoran_x_tjkt_3', 'kelas_x_tjkt_3', '2026_2027', '2026-08-03'),
  ('setoran_x_tjkt_3', 'kelas_x_tjkt_3', '2026_2027', '2026-08-10'),
  ('setoran_x_tjkt_3', 'kelas_x_tjkt_3', '2026_2027', '2026-08-17'),
  ('setoran_xi_dkv_2', 'kelas_xi_dkv_2', '2026_2027', '2026-08-03'),
  ('setoran_xi_dkv_2', 'kelas_xi_dkv_2', '2026_2027', '2026-08-10'),
  ('setoran_xi_dkv_2', 'kelas_xi_dkv_2', '2026_2027', '2026-08-17'),
  ('setoran_x_tjkt_2', 'kelas_x_tjkt_2', '2026_2027', '2026-08-03'),
  ('setoran_x_tjkt_2', 'kelas_x_tjkt_2', '2026_2027', '2026-08-10'),
  ('setoran_x_tjkt_2', 'kelas_x_tjkt_2', '2026_2027', '2026-08-17'),
  ('setoran_x_tjkt_2', 'kelas_x_tjkt_2', '2026_2027', '2026-08-24'),
  ('setoran_xi_animasi', 'kelas_xi_animasi', '2026_2027', '2026-08-03'),
  ('setoran_xi_animasi', 'kelas_xi_animasi', '2026_2027', '2026-08-10'),
  ('setoran_xi_animasi', 'kelas_xi_animasi', '2026_2027', '2026-08-17'),
  ('setoran_xi_animasi', 'kelas_xi_animasi', '2026_2027', '2026-08-24'),
  ('setoran_xi_pplg_2', 'kelas_xi_pplg_2', '2026_2027', '2026-08-03'),
  ('setoran_xi_pplg_2', 'kelas_xi_pplg_2', '2026_2027', '2026-08-10'),
  ('setoran_xi_pplg_2', 'kelas_xi_pplg_2', '2026_2027', '2026-08-17'),
  ('setoran_xi_pplg_2', 'kelas_xi_pplg_2', '2026_2027', '2026-08-24'),
  ('setoran_x_animasi', 'kelas_x_animasi', '2026_2027', '2026-08-03'),
  ('setoran_x_animasi', 'kelas_x_animasi', '2026_2027', '2026-08-10'),
  ('setoran_x_animasi', 'kelas_x_animasi', '2026_2027', '2026-08-17'),
  ('setoran_x_animasi', 'kelas_x_animasi', '2026_2027', '2026-08-24'),
  ('setoran_x_animasi', 'kelas_x_animasi', '2026_2027', '2026-08-31'),
  ('setoran_x_pplg_1', 'kelas_x_pplg_1', '2026_2027', '2026-08-03'),
  ('setoran_x_pplg_1', 'kelas_x_pplg_1', '2026_2027', '2026-08-10'),
  ('setoran_x_pplg_1', 'kelas_x_pplg_1', '2026_2027', '2026-08-17'),
  ('setoran_x_pplg_1', 'kelas_x_pplg_1', '2026_2027', '2026-08-24'),
  ('setoran_x_pplg_1', 'kelas_x_pplg_1', '2026_2027', '2026-08-31'),
  ('setoran_x_tjkt_1', 'kelas_x_tjkt_1', '2026_2027', '2026-08-03'),
  ('setoran_x_tjkt_1', 'kelas_x_tjkt_1', '2026_2027', '2026-08-10'),
  ('setoran_x_tjkt_1', 'kelas_x_tjkt_1', '2026_2027', '2026-08-17'),
  ('setoran_x_tjkt_1', 'kelas_x_tjkt_1', '2026_2027', '2026-08-24'),
  ('setoran_x_tjkt_1', 'kelas_x_tjkt_1', '2026_2027', '2026-08-31'),
  ('setoran_xi_pplg_1', 'kelas_xi_pplg_1', '2026_2027', '2026-08-03'),
  ('setoran_xi_pplg_1', 'kelas_xi_pplg_1', '2026_2027', '2026-08-10'),
  ('setoran_xi_pplg_1', 'kelas_xi_pplg_1', '2026_2027', '2026-08-17'),
  ('setoran_xi_pplg_1', 'kelas_xi_pplg_1', '2026_2027', '2026-08-24'),
  ('setoran_xi_pplg_1', 'kelas_xi_pplg_1', '2026_2027', '2026-08-31'),
  ('setoran_xi_tjkt_3', 'kelas_xi_tjkt_3', '2026_2027', '2026-08-03'),
  ('setoran_xi_tjkt_3', 'kelas_xi_tjkt_3', '2026_2027', '2026-08-10'),
  ('setoran_xi_tjkt_3', 'kelas_xi_tjkt_3', '2026_2027', '2026-08-17'),
  ('setoran_xi_tjkt_3', 'kelas_xi_tjkt_3', '2026_2027', '2026-08-24'),
  ('setoran_xi_tjkt_3', 'kelas_xi_tjkt_3', '2026_2027', '2026-08-31'),
  ('setoran_x_dkv_1', 'kelas_x_dkv_1', '2026_2027', '2026-08-03'),
  ('setoran_x_dkv_1', 'kelas_x_dkv_1', '2026_2027', '2026-08-10'),
  ('setoran_x_dkv_1', 'kelas_x_dkv_1', '2026_2027', '2026-08-17'),
  ('setoran_x_dkv_1', 'kelas_x_dkv_1', '2026_2027', '2026-08-24'),
  ('setoran_x_dkv_1', 'kelas_x_dkv_1', '2026_2027', '2026-08-31'),
  ('setoran_x_dkv_1', 'kelas_x_dkv_1', '2026_2027', '2026-09-07'),
  ('setoran_x_pplg_2', 'kelas_x_pplg_2', '2026_2027', '2026-08-03'),
  ('setoran_x_pplg_2', 'kelas_x_pplg_2', '2026_2027', '2026-08-10'),
  ('setoran_x_pplg_2', 'kelas_x_pplg_2', '2026_2027', '2026-08-17'),
  ('setoran_x_pplg_2', 'kelas_x_pplg_2', '2026_2027', '2026-08-24'),
  ('setoran_x_pplg_2', 'kelas_x_pplg_2', '2026_2027', '2026-08-31'),
  ('setoran_x_pplg_2', 'kelas_x_pplg_2', '2026_2027', '2026-09-07'),
  ('setoran_xi_tjkt_1', 'kelas_xi_tjkt_1', '2026_2027', '2026-08-03'),
  ('setoran_xi_tjkt_1', 'kelas_xi_tjkt_1', '2026_2027', '2026-08-10'),
  ('setoran_xi_tjkt_1', 'kelas_xi_tjkt_1', '2026_2027', '2026-08-17'),
  ('setoran_xi_tjkt_1', 'kelas_xi_tjkt_1', '2026_2027', '2026-08-24'),
  ('setoran_xi_tjkt_1', 'kelas_xi_tjkt_1', '2026_2027', '2026-08-31'),
  ('setoran_xi_tjkt_1', 'kelas_xi_tjkt_1', '2026_2027', '2026-09-07'),
  ('setoran_x_dkv_2', 'kelas_x_dkv_2', '2026_2027', '2026-08-03'),
  ('setoran_x_dkv_2', 'kelas_x_dkv_2', '2026_2027', '2026-08-10'),
  ('setoran_x_dkv_2', 'kelas_x_dkv_2', '2026_2027', '2026-08-17'),
  ('setoran_x_dkv_2', 'kelas_x_dkv_2', '2026_2027', '2026-08-24'),
  ('setoran_x_dkv_2', 'kelas_x_dkv_2', '2026_2027', '2026-08-31'),
  ('setoran_x_dkv_2', 'kelas_x_dkv_2', '2026_2027', '2026-09-14'),
  ('setoran_xi_dkv_1', 'kelas_xi_dkv_1', '2026_2027', '2026-08-03'),
  ('setoran_xi_dkv_1', 'kelas_xi_dkv_1', '2026_2027', '2026-08-10'),
  ('setoran_xi_dkv_1', 'kelas_xi_dkv_1', '2026_2027', '2026-08-17'),
  ('setoran_xi_dkv_1', 'kelas_xi_dkv_1', '2026_2027', '2026-08-24'),
  ('setoran_xi_dkv_1', 'kelas_xi_dkv_1', '2026_2027', '2026-08-31'),
  ('setoran_xi_dkv_1', 'kelas_xi_dkv_1', '2026_2027', '2026-09-07'),
  ('setoran_xi_dkv_1', 'kelas_xi_dkv_1', '2026_2027', '2026-09-14'),
  ('setoran_xi_tjkt_2', 'kelas_xi_tjkt_2', '2026_2027', '2026-08-03'),
  ('setoran_xi_tjkt_2', 'kelas_xi_tjkt_2', '2026_2027', '2026-08-10'),
  ('setoran_xi_tjkt_2', 'kelas_xi_tjkt_2', '2026_2027', '2026-08-17'),
  ('setoran_xi_tjkt_2', 'kelas_xi_tjkt_2', '2026_2027', '2026-08-24'),
  ('setoran_xi_tjkt_2', 'kelas_xi_tjkt_2', '2026_2027', '2026-08-31'),
  ('setoran_xi_tjkt_2', 'kelas_xi_tjkt_2', '2026_2027', '2026-09-07'),
  ('setoran_xi_tjkt_2', 'kelas_xi_tjkt_2', '2026_2027', '2026-09-14'),
  ('setoran_xi_tjkt_2', 'kelas_xi_tjkt_2', '2026_2027', '2026-09-21'),
  ('VWF7UIbAaVaf78Q9U3gy', 'kelas_x_pplg_1', '2026_2027', '2026-09-07'),
  ('VWF7UIbAaVaf78Q9U3gy', 'kelas_x_pplg_1', '2026_2027', '2026-09-14'),
  ('VWF7UIbAaVaf78Q9U3gy', 'kelas_x_pplg_1', '2026_2027', '2026-09-21'),
  ('8hzAHzcmLq0MmARM1AGP', 'kelas_xi_animasi', '2026_2027', '2026-08-31'),
  ('8hzAHzcmLq0MmARM1AGP', 'kelas_xi_animasi', '2026_2027', '2026-09-07'),
  ('8hzAHzcmLq0MmARM1AGP', 'kelas_xi_animasi', '2026_2027', '2026-09-14'),
  ('8hzAHzcmLq0MmARM1AGP', 'kelas_xi_animasi', '2026_2027', '2026-09-21'),
  ('6afZPIJyzsJAVICtQHnV', 'kelas_xi_tjkt_2', '2026_2027', '2026-09-28'),
  ('6afZPIJyzsJAVICtQHnV', 'kelas_xi_tjkt_2', '2026_2027', '2026-10-05'),
  ('6afZPIJyzsJAVICtQHnV', 'kelas_xi_tjkt_2', '2026_2027', '2026-10-12'),
  ('6afZPIJyzsJAVICtQHnV', 'kelas_xi_tjkt_2', '2026_2027', '2026-10-19'),
  ('9Upo8ZlUdytmoE5jQTCY', 'kelas_xi_pplg_2', '2026_2027', '2026-08-31'),
  ('9Upo8ZlUdytmoE5jQTCY', 'kelas_xi_pplg_2', '2026_2027', '2026-09-07'),
  ('XKUiD9XIX0GTVWA0CGeB', 'kelas_x_tjkt_2', '2026_2027', '2026-08-31'),
  ('XKUiD9XIX0GTVWA0CGeB', 'kelas_x_tjkt_2', '2026_2027', '2026-09-07'),
  ('QHvYXNVm2RPb2VVbZq7R', 'kelas_x_tjkt_1', '2026_2027', '2026-09-07'),
  ('QHvYXNVm2RPb2VVbZq7R', 'kelas_x_tjkt_1', '2026_2027', '2026-09-14'),
  ('QHvYXNVm2RPb2VVbZq7R', 'kelas_x_tjkt_1', '2026_2027', '2026-09-21'),
  ('QHvYXNVm2RPb2VVbZq7R', 'kelas_x_tjkt_1', '2026_2027', '2026-09-28'),
  ('QHvYXNVm2RPb2VVbZq7R', 'kelas_x_tjkt_1', '2026_2027', '2026-10-05'),
  ('QHvYXNVm2RPb2VVbZq7R', 'kelas_x_tjkt_1', '2026_2027', '2026-10-12'),
  ('QHvYXNVm2RPb2VVbZq7R', 'kelas_x_tjkt_1', '2026_2027', '2026-10-19'),
  ('QHvYXNVm2RPb2VVbZq7R', 'kelas_x_tjkt_1', '2026_2027', '2026-10-26'),
  ('QHvYXNVm2RPb2VVbZq7R', 'kelas_x_tjkt_1', '2026_2027', '2026-11-02'),
  ('G3NJNR2q6rKkOrfT9PJ6', 'kelas_xi_tjkt_3', '2026_2027', '2026-09-07'),
  ('G3NJNR2q6rKkOrfT9PJ6', 'kelas_xi_tjkt_3', '2026_2027', '2026-09-14'),
  ('G3NJNR2q6rKkOrfT9PJ6', 'kelas_xi_tjkt_3', '2026_2027', '2026-09-21'),
  ('G3NJNR2q6rKkOrfT9PJ6', 'kelas_xi_tjkt_3', '2026_2027', '2026-09-28'),
  ('G3NJNR2q6rKkOrfT9PJ6', 'kelas_xi_tjkt_3', '2026_2027', '2026-10-05'),
  ('XUGwtRg4RtlAvTeDwnTJ', 'kelas_xi_pplg_1', '2026_2027', '2026-09-07'),
  ('XUGwtRg4RtlAvTeDwnTJ', 'kelas_xi_pplg_1', '2026_2027', '2026-09-14'),
  ('THd2bRlFCbirS497ndtf', 'kelas_x_dkv_1', '2026_2027', '2027-05-17'),
  ('v9uWhdyUPdXkWOwTGhnt', 'kelas_xi_dkv_2', '2026_2027', '2026-08-24'),
  ('v9uWhdyUPdXkWOwTGhnt', 'kelas_xi_dkv_2', '2026_2027', '2026-08-31'),
  ('v9uWhdyUPdXkWOwTGhnt', 'kelas_xi_dkv_2', '2026_2027', '2026-09-07'),
  ('v9uWhdyUPdXkWOwTGhnt', 'kelas_xi_dkv_2', '2026_2027', '2026-09-14'),
  ('v9uWhdyUPdXkWOwTGhnt', 'kelas_xi_dkv_2', '2026_2027', '2026-09-21'),
  ('v9uWhdyUPdXkWOwTGhnt', 'kelas_xi_dkv_2', '2026_2027', '2026-09-28'),
  ('v9uWhdyUPdXkWOwTGhnt', 'kelas_xi_dkv_2', '2026_2027', '2026-10-05'),
  ('v9uWhdyUPdXkWOwTGhnt', 'kelas_xi_dkv_2', '2026_2027', '2026-10-12'),
  ('v9uWhdyUPdXkWOwTGhnt', 'kelas_xi_dkv_2', '2026_2027', '2026-10-19'),
  ('v9uWhdyUPdXkWOwTGhnt', 'kelas_xi_dkv_2', '2026_2027', '2026-10-26'),
  ('v9uWhdyUPdXkWOwTGhnt', 'kelas_xi_dkv_2', '2026_2027', '2026-11-02'),
  ('v9uWhdyUPdXkWOwTGhnt', 'kelas_xi_dkv_2', '2026_2027', '2026-11-09'),
  ('v9uWhdyUPdXkWOwTGhnt', 'kelas_xi_dkv_2', '2026_2027', '2026-11-16'),
  ('LwssUC3wpyrWTCMDoq62', 'kelas_x_dkv_1', '2026_2027', '2026-09-14'),
  ('gpW53HrGyOf8b2iW2S2f', 'kelas_xi_pplg_1', '2026_2027', '2026-09-21'),
  ('gpW53HrGyOf8b2iW2S2f', 'kelas_xi_pplg_1', '2026_2027', '2026-09-28'),
  ('gzE0Tw9szQZmCVfDfUhb', 'kelas_x_dkv_2', '2026_2027', '2026-09-07'),
  ('gzE0Tw9szQZmCVfDfUhb', 'kelas_x_dkv_2', '2026_2027', '2026-09-21'),
  ('gzE0Tw9szQZmCVfDfUhb', 'kelas_x_dkv_2', '2026_2027', '2026-09-28'),
  ('gzE0Tw9szQZmCVfDfUhb', 'kelas_x_dkv_2', '2026_2027', '2026-10-05'),
  ('gzE0Tw9szQZmCVfDfUhb', 'kelas_x_dkv_2', '2026_2027', '2026-10-12');

INSERT INTO `transaksi` (`id`, `jenis`, `tanggal`, `keterangan`, `nominal`, `kategori`, `setoran_id`, `tahun_ajaran_id`, `dibuat_pada`) VALUES
  ('tx_1', 'pemasukan', '2026-07-20', 'Modal awal', 1000000, 'Modal', NULL, '2026_2027', '2026-07-20 08:00:00'),
  ('tx_2', 'pemasukan', '2026-08-08', 'Uang kas minggu', 412000, 'Kas Mingguan (rekap lama)', NULL, '2026_2027', '2026-08-08 08:00:00'),
  ('tx_3', 'pengeluaran', '2026-08-08', 'Hadiah lomba senam 17 an', 497000, 'Hadiah & Lomba', NULL, '2026_2027', '2026-08-08 09:00:00'),
  ('tx_4', 'pengeluaran', '2026-08-11', '2 spanduk kurang dari uang futsal', 40000, 'Perlengkapan', NULL, '2026_2027', '2026-08-11 08:00:00'),
  ('tx_5', 'pengeluaran', '2026-08-12', 'Konsumsi', 230000, 'Konsumsi', NULL, '2026_2027', '2026-08-12 08:00:00'),
  ('tx_6', 'pengeluaran', '2026-08-12', 'Kue buat juri', 37000, 'Konsumsi', NULL, '2026_2027', '2026-08-12 08:30:00'),
  ('tx_7', 'pengeluaran', '2026-08-12', 'Batrai mic', 16000, 'Perlengkapan', NULL, '2026_2027', '2026-08-12 09:00:00'),
  ('tx_8', 'pengeluaran', '2026-08-12', 'Minum Cleo 1 pack', 23000, 'Konsumsi', NULL, '2026_2027', '2026-08-12 09:30:00'),
  ('tx_9', 'pengeluaran', '2026-08-12', 'Kotakan 1 pack isi 100', 45000, 'Perlengkapan', NULL, '2026_2027', '2026-08-12 10:00:00'),
  ('tx_10', 'pengeluaran', '2026-08-13', 'Konsumsi minum makan wasit', 66000, 'Konsumsi', NULL, '2026_2027', '2026-08-13 08:00:00'),
  ('tx_11', 'pengeluaran', '2026-08-13', 'Konsumsi minum PMR dan OSIS', 40000, 'Konsumsi', NULL, '2026_2027', '2026-08-13 08:30:00'),
  ('tx_12', 'pengeluaran', '2026-08-13', 'Bungkus hadiah lomba YEL', 45000, 'Hadiah & Lomba', NULL, '2026_2027', '2026-08-13 09:00:00'),
  ('tx_13', 'pengeluaran', '2026-08-13', 'Matrai 10 rb', 12000, 'Perlengkapan', NULL, '2026_2027', '2026-08-13 09:30:00'),
  ('tx_14', 'pemasukan', '2026-08-14', 'Modal tambahan', 600000, 'Modal', NULL, '2026_2027', '2026-08-14 08:00:00'),
  ('tx_15', 'pengeluaran', '2026-08-14', 'Konsumsi panitia', 238000, 'Konsumsi', NULL, '2026_2027', '2026-08-14 08:30:00'),
  ('tx_16', 'pengeluaran', '2026-08-14', 'Kue juri', 15000, 'Konsumsi', NULL, '2026_2027', '2026-08-14 09:00:00'),
  ('tx_17', 'pengeluaran', '2026-08-14', 'Minum Cleo 1 pack', 26000, 'Konsumsi', NULL, '2026_2027', '2026-08-14 09:30:00'),
  ('tx_18', 'pengeluaran', '2026-08-14', 'Konsumsi makan minum wasit', 44000, 'Konsumsi', NULL, '2026_2027', '2026-08-14 10:00:00'),
  ('tx_19', 'pengeluaran', '2026-08-14', 'Totebag lomba nyanyi', 44000, 'Hadiah & Lomba', NULL, '2026_2027', '2026-08-14 10:30:00'),
  ('tx_20', 'pengeluaran', '2026-08-14', 'Konsumsi minum PMR dan OSIS', 40000, 'Konsumsi', NULL, '2026_2027', '2026-08-14 11:00:00'),
  ('tx_21', 'pengeluaran', '2026-08-14', 'Bungkus kado senam', 8000, 'Hadiah & Lomba', NULL, '2026_2027', '2026-08-14 11:30:00'),
  ('tx_22', 'pengeluaran', '2026-08-16', 'Konsumsi panitia', 204000, 'Konsumsi', NULL, '2026_2027', '2026-08-16 08:00:00'),
  ('tx_23', 'pengeluaran', '2026-08-16', 'Konsumsi makan minum wasit', 62000, 'Konsumsi', NULL, '2026_2027', '2026-08-16 08:30:00'),
  ('tx_24', 'pengeluaran', '2026-08-16', 'Konsumsi minum OSIS PMR', 40000, 'Konsumsi', NULL, '2026_2027', '2026-08-16 09:00:00'),
  ('tx_25', 'pengeluaran', '2026-08-16', 'Hadiah top score futsal', 150000, 'Hadiah & Lomba', NULL, '2026_2027', '2026-08-16 09:30:00'),
  ('tx_26', 'pemasukan', '2026-08-16', 'Uang pelanggaran', 30000, 'Uang Pelanggaran', NULL, '2026_2027', '2026-08-16 10:00:00'),
  ('tx_27', 'pemasukan', '2026-09-02', 'Uang kas minggu', 814000, 'Kas Mingguan (rekap lama)', NULL, '2026_2027', '2026-09-02 08:00:00'),
  ('tx_28', 'pemasukan', '2026-09-14', 'Uang kas minggu', 738000, 'Kas Mingguan (rekap lama)', NULL, '2026_2027', '2026-09-14 08:00:00'),
  ('tx_29', 'pemasukan', '2026-09-16', 'Uang kas minggu', 731000, 'Kas Mingguan (rekap lama)', NULL, '2026_2027', '2026-09-16 08:00:00'),
  ('tx_30', 'pemasukan', '2026-09-26', 'Uang kas minggu', 170000, 'Kas Mingguan (rekap lama)', NULL, '2026_2027', '2026-09-26 08:00:00'),
  ('tx_31', 'pengeluaran', '2026-10-18', 'Kebutuhan batrai mic 8', 28000, 'Perlengkapan', NULL, '2026_2027', '2026-10-18 08:00:00'),
  ('gy8dFCP9eeOxQGBOw6rs', 'pemasukan', '2026-11-09', 'Kas mingguan - X PPLG 1 (minggu 7 Sep s/d 21 Sep 2026, 3 minggu)', 102000, 'Kas Mingguan', 'VWF7UIbAaVaf78Q9U3gy', '2026_2027', '2026-11-09 12:31:32'),
  ('ZrUHBIGq5fUtPV13wNpG', 'pemasukan', '2026-11-09', 'Kas mingguan - XI ANIMASI (minggu 31 Agu s/d 21 Sep 2026, 4 minggu)', 116000, 'Kas Mingguan', '8hzAHzcmLq0MmARM1AGP', '2026_2027', '2026-11-09 12:38:03'),
  ('kEaT1Jg0vWal2y3cU6E3', 'pengeluaran', '2026-11-10', 'membeli batrai', 34500, 'Perlengkapan', NULL, '2026_2027', '2026-11-10 00:59:23'),
  ('Ov7ZUD2I0s2UQXQwHNNz', 'pemasukan', '2026-11-13', 'Kas mingguan - XI TJKT 2 (minggu 28 Sep s/d 19 Okt 2026, 4 minggu)', 128000, 'Kas Mingguan', '6afZPIJyzsJAVICtQHnV', '2026_2027', '2026-11-13 02:12:41'),
  ('K5mbwX5sTmRij12rkLfo', 'pemasukan', '2026-11-13', 'Kas mingguan - XI PPLG 2 (minggu 31 Agu s/d 7 Sep 2026, 2 minggu)', 70000, 'Kas Mingguan', '9Upo8ZlUdytmoE5jQTCY', '2026_2027', '2026-11-13 07:01:53'),
  ('xZT7mereWp8zqDux4jOV', 'pemasukan', '2026-11-13', 'Kas mingguan - X TJKT 2 (minggu 31 Agu s/d 7 Sep 2026, 2 minggu)', 68000, 'Kas Mingguan', 'XKUiD9XIX0GTVWA0CGeB', '2026_2027', '2026-11-13 07:06:10'),
  ('9F5ReYj0mTmEKYjjC0UQ', 'pemasukan', '2026-11-17', 'Kas mingguan - X TJKT 1 (minggu 7 Sep s/d 2 Nov 2026, 9 minggu)', 306000, 'Kas Mingguan', 'QHvYXNVm2RPb2VVbZq7R', '2026_2027', '2026-11-17 04:26:07'),
  ('qlEFyHSF9awK20WvlUMP', 'pemasukan', '2026-11-17', 'Kas mingguan - XI TJKT 3 (minggu 7 Sep s/d 5 Okt 2026, 5 minggu)', 175000, 'Kas Mingguan', 'G3NJNR2q6rKkOrfT9PJ6', '2026_2027', '2026-11-17 04:57:28'),
  ('YNBhixexQmnp1vbvzfoZ', 'pemasukan', '2026-11-17', 'Kas mingguan - XI PPLG 1 (minggu 7 Sep s/d 14 Sep 2026, 2 minggu)', 68000, 'Kas Mingguan', 'XUGwtRg4RtlAvTeDwnTJ', '2026_2027', '2026-11-17 11:15:47'),
  ('awHfAgL3zlQ6tXIoZhGs', 'pemasukan', '2026-11-18', 'Kas mingguan - X DKV 1 (minggu 17 Mei 2027, 1 minggu)', 36000, 'Kas Mingguan', 'THd2bRlFCbirS497ndtf', '2026_2027', '2026-11-18 04:26:03'),
  ('EKluBSt16HJTZp5qeZFL', 'pemasukan', '2026-11-18', 'Kas mingguan - XI DKV 2 (minggu 24 Agu s/d 16 Nov 2026, 13 minggu)', 403000, 'Kas Mingguan', 'v9uWhdyUPdXkWOwTGhnt', '2026_2027', '2026-11-18 04:40:32'),
  ('irhgsHJGYsKkIaPidmz4', 'pemasukan', '2026-11-18', 'lebihan 2rb', 2000, 'Lainnya', NULL, '2026_2027', '2026-11-18 04:41:18'),
  ('QJ0U0R8cBseZFzAysIp1', 'pemasukan', '2026-11-19', 'Kas mingguan - X DKV 1 (minggu 14 Sep 2026, 1 minggu)', 36000, 'Kas Mingguan', 'LwssUC3wpyrWTCMDoq62', '2026_2027', '2026-11-19 14:34:52'),
  ('rcBKN6u4ALWmN71Ck0Pd', 'pemasukan', '2026-11-23', 'Kas mingguan - XI PPLG 1 (minggu 21 Sep s/d 28 Sep 2026, 2 minggu)', 68000, 'Kas Mingguan', 'gpW53HrGyOf8b2iW2S2f', '2026_2027', '2026-11-23 07:32:53'),
  ('EFkETHc8hznKIglWFTDi', 'pemasukan', '2026-11-26', 'Kas mingguan - X DKV 2 (minggu 7 Sep s/d 12 Okt 2026, 5 minggu)', 175000, 'Kas Mingguan', 'gzE0Tw9szQZmCVfDfUhb', '2026_2027', '2026-11-26 00:50:19');

INSERT INTO `riwayat` (`id`, `waktu`, `aksi`, `jenis_data`, `ringkasan`, `nilai_lama`, `nilai_baru`, `alasan`, `actor_role`) VALUES
  ('K8mtxtqYsFTre2GIbFrN', '2026-11-09 12:31:33', 'tambah', 'setoran', 'Setoran kas X PPLG 1 (3 minggu: minggu 7 Sep s/d 21 Sep 2026, 3 minggu) senilai Rp102.000', '', '{\"total\":102000,\"daftarMinggu\":[\"2026-09-07\",\"2026-09-14\",\"2026-09-21\"],\"tanggalSetor\":\"2026-11-09\"}', 'Pencatatan kas mingguan', 'Bendahara OSIS'),
  ('wP3kWFe8vMFXZ62ub82m', '2026-11-09 12:38:04', 'tambah', 'setoran', 'Setoran kas XI ANIMASI (4 minggu: minggu 31 Agu s/d 21 Sep 2026, 4 minggu) senilai Rp116.000', '', '{\"total\":116000,\"daftarMinggu\":[\"2026-08-31\",\"2026-09-07\",\"2026-09-14\",\"2026-09-21\"],\"tanggalSetor\":\"2026-11-09\"}', 'Pencatatan kas mingguan', 'Bendahara OSIS'),
  ('LiXJo08gOEZ8AKVKRfgg', '2026-11-10 00:59:24', 'tambah', 'transaksi', 'Tambah transaksi PENGELUARAN: membeli batrai (Rp34.500) [Kategori: Perlengkapan]', '', '{\"jenis\":\"pengeluaran\",\"tanggal\":\"2026-11-10\",\"keterangan\":\"membeli batrai\",\"nominal\":34500,\"kategori\":\"Perlengkapan\",\"tahunAjaranId\":\"2026_2027\"}', 'upacara', 'Bendahara OSIS'),
  ('2LhQCceJbODJO2xS33Ob', '2026-11-10 05:08:18', 'ubah', 'kelas', 'Ubah jumlah siswa XI TJKT 3 dari 35 menjadi 60 siswa', '35 siswa', '60 siswa', 'siswanya membludak', 'Bendahara OSIS'),
  ('qqNabe5dxFdcBqjd9iMg', '2026-11-10 05:09:28', 'ubah', 'kelas', 'Ubah jumlah siswa XI TJKT 3 dari 60 menjadi 35 siswa', '60 siswa', '35 siswa', 'yang benernya', 'Bendahara OSIS'),
  ('W9GTPkOQfm3FFitYJ4yP', '2026-11-13 02:12:42', 'tambah', 'setoran', 'Setoran kas XI TJKT 2 (4 minggu: minggu 28 Sep s/d 19 Okt 2026, 4 minggu) senilai Rp128.000', '', '{\"total\":128000,\"daftarMinggu\":[\"2026-09-28\",\"2026-10-05\",\"2026-10-12\",\"2026-10-19\"],\"tanggalSetor\":\"2026-11-13\"}', 'Pencatatan kas mingguan', 'Bendahara OSIS'),
  ('CpsRosHScPPqyLxMmkP7', '2026-11-13 07:01:55', 'tambah', 'setoran', 'Setoran kas XI PPLG 2 (2 minggu: minggu 31 Agu s/d 7 Sep 2026, 2 minggu) senilai Rp70.000', '', '{\"total\":70000,\"daftarMinggu\":[\"2026-08-31\",\"2026-09-07\"],\"tanggalSetor\":\"2026-11-13\"}', 'Pencatatan kas mingguan', 'Bendahara OSIS'),
  ('HpYO8DcFdsuzaR6whdmk', '2026-11-13 07:06:11', 'tambah', 'setoran', 'Setoran kas X TJKT 2 (2 minggu: minggu 31 Agu s/d 7 Sep 2026, 2 minggu) senilai Rp68.000', '', '{\"total\":68000,\"daftarMinggu\":[\"2026-08-31\",\"2026-09-07\"],\"tanggalSetor\":\"2026-11-13\"}', 'Pencatatan kas mingguan', 'Bendahara OSIS'),
  ('BOypW7AT8W9LFINgOUR9', '2026-11-16 08:50:19', 'ubah', 'kelas', 'Ubah jumlah siswa X TJKT 1 dari 35 menjadi 34 siswa', '35 siswa', '34 siswa', 'keluar 1 murid', 'Bendahara OSIS'),
  ('a7Kam9ih6HNp6Ny7R9IY', '2026-11-17 04:26:09', 'tambah', 'setoran', 'Setoran kas X TJKT 1 (9 minggu: minggu 7 Sep s/d 2 Nov 2026, 9 minggu) senilai Rp306.000', '', '{\"total\":306000,\"daftarMinggu\":[\"2026-09-07\",\"2026-09-14\",\"2026-09-21\",\"2026-09-28\",\"2026-10-05\",\"2026-10-12\",\"2026-10-19\",\"2026-10-26\",\"2026-11-02\"],\"tanggalSetor\":\"2026-11-17\"}', 'Pencatatan kas mingguan', 'Bendahara OSIS'),
  ('fJ8GuvclS28VLZv2AI3J', '2026-11-17 04:57:29', 'tambah', 'setoran', 'Setoran kas XI TJKT 3 (5 minggu: minggu 7 Sep s/d 5 Okt 2026, 5 minggu) senilai Rp175.000', '', '{\"total\":175000,\"daftarMinggu\":[\"2026-09-07\",\"2026-09-14\",\"2026-09-21\",\"2026-09-28\",\"2026-10-05\"],\"tanggalSetor\":\"2026-11-17\"}', 'Pencatatan kas mingguan', 'Bendahara OSIS'),
  ('fuiJCOReR0yRfhB23pp2', '2026-11-17 11:15:48', 'tambah', 'setoran', 'Setoran kas XI PPLG 1 (2 minggu: minggu 7 Sep s/d 14 Sep 2026, 2 minggu) senilai Rp68.000', '', '{\"total\":68000,\"daftarMinggu\":[\"2026-09-07\",\"2026-09-14\"],\"tanggalSetor\":\"2026-11-17\"}', 'Pencatatan kas mingguan', 'Bendahara OSIS'),
  ('1N8PTzAmS6aMmtc8V8iq', '2026-11-18 04:26:04', 'tambah', 'setoran', 'Setoran kas X DKV 1 (1 minggu: minggu 17 Mei 2027, 1 minggu) senilai Rp36.000', '', '{\"total\":36000,\"daftarMinggu\":[\"2027-05-17\"],\"tanggalSetor\":\"2026-11-18\"}', 'Pencatatan kas mingguan', 'Bendahara OSIS'),
  ('i6Lri8rZdPIf6Y14IIi9', '2026-11-18 04:40:35', 'tambah', 'setoran', 'Setoran kas XI DKV 2 (13 minggu: minggu 24 Agu s/d 16 Nov 2026, 13 minggu) senilai Rp403.000', '', '{\"total\":403000,\"daftarMinggu\":[\"2026-08-24\",\"2026-08-31\",\"2026-09-07\",\"2026-09-14\",\"2026-09-21\",\"2026-09-28\",\"2026-10-05\",\"2026-10-12\",\"2026-10-19\",\"2026-10-26\",\"2026-11-02\",\"2026-11-09\",\"2026-11-16\"],\"tanggalSetor\":\"2026-11-18\"}', 'Pencatatan kas mingguan', 'Bendahara OSIS'),
  ('QPxetcSf4GmBegUfUWAV', '2026-11-18 04:41:20', 'tambah', 'transaksi', 'Tambah transaksi PEMASUKAN: lebihan 2rb (Rp2.000) [Kategori: Lainnya]', '', '{\"jenis\":\"pemasukan\",\"tanggal\":\"2026-11-18\",\"keterangan\":\"lebihan 2rb\",\"nominal\":2000,\"kategori\":\"Lainnya\",\"tahunAjaranId\":\"2026_2027\"}', 'Pencatatan pemasukan', 'Bendahara OSIS'),
  ('sbRJipODD51K07edQ05I', '2026-11-19 14:34:54', 'tambah', 'setoran', 'Setoran kas X DKV 1 (1 minggu: minggu 14 Sep 2026, 1 minggu) senilai Rp36.000', '', '{\"total\":36000,\"daftarMinggu\":[\"2026-09-14\"],\"tanggalSetor\":\"2026-11-19\"}', 'Pencatatan kas mingguan', 'Bendahara OSIS'),
  ('wNdogrtk9YB1WQBNA4Lf', '2026-11-23 07:32:54', 'tambah', 'setoran', 'Setoran kas XI PPLG 1 (2 minggu: minggu 21 Sep s/d 28 Sep 2026, 2 minggu) senilai Rp68.000', '', '{\"total\":68000,\"daftarMinggu\":[\"2026-09-21\",\"2026-09-28\"],\"tanggalSetor\":\"2026-11-23\"}', 'Pencatatan kas mingguan', 'Bendahara OSIS'),
  ('bBPskGwVRBjHQKCPHBit', '2026-11-26 00:50:20', 'tambah', 'setoran', 'Setoran kas X DKV 2 (5 minggu: minggu 7 Sep s/d 12 Okt 2026, 5 minggu) senilai Rp175.000', '', '{\"total\":175000,\"daftarMinggu\":[\"2026-09-07\",\"2026-09-21\",\"2026-09-28\",\"2026-10-05\",\"2026-10-12\"],\"tanggalSetor\":\"2026-11-26\"}', 'Pencatatan kas mingguan', 'Bendahara OSIS');

-- View Verifikasi Ringkasan Saldo
CREATE OR REPLACE VIEW `v_ringkasan_kas` AS
SELECT
  tahun_ajaran_id,
  SUM(CASE WHEN jenis = 'pemasukan' THEN nominal ELSE 0 END) AS total_pemasukan,
  SUM(CASE WHEN jenis = 'pengeluaran' THEN nominal ELSE 0 END) AS total_pengeluaran,
  SUM(CASE WHEN jenis = 'pemasukan' THEN nominal ELSE -nominal END) AS saldo_sekarang,
  COUNT(*) AS jumlah_transaksi
FROM `transaksi`
GROUP BY tahun_ajaran_id;

SET FOREIGN_KEY_CHECKS = 1;
-- Selesai: Verifikasi cepat jalankan -> SELECT * FROM v_ringkasan_kas;