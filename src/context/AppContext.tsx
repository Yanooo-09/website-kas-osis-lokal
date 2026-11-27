import React, { createContext, useContext, useState, useEffect, useMemo, useCallback, ReactNode } from 'react';
import {
  Kelas,
  Pengaturan,
  RiwayatLog,
  Setoran,
  TahunAjaran,
  Transaksi,
  WeekInfo,
  TabType
} from '../types';
import { DEFAULT_PENGATURAN, DEFAULT_TAHUN_AJARAN } from '../data/seedData';
import { generateMingguTahunAjaran, getSeninMingguIni } from '../utils/dateAndMoney';
import { sanitizeText, isValidYYYYMMDD, isValidPositiveInt } from '../utils/sanitize';

const USERNAME_REGEX = /^[a-zA-Z0-9_.-]{3,50}$/;

interface AuthResult {
  success: boolean;
  message?: string;
}

interface DataPayload {
  pengaturan: Pengaturan | null;
  tahunAjaranList: TahunAjaran[];
  kelasList: Kelas[];
  setoranList: Setoran[];
  transaksiList: Transaksi[];
  riwayatList: RiwayatLog[];
}

interface AppContextType {
  // Auth state
  isAdmin: boolean;
  isViewerAuthenticated: boolean;
  isAuthLoading: boolean;
  activeTab: TabType;
  setActiveTab: (tab: TabType) => void;
  selectedTahunAjaranId: string;
  setSelectedTahunAjaranId: (id: string) => void;

  // Data state
  pengaturan: Pengaturan;
  tahunAjaranList: TahunAjaran[];
  kelasList: Kelas[];
  setoranList: Setoran[];
  transaksiList: Transaksi[];
  riwayatList: RiwayatLog[];
  allWeeks: WeekInfo[];
  currentMonday: string;
  isDataLoading: boolean;
  dbError: string | null;

  // Derived financial state
  saldoSekarang: number;
  totalPemasukan: number;
  totalPengeluaran: number;

  // Auth methods & state
  showAdminLoginModal: boolean;
  setShowAdminLoginModal: (show: boolean) => void;
  loginAdminWithCredentials: (username: string, password: string) => Promise<AuthResult>;
  setupInitialAdminAccount: (username: string, password: string) => Promise<AuthResult>;
  loginViewerWithCode: (code: string) => Promise<AuthResult>;
  logout: () => Promise<void>;

  // Data actions (Admin only)
  tambahSetoran: (
    kelasId: string,
    daftarMinggu: string[],
    tanggalSetor: string,
    alasan: string
  ) => Promise<void>;
  ubahSetoran: (
    setoranId: string,
    daftarMingguBaru: string[],
    tanggalSetorBaru: string,
    alasan: string
  ) => Promise<void>;
  hapusSetoran: (setoranId: string, alasan: string) => Promise<void>;

  tambahTransaksi: (
    data: Omit<Transaksi, 'id' | 'dibuatPada'>,
    alasan: string
  ) => Promise<void>;
  ubahTransaksi: (
    transaksiId: string,
    data: Partial<Omit<Transaksi, 'id' | 'dibuatPada'>>,
    alasan: string
  ) => Promise<void>;
  hapusTransaksi: (transaksiId: string, alasan: string) => Promise<void>;

  ubahJumlahSiswaKelas: (
    kelasId: string,
    jumlahSiswaBaru: number,
    alasan: string
  ) => Promise<void>;
  ubahNamaKelas: (
    kelasId: string,
    namaBaru: string,
    alasan: string
  ) => Promise<void>;

  simpanPengaturan: (
    data: Partial<Pengaturan>,
    alasan: string
  ) => Promise<void>;
  ubahPasscodeViewer: (
    passcodeBaru: string,
    alasan: string
  ) => Promise<void>;
  ubahKredensialAdmin: (
    usernameBaru: string,
    passwordSaatIni: string,
    passwordBaru: string,
    alasan: string
  ) => Promise<void>;
  buatTahunAjaranBaru: (
    label: string,
    tanggalMulai: string,
    tanggalAkhir: string,
    bawaModalAwal: boolean,
    alasan: string
  ) => Promise<void>;

  muatDataAwalExcel: () => Promise<void>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

async function parseJsonSafe<T>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export const AppProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  // Auth token kept strictly in React memory (never persisted to localStorage/sessionStorage)
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState<boolean>(true);
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const [isViewerAuthenticated, setIsViewerAuthenticated] = useState<boolean>(false);
  const [showAdminLoginModal, setShowAdminLoginModal] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<TabType>('RINGKASAN');

  // Local SQLite backend entities state (empty until authenticated)
  const [pengaturan, setPengaturan] = useState<Pengaturan>(DEFAULT_PENGATURAN);
  const [tahunAjaranList, setTahunAjaranList] = useState<TahunAjaran[]>([DEFAULT_TAHUN_AJARAN]);
  const [selectedTahunAjaranId, setSelectedTahunAjaranId] = useState<string>('2026_2027');
  const [kelasList, setKelasList] = useState<Kelas[]>([]);
  const [setoranList, setSetoranList] = useState<Setoran[]>([]);
  const [transaksiList, setTransaksiList] = useState<Transaksi[]>([]);
  const [riwayatList, setRiwayatList] = useState<RiwayatLog[]>([]);
  const [isDataLoading, setIsDataLoading] = useState<boolean>(false);
  const [dbError, setDbError] = useState<string | null>(null);

  const loadPublicConfig = useCallback(async () => {
    try {
      const res = await fetch('/api/config/public', { cache: 'no-store' });
      const data = await parseJsonSafe<{
        dbReady?: boolean;
        dbError?: string;
        namaSekolah?: string;
        namaBendahara?: string;
        tahunAjaranAktifId?: string;
        adminUsername?: string;
        adminConfigured?: boolean;
      }>(res);
      if (data) {
        if (data.dbReady === false) {
          setDbError(
            data.dbError ||
              'Database MySQL belum terhubung atau belum di-import dari database/kas_osis_smkn7_samarinda.sql.'
          );
        } else if (res.ok) {
          setDbError(null);
        }
        setPengaturan((prev) => ({
          ...prev,
          namaSekolah: sanitizeText(data.namaSekolah, 100) || prev.namaSekolah,
          namaBendahara: sanitizeText(data.namaBendahara, 100) || prev.namaBendahara,
          tahunAjaranAktifId: sanitizeText(data.tahunAjaranAktifId, 50) || prev.tahunAjaranAktifId,
          adminUsername: sanitizeText(data.adminUsername, 50) || prev.adminUsername || 'alkiyano',
          adminConfigured: Boolean(data.adminConfigured)
        }));
        if (data.tahunAjaranAktifId) {
          setSelectedTahunAjaranId((prev) => prev || sanitizeText(data.tahunAjaranAktifId, 50));
        }
      }
    } catch {
      // Ignore if temporarily offline
    }
  }, []);

  // Purge any legacy client-side flags on boot and load non-sensitive public config
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('kas_osis_admin_auth');
      localStorage.removeItem('kas_osis_viewer_auth');
    }
    loadPublicConfig().finally(() => {
      setIsAuthLoading(false);
    });
  }, [loadPublicConfig]);

  const clearSessionState = useCallback(() => {
    setAuthToken(null);
    setIsAdmin(false);
    setIsViewerAuthenticated(false);
    setKelasList([]);
    setSetoranList([]);
    setTransaksiList([]);
    setRiwayatList([]);
  }, []);

  const refreshData = useCallback(
    async (tokenOverride?: string | null) => {
      const token = tokenOverride ?? authToken;
      if (!token) return;

      setIsDataLoading(true);
      try {
        const res = await fetch('/api/data', {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store'
        });

        if (res.status === 401 || res.status === 403) {
          clearSessionState();
          throw new Error('Sesi berakhir. Silakan login kembali.');
        }

        const payload = await parseJsonSafe<DataPayload & { message?: string }>(res);
        if (!res.ok || !payload) {
          throw new Error(payload?.message || 'Gagal memuat data kas OSIS.');
        }

        if (payload.pengaturan) {
          setPengaturan(payload.pengaturan);
          if (payload.pengaturan.tahunAjaranAktifId) {
            setSelectedTahunAjaranId((prev) => prev || payload.pengaturan!.tahunAjaranAktifId);
          }
        }
        if (Array.isArray(payload.tahunAjaranList) && payload.tahunAjaranList.length > 0) {
          setTahunAjaranList(payload.tahunAjaranList);
        }
        setKelasList(Array.isArray(payload.kelasList) ? payload.kelasList : []);
        setSetoranList(Array.isArray(payload.setoranList) ? payload.setoranList : []);
        setTransaksiList(Array.isArray(payload.transaksiList) ? payload.transaksiList : []);
        setRiwayatList(Array.isArray(payload.riwayatList) ? payload.riwayatList : []);
      } finally {
        setIsDataLoading(false);
      }
    },
    [authToken, clearSessionState]
  );

  const apiMutate = useCallback(
    async <T,>(
      url: string,
      method: 'POST' | 'PUT' | 'DELETE',
      body?: Record<string, unknown>,
      tokenOverride?: string | null
    ): Promise<T> => {
      const token = tokenOverride ?? authToken;
      if (!isAdmin || !token) {
        throw new Error('Akses ditolak: Silakan masuk sebagai Admin terlebih dahulu.');
      }

      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: body !== undefined ? JSON.stringify(body) : undefined
      });

      const data = await parseJsonSafe<T & { message?: string }>(res);
      if (res.status === 401 || res.status === 403) {
        if (res.status === 401) {
          clearSessionState();
        }
        throw new Error(data?.message || 'Sesi Admin tidak valid atau telah berakhir.');
      }
      if (!res.ok) {
        throw new Error(data?.message || 'Operasi gagal diproses oleh server.');
      }
      return (data || ({} as T)) as T;
    },
    [authToken, isAdmin, clearSessionState]
  );

  // Current date & monday calculation
  const currentMonday = useMemo(() => getSeninMingguIni(), []);

  // Selected academic year
  const selectedTahunAjaran = useMemo(() => {
    return (
      tahunAjaranList.find((t) => t.id === selectedTahunAjaranId) ||
      DEFAULT_TAHUN_AJARAN
    );
  }, [tahunAjaranList, selectedTahunAjaranId]);

  // All weeks in selected academic year
  const allWeeks = useMemo(() => {
    return generateMingguTahunAjaran(
      selectedTahunAjaran.tanggalMulai,
      selectedTahunAjaran.tanggalAkhir
    );
  }, [selectedTahunAjaran]);

  // Financial summary: Calculated across ALL transactions in the selected academic year
  const { totalPemasukan, totalPengeluaran, saldoSekarang } = useMemo(() => {
    let masuk = 0;
    let keluar = 0;
    transaksiList.forEach((t) => {
      if (t.tahunAjaranId === selectedTahunAjaranId) {
        const nom = Number(t.nominal);
        if (!Number.isFinite(nom) || nom <= 0) return;
        if (t.jenis === 'pemasukan') masuk += nom;
        else if (t.jenis === 'pengeluaran') keluar += nom;
      }
    });
    return {
      totalPemasukan: masuk,
      totalPengeluaran: keluar,
      saldoSekarang: masuk - keluar
    };
  }, [transaksiList, selectedTahunAjaranId]);

  // Admin Login via Username & Password (server scrypt verification + signed Bearer token)
  const loginAdminWithCredentials = async (
    username: string,
    password: string
  ): Promise<AuthResult> => {
    const cleanUsername = sanitizeText(username, 50);
    if (!cleanUsername || !password) {
      return { success: false, message: 'Masukkan username dan password admin.' };
    }

    try {
      const res = await fetch('/api/auth/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: cleanUsername, password })
      });
      const data = await parseJsonSafe<{
        success?: boolean;
        token?: string;
        username?: string;
        message?: string;
      }>(res);

      if (!res.ok || !data?.success || !data.token) {
        return {
          success: false,
          message: data?.message || 'Username atau password admin salah.'
        };
      }

      setAuthToken(data.token);
      setIsAdmin(true);
      setIsViewerAuthenticated(true);
      setShowAdminLoginModal(false);
      setActiveTab('ADMIN');
      await refreshData(data.token);
      return { success: true };
    } catch {
      return {
        success: false,
        message: 'Tidak dapat terhubung ke server untuk verifikasi login.'
      };
    }
  };

  // First-run one-time Admin account claim (locks on server after first setup)
  const setupInitialAdminAccount = async (
    username: string,
    password: string
  ): Promise<AuthResult> => {
    const cleanUsername = sanitizeText(username, 50);
    if (!USERNAME_REGEX.test(cleanUsername)) {
      return {
        success: false,
        message: 'Username harus 3–50 karakter (huruf, angka, titik, garis bawah, atau tanda hubung).'
      };
    }
    if (!password || password.length < 8 || password.length > 128) {
      return {
        success: false,
        message: 'Password admin minimal 8 karakter.'
      };
    }

    try {
      const res = await fetch('/api/auth/admin/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: cleanUsername, password })
      });
      const data = await parseJsonSafe<{
        success?: boolean;
        token?: string;
        username?: string;
        message?: string;
      }>(res);

      if (!res.ok || !data?.success || !data.token) {
        await loadPublicConfig();
        return {
          success: false,
          message: data?.message || 'Gagal mengaktifkan akun Admin.'
        };
      }

      setAuthToken(data.token);
      setIsAdmin(true);
      setIsViewerAuthenticated(true);
      setShowAdminLoginModal(false);
      setActiveTab('ADMIN');
      await refreshData(data.token);
      return { success: true };
    } catch {
      return {
        success: false,
        message: 'Gagal menghubungi server saat aktivasi akun Admin.'
      };
    }
  };

  // Shared Passcode verification for Bendahara Kelas (Viewer)
  const loginViewerWithCode = async (code: string): Promise<AuthResult> => {
    const cleanCode = sanitizeText(code, 100);
    if (!cleanCode) {
      return { success: false, message: 'Masukkan kode akses terlebih dahulu.' };
    }

    try {
      const res = await fetch('/api/auth/viewer/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: cleanCode })
      });
      const data = await parseJsonSafe<{
        success?: boolean;
        token?: string;
        message?: string;
      }>(res);

      if (!res.ok || !data?.success || !data.token) {
        return {
          success: false,
          message: data?.message || 'Kode akses salah. Silakan tanyakan kepada Bendahara OSIS.'
        };
      }

      setAuthToken(data.token);
      setIsAdmin(false);
      setIsViewerAuthenticated(true);
      await refreshData(data.token);
      return { success: true };
    } catch {
      return {
        success: false,
        message: 'Terjadi gangguan saat memverifikasi kode akses ke server.'
      };
    }
  };

  const logout = async () => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('kas_osis_admin_auth');
      localStorage.removeItem('kas_osis_viewer_auth');
    }
    clearSessionState();
    setShowAdminLoginModal(false);
    setActiveTab('KAS_MINGGUAN');
    await loadPublicConfig();
  };

  // 1. TAMBAH SETORAN
  const tambahSetoran = async (
    kelasId: string,
    daftarMinggu: string[],
    tanggalSetor: string,
    alasan: string
  ) => {
    if (!daftarMinggu || daftarMinggu.length === 0 || daftarMinggu.length > 60) {
      throw new Error('Pilih antara 1 hingga 60 minggu untuk disetor.');
    }
    const cleanTanggal = sanitizeText(tanggalSetor, 10);
    if (!isValidYYYYMMDD(cleanTanggal)) {
      throw new Error('Format tanggal setor tidak valid (YYYY-MM-DD).');
    }

    await apiMutate('/api/setoran', 'POST', {
      kelasId: sanitizeText(kelasId, 50),
      daftarMinggu,
      tanggalSetor: cleanTanggal,
      tahunAjaranId: selectedTahunAjaranId,
      alasan: sanitizeText(alasan, 300) || 'Pencatatan setoran kas mingguan kelas'
    });
    await refreshData();
  };

  // 2. UBAH SETORAN
  const ubahSetoran = async (
    setoranId: string,
    daftarMingguBaru: string[],
    tanggalSetorBaru: string,
    alasan: string
  ) => {
    const cleanAlasan = sanitizeText(alasan, 300);
    if (!cleanAlasan) throw new Error('Alasan perubahan setoran wajib diisi.');
    if (!daftarMingguBaru || daftarMingguBaru.length === 0 || daftarMingguBaru.length > 60) {
      throw new Error('Setoran harus memiliki antara 1 hingga 60 minggu.');
    }
    const cleanTanggal = sanitizeText(tanggalSetorBaru, 10);
    if (!isValidYYYYMMDD(cleanTanggal)) {
      throw new Error('Format tanggal setor baru tidak valid.');
    }

    await apiMutate(`/api/setoran/${encodeURIComponent(setoranId)}`, 'PUT', {
      daftarMingguBaru,
      tanggalSetorBaru: cleanTanggal,
      alasan: cleanAlasan
    });
    await refreshData();
  };

  // 3. HAPUS SETORAN
  const hapusSetoran = async (setoranId: string, alasan: string) => {
    const cleanAlasan = sanitizeText(alasan, 300);
    if (!cleanAlasan) throw new Error('Alasan penghapusan setoran wajib diisi.');

    await apiMutate(`/api/setoran/${encodeURIComponent(setoranId)}`, 'DELETE', {
      alasan: cleanAlasan
    });
    await refreshData();
  };

  // 4. TRANSAKSI LAIN
  const tambahTransaksi = async (
    data: Omit<Transaksi, 'id' | 'dibuatPada'>,
    alasan: string
  ) => {
    const cleanTanggal = sanitizeText(data.tanggal, 10);
    const cleanKeterangan = sanitizeText(data.keterangan, 300);
    const cleanKategori = sanitizeText(data.kategori, 100);
    const cleanAlasan = sanitizeText(alasan, 300) || 'Pencatatan transaksi kas';
    const nominal = Math.round(Number(data.nominal));

    if (!isValidYYYYMMDD(cleanTanggal)) {
      throw new Error('Format tanggal transaksi tidak valid.');
    }
    if (!cleanKeterangan) {
      throw new Error('Keterangan transaksi wajib diisi.');
    }
    if (!cleanKategori) {
      throw new Error('Kategori transaksi wajib diisi.');
    }
    if (!isValidPositiveInt(nominal, 1, 1000000000)) {
      throw new Error('Nominal transaksi harus bilangan bulat positif antara 1 hingga 1.000.000.000.');
    }
    if (data.jenis !== 'pemasukan' && data.jenis !== 'pengeluaran') {
      throw new Error('Jenis transaksi tidak valid.');
    }

    await apiMutate('/api/transaksi', 'POST', {
      jenis: data.jenis,
      tanggal: cleanTanggal,
      keterangan: cleanKeterangan,
      nominal,
      kategori: cleanKategori,
      tahunAjaranId: sanitizeText(data.tahunAjaranId, 50) || selectedTahunAjaranId,
      alasan: cleanAlasan
    });
    await refreshData();
  };

  const ubahTransaksi = async (
    transaksiId: string,
    data: Partial<Omit<Transaksi, 'id' | 'dibuatPada'>>,
    alasan: string
  ) => {
    const cleanAlasan = sanitizeText(alasan, 300);
    if (!cleanAlasan) throw new Error('Alasan perubahan wajib diisi.');

    await apiMutate(`/api/transaksi/${encodeURIComponent(transaksiId)}`, 'PUT', {
      ...data,
      alasan: cleanAlasan
    });
    await refreshData();
  };

  const hapusTransaksi = async (transaksiId: string, alasan: string) => {
    const cleanAlasan = sanitizeText(alasan, 300);
    if (!cleanAlasan) throw new Error('Alasan penghapusan wajib diisi.');

    await apiMutate(`/api/transaksi/${encodeURIComponent(transaksiId)}`, 'DELETE', {
      alasan: cleanAlasan
    });
    await refreshData();
  };

  // 5. KELOLA KELAS
  const ubahJumlahSiswaKelas = async (
    kelasId: string,
    jumlahSiswaBaru: number,
    alasan: string
  ) => {
    const cleanAlasan = sanitizeText(alasan, 300);
    if (!cleanAlasan) throw new Error('Alasan perubahan jumlah siswa wajib diisi.');
    const count = Math.round(Number(jumlahSiswaBaru));
    if (!isValidPositiveInt(count, 1, 60)) {
      throw new Error('Jumlah siswa harus bilangan bulat antara 1 sampai 60.');
    }

    await apiMutate(`/api/kelas/${encodeURIComponent(kelasId)}`, 'PUT', {
      jumlahSiswaBaru: count,
      alasan: cleanAlasan
    });
    await refreshData();
  };

  const ubahNamaKelas = async (
    kelasId: string,
    namaBaru: string,
    alasan: string
  ) => {
    const cleanNama = sanitizeText(namaBaru, 50);
    const cleanAlasan = sanitizeText(alasan, 300) || 'Pembaruan nama kelas';
    if (!cleanNama) throw new Error('Nama kelas tidak boleh kosong.');

    await apiMutate(`/api/kelas/${encodeURIComponent(kelasId)}`, 'PUT', {
      namaBaru: cleanNama,
      alasan: cleanAlasan
    });
    await refreshData();
  };

  // 6. PENGATURAN & KREDENSIAL
  const simpanPengaturan = async (data: Partial<Pengaturan>, alasan: string) => {
    const cleanAlasan = sanitizeText(alasan, 300) || 'Update pengaturan sistem';
    await apiMutate('/api/pengaturan', 'PUT', {
      tarifPerSiswa: data.tarifPerSiswa,
      tanggalMulaiPencatatanPerKelas: data.tanggalMulaiPencatatanPerKelas,
      namaSekolah: data.namaSekolah,
      namaBendahara: data.namaBendahara,
      mingguLiburKas: data.mingguLiburKas,
      alasan: cleanAlasan
    });
    await refreshData();
  };

  const ubahPasscodeViewer = async (passcodeBaru: string, alasan: string) => {
    const cleanCode = sanitizeText(passcodeBaru, 100);
    if (!cleanCode || cleanCode.length < 8) {
      throw new Error('Kode akses Bendahara Kelas minimal 8 karakter.');
    }
    await apiMutate('/api/pengaturan/viewer-passcode', 'PUT', {
      passcodeBaru: cleanCode,
      alasan: sanitizeText(alasan, 300) || 'Memperbarui kode akses Bendahara Kelas'
    });
    await refreshData();
  };

  const ubahKredensialAdmin = async (
    usernameBaru: string,
    passwordSaatIni: string,
    passwordBaru: string,
    alasan: string
  ) => {
    const cleanUsername = sanitizeText(usernameBaru, 50);
    const cleanAlasan = sanitizeText(alasan, 300) || 'Pembaruan kredensial login Admin';

    if (!USERNAME_REGEX.test(cleanUsername)) {
      throw new Error('Username admin harus 3–50 karakter (huruf, angka, titik, garis bawah, atau tanda hubung).');
    }

    const res = await apiMutate<{ success?: boolean; token?: string; adminUsername?: string }>(
      '/api/auth/admin/credentials',
      'PUT',
      {
        usernameBaru: cleanUsername,
        passwordSaatIni,
        passwordBaru,
        alasan: cleanAlasan
      }
    );

    const nextToken = res.token || authToken;
    if (res.token) {
      setAuthToken(res.token);
    }
    await refreshData(nextToken);
  };

  // 7. BUAT TAHUN AJARAN BARU
  const buatTahunAjaranBaru = async (
    label: string,
    tanggalMulai: string,
    tanggalAkhir: string,
    bawaModalAwal: boolean,
    alasan: string
  ) => {
    const cleanLabel = sanitizeText(label, 50);
    const cleanMulai = sanitizeText(tanggalMulai, 10);
    const cleanAkhir = sanitizeText(tanggalAkhir, 10);
    const cleanAlasan = sanitizeText(alasan, 300) || 'Pembukaan tahun ajaran baru';

    if (!cleanLabel || !isValidYYYYMMDD(cleanMulai) || !isValidYYYYMMDD(cleanAkhir)) {
      throw new Error('Label dan format tanggal tahun ajaran tidak valid.');
    }
    if (cleanAkhir < cleanMulai) {
      throw new Error('Tanggal akhir harus setelah tanggal mulai.');
    }

    const res = await apiMutate<{ success?: boolean; id?: string }>('/api/tahun-ajaran', 'POST', {
      label: cleanLabel,
      tanggalMulai: cleanMulai,
      tanggalAkhir: cleanAkhir,
      bawaModalAwal,
      alasan: cleanAlasan
    });

    if (res.id) {
      setSelectedTahunAjaranId(res.id);
    }
    await refreshData();
  };

  // 8. MUAT DATA AWAL EXCEL
  const muatDataAwalExcel = async () => {
    if (pengaturan.seedLoaded) {
      throw new Error('Data awal Excel sudah pernah dimuat sebelumnya.');
    }
    await apiMutate('/api/seed-excel', 'POST');
    await refreshData();
  };

  return (
    <AppContext.Provider
      value={{
        isAdmin,
        isViewerAuthenticated,
        isAuthLoading,
        activeTab,
        setActiveTab,
        selectedTahunAjaranId,
        setSelectedTahunAjaranId,
        pengaturan,
        tahunAjaranList,
        kelasList,
        setoranList,
        transaksiList,
        riwayatList,
        allWeeks,
        currentMonday,
        isDataLoading,
        dbError,
        saldoSekarang,
        totalPemasukan,
        totalPengeluaran,
        showAdminLoginModal,
        setShowAdminLoginModal,
        loginAdminWithCredentials,
        setupInitialAdminAccount,
        loginViewerWithCode,
        logout,
        tambahSetoran,
        ubahSetoran,
        hapusSetoran,
        tambahTransaksi,
        ubahTransaksi,
        hapusTransaksi,
        ubahJumlahSiswaKelas,
        ubahNamaKelas,
        simpanPengaturan,
        ubahPasscodeViewer,
        ubahKredensialAdmin,
        buatTahunAjaranBaru,
        muatDataAwalExcel
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used within an AppProvider');
  return context;
};
