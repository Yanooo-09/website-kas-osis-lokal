import React, { useState, useMemo, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { Kelas, Setoran, Transaksi } from '../types';
import {
  formatRupiah,
  formatTanggalIndonesia,
  formatToYYYYMMDD,
  hitungStatusMinggu,
  formatKeteranganRentangMinggu
} from '../utils/dateAndMoney';
import {
  PlusCircle,
  FileSpreadsheet,
  Settings,
  Users,
  Edit2,
  Trash2,
  AlertTriangle,
  Check,
  Shield,
  KeyRound,
  Download,
  CalendarPlus,
  CalendarOff,
  RefreshCw,
  Sparkles,
  Eye,
  EyeOff,
  Lock,
  User,
  X
} from 'lucide-react';

export const TabAdmin: React.FC = () => {
  const {
    kelasList,
    setoranList,
    transaksiList,
    allWeeks,
    pengaturan,
    currentMonday,
    selectedTahunAjaranId,
    saldoSekarang,
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
  } = useApp();

  // Sub-navigation in Admin tab
  const [adminSection, setAdminSection] = useState<
    'SETORAN' | 'DAFTAR_SETORAN' | 'TRANSAKSI' | 'KELOLA_KELAS' | 'LIBUR_KAS' | 'PENGATURAN'
  >('SETORAN');

  // ==========================================
  // SECTION A: FORM SETORAN KELAS
  // ==========================================
  const [selectedKelasId, setSelectedKelasId] = useState<string>(
    kelasList[0]?.id || ''
  );
  const [selectedWeeks, setSelectedWeeks] = useState<string[]>([]);
  const [tanggalSetor, setTanggalSetor] = useState<string>(
    formatToYYYYMMDD(new Date())
  );
  const [alasanSetoran, setAlasanSetoran] = useState<string>('Pencatatan kas mingguan');
  const [isSubmittingSetoran, setIsSubmittingSetoran] = useState(false);

  // Active selected class object
  const activeKelas = useMemo(() => {
    return kelasList.find((k) => k.id === selectedKelasId) || kelasList[0];
  }, [kelasList, selectedKelasId]);

  // Set of already paid weeks for active class
  const activeClassPaidWeeks = useMemo(() => {
    const set = new Set<string>();
    if (!activeKelas) return set;
    setoranList
      .filter((s) => s.kelasId === activeKelas.id && s.tahunAjaranId === selectedTahunAjaranId)
      .forEach((s) => s.daftarMinggu.forEach((m) => set.add(m)));
    return set;
  }, [activeKelas, setoranList, selectedTahunAjaranId]);

  const mingguLiburKas = useMemo(
    () => pengaturan.mingguLiburKas || {},
    [pengaturan.mingguLiburKas]
  );

  // Available unpaid weeks for active class (excluding weeks marked as Libur Kas)
  const availableUnpaidWeeks = useMemo(() => {
    return allWeeks.filter(
      (w) => !activeClassPaidWeeks.has(w.startMonday) && !mingguLiburKas[w.startMonday]
    );
  }, [allWeeks, activeClassPaidWeeks, mingguLiburKas]);

  useEffect(() => {
    setSelectedWeeks((prev) => prev.filter((m) => !mingguLiburKas[m]));
  }, [mingguLiburKas]);

  // Live total calculation for setoran form
  const setoranLiveTotal = useMemo(() => {
    if (!activeKelas) return 0;
    const count = selectedWeeks.length;
    const siswa = activeKelas.jumlahSiswa;
    const tarif = pengaturan.tarifPerSiswa || 1000;
    return count * siswa * tarif;
  }, [activeKelas, selectedWeeks, pengaturan.tarifPerSiswa]);

  // Toggle week selection
  const toggleWeekSelection = (monday: string) => {
    if (activeClassPaidWeeks.has(monday)) return; // Already paid cannot be selected
    if (selectedWeeks.includes(monday)) {
      setSelectedWeeks(selectedWeeks.filter((w) => w !== monday));
    } else {
      setSelectedWeeks([...selectedWeeks, monday].sort());
    }
  };

  // Shortcut: Bayar N minggu mulai dari minggu belum bayar pertama
  const selectNextNWeeks = (n: number) => {
    const toSelect = availableUnpaidWeeks.slice(0, n).map((w) => w.startMonday);
    setSelectedWeeks(toSelect);
  };

  // Shortcut: Pilih sampai minggu tertentu
  const selectUntilWeek = (targetMonday: string) => {
    const toSelect: string[] = [];
    for (const w of availableUnpaidWeeks) {
      if (w.startMonday <= targetMonday) {
        toSelect.push(w.startMonday);
      }
    }
    setSelectedWeeks(toSelect);
  };

  const [statusNotice, setStatusNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const notify = (type: 'success' | 'error', text: string) => {
    setStatusNotice({ type, text });
  };

  const handleSaveSetoran = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeKelas) return;
    if (selectedWeeks.length === 0) {
      notify('error', 'Pilih minimal satu minggu yang belum dibayar.');
      return;
    }

    try {
      setIsSubmittingSetoran(true);
      await tambahSetoran(activeKelas.id, selectedWeeks, tanggalSetor, alasanSetoran);
      notify('success', `Setoran ${activeKelas.nama} berhasil disimpan! Total: ${formatRupiah(setoranLiveTotal)}.`);
      setSelectedWeeks([]);
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Gagal menyimpan setoran');
    } finally {
      setIsSubmittingSetoran(false);
    }
  };

  // ==========================================
  // SECTION B: DAFTAR SETORAN (EDIT & HAPUS)
  // ==========================================
  const [editingSetoran, setEditingSetoran] = useState<Setoran | null>(null);
  const [editSetoranWeeks, setEditSetoranWeeks] = useState<string[]>([]);
  const [editSetoranTanggal, setEditSetoranTanggal] = useState<string>('');
  const [editAlasan, setEditAlasan] = useState<string>('');

  const [deletingSetoran, setDeletingSetoran] = useState<Setoran | null>(null);
  const [deleteAlasan, setDeleteAlasan] = useState<string>('');

  const handleOpenEditSetoran = (s: Setoran) => {
    setEditingSetoran(s);
    setEditSetoranWeeks([...s.daftarMinggu]);
    setEditSetoranTanggal(s.tanggalSetor);
    setEditAlasan('');
  };

  const handleSaveEditSetoran = async () => {
    if (!editingSetoran) return;
    if (!editAlasan || editAlasan.trim() === '') {
      notify('error', 'Alasan perubahan wajib diisi!');
      return;
    }
    if (editSetoranWeeks.length === 0) {
      notify('error', 'Minimal 1 minggu harus dipilih.');
      return;
    }

    try {
      await ubahSetoran(editingSetoran.id, editSetoranWeeks, editSetoranTanggal, editAlasan);
      notify('success', 'Perubahan setoran berhasil disimpan dan tercatat di riwayat.');
      setEditingSetoran(null);
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Gagal mengubah setoran');
    }
  };

  const handleConfirmDeleteSetoran = async () => {
    if (!deletingSetoran) return;
    if (!deleteAlasan || deleteAlasan.trim() === '') {
      notify('error', 'Alasan penghapusan setoran wajib diisi!');
      return;
    }

    try {
      await hapusSetoran(deletingSetoran.id, deleteAlasan);
      notify('success', 'Setoran berhasil dihapus beserta transaksi kas terkait.');
      setDeletingSetoran(null);
      setDeleteAlasan('');
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Gagal menghapus setoran');
    }
  };

  // ==========================================
  // SECTION C: TRANSAKSI LAIN (PEMASUKAN & PENGELUARAN)
  // ==========================================
  const [transJenis, setTransJenis] = useState<'pemasukan' | 'pengeluaran'>('pengeluaran');
  const [transTanggal, setTransTanggal] = useState<string>(formatToYYYYMMDD(new Date()));
  const [transKeterangan, setTransKeterangan] = useState<string>('');
  const [transNominal, setTransNominal] = useState<number | ''>('');
  const [transKategori, setTransKategori] = useState<string>('Konsumsi');
  const [newKategoriInput, setNewKategoriInput] = useState<string>('');
  const [transAlasan, setTransAlasan] = useState<string>('');

  const [editingTransaksi, setEditingTransaksi] = useState<Transaksi | null>(null);
  const [editTransAlasan, setEditTransAlasan] = useState<string>('');

  const [deletingTransaksi, setDeletingTransaksi] = useState<Transaksi | null>(null);
  const [deleteTransAlasan, setDeleteTransAlasan] = useState<string>('');

  const categoriesForJenis = useMemo(() => {
    return transJenis === 'pemasukan'
      ? pengaturan.kategoriPemasukan || ['Modal', 'Uang Pelanggaran', 'Kas Mingguan (rekap lama)', 'Lainnya']
      : pengaturan.kategoriPengeluaran || ['Konsumsi', 'Hadiah & Lomba', 'Perlengkapan', 'Lainnya'];
  }, [transJenis, pengaturan]);

  // Warning if expense exceeds balance
  const willBeNegative = useMemo(() => {
    if (transJenis === 'pengeluaran' && typeof transNominal === 'number' && transNominal > 0) {
      return saldoSekarang - transNominal < 0;
    }
    return false;
  }, [transJenis, transNominal, saldoSekarang]);

  const handleSaveTransaksi = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!transKeterangan || transKeterangan.trim() === '') {
      notify('error', 'Keterangan transaksi wajib diisi.');
      return;
    }
    if (!transNominal || Number(transNominal) <= 0) {
      notify('error', 'Nominal harus lebih besar dari 0.');
      return;
    }

    const finalKategori = newKategoriInput.trim() !== '' ? newKategoriInput.trim() : transKategori;

    try {
      await tambahTransaksi(
        {
          jenis: transJenis,
          tanggal: transTanggal,
          keterangan: transKeterangan.trim(),
          nominal: Number(transNominal),
          kategori: finalKategori,
          tahunAjaranId: selectedTahunAjaranId
        },
        transAlasan || `Pencatatan ${transJenis}`
      );

      notify('success', `Transaksi ${transJenis} berhasil dicatat!`);
      setTransKeterangan('');
      setTransNominal('');
      setNewKategoriInput('');
      setTransAlasan('');
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Gagal mencatat transaksi');
    }
  };

  // ==========================================
  // SECTION D: KELOLA KELAS
  // ==========================================
  const [editKelasTarget, setEditKelasTarget] = useState<Kelas | null>(null);
  const [newSiswaCount, setNewSiswaCount] = useState<number>(35);
  const [newKelasName, setNewKelasName] = useState<string>('');
  const [kelasAlasan, setKelasAlasan] = useState<string>('');

  const handleOpenEditKelas = (k: Kelas) => {
    setEditKelasTarget(k);
    setNewSiswaCount(k.jumlahSiswa);
    setNewKelasName(k.nama);
    setKelasAlasan('');
  };

  const handleSaveEditKelas = async () => {
    if (!editKelasTarget) return;
    if (!kelasAlasan || kelasAlasan.trim() === '') {
      notify('error', 'Alasan perubahan kelas wajib diisi!');
      return;
    }

    try {
      if (newKelasName.trim() !== editKelasTarget.nama) {
        await ubahNamaKelas(editKelasTarget.id, newKelasName.trim(), kelasAlasan);
      }
      if (newSiswaCount !== editKelasTarget.jumlahSiswa) {
        await ubahJumlahSiswaKelas(editKelasTarget.id, newSiswaCount, kelasAlasan);
      }
      notify('success', 'Data kelas berhasil diperbarui. Setoran lama tetap aman.');
      setEditKelasTarget(null);
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Gagal memperbarui kelas');
    }
  };

  // ==========================================
  // SECTION E: PENGATURAN & TAHUN AJARAN BARU
  // ==========================================
  const [newTarif, setNewTarif] = useState<number>(pengaturan.tarifPerSiswa || 1000);
  const [newTglPencatatan, setNewTglPencatatan] = useState<string>(
    pengaturan.tanggalMulaiPencatatanPerKelas || '2026-08-03'
  );
  const [adminUsernameInput, setAdminUsernameInput] = useState<string>(
    pengaturan.adminUsername || 'alkiyano'
  );
  const [currentAdminPassword, setCurrentAdminPassword] = useState<string>('');
  const [newAdminPassword, setNewAdminPassword] = useState<string>('');
  const [showAdminPasswords, setShowAdminPasswords] = useState<boolean>(false);
  const [newViewerCode, setNewViewerCode] = useState<string>('');
  const [pengaturanAlasan, setPengaturanAlasan] = useState<string>('');

  useEffect(() => {
    if (pengaturan.adminUsername) {
      setAdminUsernameInput(pengaturan.adminUsername);
    }
  }, [pengaturan.adminUsername]);

  // ==========================================
  // SECTION F: JADWAL LIBUR PENARIKAN KAS
  // ==========================================
  const [draftLiburKas, setDraftLiburKas] = useState<Record<string, string>>(
    pengaturan.mingguLiburKas || {}
  );
  const [liburMonthFilter, setLiburMonthFilter] = useState<string>('ALL');
  const [liburReasonInput, setLiburReasonInput] = useState<string>('Selesai Ulangan');
  const [liburAlasanSimpan, setLiburAlasanSimpan] = useState<string>(
    'Pengaturan minggu tanpa tarikan kas kelas'
  );
  const [isSavingLibur, setIsSavingLibur] = useState<boolean>(false);

  useEffect(() => {
    setDraftLiburKas(pengaturan.mingguLiburKas || {});
  }, [pengaturan.mingguLiburKas]);

  const weekMapByMonday = useMemo(() => {
    const map = new Map<string, (typeof allWeeks)[number]>();
    allWeeks.forEach((w) => map.set(w.startMonday, w));
    return map;
  }, [allWeeks]);

  const availableMonthsForLibur = useMemo(() => {
    const seen = new Set<string>();
    const months: { monthKey: string; monthName: string }[] = [];
    allWeeks.forEach((w) => {
      if (!seen.has(w.monthKey)) {
        seen.add(w.monthKey);
        months.push({ monthKey: w.monthKey, monthName: w.monthName });
      }
    });
    return months;
  }, [allWeeks]);

  const paidCountByWeek = useMemo(() => {
    const counts = new Map<string, number>();
    setoranList
      .filter((s) => s.tahunAjaranId === selectedTahunAjaranId)
      .forEach((s) => {
        s.daftarMinggu.forEach((m) => {
          counts.set(m, (counts.get(m) || 0) + 1);
        });
      });
    return counts;
  }, [setoranList, selectedTahunAjaranId]);

  const filteredWeeksForLibur = useMemo(() => {
    if (liburMonthFilter === 'ALL') return allWeeks;
    return allWeeks.filter((w) => w.monthKey === liburMonthFilter);
  }, [allWeeks, liburMonthFilter]);

  const sortedActiveDraftLibur = useMemo(() => {
    return Object.entries(draftLiburKas).sort(([a], [b]) => a.localeCompare(b));
  }, [draftLiburKas]);

  const hasUnsavedLiburChanges = useMemo(() => {
    const saved = pengaturan.mingguLiburKas || {};
    const draftKeys = Object.keys(draftLiburKas).sort();
    const savedKeys = Object.keys(saved).sort();
    if (draftKeys.length !== savedKeys.length) return true;
    return draftKeys.some((k, idx) => k !== savedKeys[idx] || draftLiburKas[k] !== saved[k]);
  }, [draftLiburKas, pengaturan.mingguLiburKas]);

  const toggleDraftLiburWeek = (startMonday: string) => {
    setDraftLiburKas((prev) => {
      const next = { ...prev };
      if (Object.prototype.hasOwnProperty.call(next, startMonday)) {
        delete next[startMonday];
      } else {
        next[startMonday] = liburReasonInput.trim() || 'Selesai Ulangan';
      }
      return next;
    });
  };

  const updateDraftLiburReason = (startMonday: string, reason: string) => {
    setDraftLiburKas((prev) => ({
      ...prev,
      [startMonday]: reason
    }));
  };

  const handleSaveLiburKas = async () => {
    const sanitized: Record<string, string> = {};
    Object.entries(draftLiburKas).forEach(([monday, reason]) => {
      sanitized[monday] = reason.trim() || 'Libur Kas';
    });

    try {
      setIsSavingLibur(true);
      await simpanPengaturan(
        { mingguLiburKas: sanitized },
        liburAlasanSimpan.trim() || 'Pembaruan jadwal minggu libur tarikan kas kelas'
      );
      notify(
        'success',
        `Jadwal libur kas berhasil disimpan (${Object.keys(sanitized).length} minggu bebas tarikan kas).`
      );
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Gagal menyimpan jadwal libur kas');
    } finally {
      setIsSavingLibur(false);
    }
  };

  // Tahun Ajaran Baru Modal State
  const [showNewYearModal, setShowNewYearModal] = useState(false);
  const [newYearLabel, setNewYearLabel] = useState('2027/2028');
  const [newYearStart, setNewYearStart] = useState('2027-08-02');
  const [newYearEnd, setNewYearEnd] = useState('2028-06-25');
  const [newYearCarryOver, setNewYearCarryOver] = useState(true);
  const [newYearAlasan, setNewYearAlasan] = useState('Pembukaan tahun ajaran baru');

  const handleSavePengaturan = async () => {
    if (!pengaturanAlasan || pengaturanAlasan.trim() === '') {
      notify('error', 'Alasan perubahan pengaturan wajib diisi!');
      return;
    }
    try {
      await simpanPengaturan(
        {
          tarifPerSiswa: Number(newTarif),
          tanggalMulaiPencatatanPerKelas: newTglPencatatan
        },
        pengaturanAlasan
      );
      if (newViewerCode.trim() !== '') {
        await ubahPasscodeViewer(newViewerCode.trim(), pengaturanAlasan);
        setNewViewerCode('');
      }
      const currentUsername = pengaturan.adminUsername || 'alkiyano';
      const usernameChanged = adminUsernameInput.trim() !== currentUsername;
      const passwordChanged = newAdminPassword.trim() !== '';
      if (usernameChanged || passwordChanged) {
        await ubahKredensialAdmin(
          adminUsernameInput.trim(),
          currentAdminPassword,
          newAdminPassword,
          pengaturanAlasan
        );
        setCurrentAdminPassword('');
        setNewAdminPassword('');
      }
      notify('success', 'Pengaturan berhasil disimpan!');
      setPengaturanAlasan('');
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Gagal menyimpan pengaturan');
    }
  };

  const handleCreateNewAcademicYear = async () => {
    if (!newYearLabel || !newYearStart || !newYearEnd) {
      notify('error', 'Lengkapi label dan rentang tanggal tahun ajaran.');
      return;
    }
    try {
      await buatTahunAjaranBaru(
        newYearLabel,
        newYearStart,
        newYearEnd,
        newYearCarryOver,
        newYearAlasan
      );
      notify('success', `Tahun ajaran baru ${newYearLabel} berhasil dibuka!`);
      setShowNewYearModal(false);
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Gagal membuat tahun ajaran');
    }
  };

  // Seed Excel Button Handler
  const [isSeeding, setIsSeeding] = useState(false);
  const [confirmSeed, setConfirmSeed] = useState(false);
  const handleLoadExcelSeed = async () => {
    if (pengaturan.seedLoaded) {
      notify('error', 'Data awal Excel sudah pernah dimuat sebelumnya.');
      return;
    }
    if (!confirmSeed) {
      setConfirmSeed(true);
      return;
    }

    try {
      setIsSeeding(true);
      await muatDataAwalExcel();
      notify('success', 'SUKSES! Data awal dari Excel berhasil dimuat. Saldo akhir buku kas terverifikasi tepat Rp2.545.000.');
      setConfirmSeed(false);
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Gagal memuat data awal');
    } finally {
      setIsSeeding(false);
    }
  };

  return (
    <div className="space-y-6">
      {statusNotice && (
        <div
          className={`p-3.5 rounded-xl border text-xs font-bold flex items-center justify-between gap-2 ${
            statusNotice.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
        >
          <span>{statusNotice.text}</span>
          <button
            type="button"
            onClick={() => setStatusNotice(null)}
            className="text-xs underline opacity-75 hover:opacity-100"
          >
            Tutup
          </button>
        </div>
      )}

      {/* Admin Nav Sub-header */}
      <div className="bg-white border border-slate-200/90 shadow-xs rounded-xl p-4 sm:p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3 mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-purple-50 text-[#6C2BD9] flex items-center justify-center">
              <Shield className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight">
                Panel Kontrol Bendahara ({pengaturan.namaBendahara || 'Bendahara OSIS'})
              </h2>
              <p className="text-xs text-slate-500 font-medium">
                Pencatatan setoran, pembukuan kas, mutasi siswa & pengaturan
              </p>
            </div>
          </div>
          <span className="text-xs font-semibold bg-emerald-50 text-emerald-700 px-2.5 py-1 rounded-lg border border-emerald-200 self-start sm:self-auto">
            Hak Akses Penuh
          </span>
        </div>

        {/* Sub-menu Segmented Control */}
        <div className="flex flex-wrap gap-1.5 p-1 bg-slate-100 rounded-xl">
          <button
            onClick={() => setAdminSection('SETORAN')}
            className={`px-3 py-2 text-xs font-bold rounded-lg transition-all ${
              adminSection === 'SETORAN'
                ? 'bg-[#6C2BD9] text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
            }`}
          >
            + Setoran Kas Kelas
          </button>
          <button
            onClick={() => setAdminSection('DAFTAR_SETORAN')}
            className={`px-3 py-2 text-xs font-bold rounded-lg transition-all ${
              adminSection === 'DAFTAR_SETORAN'
                ? 'bg-[#6C2BD9] text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
            }`}
          >
            Daftar Setoran ({setoranList.length})
          </button>
          <button
            onClick={() => setAdminSection('TRANSAKSI')}
            className={`px-3 py-2 text-xs font-bold rounded-lg transition-all ${
              adminSection === 'TRANSAKSI'
                ? 'bg-[#6C2BD9] text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
            }`}
          >
            Pemasukan & Pengeluaran
          </button>
          <button
            onClick={() => setAdminSection('KELOLA_KELAS')}
            className={`px-3 py-2 text-xs font-bold rounded-lg transition-all ${
              adminSection === 'KELOLA_KELAS'
                ? 'bg-[#6C2BD9] text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
            }`}
          >
            Kelola Kelas (16)
          </button>
          <button
            onClick={() => setAdminSection('LIBUR_KAS')}
            className={`px-3 py-2 text-xs font-bold rounded-lg transition-all inline-flex items-center gap-1.5 ${
              adminSection === 'LIBUR_KAS'
                ? 'bg-amber-600 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
            }`}
          >
            <CalendarOff className="w-3.5 h-3.5" />
            <span>Jadwal Libur Kas ({Object.keys(mingguLiburKas).length})</span>
          </button>
          <button
            onClick={() => setAdminSection('PENGATURAN')}
            className={`px-3 py-2 text-xs font-bold rounded-lg transition-all ${
              adminSection === 'PENGATURAN'
                ? 'bg-[#6C2BD9] text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
            }`}
          >
            Pengaturan & Kredensial
          </button>
        </div>
      </div>

      {/* ========================================================= */}
      {/* SUB-SECTION 1: FORM SETORAN KELAS                         */}
      {/* ========================================================= */}
      {adminSection === 'SETORAN' && (
        <div className="neo-box bg-white p-4 sm:p-6 space-y-4">
          <div className="border-b-2 border-[#111111] pb-2">
            <h3 className="text-base sm:text-lg font-black text-[#111111]">
              Input Setoran Kas Mingguan Kelas
            </h3>
            <p className="text-xs text-gray-600 font-medium">
              Nominal dihitung otomatis: Jumlah Minggu × Jumlah Siswa Saat Ini × Tarif Kas.
            </p>
          </div>

          <form onSubmit={handleSaveSetoran} className="space-y-4">
            {/* 1. Pilih Kelas */}
            <div>
              <label className="block text-xs font-black uppercase text-gray-700 mb-1">
                Pilih Kelas:
              </label>
              <select
                value={selectedKelasId}
                onChange={(e) => {
                  setSelectedKelasId(e.target.value);
                  setSelectedWeeks([]); // Reset selected weeks when changing class
                }}
                className="neo-input w-full font-bold text-sm"
              >
                {kelasList.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.nama} ({k.jumlahSiswa} siswa • Tingkat {k.tingkat})
                  </option>
                ))}
              </select>
            </div>

            {/* Class Snapshot Banner */}
            {activeKelas && (
              <div className="neo-box-sm bg-[#FFF8E7] p-3 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div>
                  <span className="font-bold text-gray-600">Tarif per minggu: </span>
                  <span className="font-mono-num font-black text-[#111111]">
                    {activeKelas.jumlahSiswa} siswa × {formatRupiah(pengaturan.tarifPerSiswa || 1000)} ={' '}
                    <span className="text-[#6BCB77]">
                      {formatRupiah(activeKelas.jumlahSiswa * (pengaturan.tarifPerSiswa || 1000))}
                    </span>
                  </span>
                </div>
                <div className="text-[11px] font-semibold text-gray-500">
                  Snapshot tersimpan saat setor
                </div>
              </div>
            )}

            {/* 2. Pintasan Pemilihan Minggu */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-black uppercase text-gray-700">
                  Pilih Minggu yang Hendak Disetor:
                </label>
                <span className="text-[11px] font-bold text-gray-500">
                  Tersedia {availableUnpaidWeeks.length} minggu belum lunas
                </span>
              </div>

              {/* Shortcut buttons */}
              <div className="flex flex-wrap items-center gap-1.5 mb-2.5">
                <span className="text-[10px] font-black uppercase text-gray-500 mr-1">
                  Pintasan:
                </span>
                <button
                  type="button"
                  onClick={() => selectNextNWeeks(1)}
                  className="neo-btn-sm bg-gray-100 hover:bg-[#FFD93D] text-[11px] py-1 px-2 font-bold"
                >
                  1 Minggu
                </button>
                <button
                  type="button"
                  onClick={() => selectNextNWeeks(2)}
                  className="neo-btn-sm bg-gray-100 hover:bg-[#FFD93D] text-[11px] py-1 px-2 font-bold"
                >
                  2 Minggu
                </button>
                <button
                  type="button"
                  onClick={() => selectNextNWeeks(4)}
                  className="neo-btn-sm bg-gray-100 hover:bg-[#FFD93D] text-[11px] py-1 px-2 font-bold"
                >
                  4 Minggu (1 Bulan)
                </button>
                <button
                  type="button"
                  onClick={() => selectNextNWeeks(8)}
                  className="neo-btn-sm bg-gray-100 hover:bg-[#FFD93D] text-[11px] py-1 px-2 font-bold"
                >
                  8 Minggu (Bayar di Muka)
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedWeeks([])}
                  className="neo-btn-sm bg-red-50 hover:bg-red-100 text-[11px] py-1 px-2 font-bold text-red-600 ml-auto"
                >
                  Batal Pilih
                </button>
              </div>

              {/* Exempt weeks notice */}
              {Object.keys(mingguLiburKas).length > 0 && (
                <div className="mb-2.5 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-[11px] text-amber-900 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 font-medium">
                    <CalendarOff className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                    <span>
                      <strong>{Object.keys(mingguLiburKas).length} minggu</strong> ditandai{' '}
                      <strong>Libur Kas</strong> sehingga otomatis dilewati dari tagihan setoran.
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setAdminSection('LIBUR_KAS')}
                    className="font-bold text-amber-800 underline hover:text-amber-950"
                  >
                    Atur Jadwal Libur
                  </button>
                </div>
              )}

              {/* Checkbox List of Weeks */}
              <div className="max-h-60 overflow-y-auto border-2 border-[#111111] p-2 rounded bg-gray-50 space-y-1">
                {availableUnpaidWeeks.length === 0 ? (
                  <div className="text-center py-6 text-gray-500 font-bold text-xs">
                    ✓ Kelas ini sudah melunasi seluruh minggu aktif pada tahun ajaran ini!
                  </div>
                ) : (
                  availableUnpaidWeeks.map((w) => {
                    const isChecked = selectedWeeks.includes(w.startMonday);
                    const isPassedOrCurrent = w.startMonday <= currentMonday;
                    return (
                      <label
                        key={w.startMonday}
                        className={`flex items-center justify-between p-2 rounded border cursor-pointer select-none transition-colors text-xs ${
                          isChecked
                            ? 'bg-[#FFD93D] border-[#111111] font-black'
                            : 'bg-white border-gray-300 hover:bg-yellow-50'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggleWeekSelection(w.startMonday)}
                            className="w-4 h-4 accent-[#111111]"
                          />
                          <span className="font-mono-num font-bold">{w.labelLong}</span>
                        </div>

                        <div className="flex items-center gap-1.5">
                          {isPassedOrCurrent ? (
                            <span className="bg-[#FF6B6B] text-white text-[9px] font-black px-1.5 py-0.2 rounded uppercase">
                              Tunggakan
                            </span>
                          ) : (
                            <span className="bg-[#4D96FF] text-white text-[9px] font-black px-1.5 py-0.2 rounded uppercase">
                              Di Muka
                            </span>
                          )}
                          <span className="text-[11px] text-gray-600 font-mono-num">
                            Minggu #{w.weekIndexInYear}
                          </span>
                        </div>
                      </label>
                    );
                  })
                )}
              </div>
            </div>

            {/* 3. Tanggal Setor & Alasan */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-black uppercase text-gray-700 mb-1">
                  Tanggal Setor:
                </label>
                <input
                  type="date"
                  value={tanggalSetor}
                  onChange={(e) => setTanggalSetor(e.target.value)}
                  className="neo-input w-full text-xs font-bold font-mono-num"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-black uppercase text-gray-700 mb-1">
                  Catatan / Keterangan:
                </label>
                <input
                  type="text"
                  value={alasanSetoran}
                  onChange={(e) => setAlasanSetoran(e.target.value)}
                  placeholder="Contoh: Diserahkan bendahara kelas X"
                  className="neo-input w-full text-xs"
                />
              </div>
            </div>

            {/* LIVE PREVIEW BOX */}
            <div className="neo-box p-4 bg-[#6BCB77]/20 border-2 border-[#111111]">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <span className="text-xs font-black uppercase text-gray-700">
                    Ringkasan Nominal Setoran Otomatis:
                  </span>
                  <div className="text-xs text-gray-800 font-medium mt-0.5">
                    {selectedWeeks.length} minggu × {activeKelas?.jumlahSiswa} siswa ×{' '}
                    {formatRupiah(pengaturan.tarifPerSiswa || 1000)}
                  </div>
                  {selectedWeeks.length > 0 && (
                    <div className="text-[11px] text-gray-600 mt-1 font-semibold">
                      Rentang: {formatKeteranganRentangMinggu(selectedWeeks)}
                    </div>
                  )}
                </div>

                <div className="text-right">
                  <div className="text-xs font-bold text-gray-600">TOTAL SETORAN:</div>
                  <div className="font-mono-num font-black text-2xl text-[#111111]">
                    {formatRupiah(setoranLiveTotal)}
                  </div>
                </div>
              </div>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={selectedWeeks.length === 0 || isSubmittingSetoran}
              className="neo-btn bg-[#FFD93D] hover:bg-[#ffe26b] w-full text-base font-black uppercase tracking-wide justify-center"
            >
              {isSubmittingSetoran ? 'Menyimpan...' : 'SIMPAN SETORAN KAS (AUTO MASUK BUKU KAS)'}
            </button>
          </form>
        </div>
      )}

      {/* ========================================================= */}
      {/* SUB-SECTION 2: DAFTAR SETORAN (EDIT / HAPUS DENGAN ALASAN)*/}
      {/* ========================================================= */}
      {adminSection === 'DAFTAR_SETORAN' && (
        <div className="neo-box bg-white p-4 sm:p-6 space-y-4">
          <div className="flex items-center justify-between border-b-2 border-[#111111] pb-2">
            <div>
              <h3 className="text-base sm:text-lg font-black text-[#111111]">
                Daftar Seluruh Setoran Kas Kelas
              </h3>
              <p className="text-xs text-gray-600 font-medium">
                Setiap edit atau hapus wajib mengisi kolom alasan dan otomatis tercatat di riwayat audit.
              </p>
            </div>
            <span className="font-mono-num text-xs font-bold bg-gray-100 px-2 py-1 rounded border">
              Total {setoranList.length} Setoran
            </span>
          </div>

          {setoranList.length === 0 ? (
            <div className="text-center py-10 text-gray-500 font-bold border-2 border-dashed border-gray-300 rounded text-xs">
              Belum ada catatan setoran kas kelas.
            </div>
          ) : (
            <div className="space-y-2.5 max-h-[550px] overflow-y-auto pr-1">
              {setoranList.map((s) => (
                <div
                  key={s.id}
                  className="neo-box-sm p-3.5 bg-white hover:bg-[#FFFDEB] transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-black text-sm text-[#111111]">{s.kelasNama}</span>
                      <span className="text-[11px] font-bold bg-[#FFD93D] px-1.5 py-0.2 rounded border border-[#111111]">
                        {s.jumlahMinggu} Minggu
                      </span>
                      <span className="font-mono-num text-xs text-gray-500">
                        {formatTanggalIndonesia(s.tanggalSetor)}
                      </span>
                    </div>

                    <div className="text-xs text-gray-700 font-medium">
                      Minggu: {s.daftarMinggu.join(', ')}
                    </div>

                    <div className="text-[11px] text-gray-500 font-mono-num">
                      Snapshot saat setor: {s.jumlahSiswaSnapshot} siswa × {formatRupiah(s.tarifSnapshot)}
                    </div>
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-3 pt-2 sm:pt-0 border-t sm:border-t-0 border-gray-200">
                    <div className="font-mono-num font-black text-base text-[#6BCB77]">
                      {formatRupiah(s.total)}
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => handleOpenEditSetoran(s)}
                        className="neo-btn-sm bg-white hover:bg-gray-100 text-xs px-2 py-1 font-bold"
                        title="Edit setoran"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => {
                          setDeletingSetoran(s);
                          setDeleteAlasan('');
                        }}
                        className="neo-btn-sm bg-red-50 hover:bg-red-100 text-xs px-2 py-1 font-bold text-red-600"
                        title="Hapus setoran"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ========================================================= */}
      {/* SUB-SECTION 3: PEMASUKAN LAIN & PENGELUARAN                */}
      {/* ========================================================= */}
      {adminSection === 'TRANSAKSI' && (
        <div className="neo-box bg-white p-4 sm:p-6 space-y-4">
          <div className="border-b-2 border-[#111111] pb-2">
            <h3 className="text-base sm:text-lg font-black text-[#111111]">
              Input Transaksi Buku Kas (Pemasukan Lain & Pengeluaran)
            </h3>
            <p className="text-xs text-gray-600 font-medium">
              Catatan: Setoran kas mingguan kelas otomatis dicatat melalui tab Setoran Kelas di atas.
            </p>
          </div>

          <form onSubmit={handleSaveTransaksi} className="space-y-4">
            {/* Jenis Transaksi */}
            <div>
              <label className="block text-xs font-black uppercase text-gray-700 mb-1">
                Jenis Transaksi:
              </label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setTransJenis('pemasukan');
                    setTransKategori('Modal');
                  }}
                  className={`neo-btn py-2 text-xs font-black ${
                    transJenis === 'pemasukan' ? 'bg-[#6BCB77] text-[#111111]' : 'bg-white hover:bg-green-50'
                  }`}
                >
                  + PEMASUKAN LAIN
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTransJenis('pengeluaran');
                    setTransKategori('Konsumsi');
                  }}
                  className={`neo-btn py-2 text-xs font-black ${
                    transJenis === 'pengeluaran' ? 'bg-[#FF6B6B] text-white' : 'bg-white hover:bg-red-50'
                  }`}
                >
                  - PENGELUARAN KAS
                </button>
              </div>
            </div>

            {/* Tanggal & Nominal */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-black uppercase text-gray-700 mb-1">
                  Tanggal:
                </label>
                <input
                  type="date"
                  value={transTanggal}
                  onChange={(e) => setTransTanggal(e.target.value)}
                  className="neo-input w-full text-xs font-bold font-mono-num"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-black uppercase text-gray-700 mb-1">
                  Nominal (Rp):
                </label>
                <input
                  type="number"
                  placeholder="Contoh: 150000"
                  value={transNominal}
                  onChange={(e) => setTransNominal(e.target.value === '' ? '' : Number(e.target.value))}
                  className="neo-input w-full text-xs font-bold font-mono-num"
                  required
                  min={1}
                />
              </div>
            </div>

            {/* Kategori & Kategori Baru */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-black uppercase text-gray-700 mb-1">
                  Pilih Kategori:
                </label>
                <select
                  value={transKategori}
                  onChange={(e) => setTransKategori(e.target.value)}
                  className="neo-input w-full text-xs font-bold"
                >
                  {categoriesForJenis.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-black uppercase text-gray-700 mb-1">
                  Atau Buat Kategori Baru (Opsional):
                </label>
                <input
                  type="text"
                  placeholder="Nama kategori baru..."
                  value={newKategoriInput}
                  onChange={(e) => setNewKategoriInput(e.target.value)}
                  className="neo-input w-full text-xs"
                />
              </div>
            </div>

            {/* Keterangan */}
            <div>
              <label className="block text-xs font-black uppercase text-gray-700 mb-1">
                Keterangan Transaksi:
              </label>
              <input
                type="text"
                placeholder="Contoh: Pembelian kue juri lomba poster"
                value={transKeterangan}
                onChange={(e) => setTransKeterangan(e.target.value)}
                className="neo-input w-full text-xs font-medium"
                required
              />
            </div>

            {/* Alasan Wajib untuk Audit Log */}
            <div>
              <label className="block text-xs font-black uppercase text-gray-700 mb-1">
                Alasan / Keperluan Transaksi:
              </label>
              <input
                type="text"
                placeholder="Contoh: Kebutuhan konsumsi juri acara 17-an"
                value={transAlasan}
                onChange={(e) => setTransAlasan(e.target.value)}
                className="neo-input w-full text-xs"
              />
            </div>

            {/* Warning if expense makes balance negative */}
            {willBeNegative && (
              <div className="neo-box-sm bg-[#FF6B6B]/20 border-2 border-[#FF6B6B] p-3 rounded flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-[#FF6B6B] shrink-0" />
                <div className="text-xs font-black text-[#111111]">
                  Peringatan: Pengeluaran ini sebesar {formatRupiah(Number(transNominal))} akan membuat saldo
                  menjadi negatif (Saldo sekarang: {formatRupiah(saldoSekarang)}). Transaksi tetap dapat disimpan.
                </div>
              </div>
            )}

            <button
              type="submit"
              className="neo-btn bg-[#FFD93D] hover:bg-[#ffe26b] w-full text-sm font-black uppercase tracking-wide justify-center"
            >
              SIMPAN TRANSAKSI BUKU KAS
            </button>
          </form>
        </div>
      )}

      {/* ========================================================= */}
      {/* SUB-SECTION 4: KELOLA KELAS                               */}
      {/* ========================================================= */}
      {adminSection === 'KELOLA_KELAS' && (
        <div className="neo-box bg-white p-4 sm:p-6 space-y-4">
          <div className="border-b-2 border-[#111111] pb-2">
            <h3 className="text-base sm:text-lg font-black text-[#111111]">
              Kelola 16 Kelas SMKN 7 Samarinda
            </h3>
            <p className="text-xs text-gray-600 font-medium">
              Aturan Snapshot: Jika jumlah siswa diubah, setoran lama TIDAK akan berubah. Perubahan jumlah siswa
              hanya berlaku untuk setoran baru dan dicatat ke riwayat audit.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {kelasList.map((k) => (
              <div
                key={k.id}
                className="neo-box-sm p-3.5 bg-[#FFF8E7] flex items-center justify-between gap-2"
              >
                <div>
                  <div className="font-black text-sm text-[#111111]">{k.nama}</div>
                  <div className="text-xs text-gray-700 font-medium mt-0.5">
                    Tingkat {k.tingkat} • Urutan #{k.urutan}
                  </div>
                  <div className="font-mono-num font-bold text-xs text-[#6BCB77] mt-0.5">
                    {k.jumlahSiswa} siswa ({formatRupiah(k.jumlahSiswa * (pengaturan.tarifPerSiswa || 1000))}/minggu)
                  </div>
                </div>

                <button
                  onClick={() => handleOpenEditKelas(k)}
                  className="neo-btn-sm bg-white hover:bg-gray-100 text-xs font-bold gap-1"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                  <span>Ubah</span>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* SUB-SECTION 5: JADWAL LIBUR PENARIKAN KAS KELAS           */}
      {/* ========================================================= */}
      {adminSection === 'LIBUR_KAS' && (
        <div className="neo-box bg-white p-4 sm:p-6 space-y-4">
          <div className="border-b-2 border-[#111111] pb-2 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h3 className="text-base sm:text-lg font-black text-[#111111] flex items-center gap-2">
                <CalendarOff className="w-5 h-5 text-amber-600" />
                <span>Jadwal Minggu Tanpa Penarikan Uang Kas</span>
              </h3>
              <p className="text-xs text-gray-600 font-medium mt-0.5">
                Centang minggu yang dibebaskan dari tarikan kas (misalnya selesai ulangan, classmeeting, atau libur sekolah). Minggu ini tidak akan dihitung sebagai tunggakan.
              </p>
            </div>
            {hasUnsavedLiburChanges && (
              <span className="text-[11px] font-bold bg-amber-100 text-amber-800 border border-amber-300 px-2.5 py-1 rounded-lg self-start sm:self-auto">
                Ada perubahan belum disimpan
              </span>
            )}
          </div>

          {/* Active Exempt Weeks Strip */}
          <div className="p-3 rounded-xl bg-amber-50/70 border border-amber-200 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-black uppercase text-amber-900">
                Minggu Libur Kas Terpilih ({sortedActiveDraftLibur.length})
              </span>
              {sortedActiveDraftLibur.length > 0 && (
                <button
                  type="button"
                  onClick={() => setDraftLiburKas({})}
                  className="text-[11px] font-bold text-rose-600 hover:underline"
                >
                  Kosongkan Semua
                </button>
              )}
            </div>

            {sortedActiveDraftLibur.length === 0 ? (
              <p className="text-xs text-amber-800/80 font-medium">
                Belum ada minggu libur kas yang dipilih. Semua minggu aktif tetap ditarik seperti biasa.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {sortedActiveDraftLibur.map(([monday, reason]) => {
                  const weekInfo = weekMapByMonday.get(monday);
                  return (
                    <span
                      key={monday}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white border border-amber-300 text-[11px] font-bold text-amber-950 shadow-2xs"
                    >
                      <span>{weekInfo ? weekInfo.labelShort : monday}</span>
                      <span className="text-amber-700 font-medium">({reason})</span>
                      <button
                        type="button"
                        onClick={() => toggleDraftLiburWeek(monday)}
                        className="text-amber-700 hover:text-rose-600 p-0.5"
                        title="Hapus dari daftar libur kas"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  );
                })}
              </div>
            )}
          </div>

          {/* Reason Preset & Month Filter */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-black uppercase text-gray-700 mb-1">
                Keterangan Default Saat Mencentang:
              </label>
              <input
                type="text"
                value={liburReasonInput}
                onChange={(e) => setLiburReasonInput(e.target.value)}
                placeholder="Contoh: Selesai Ulangan"
                maxLength={100}
                className="neo-input w-full text-xs font-bold"
              />
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {['Selesai Ulangan', 'Classmeeting', 'Libur Sekolah', 'Ujian Sekolah'].map(
                  (preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setLiburReasonInput(preset)}
                      className={`text-[10px] font-bold px-2 py-0.5 rounded border transition-colors ${
                        liburReasonInput === preset
                          ? 'bg-amber-500 text-white border-amber-600'
                          : 'bg-slate-100 text-slate-700 border-slate-200 hover:bg-amber-50'
                      }`}
                    >
                      {preset}
                    </button>
                  )
                )}
              </div>
            </div>

            <div>
              <label className="block text-xs font-black uppercase text-gray-700 mb-1">
                Filter Bulan:
              </label>
              <select
                value={liburMonthFilter}
                onChange={(e) => setLiburMonthFilter(e.target.value)}
                className="neo-input w-full text-xs font-bold"
              >
                <option value="ALL">Semua Bulan ({allWeeks.length} Minggu)</option>
                {availableMonthsForLibur.map((m) => (
                  <option key={m.monthKey} value={m.monthKey}>
                    {m.monthName}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-gray-500 mt-1.5">
                Kelas yang sudah terlanjur setor sebelum minggu dijadikan libur tetap berstatus LUNAS.
              </p>
            </div>
          </div>

          {/* Checklist of Weeks */}
          <div className="max-h-72 overflow-y-auto border-2 border-[#111111] p-2 rounded bg-gray-50 space-y-1.5">
            {filteredWeeksForLibur.map((w) => {
              const isExempt = Object.prototype.hasOwnProperty.call(draftLiburKas, w.startMonday);
              const paidCount = paidCountByWeek.get(w.startMonday) || 0;
              const isCurrentWeek = w.startMonday === currentMonday;
              return (
                <div
                  key={w.startMonday}
                  className={`p-2.5 rounded border transition-colors text-xs ${
                    isExempt
                      ? 'bg-amber-50 border-amber-400'
                      : 'bg-white border-gray-200 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <label className="flex items-center gap-2.5 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={isExempt}
                        onChange={() => toggleDraftLiburWeek(w.startMonday)}
                        className="w-4 h-4 accent-amber-600"
                      />
                      <div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-mono-num font-bold text-slate-900">
                            {w.labelLong}
                          </span>
                          <span className="text-[10px] font-mono-num text-slate-500">
                            (Minggu #{w.weekIndexInYear})
                          </span>
                          {isCurrentWeek && (
                            <span className="text-[10px] font-bold bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">
                              Minggu Ini
                            </span>
                          )}
                        </div>
                        {paidCount > 0 && (
                          <div className="text-[10px] font-semibold text-emerald-700 mt-0.5">
                            Info: {paidCount} kelas sudah menyetor untuk minggu ini (status LUNAS tetap aman)
                          </div>
                        )}
                      </div>
                    </label>

                    {isExempt ? (
                      <div className="flex items-center gap-1.5 pl-6 sm:pl-0">
                        <span className="text-[10px] font-bold text-amber-800 uppercase">Alasan:</span>
                        <input
                          type="text"
                          value={draftLiburKas[w.startMonday]}
                          onChange={(e) => updateDraftLiburReason(w.startMonday, e.target.value)}
                          maxLength={100}
                          className="px-2 py-1 text-[11px] font-semibold bg-white border border-amber-300 rounded w-44"
                        />
                      </div>
                    ) : (
                      <span className="text-[10px] font-semibold text-slate-400 pl-6 sm:pl-0">
                        Penarikan Normal
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Save Footer */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end pt-1">
            <div className="sm:col-span-2">
              <label className="block text-xs font-black uppercase text-gray-700 mb-1">
                Catatan Audit Log:
              </label>
              <input
                type="text"
                value={liburAlasanSimpan}
                onChange={(e) => setLiburAlasanSimpan(e.target.value)}
                placeholder="Contoh: Libur kas minggu selesai ulangan PTS"
                className="neo-input w-full text-xs"
              />
            </div>
            <button
              type="button"
              onClick={handleSaveLiburKas}
              disabled={isSavingLibur || !hasUnsavedLiburChanges}
              className="neo-btn bg-[#FFD93D] hover:bg-[#ffe26b] disabled:opacity-50 disabled:cursor-not-allowed w-full text-xs font-black uppercase justify-center py-2.5"
            >
              {isSavingLibur ? 'Menyimpan...' : 'Simpan Jadwal Libur Kas'}
            </button>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* SUB-SECTION 6: PENGATURAN SISTEM & SEED DARI EXCEL        */}
      {/* ========================================================= */}
      {adminSection === 'PENGATURAN' && (
        <div className="space-y-4">
          {/* 1. Pengaturan Utama */}
          <div className="neo-box bg-white p-4 sm:p-6 space-y-4">
            <div className="border-b-2 border-[#111111] pb-2">
              <h3 className="text-base sm:text-lg font-black text-[#111111]">
                Pengaturan Sistem KAS OSIS
              </h3>
              <p className="text-xs text-gray-600 font-medium">
                Sesuaikan tarif kas, tanggal mulai pencatatan per kelas, dan ganti kode akses viewer.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-black uppercase text-gray-700 mb-1">
                  Tarif Kas per Siswa per Minggu (Rp):
                </label>
                <input
                  type="number"
                  value={newTarif}
                  onChange={(e) => setNewTarif(Number(e.target.value))}
                  className="neo-input w-full text-xs font-mono-num font-bold"
                  min={100}
                />
              </div>

              <div>
                <label className="block text-xs font-black uppercase text-gray-700 mb-1">
                  Tanggal Mulai Pencatatan per Kelas:
                </label>
                <input
                  type="date"
                  value={newTglPencatatan}
                  onChange={(e) => setNewTglPencatatan(e.target.value)}
                  className="neo-input w-full text-xs font-mono-num font-bold"
                />
                <span className="text-[10px] text-gray-500 font-medium">
                  Minggu sebelum tanggal ini tampil sebagai REKAP LAMA & bukan tunggakan.
                </span>
              </div>
            </div>

            {/* Ubah Username & Password Admin */}
            <div className="p-3.5 bg-blue-50/70 border border-blue-200 rounded-xl space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900">
                  <Shield className="w-4 h-4 text-[#0D62C9]" />
                  <span>Username & Password Login Admin</span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowAdminPasswords(!showAdminPasswords)}
                  className="text-[11px] font-semibold text-[#0D62C9] hover:underline flex items-center gap-1"
                >
                  {showAdminPasswords ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  <span>{showAdminPasswords ? 'Sembunyikan' : 'Lihat Password'}</span>
                </button>
              </div>
              <p className="text-[11px] text-slate-600 leading-relaxed">
                Ubah username atau password login Admin Bendahara OSIS di sini (kosongkan kolom password jika tidak ingin mengganti password).
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-[10px] font-bold uppercase text-slate-600 mb-1 flex items-center gap-1">
                    <User className="w-3 h-3" />
                    Username Admin:
                  </label>
                  <input
                    type="text"
                    value={adminUsernameInput}
                    onChange={(e) => setAdminUsernameInput(e.target.value)}
                    placeholder="Username admin..."
                    autoComplete="username"
                    className="neo-input w-full text-xs font-semibold"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase text-slate-600 mb-1 flex items-center gap-1">
                    <Lock className="w-3 h-3" />
                    Password Saat Ini:
                  </label>
                  <input
                    type={showAdminPasswords ? 'text' : 'password'}
                    value={currentAdminPassword}
                    onChange={(e) => setCurrentAdminPassword(e.target.value)}
                    placeholder="Wajib jika ganti password..."
                    autoComplete="current-password"
                    className="neo-input w-full text-xs font-mono-num"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase text-slate-600 mb-1 flex items-center gap-1">
                    <KeyRound className="w-3 h-3" />
                    Password Baru (Min. 8):
                  </label>
                  <input
                    type={showAdminPasswords ? 'text' : 'password'}
                    value={newAdminPassword}
                    onChange={(e) => setNewAdminPassword(e.target.value)}
                    placeholder="Opsional, min. 8 karakter..."
                    autoComplete="new-password"
                    className="neo-input w-full text-xs font-mono-num"
                  />
                </div>
              </div>
            </div>

            {/* Ganti Kode Akses Viewer */}
            <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
                <KeyRound className="w-4 h-4 text-[#0D62C9]" />
                <span>Ganti Kode Akses Bendahara Kelas (Min. 8 Karakter):</span>
              </div>
              <p className="text-[11px] text-slate-600">
                Kode akses baru otomatis di-hash dengan scrypt beserta salt acak sebelum disimpan ke database lokal.
              </p>
              <input
                type="password"
                autoComplete="new-password"
                placeholder="Ketik kode akses baru minimal 8 karakter..."
                value={newViewerCode}
                onChange={(e) => setNewViewerCode(e.target.value)}
                className="neo-input w-full text-xs font-mono-num"
              />
            </div>

            {/* Alasan Wajib */}
            <div>
              <label className="block text-xs font-black uppercase text-gray-700 mb-1">
                Alasan Perubahan Pengaturan:
              </label>
              <input
                type="text"
                placeholder="Contoh: Penyesuaian tarif kas hasil rapat OSIS"
                value={pengaturanAlasan}
                onChange={(e) => setPengaturanAlasan(e.target.value)}
                className="neo-input w-full text-xs"
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
              <button
                type="button"
                onClick={handleSavePengaturan}
                className="neo-btn bg-[#FFD93D] text-xs font-black"
              >
                SIMPAN PERUBAHAN PENGATURAN
              </button>

              <button
                type="button"
                onClick={() => setShowNewYearModal(true)}
                className="neo-btn-sm bg-white hover:bg-gray-100 text-xs font-bold gap-1"
              >
                <CalendarPlus className="w-4 h-4 text-[#111111]" />
                <span>+ Buat Tahun Ajaran Baru</span>
              </button>
            </div>
          </div>

          {/* 2. Tombol Sekali Pakai: Muat Data Awal dari Excel */}
          <div className="neo-box bg-[#FFF8E7] p-4 sm:p-6 border-3 border-[#111111] space-y-3">
            <div className="flex items-center gap-2">
              <FileSpreadsheet className="w-6 h-6 text-[#111111]" />
              <h3 className="text-base sm:text-lg font-black text-[#111111]">
                Muat Data Awal dari Excel (Seed Sekali Pakai)
              </h3>
            </div>

            <p className="text-xs text-gray-700 font-medium leading-relaxed">
              Memasukkan data lengkap 16 kelas (543 siswa: 8 kelas X dan 8 kelas XI) serta 31 transaksi awal
              tahun ajaran 2026/2027. Saldo akhir buku kas dijamin terverifikasi tepat{' '}
              <span className="font-mono-num font-black text-[#111111] bg-white px-1.5 py-0.5 rounded border border-[#111111]">
                Rp2.545.000
              </span>
              .
            </p>

            {pengaturan.seedLoaded ? (
              <div className="p-3 bg-[#6BCB77]/30 border-2 border-[#111111] rounded flex items-center gap-2 text-xs font-black text-[#111111]">
                <Check className="w-4 h-4 text-[#6BCB77] stroke-[3]" />
                <span>DATA AWAL DARI EXCEL SUDAH BERHASIL DIMUAT (TOMBOL DINONAKTIFKAN).</span>
              </div>
            ) : confirmSeed ? (
              <div className="p-3 bg-amber-50 border-2 border-amber-400 rounded space-y-2">
                <p className="text-xs font-bold text-amber-900">
                  Konfirmasi: Muat 16 kelas (543 siswa) dan 31 transaksi awal dari pembukuan Excel? Saldo akhir akan diverifikasi tepat Rp2.545.000.
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleLoadExcelSeed}
                    disabled={isSeeding}
                    className="neo-btn-sm bg-[#6BCB77] text-[#111111] text-xs font-black"
                  >
                    {isSeeding ? 'Memuat...' : 'Ya, Muat Sekarang'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmSeed(false)}
                    className="neo-btn-sm bg-white text-xs font-bold"
                  >
                    Batal
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleLoadExcelSeed}
                disabled={isSeeding}
                className="neo-btn bg-[#6BCB77] hover:bg-[#5bb867] text-[#111111] text-xs font-black uppercase tracking-wider"
              >
                MUAT DATA AWAL DARI EXCEL SEKARANG
              </button>
            )}
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL EDIT SETORAN                                        */}
      {/* ========================================================= */}
      {editingSetoran && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-3">
          <div className="neo-box bg-white max-w-md w-full p-4 sm:p-5 space-y-3">
            <h3 className="text-base font-black text-[#111111]">
              Edit Setoran ({editingSetoran.kelasNama})
            </h3>
            <p className="text-xs text-gray-600">
              Snapshot tersimpan: {editingSetoran.jumlahSiswaSnapshot} siswa ×{' '}
              {formatRupiah(editingSetoran.tarifSnapshot)}
            </p>

            <div>
              <label className="block text-xs font-black uppercase text-gray-700 mb-1">
                Tanggal Setor:
              </label>
              <input
                type="date"
                value={editSetoranTanggal}
                onChange={(e) => setEditSetoranTanggal(e.target.value)}
                className="neo-input w-full text-xs font-mono-num"
              />
            </div>

            <div>
              <label className="block text-xs font-black uppercase text-gray-700 mb-1">
                Alasan Perubahan (WAJIB):
              </label>
              <input
                type="text"
                placeholder="Alasan perubahan setoran..."
                value={editAlasan}
                onChange={(e) => setEditAlasan(e.target.value)}
                className="neo-input w-full text-xs"
                required
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setEditingSetoran(null)}
                className="neo-btn-sm bg-gray-100 text-xs font-bold"
              >
                Batal
              </button>
              <button
                onClick={handleSaveEditSetoran}
                className="neo-btn-sm bg-[#FFD93D] text-xs font-black"
              >
                Simpan Perubahan
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL HAPUS SETORAN                                       */}
      {/* ========================================================= */}
      {deletingSetoran && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-3">
          <div className="neo-box bg-white max-w-md w-full p-4 sm:p-5 space-y-3">
            <h3 className="text-base font-black text-[#FF6B6B] flex items-center gap-1.5">
              <Trash2 className="w-5 h-5 text-[#FF6B6B]" />
              Hapus Setoran Kas
            </h3>
            <p className="text-xs text-gray-700 font-medium">
              Anda akan menghapus setoran <span className="font-bold">{deletingSetoran.kelasNama}</span> senilai{' '}
              <span className="font-mono-num font-bold">{formatRupiah(deletingSetoran.total)}</span> ({deletingSetoran.jumlahMinggu} minggu). Baris transaksi kas terkait juga akan dihapus.
            </p>

            <div>
              <label className="block text-xs font-black uppercase text-gray-700 mb-1">
                Alasan Penghapusan (WAJIB):
              </label>
              <input
                type="text"
                placeholder="Ketik alasan menghapus setoran..."
                value={deleteAlasan}
                onChange={(e) => setDeleteAlasan(e.target.value)}
                className="neo-input w-full text-xs"
                required
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setDeletingSetoran(null)}
                className="neo-btn-sm bg-gray-100 text-xs font-bold"
              >
                Batal
              </button>
              <button
                onClick={handleConfirmDeleteSetoran}
                className="neo-btn-sm bg-[#FF6B6B] text-white text-xs font-black"
              >
                Konfirmasi Hapus
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL EDIT KELAS                                          */}
      {/* ========================================================= */}
      {editKelasTarget && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-3">
          <div className="neo-box bg-white max-w-md w-full p-4 sm:p-5 space-y-3">
            <h3 className="text-base font-black text-[#111111]">
              Ubah Data Kelas {editKelasTarget.nama}
            </h3>

            <div>
              <label className="block text-xs font-black uppercase text-gray-700 mb-1">
                Nama Kelas:
              </label>
              <input
                type="text"
                value={newKelasName}
                onChange={(e) => setNewKelasName(e.target.value)}
                className="neo-input w-full text-xs font-bold"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-black uppercase text-gray-700 mb-1">
                Jumlah Siswa Saat Ini:
              </label>
              <input
                type="number"
                value={newSiswaCount}
                onChange={(e) => setNewSiswaCount(Number(e.target.value))}
                className="neo-input w-full text-xs font-mono-num font-bold"
                min={1}
                max={60}
                required
              />
              <span className="text-[10px] text-gray-500 font-medium">
                Setoran lama TIDAK akan berubah (snapshot aman).
              </span>
            </div>

            <div>
              <label className="block text-xs font-black uppercase text-gray-700 mb-1">
                Alasan Perubahan (WAJIB):
              </label>
              <input
                type="text"
                placeholder="Contoh: Ada siswa mutasi keluar/masuk"
                value={kelasAlasan}
                onChange={(e) => setKelasAlasan(e.target.value)}
                className="neo-input w-full text-xs"
                required
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setEditKelasTarget(null)}
                className="neo-btn-sm bg-gray-100 text-xs font-bold"
              >
                Batal
              </button>
              <button
                onClick={handleSaveEditKelas}
                className="neo-btn-sm bg-[#FFD93D] text-xs font-black"
              >
                Simpan Perubahan
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL TAHUN AJARAN BARU                                   */}
      {/* ========================================================= */}
      {showNewYearModal && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-3">
          <div className="neo-box bg-white max-w-md w-full p-4 sm:p-5 space-y-3">
            <h3 className="text-base font-black text-[#111111]">
              Buat Tahun Ajaran Baru
            </h3>
            <p className="text-xs text-gray-600">
              Data tahun ajaran lama tetap tersimpan sebagai arsip dan dapat dibuka kapan saja melalui pemilih
              tahun ajaran di atas.
            </p>

            <div>
              <label className="block text-xs font-black uppercase text-gray-700 mb-1">
                Label Tahun Ajaran:
              </label>
              <input
                type="text"
                placeholder="Contoh: 2027/2028"
                value={newYearLabel}
                onChange={(e) => setNewYearLabel(e.target.value)}
                className="neo-input w-full text-xs font-mono-num font-bold"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-black uppercase text-gray-700 mb-1">
                  Mulai (Senin):
                </label>
                <input
                  type="date"
                  value={newYearStart}
                  onChange={(e) => setNewYearStart(e.target.value)}
                  className="neo-input w-full text-xs font-mono-num"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-black uppercase text-gray-700 mb-1">
                  Selesai (Minggu):
                </label>
                <input
                  type="date"
                  value={newYearEnd}
                  onChange={(e) => setNewYearEnd(e.target.value)}
                  className="neo-input w-full text-xs font-mono-num"
                  required
                />
              </div>
            </div>

            {/* Carryover saldo checkbox */}
            <label className="flex items-start gap-2 p-2.5 bg-[#FFF8E7] border border-[#111111] rounded cursor-pointer">
              <input
                type="checkbox"
                checked={newYearCarryOver}
                onChange={(e) => setNewYearCarryOver(e.target.checked)}
                className="w-4 h-4 accent-[#111111] mt-0.5"
              />
              <div className="text-xs">
                <span className="font-bold text-[#111111]">Bawa Sisa Saldo Akhir sebagai Modal Awal</span>
                <p className="text-[11px] text-gray-600 mt-0.5">
                  Saldo akhir saat ini sebesar{' '}
                  <span className="font-mono-num font-black text-black">
                    {formatRupiah(saldoSekarang)}
                  </span>{' '}
                  akan dicatat otomatis sebagai transaksi "Modal Awal" di tahun ajaran baru.
                </p>
              </div>
            </label>

            <div>
              <label className="block text-xs font-black uppercase text-gray-700 mb-1">
                Alasan / Catatan:
              </label>
              <input
                type="text"
                value={newYearAlasan}
                onChange={(e) => setNewYearAlasan(e.target.value)}
                className="neo-input w-full text-xs"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setShowNewYearModal(false)}
                className="neo-btn-sm bg-gray-100 text-xs font-bold"
              >
                Batal
              </button>
              <button
                onClick={handleCreateNewAcademicYear}
                className="neo-btn-sm bg-[#FFD93D] text-xs font-black"
              >
                Buka Tahun Ajaran
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
