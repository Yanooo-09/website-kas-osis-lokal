import React, { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { Kelas, WeekInfo, CellStatus } from '../types';
import {
  formatRupiah,
  formatTanggalIndonesia,
  hitungStatusMinggu
} from '../utils/dateAndMoney';
import {
  CheckCircle2,
  XCircle,
  Clock,
  MinusCircle,
  RotateCcw,
  AlertCircle,
  ChevronRight,
  X,
  Users,
  Coins,
  Receipt,
  LayoutGrid,
  Table as TableIcon,
  Search,
  Filter,
  FileSpreadsheet,
  CalendarOff
} from 'lucide-react';
import { sanitizeSpreadsheetCell } from '../utils/sanitize';
import writeXlsxFile, { type Row } from 'write-excel-file/browser';

export const TabKasMingguan: React.FC = () => {
  const {
    kelasList,
    setoranList,
    allWeeks,
    pengaturan,
    currentMonday,
    selectedTahunAjaranId,
    setActiveTab,
    isAdmin
  } = useApp();

  // View Mode: 'CARDS' (HP Friendly) or 'TABLE' (Spreadsheet)
  const [viewMode, setViewMode] = useState<'CARDS' | 'TABLE'>('CARDS');

  // Search & Filter in Cards View
  const [searchQuery, setSearchQuery] = useState('');
  const [filterTingkat, setFilterTingkat] = useState<'ALL' | 'X' | 'XI'>('ALL');

  // Selected class for Detail Modal
  const [selectedKelasDetail, setSelectedKelasDetail] = useState<Kelas | null>(null);

  // Group weeks by monthKey
  const months = useMemo(() => {
    const map = new Map<string, { key: string; name: string; weeks: WeekInfo[] }>();
    allWeeks.forEach((w) => {
      if (!map.has(w.monthKey)) {
        map.set(w.monthKey, { key: w.monthKey, name: w.monthName, weeks: [] });
      }
      map.get(w.monthKey)!.weeks.push(w);
    });
    return Array.from(map.values());
  }, [allWeeks]);

  // Default month: the month where currentMonday is, or first month
  const defaultMonthKey = useMemo(() => {
    const curWeek = allWeeks.find((w) => w.startMonday === currentMonday);
    if (curWeek) return curWeek.monthKey;
    const now = new Date();
    const curKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const found = months.find((m) => m.key === curKey);
    return found ? found.key : (months[0]?.key || '');
  }, [allWeeks, currentMonday, months]);

  const [selectedMonthKey, setSelectedMonthKey] = useState<string>(defaultMonthKey);

  // Active month object
  const currentMonthObj = useMemo(() => {
    return months.find((m) => m.key === selectedMonthKey) || months[0];
  }, [months, selectedMonthKey]);

  // Set of paid weeks per class for quick lookup: Map<classId, Set<weekMonday>>
  const paidWeeksMap = useMemo(() => {
    const map = new Map<string, Set<string>>();
    kelasList.forEach((k) => map.set(k.id, new Set()));
    setoranList
      .filter((s) => s.tahunAjaranId === selectedTahunAjaranId)
      .forEach((s) => {
        const set = map.get(s.kelasId);
        if (set) {
          s.daftarMinggu.forEach((m) => set.add(m));
        }
      });
    return map;
  }, [kelasList, setoranList, selectedTahunAjaranId]);

  const mingguLiburKas = useMemo(
    () => pengaturan.mingguLiburKas || {},
    [pengaturan.mingguLiburKas]
  );

  // "Minggu ini" card calculations
  const thisWeekInfo = useMemo(() => {
    const week = allWeeks.find((w) => w.startMonday === currentMonday);
    if (!week) return null;

    const exemptReason = mingguLiburKas[currentMonday] || '';
    const isExempt = Boolean(exemptReason);
    const paidClasses: Kelas[] = [];
    const unpaidClasses: Kelas[] = [];

    kelasList.forEach((k) => {
      const set = paidWeeksMap.get(k.id);
      if (set && set.has(currentMonday)) {
        paidClasses.push(k);
      } else if (!isExempt) {
        unpaidClasses.push(k);
      }
    });

    return {
      week,
      isExempt,
      exemptReason,
      paidCount: paidClasses.length,
      totalClasses: kelasList.length || 16,
      paidClasses,
      unpaidClasses
    };
  }, [allWeeks, currentMonday, kelasList, paidWeeksMap, mingguLiburKas]);

  // Target and collected cash this selected month (excluding unpaid Libur Kas weeks from target)
  const monthTargetAndCollected = useMemo(() => {
    if (!currentMonthObj) {
      return { target: 0, collected: 0, percent: 0, activeWeeksCount: 0, exemptWeeksCount: 0, totalSiswa: 0 };
    }
    const weeksInMonth = currentMonthObj.weeks;
    const activeWeeksInMonth = weeksInMonth.filter((w) => !mingguLiburKas[w.startMonday]);
    const totalSiswa = kelasList.reduce((acc, k) => acc + k.jumlahSiswa, 0);
    const tarif = pengaturan.tarifPerSiswa || 1000;
    const target = totalSiswa * tarif * activeWeeksInMonth.length;

    let collected = 0;
    weeksInMonth.forEach((w) => {
      kelasList.forEach((k) => {
        const set = paidWeeksMap.get(k.id);
        if (set && set.has(w.startMonday)) {
          collected += k.jumlahSiswa * tarif;
        }
      });
    });

    const percent = target > 0 ? Math.round((collected / target) * 100) : collected > 0 ? 100 : 0;
    return {
      target,
      collected,
      percent,
      activeWeeksCount: activeWeeksInMonth.length,
      exemptWeeksCount: weeksInMonth.length - activeWeeksInMonth.length,
      totalSiswa
    };
  }, [currentMonthObj, kelasList, pengaturan.tarifPerSiswa, paidWeeksMap, mingguLiburKas]);

  // Filtered classes for Cards view
  const filteredClasses = useMemo(() => {
    return kelasList.filter((k) => {
      const matchTingkat = filterTingkat === 'ALL' || k.tingkat === filterTingkat;
      const matchQuery =
        k.nama.toLowerCase().includes(searchQuery.toLowerCase().trim()) ||
        k.tingkat.toLowerCase().includes(searchQuery.toLowerCase().trim());
      return matchTingkat && matchQuery;
    });
  }, [kelasList, filterTingkat, searchQuery]);

  // Cell badge renderer
  const renderCellBadge = (status: CellStatus) => {
    switch (status) {
      case 'LUNAS':
        return (
          <span className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-700 text-[11px] font-semibold px-2 py-0.5 rounded border border-emerald-200">
            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
            <span>Lunas</span>
          </span>
        );
      case 'DI_MUKA':
        return (
          <span className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 text-[11px] font-semibold px-2 py-0.5 rounded border border-blue-200">
            <Clock className="w-3 h-3 text-blue-600" />
            <span>Di Muka</span>
          </span>
        );
      case 'BELUM':
        return (
          <span className="inline-flex items-center gap-1 bg-rose-50 text-rose-700 text-[11px] font-semibold px-2 py-0.5 rounded border border-rose-200">
            <XCircle className="w-3 h-3 text-rose-600" />
            <span>Belum</span>
          </span>
        );
      case 'BELUM_ADA':
        return (
          <span className="inline-flex items-center gap-1 bg-slate-100 text-slate-500 text-[11px] font-medium px-2 py-0.5 rounded">
            <MinusCircle className="w-3 h-3 text-slate-400" />
            <span>N/A</span>
          </span>
        );
      case 'REKAP_LAMA':
        return (
          <span className="inline-flex items-center gap-1 bg-purple-50 text-purple-700 text-[11px] font-semibold px-2 py-0.5 rounded border border-purple-200">
            <RotateCcw className="w-3 h-3 text-purple-600" />
            <span>Rekap Lama</span>
          </span>
        );
      case 'LIBUR_KAS':
        return (
          <span className="inline-flex items-center gap-1 bg-amber-50 text-amber-800 text-[11px] font-semibold px-2 py-0.5 rounded border border-amber-200">
            <CalendarOff className="w-3 h-3 text-amber-600" />
            <span>Libur Kas</span>
          </span>
        );
    }
  };

  // Row Summary for a class
  const getClassRowSummary = (kelas: Kelas) => {
    const paidSet = paidWeeksMap.get(kelas.id) || new Set<string>();
    let tunggakanCount = 0;
    let latestPaidMonday = '';

    allWeeks.forEach((w) => {
      const status = hitungStatusMinggu(
        w.startMonday,
        paidSet.has(w.startMonday),
        pengaturan.tanggalMulaiPencatatanPerKelas,
        currentMonday,
        mingguLiburKas
      );
      if (status === 'BELUM') {
        tunggakanCount++;
      }
      if (paidSet.has(w.startMonday)) {
        if (!latestPaidMonday || w.startMonday > latestPaidMonday) {
          latestPaidMonday = w.startMonday;
        }
      }
    });

    if (tunggakanCount > 0) {
      return (
        <span className="inline-flex items-center text-rose-700 bg-rose-50 text-xs font-semibold px-2.5 py-0.5 rounded-md border border-rose-200">
          Tunggakan {tunggakanCount} minggu
        </span>
      );
    }

    if (latestPaidMonday) {
      const paidWeekObj = allWeeks.find((w) => w.startMonday === latestPaidMonday);
      return (
        <span className="inline-flex items-center text-emerald-700 bg-emerald-50 text-xs font-semibold px-2.5 py-0.5 rounded-md border border-emerald-200">
          Lunas s/d {paidWeekObj ? paidWeekObj.labelShort : latestPaidMonday}
        </span>
      );
    }

    return (
      <span className="inline-flex items-center text-slate-500 bg-slate-100 text-xs font-medium px-2.5 py-0.5 rounded-md">
        Belum ada setoran
      </span>
    );
  };

  // Ekspor Rekapitulasi Tunggakan Kas ke Excel (.xlsx) - Khusus Admin
  const handleExportTunggakanExcel = async () => {
    if (!isAdmin) {
      return;
    }

    if (kelasList.length === 0) {
      return;
    }

    const tarif = pengaturan.tarifPerSiswa || 1000;
    let totalSiswaSekolah = 0;
    let grandTotalTunggakanNominal = 0;
    let totalMingguTunggakanSemua = 0;

    const headerRow: Row = [
      { value: 'No', fontWeight: 'bold' },
      { value: 'Tingkat', fontWeight: 'bold' },
      { value: 'Nama Kelas', fontWeight: 'bold' },
      { value: 'Jumlah Siswa', fontWeight: 'bold' },
      { value: 'Tarif/Siswa (Rp)', fontWeight: 'bold' },
      { value: 'Iuran/Minggu (Rp)', fontWeight: 'bold' },
      { value: 'Status Setoran', fontWeight: 'bold' },
      { value: 'Tunggakan (Minggu)', fontWeight: 'bold' },
      { value: 'Total Tunggakan (Rp)', fontWeight: 'bold' },
      { value: 'Daftar Minggu Belum Bayar', fontWeight: 'bold' }
    ];

    const dataRows: Row[] = kelasList.map((k, index) => {
      const paidSet = paidWeeksMap.get(k.id) || new Set<string>();
      const unpaidWeeks: WeekInfo[] = [];

      allWeeks.forEach((w) => {
        const status = hitungStatusMinggu(
          w.startMonday,
          paidSet.has(w.startMonday),
          pengaturan.tanggalMulaiPencatatanPerKelas,
          currentMonday,
          mingguLiburKas
        );
        if (status === 'BELUM') {
          unpaidWeeks.push(w);
        }
      });

      const tunggakanCount = unpaidWeeks.length;
      const nominalTunggakan = tunggakanCount * k.jumlahSiswa * tarif;
      const tarifPerMinggu = k.jumlahSiswa * tarif;

      totalSiswaSekolah += k.jumlahSiswa;
      grandTotalTunggakanNominal += nominalTunggakan;
      totalMingguTunggakanSemua += tunggakanCount;

      const rincianMinggu =
        unpaidWeeks.length > 0
          ? unpaidWeeks.map((w) => w.labelShort).join(', ')
          : 'Lunas (Tidak ada tunggakan)';

      return [
        { type: Number, value: index + 1 },
        { type: String, value: sanitizeSpreadsheetCell(`Kelas ${k.tingkat}`) },
        { type: String, value: sanitizeSpreadsheetCell(k.nama) },
        { type: Number, value: k.jumlahSiswa },
        { type: Number, value: tarif, format: '#,##0' },
        { type: Number, value: tarifPerMinggu, format: '#,##0' },
        {
          type: String,
          value: sanitizeSpreadsheetCell(
            tunggakanCount > 0 ? `Menunggak ${tunggakanCount} Minggu` : 'LUNAS SEMUA'
          )
        },
        { type: Number, value: tunggakanCount },
        { type: Number, value: nominalTunggakan, format: '#,##0' },
        { type: String, value: sanitizeSpreadsheetCell(rincianMinggu) }
      ];
    });

    const summaryRow: Row = [
      { type: String, value: '' },
      { type: String, value: 'TOTAL', fontWeight: 'bold' },
      { type: String, value: `${kelasList.length} Kelas`, fontWeight: 'bold' },
      { type: Number, value: totalSiswaSekolah, fontWeight: 'bold' },
      { type: Number, value: tarif, fontWeight: 'bold', format: '#,##0' },
      { type: Number, value: totalSiswaSekolah * tarif, fontWeight: 'bold', format: '#,##0' },
      {
        type: String,
        value: grandTotalTunggakanNominal > 0 ? 'Masih Ada Tunggakan' : 'LUNAS SEMUA',
        fontWeight: 'bold'
      },
      { type: Number, value: totalMingguTunggakanSemua, fontWeight: 'bold' },
      { type: Number, value: grandTotalTunggakanNominal, fontWeight: 'bold', format: '#,##0' },
      {
        type: String,
        value: `Total piutang kas yang belum disetor: Rp ${grandTotalTunggakanNominal.toLocaleString('id-ID')}`,
        fontWeight: 'bold'
      }
    ];

    const cleanTahun = selectedTahunAjaranId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const todayStr = new Date().toISOString().slice(0, 10);

    await writeXlsxFile([headerRow, ...dataRows, summaryRow], {
      columns: [
        { width: 6 },
        { width: 12 },
        { width: 18 },
        { width: 14 },
        { width: 16 },
        { width: 18 },
        { width: 24 },
        { width: 18 },
        { width: 22 },
        { width: 60 }
      ],
      sheet: 'Rekap Tunggakan Kas'
    }).toFile(`Rekap_Tunggakan_Kas_Kelas_SMKN7_${cleanTahun}_${todayStr}.xlsx`);
  };

  return (
    <div className="space-y-6">
      {/* 1. KARTU MINGGU INI */}
      {thisWeekInfo && (
        <div className="bg-white border border-slate-200/90 shadow-xs rounded-xl p-5 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4 mb-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="bg-[#6C2BD9] text-white text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider">
                  Minggu Ini
                </span>
                <span className="font-mono-num font-bold text-sm sm:text-base text-slate-800">
                  {thisWeekInfo.week.labelLong}
                </span>
              </div>
              <p className="text-xs text-slate-500 font-medium mt-1">
                Tarif kas: {formatRupiah(pengaturan.tarifPerSiswa || 1000)} / siswa / minggu
              </p>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs sm:text-sm font-bold text-slate-700">
                {thisWeekInfo.isExempt
                  ? 'Tidak ada tarikan kas minggu ini'
                  : `${thisWeekInfo.paidCount} dari ${thisWeekInfo.totalClasses} kelas lunas`}
              </span>
              {isAdmin && (
                <button
                  onClick={() => setActiveTab('ADMIN')}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-3 py-1.5 rounded-lg shadow-xs transition-colors"
                >
                  + Catat Setoran
                </button>
              )}
            </div>
          </div>

          {/* Progress Bar */}
          {!thisWeekInfo.isExempt && (
            <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden mb-4">
              <div
                className="h-full bg-emerald-500 rounded-full transition-all duration-300"
                style={{
                  width: `${(thisWeekInfo.paidCount / thisWeekInfo.totalClasses) * 100}%`
                }}
              />
            </div>
          )}

          {/* Exempt Banner OR Unpaid Classes Alert List */}
          {thisWeekInfo.isExempt ? (
            <div className="bg-amber-50 border border-amber-200 p-3.5 rounded-xl flex items-start gap-2.5 text-xs text-amber-900">
              <CalendarOff className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <div className="font-bold">
                  Libur Penarikan Kas: {thisWeekInfo.exemptReason}
                </div>
                <p className="text-[11px] text-amber-800/85 mt-0.5">
                  Minggu ini dinonaktifkan oleh Admin sehingga kelas tidak dihitung menunggak.
                </p>
              </div>
            </div>
          ) : thisWeekInfo.unpaidClasses.length > 0 ? (
            <div className="bg-slate-50/80 border border-slate-200 rounded-xl p-3.5">
              <div className="flex items-center gap-1.5 text-xs font-bold text-rose-700 mb-2">
                <AlertCircle className="w-4 h-4 text-rose-600" />
                <span>Kelas yang BELUM setor minggu ini ({thisWeekInfo.unpaidClasses.length}):</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {thisWeekInfo.unpaidClasses.map((k) => (
                  <button
                    key={k.id}
                    onClick={() => setSelectedKelasDetail(k)}
                    className="bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 text-xs py-1 px-2.5 rounded-lg font-semibold flex items-center gap-1 shadow-2xs transition-colors"
                  >
                    <span>{k.nama}</span>
                    <span className="text-[10px] text-slate-400 font-mono-num">
                      ({formatRupiah(k.jumlahSiswa * (pengaturan.tarifPerSiswa || 1000))})
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="bg-emerald-50 border border-emerald-200 p-3 rounded-xl flex items-center gap-2 text-xs font-bold text-emerald-800">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              <span>Hebat! Seluruh 16 kelas sudah melunasi kas minggu ini!</span>
            </div>
          )}
        </div>
      )}

      {/* 2. PEMILIH BULAN & VIEW SWITCHER */}
      <div className="bg-white border border-slate-200/90 shadow-xs rounded-xl p-5 sm:p-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-5">
          <div>
            <h2 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight">
              Matriks Kas Mingguan 16 Kelas
            </h2>
            <p className="text-xs text-slate-500 font-medium mt-0.5">
              Pilih bulan untuk memeriksa status setoran kelas.
            </p>
          </div>

          {/* View Switcher Tabs (Kartu vs Tabel) & Export Excel (Khusus Admin) */}
          <div className="flex flex-wrap items-center gap-2">
            {isAdmin && (
              <button
                onClick={handleExportTunggakanExcel}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs transition-all cursor-pointer"
                title="Unduh Rekapitulasi Tunggakan Kas Kelas dalam format Excel (.xlsx)"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-white" />
                <span>Ekspor Rekap Tunggakan (.xlsx)</span>
              </button>
            )}

            <div className="flex p-1 bg-slate-100 rounded-xl border border-slate-200/80">
              <button
                onClick={() => setViewMode('CARDS')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  viewMode === 'CARDS'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
                title="Tampilan Kartu (Ramah Layar HP)"
              >
                <LayoutGrid className="w-3.5 h-3.5" />
                <span>Kartu (HP)</span>
              </button>

              <button
                onClick={() => setViewMode('TABLE')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  viewMode === 'TABLE'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
                title="Tampilan Tabel Matriks (Komputer/Laptop)"
              >
                <TableIcon className="w-3.5 h-3.5" />
                <span>Tabel Lengkap</span>
              </button>
            </div>
          </div>
        </div>

        {/* Month Selector Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-2 mb-4 scrollbar-none">
          {months.map((m) => {
            const isSelected = m.key === selectedMonthKey;
            return (
              <button
                key={m.key}
                onClick={() => setSelectedMonthKey(m.key)}
                className={`px-3 py-1.5 text-xs font-bold rounded-lg shrink-0 transition-all ${
                  isSelected
                    ? 'bg-[#0D62C9] text-white shadow-xs'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {m.name}
              </button>
            );
          })}
        </div>

        {/* Month Summary Bar */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-slate-50 border border-slate-200/80 p-4 rounded-xl mb-5">
          <div>
            <span className="text-[11px] font-semibold text-slate-500 uppercase">
              Target Kas Bulan Ini
            </span>
            <div className="font-mono-num font-bold text-base text-slate-900 mt-0.5">
              {formatRupiah(monthTargetAndCollected.target)}
            </div>
            <span className="text-[10px] text-slate-400 font-medium">
              {monthTargetAndCollected.activeWeeksCount} minggu aktif
              {monthTargetAndCollected.exemptWeeksCount > 0
                ? ` (${monthTargetAndCollected.exemptWeeksCount} libur kas)`
                : ''}{' '}
              × {monthTargetAndCollected.totalSiswa} siswa × {formatRupiah(pengaturan.tarifPerSiswa || 1000)}
            </span>
          </div>

          <div>
            <span className="text-[11px] font-semibold text-slate-500 uppercase">
              Terkumpul Bulan Ini
            </span>
            <div className="font-mono-num font-bold text-base text-emerald-600 mt-0.5">
              {formatRupiah(monthTargetAndCollected.collected)}
            </div>
            <span className="text-[10px] text-slate-400 font-medium">
              Capaian: {monthTargetAndCollected.percent}%
            </span>
          </div>

          <div>
            <span className="text-[11px] font-semibold text-slate-500 uppercase">
              Sisa Belum Terkumpul
            </span>
            <div className="font-mono-num font-bold text-base text-rose-600 mt-0.5">
              {formatRupiah(Math.max(0, monthTargetAndCollected.target - monthTargetAndCollected.collected))}
            </div>
            <span className="text-[10px] text-slate-400 font-medium">
              Sesuai minggu aktif bulan ini
            </span>
          </div>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-600 bg-slate-50/60 p-2.5 border border-slate-200 rounded-xl mb-4">
          <span className="text-[10px] font-bold uppercase text-slate-400">Keterangan:</span>
          {renderCellBadge('LUNAS')}
          {renderCellBadge('DI_MUKA')}
          {renderCellBadge('BELUM')}
          {renderCellBadge('LIBUR_KAS')}
          {renderCellBadge('BELUM_ADA')}
          {renderCellBadge('REKAP_LAMA')}
        </div>

        {/* ========================================================= */}
        {/* VIEW MODE A: KARTU KELAS (HP FRIENDLY & LEGA DI MATA)     */}
        {/* ========================================================= */}
        {viewMode === 'CARDS' && (
          <div className="space-y-4">
            {/* Filter & Search Bar */}
            <div className="flex flex-col sm:flex-row gap-2.5 justify-between">
              <div className="relative flex-1">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Cari kelas (contoh: TJKT, PPLG, Animasi, DKV)..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3.5 py-2 rounded-xl border border-slate-200 text-xs bg-slate-50 focus:bg-white focus:border-[#6C2BD9] outline-none transition-all"
                />
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => setFilterTingkat('ALL')}
                  className={`px-3 py-2 text-xs font-bold rounded-lg transition-colors ${
                    filterTingkat === 'ALL'
                      ? 'bg-slate-800 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  Semua (16)
                </button>
                <button
                  onClick={() => setFilterTingkat('X')}
                  className={`px-3 py-2 text-xs font-bold rounded-lg transition-colors ${
                    filterTingkat === 'X'
                      ? 'bg-slate-800 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  Kelas X (8)
                </button>
                <button
                  onClick={() => setFilterTingkat('XI')}
                  className={`px-3 py-2 text-xs font-bold rounded-lg transition-colors ${
                    filterTingkat === 'XI'
                      ? 'bg-slate-800 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  Kelas XI (8)
                </button>
              </div>
            </div>

            {/* Grid of Class Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {filteredClasses.map((kelas) => {
                const paidSet = paidWeeksMap.get(kelas.id) || new Set<string>();
                const weeksInMonth = currentMonthObj?.weeks || [];

                let paidInMonthCount = 0;
                let activeWeeksInMonthCount = 0;
                weeksInMonth.forEach((w) => {
                  const isPaid = paidSet.has(w.startMonday);
                  if (isPaid) paidInMonthCount++;
                  if (isPaid || !mingguLiburKas[w.startMonday]) activeWeeksInMonthCount++;
                });

                const monthPercent =
                  activeWeeksInMonthCount > 0
                    ? Math.round((paidInMonthCount / activeWeeksInMonthCount) * 100)
                    : 100;

                return (
                  <div
                    key={kelas.id}
                    onClick={() => setSelectedKelasDetail(kelas)}
                    className="p-4 rounded-xl border border-slate-200 bg-white hover:border-[#6C2BD9]/50 hover:shadow-sm transition-all cursor-pointer flex flex-col justify-between group"
                  >
                    <div>
                      {/* Class Header */}
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="font-bold text-sm sm:text-base text-slate-900 group-hover:text-[#6C2BD9] transition-colors">
                              {kelas.nama}
                            </h3>
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                              Tingkat {kelas.tingkat}
                            </span>
                          </div>
                          <p className="text-xs text-slate-500 font-medium mt-0.5">
                            {kelas.jumlahSiswa} siswa · {formatRupiah(kelas.jumlahSiswa * (pengaturan.tarifPerSiswa || 1000))}/mgg
                          </p>
                        </div>
                        <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-[#6C2BD9] group-hover:translate-x-0.5 transition-all" />
                      </div>

                      {/* Status Global */}
                      <div className="mb-3">{getClassRowSummary(kelas)}</div>

                      {/* Month Week Status Pills */}
                      <div className="space-y-1.5 pt-2 border-t border-slate-100">
                        <div className="flex items-center justify-between text-[11px] text-slate-500 font-medium">
                          <span>{currentMonthObj?.name}:</span>
                          <span className="font-bold text-slate-700">
                            {paidInMonthCount}/{activeWeeksInMonthCount} Minggu ({monthPercent}%)
                          </span>
                        </div>

                        <div className="grid grid-cols-4 sm:grid-cols-5 gap-1.5">
                          {weeksInMonth.map((w, wIdx) => {
                            const isPaid = paidSet.has(w.startMonday);
                            const isCurrent = w.startMonday === currentMonday;
                            const status = hitungStatusMinggu(
                              w.startMonday,
                              isPaid,
                              pengaturan.tanggalMulaiPencatatanPerKelas,
                              currentMonday,
                              mingguLiburKas
                            );
                            const liburNote = mingguLiburKas[w.startMonday];

                            return (
                              <div
                                key={w.startMonday}
                                title={status === 'LIBUR_KAS' ? `Libur Kas: ${liburNote}` : w.labelLong}
                                className={`text-center py-1 px-1 rounded-md text-[10px] font-bold flex flex-col items-center justify-center ${
                                  isPaid
                                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                    : status === 'LIBUR_KAS'
                                    ? 'bg-amber-50 text-amber-800 border border-amber-200'
                                    : isCurrent
                                    ? 'bg-rose-50 text-rose-700 border border-rose-300 ring-1 ring-rose-400'
                                    : 'bg-slate-100 text-slate-500'
                                }`}
                              >
                                <span>M{wIdx + 1}</span>
                                <span className="text-[9px] font-normal opacity-85">
                                  {isPaid ? 'Lunas' : status === 'LIBUR_KAS' ? 'Libur' : 'Belum'}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>

                    <div className="mt-3 pt-2 text-[11px] text-[#6C2BD9] font-bold flex items-center justify-end gap-1">
                      <span>Rincian Pembayaran</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* VIEW MODE B: TABEL MATRIKS (DESKTOP / SPREADSHEET)        */}
        {/* ========================================================= */}
        {viewMode === 'TABLE' && (
          <div className="rounded-xl border border-slate-200 overflow-x-auto relative">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <th className="sticky left-0 z-20 bg-slate-50 border-r border-slate-200 p-3 font-bold text-xs uppercase min-w-[140px] sm:min-w-[160px] shadow-xs">
                    Nama Kelas
                  </th>
                  <th className="border-r border-slate-200 p-3 font-bold text-xs text-center min-w-[70px]">
                    Siswa
                  </th>
                  <th className="border-r border-slate-200 p-3 font-bold text-xs min-w-[160px]">
                    Status Global
                  </th>
                  {currentMonthObj?.weeks.map((week) => {
                    const isCurrent = week.startMonday === currentMonday;
                    const liburNote = mingguLiburKas[week.startMonday];
                    return (
                      <th
                        key={week.startMonday}
                        title={liburNote ? `Libur Kas: ${liburNote}` : week.labelLong}
                        className={`border-r last:border-r-0 border-slate-200 p-2.5 font-bold text-center min-w-[105px] ${
                          liburNote
                            ? 'bg-amber-50/70 text-amber-900'
                            : isCurrent
                            ? 'bg-purple-50 text-[#6C2BD9]'
                            : ''
                        }`}
                      >
                        <div className="font-mono-num text-[11px]">{week.labelShort}</div>
                        <div className="flex items-center justify-center gap-1 mt-0.5">
                          {isCurrent && (
                            <span className="inline-block bg-[#6C2BD9] text-white text-[9px] px-1 rounded uppercase font-sans font-bold">
                              Ini
                            </span>
                          )}
                          {liburNote && (
                            <span className="inline-block bg-amber-200/80 text-amber-900 text-[9px] px-1 rounded uppercase font-sans font-bold">
                              Libur
                            </span>
                          )}
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-200">
                {kelasList.map((kelas, idx) => {
                  const paidSet = paidWeeksMap.get(kelas.id) || new Set<string>();
                  const isClassXFirst = idx === 0;
                  const isClassXILast = idx === 8;

                  return (
                    <React.Fragment key={kelas.id}>
                      {(isClassXFirst || isClassXILast) && (
                        <tr className="bg-slate-100/70 border-y border-slate-200">
                          <td
                            colSpan={3 + (currentMonthObj?.weeks.length || 0)}
                            className="px-3.5 py-1.5 text-[11px] font-bold uppercase text-slate-500 tracking-wider"
                          >
                            Tingkat {kelas.tingkat} ({kelas.tingkat === 'X' ? '8 Kelas' : '8 Kelas'})
                          </td>
                        </tr>
                      )}

                      <tr className="hover:bg-slate-50/80 transition-colors">
                        <td className="sticky left-0 z-10 bg-white border-r border-slate-200 p-2.5 sm:p-3 font-bold shadow-xs">
                          <button
                            onClick={() => setSelectedKelasDetail(kelas)}
                            className="text-left font-bold text-xs sm:text-sm text-slate-900 hover:text-[#6C2BD9] flex items-center justify-between w-full group"
                          >
                            <span>{kelas.nama}</span>
                            <ChevronRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-[#6C2BD9] transition-transform" />
                          </button>
                        </td>

                        <td className="border-r border-slate-200 p-2.5 text-center font-mono-num font-semibold text-xs text-slate-700">
                          {kelas.jumlahSiswa}
                        </td>

                        <td className="border-r border-slate-200 p-2.5">
                          {getClassRowSummary(kelas)}
                        </td>

                        {currentMonthObj?.weeks.map((week) => {
                          const status = hitungStatusMinggu(
                            week.startMonday,
                            paidSet.has(week.startMonday),
                            pengaturan.tanggalMulaiPencatatanPerKelas,
                            currentMonday,
                            mingguLiburKas
                          );

                          return (
                            <td
                              key={week.startMonday}
                              title={
                                status === 'LIBUR_KAS'
                                  ? `Tidak ada penarikan kas: ${mingguLiburKas[week.startMonday]}`
                                  : undefined
                              }
                              className={`border-r last:border-r-0 border-slate-200 p-2 text-center ${
                                status === 'LIBUR_KAS'
                                  ? 'bg-amber-50/30'
                                  : week.startMonday === currentMonday
                                  ? 'bg-purple-50/30'
                                  : ''
                              }`}
                            >
                              {renderCellBadge(status)}
                            </td>
                          );
                        })}
                      </tr>
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 3. MODAL DETAIL PEMBAYARAN KELAS */}
      {selectedKelasDetail && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4">
          <div className="bg-white border border-slate-200 shadow-xl rounded-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-5 sm:p-6 relative">
            {/* Close Button */}
            <button
              onClick={() => setSelectedKelasDetail(null)}
              className="absolute top-4 right-4 p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
              title="Tutup"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="border-b border-slate-100 pb-3 mb-4">
              <span className="text-[10px] font-bold uppercase bg-purple-50 text-[#6C2BD9] px-2.5 py-0.5 rounded-md border border-purple-200">
                Rincian Kas Kelas
              </span>
              <h2 className="text-xl font-bold text-slate-900 mt-1.5">
                {selectedKelasDetail.nama}
              </h2>
              <p className="text-xs text-slate-500 font-medium">
                Tingkat {selectedKelasDetail.tingkat} · Urutan #{selectedKelasDetail.urutan}
              </p>
            </div>

            {/* Quick Metrics */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 mb-4">
              <div className="p-3 bg-slate-50 border border-slate-200/80 rounded-xl">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">
                  <Users className="w-3.5 h-3.5" />
                  <span>Jumlah Siswa</span>
                </div>
                <div className="font-mono-num font-bold text-base text-slate-900 mt-1">
                  {selectedKelasDetail.jumlahSiswa} siswa
                </div>
              </div>

              <div className="p-3 bg-slate-50 border border-slate-200/80 rounded-xl">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">
                  <Coins className="w-3.5 h-3.5" />
                  <span>Tarif / Minggu</span>
                </div>
                <div className="font-mono-num font-bold text-base text-slate-900 mt-1">
                  {formatRupiah(selectedKelasDetail.jumlahSiswa * (pengaturan.tarifPerSiswa || 1000))}
                </div>
              </div>

              <div className="p-3 bg-slate-50 border border-slate-200/80 rounded-xl col-span-2 sm:col-span-1">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">
                  <Receipt className="w-3.5 h-3.5" />
                  <span>Total Disetor</span>
                </div>
                <div className="font-mono-num font-bold text-base text-emerald-600 mt-1">
                  {formatRupiah(
                    setoranList
                      .filter(
                        (s) =>
                          s.kelasId === selectedKelasDetail.id &&
                          s.tahunAjaranId === selectedTahunAjaranId
                      )
                      .reduce((acc, cur) => acc + cur.total, 0)
                  )}
                </div>
              </div>
            </div>

            {/* Status Tunggakan */}
            {(() => {
              const paidSet = paidWeeksMap.get(selectedKelasDetail.id) || new Set<string>();
              const unpaidWeeks: WeekInfo[] = [];

              allWeeks.forEach((w) => {
                const status = hitungStatusMinggu(
                  w.startMonday,
                  paidSet.has(w.startMonday),
                  pengaturan.tanggalMulaiPencatatanPerKelas,
                  currentMonday,
                  mingguLiburKas
                );
                if (status === 'BELUM') {
                  unpaidWeeks.push(w);
                }
              });

              if (unpaidWeeks.length > 0) {
                const totalTunggakan =
                  unpaidWeeks.length *
                  selectedKelasDetail.jumlahSiswa *
                  (pengaturan.tarifPerSiswa || 1000);
                return (
                  <div className="bg-rose-50 border border-rose-200 p-3.5 rounded-xl mb-4">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-rose-800 uppercase">
                        Tunggakan Belum Bayar ({unpaidWeeks.length} Minggu)
                      </span>
                      <span className="font-mono-num font-bold text-sm text-rose-700">
                        Total: {formatRupiah(totalTunggakan)}
                      </span>
                    </div>
                    <p className="text-[11px] text-rose-700 mt-1 mb-2 font-medium">
                      Berikut daftar minggu berjalan yang belum disetorkan:
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {unpaidWeeks.map((w) => (
                        <span
                          key={w.startMonday}
                          className="bg-white border border-rose-200 text-rose-800 px-2.5 py-0.5 rounded-md text-xs font-mono-num font-semibold shadow-2xs"
                        >
                          {w.labelLong}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              }

              return (
                <div className="bg-emerald-50 border border-emerald-200 p-3.5 rounded-xl mb-4 flex items-center gap-2.5">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                  <div>
                    <div className="text-xs font-bold text-emerald-900">
                      Kelas ini Tidak Memiliki Tunggakan!
                    </div>
                    <div className="text-[11px] text-emerald-700 font-medium">
                      Semua minggu yang telah berjalan sudah lunas disetorkan.
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Riwayat Setoran Kelas */}
            <div className="mt-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
                Riwayat Setoran ({selectedKelasDetail.nama})
              </h3>
              {(() => {
                const kelasSetoran = setoranList.filter(
                  (s) =>
                    s.kelasId === selectedKelasDetail.id &&
                    s.tahunAjaranId === selectedTahunAjaranId
                );

                if (kelasSetoran.length === 0) {
                  return (
                    <div className="text-center py-6 border border-dashed border-slate-200 rounded-xl text-xs text-slate-400 font-medium">
                      Belum ada catatan setoran kas untuk kelas ini.
                    </div>
                  );
                }

                return (
                  <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                    {kelasSetoran.map((s, idx) => (
                      <div
                        key={s.id}
                        className="p-3 bg-slate-50 border border-slate-200/80 rounded-xl"
                      >
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-semibold text-slate-700">
                            Setoran #{kelasSetoran.length - idx} · {formatTanggalIndonesia(s.tanggalSetor)}
                          </span>
                          <span className="font-mono-num font-bold text-sm text-emerald-600">
                            {formatRupiah(s.total)}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-600 mt-1">
                          <span className="font-medium text-slate-400">{s.jumlahMinggu} minggu:</span>{' '}
                          {s.daftarMinggu.join(', ')}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>

            {/* Quick Action for Admin */}
            {isAdmin && (
              <div className="mt-5 pt-3 border-t border-slate-100 flex justify-end">
                <button
                  onClick={() => {
                    setSelectedKelasDetail(null);
                    setActiveTab('ADMIN');
                  }}
                  className="w-full bg-[#6C2BD9] hover:bg-[#5b21b6] text-white py-2.5 rounded-xl text-xs font-bold shadow-xs transition-colors flex items-center justify-center gap-1.5"
                >
                  Buka Form Setoran untuk {selectedKelasDetail.nama}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
