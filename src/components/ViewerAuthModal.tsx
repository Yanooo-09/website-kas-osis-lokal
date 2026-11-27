import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { KeyRound, ShieldCheck, Eye, EyeOff, AlertCircle, Lock, User } from 'lucide-react';

export const ViewerAuthModal: React.FC = () => {
  const {
    loginViewerWithCode,
    loginAdminWithCredentials,
    setupInitialAdminAccount,
    pengaturan,
    dbError
  } = useApp();

  // Mode: 'VIEWER' or 'ADMIN'
  const [authMode, setAuthMode] = useState<'VIEWER' | 'ADMIN'>('VIEWER');

  // Viewer state
  const [passcode, setPasscode] = useState('');
  const [showViewerPassword, setShowViewerPassword] = useState(false);

  // Admin state
  const [isSetupMode, setIsSetupMode] = useState<boolean>(!pengaturan.adminConfigured);
  const [hasManualToggle, setHasManualToggle] = useState<boolean>(false);
  const [adminUsername, setAdminUsername] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [confirmAdminPassword, setConfirmAdminPassword] = useState('');
  const [showAdminPassword, setShowAdminPassword] = useState(false);

  // Common UI state
  const [errorMsg, setErrorMsg] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!hasManualToggle) {
      setIsSetupMode(!pengaturan.adminConfigured);
      if (!pengaturan.adminConfigured && !adminUsername) {
        setAdminUsername(pengaturan.adminUsername || 'alkiyano');
      }
    }
  }, [pengaturan.adminConfigured, pengaturan.adminUsername, hasManualToggle, adminUsername]);

  // Handle Viewer submission
  const handleViewerSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passcode.trim()) {
      setErrorMsg('Masukkan kode akses.');
      return;
    }

    setIsLoading(true);
    setErrorMsg('');
    const res = await loginViewerWithCode(passcode);
    setIsLoading(false);

    if (!res.success) {
      setErrorMsg(res.message || 'Kode akses salah. Silakan tanyakan kepada Bendahara OSIS.');
    }
  };

  // Handle Admin username & password login / initial activation
  const handleAdminSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    if (isSetupMode) {
      if (!adminUsername.trim()) {
        setErrorMsg('Masukkan username admin.');
        return;
      }
      if (adminPassword.length < 8) {
        setErrorMsg('Password admin minimal 8 karakter.');
        return;
      }
      if (adminPassword !== confirmAdminPassword) {
        setErrorMsg('Konfirmasi password tidak cocok.');
        return;
      }

      setIsLoading(true);
      const res = await setupInitialAdminAccount(adminUsername, adminPassword);
      setIsLoading(false);

      if (!res.success) {
        setErrorMsg(res.message || 'Gagal mengaktifkan akun Admin.');
      }
      return;
    }

    if (!adminUsername.trim() || !adminPassword) {
      setErrorMsg('Masukkan username dan password admin.');
      return;
    }

    setIsLoading(true);
    const res = await loginAdminWithCredentials(adminUsername, adminPassword);
    setIsLoading(false);

    if (!res.success) {
      setErrorMsg(res.message || 'Username atau password salah.');
    }
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex flex-col justify-center items-center p-4">
      <div className="max-w-md w-full bg-white border border-slate-200/90 shadow-sm rounded-2xl p-6 sm:p-8 space-y-6">
        {/* Header Branding */}
        <div className="text-center space-y-3 border-b border-slate-100 pb-5">
          <div className="w-20 h-20 sm:w-24 sm:h-24 mx-auto rounded-3xl bg-white border border-slate-200/90 shadow-md flex items-center justify-center p-2">
            <img
              src="/assets/aistudio/logo_osis_resized_2f1d7ea6.png"
              alt="Logo OSIS SMKN 7 Samarinda"
              className="w-full h-full object-contain"
            />
          </div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-slate-900">
              KAS OSIS
            </h1>
            <p className="text-xs font-bold text-[#0D62C9] uppercase tracking-wider mt-1">
              {pengaturan.namaSekolah || 'SMKN 7 SAMARINDA'}
            </p>
          </div>
          <p className="text-xs text-slate-500 font-medium">
            Sistem Informasi Pembukuan & Rekap Kas Mingguan Kelas
          </p>
        </div>

        {/* Mode Switcher Tabs */}
        <div className="grid grid-cols-2 p-1.5 bg-slate-100 rounded-xl">
          <button
            type="button"
            onClick={() => {
              setAuthMode('VIEWER');
              setErrorMsg('');
            }}
            className={`py-2 px-3 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-2 ${
              authMode === 'VIEWER'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            <KeyRound className="w-3.5 h-3.5" />
            <span>Bendahara Kelas</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setAuthMode('ADMIN');
              setErrorMsg('');
            }}
            className={`py-2 px-3 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-2 ${
              authMode === 'ADMIN'
                ? 'bg-[#0D62C9] text-white shadow-xs'
                : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Login Admin</span>
          </button>
        </div>

        {/* Database Not Ready Notice */}
        {dbError && (
          <div className="p-3 bg-amber-50 border border-amber-300 rounded-xl flex items-start gap-2.5 text-xs font-semibold text-amber-900">
            <AlertCircle className="w-4 h-4 shrink-0 text-amber-600 mt-0.5" />
            <span>{dbError}</span>
          </div>
        )}

        {/* Error Notification */}
        {errorMsg && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-start gap-2.5 text-xs font-semibold text-rose-700">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Mode 1: Viewer Form */}
        {authMode === 'VIEWER' && (
          <form onSubmit={handleViewerSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <KeyRound className="w-4 h-4 text-slate-400" />
                  Kode Akses Bersama:
                </span>
                <span className="text-[11px] text-slate-400 font-normal">
                  (Hanya Lihat)
                </span>
              </label>

              <div className="relative">
                <input
                  type={showViewerPassword ? 'text' : 'password'}
                  placeholder="Masukkan kode akses..."
                  value={passcode}
                  onChange={(e) => {
                    setPasscode(e.target.value);
                    setErrorMsg('');
                  }}
                  autoComplete="off"
                  className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:border-[#0D62C9] focus:ring-2 focus:ring-[#0D62C9]/20 outline-none transition-all pr-10 font-mono-num font-semibold"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => setShowViewerPassword(!showViewerPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                  aria-label="Tampilkan atau sembunyikan kode akses"
                >
                  {showViewerPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-[#0D62C9] hover:bg-[#0b54ad] disabled:opacity-60 text-white py-2.5 px-4 rounded-xl text-sm font-bold shadow-xs hover:shadow transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              {isLoading ? 'Memverifikasi...' : 'MASUK SEBAGAI BENDAHARA KELAS'}
            </button>

            <p className="text-[11px] text-center text-slate-500 font-medium leading-relaxed">
              Untuk bendahara kelas atau perwakilan kelas yang ingin memantau setoran kas mingguan.
            </p>
          </form>
        )}

        {/* Mode 2: Admin Username & Password Form */}
        {authMode === 'ADMIN' && (
          <form onSubmit={handleAdminSubmit} className="space-y-3.5">
            {isSetupMode && (
              <div className="p-3 rounded-xl bg-blue-50/70 border border-blue-200/80 text-[11px] text-slate-700 leading-relaxed">
                <span className="font-bold text-[#0D62C9]">Aktivasi Pertama Kali:</span> Buat username dan password admin (min. 8 karakter). Username & password ini bisa diganti nanti di Panel Admin.
              </div>
            )}

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">
                Username Admin
              </label>
              <div className="relative">
                <User className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Masukkan username admin..."
                  value={adminUsername}
                  onChange={(e) => {
                    setAdminUsername(e.target.value);
                    setErrorMsg('');
                  }}
                  autoComplete="username"
                  className="w-full rounded-xl border border-slate-300 bg-white pl-9 pr-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:border-[#0D62C9] focus:ring-2 focus:ring-[#0D62C9]/20 outline-none transition-all font-semibold"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">
                {isSetupMode ? 'Password Admin Baru (Min. 8 Karakter)' : 'Password Admin'}
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type={showAdminPassword ? 'text' : 'password'}
                  placeholder={isSetupMode ? 'Minimal 8 karakter...' : 'Masukkan password admin...'}
                  value={adminPassword}
                  onChange={(e) => {
                    setAdminPassword(e.target.value);
                    setErrorMsg('');
                  }}
                  autoComplete={isSetupMode ? 'new-password' : 'current-password'}
                  className="w-full rounded-xl border border-slate-300 bg-white pl-9 pr-10 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:border-[#0D62C9] focus:ring-2 focus:ring-[#0D62C9]/20 outline-none transition-all font-mono-num font-semibold"
                />
                <button
                  type="button"
                  onClick={() => setShowAdminPassword(!showAdminPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                  aria-label="Tampilkan atau sembunyikan password"
                >
                  {showAdminPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {isSetupMode && (
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">
                  Konfirmasi Password Admin
                </label>
                <div className="relative">
                  <KeyRound className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type={showAdminPassword ? 'text' : 'password'}
                    placeholder="Ulangi password baru..."
                    value={confirmAdminPassword}
                    onChange={(e) => {
                      setConfirmAdminPassword(e.target.value);
                      setErrorMsg('');
                    }}
                    autoComplete="new-password"
                    className="w-full rounded-xl border border-slate-300 bg-white pl-9 pr-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:border-[#0D62C9] focus:ring-2 focus:ring-[#0D62C9]/20 outline-none transition-all font-mono-num font-semibold"
                  />
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-[#0D62C9] hover:bg-[#0b54ad] disabled:opacity-60 text-white py-2.5 px-4 rounded-xl text-sm font-bold shadow-xs hover:shadow transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              <ShieldCheck className="w-4 h-4" />
              <span>
                {isLoading
                  ? 'Memverifikasi...'
                  : isSetupMode
                  ? 'AKTIFKAN & MASUK SEBAGAI ADMIN'
                  : 'MASUK SEBAGAI ADMIN'}
              </span>
            </button>

            {!pengaturan.adminConfigured && (
              <button
                type="button"
                onClick={() => {
                  setHasManualToggle(true);
                  setIsSetupMode(!isSetupMode);
                  setErrorMsg('');
                }}
                className="w-full text-[11px] text-[#0D62C9] hover:underline font-semibold text-center"
              >
                {isSetupMode
                  ? 'Sudah pernah aktivasi? Login dengan password'
                  : 'Belum atur password? Aktivasi Akun Admin Pertama'}
              </button>
            )}

            <p className="text-[11px] text-center text-slate-500 font-medium leading-relaxed">
              Khusus Bendahara OSIS untuk mencatat setoran kas, transaksi, dan kelola kelas.
            </p>
          </form>
        )}
      </div>
    </div>
  );
};
