import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { ShieldCheck, Lock, User, Eye, EyeOff, AlertCircle, X, KeyRound } from 'lucide-react';

export const AdminLoginModal: React.FC = () => {
  const {
    showAdminLoginModal,
    setShowAdminLoginModal,
    loginAdminWithCredentials,
    setupInitialAdminAccount,
    pengaturan
  } = useApp();

  const [isSetupMode, setIsSetupMode] = useState<boolean>(!pengaturan.adminConfigured);
  const [hasManualToggle, setHasManualToggle] = useState<boolean>(false);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [errorMsg, setErrorMsg] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!hasManualToggle) {
      setIsSetupMode(!pengaturan.adminConfigured);
      if (!pengaturan.adminConfigured && !username) {
        setUsername(pengaturan.adminUsername || 'alkiyano');
      }
    }
  }, [pengaturan.adminConfigured, pengaturan.adminUsername, hasManualToggle, username]);

  if (!showAdminLoginModal) return null;

  const resetForm = () => {
    setErrorMsg('');
    setPassword('');
    setConfirmPassword('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    if (isSetupMode) {
      if (!username.trim()) {
        setErrorMsg('Masukkan username admin.');
        return;
      }
      if (password.length < 8) {
        setErrorMsg('Password admin minimal 8 karakter.');
        return;
      }
      if (password !== confirmPassword) {
        setErrorMsg('Konfirmasi password tidak cocok.');
        return;
      }

      setIsLoading(true);
      const res = await setupInitialAdminAccount(username, password);
      setIsLoading(false);

      if (!res.success) {
        setErrorMsg(res.message || 'Gagal mengaktifkan akun Admin.');
      }
      return;
    }

    if (!username.trim() || !password) {
      setErrorMsg('Masukkan username dan password admin.');
      return;
    }

    setIsLoading(true);
    const res = await loginAdminWithCredentials(username, password);
    setIsLoading(false);

    if (!res.success) {
      setErrorMsg(res.message || 'Username atau password salah.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-3 animate-in fade-in duration-150">
      <div className="bg-white border border-slate-200/90 shadow-xl rounded-2xl max-w-sm w-full p-6 space-y-5 relative">
        {/* Close Button */}
        <button
          type="button"
          onClick={() => {
            resetForm();
            setShowAdminLoginModal(false);
          }}
          className="absolute right-4 top-4 p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          title="Tutup"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Header */}
        <div className="text-center space-y-1.5 border-b border-slate-100 pb-4">
          <div className="w-12 h-12 mx-auto rounded-full bg-blue-100 text-[#0D62C9] flex items-center justify-center mb-1 shadow-xs">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <h2 className="text-lg font-bold text-slate-900 tracking-tight">
            {isSetupMode ? 'Aktivasi Akun Admin Pertama' : 'Login Admin Bendahara'}
          </h2>
          <p className="text-xs text-slate-500 font-medium">
            {pengaturan.namaSekolah || 'SMKN 7 SAMARINDA'} · KAS OSIS
          </p>
        </div>

        {/* Error Alert */}
        {errorMsg && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-start gap-2 text-xs font-semibold text-rose-700">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        {isSetupMode && (
          <div className="p-3 rounded-xl bg-blue-50/70 border border-blue-200/80 text-[11px] text-slate-700 leading-relaxed">
            Atur username dan password admin pertama kali (minimal 8 karakter). Password ini nanti bisa diubah kapan saja dari menu Pengaturan Admin.
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3.5">
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
              Username Admin
            </label>
            <div className="relative">
              <User className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value);
                  setErrorMsg('');
                }}
                placeholder="Masukkan username..."
                autoComplete="username"
                className="w-full rounded-xl border border-slate-300 bg-white pl-9 pr-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:border-[#0D62C9] focus:ring-2 focus:ring-[#0D62C9]/20 outline-none transition-all font-semibold"
                autoFocus
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
              {isSetupMode ? 'Password Baru (Min. 8 Karakter)' : 'Password Admin'}
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setErrorMsg('');
                }}
                placeholder={isSetupMode ? 'Minimal 8 karakter...' : 'Masukkan password...'}
                autoComplete={isSetupMode ? 'new-password' : 'current-password'}
                className="w-full rounded-xl border border-slate-300 bg-white pl-9 pr-10 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:border-[#0D62C9] focus:ring-2 focus:ring-[#0D62C9]/20 outline-none transition-all font-mono-num font-semibold"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                aria-label="Tampilkan atau sembunyikan password"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {isSetupMode && (
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                Konfirmasi Password
              </label>
              <div className="relative">
                <KeyRound className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => {
                    setConfirmPassword(e.target.value);
                    setErrorMsg('');
                  }}
                  placeholder="Ulangi password baru..."
                  autoComplete="new-password"
                  className="w-full rounded-xl border border-slate-300 bg-white pl-9 pr-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:border-[#0D62C9] focus:ring-2 focus:ring-[#0D62C9]/20 outline-none transition-all font-mono-num font-semibold"
                />
              </div>
            </div>
          )}

          <div className="pt-1 flex flex-col gap-2">
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
                  ? 'AKTIFKAN & MASUK ADMIN'
                  : 'MASUK SEBAGAI ADMIN'}
              </span>
            </button>

            {!pengaturan.adminConfigured && (
              <button
                type="button"
                onClick={() => {
                  setHasManualToggle(true);
                  setIsSetupMode(!isSetupMode);
                  resetForm();
                }}
                className="text-[11px] text-[#0D62C9] hover:underline font-semibold text-center py-0.5"
              >
                {isSetupMode
                  ? 'Sudah pernah aktivasi? Login dengan password'
                  : 'Belum atur password? Aktivasi Akun Pertama'}
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                resetForm();
                setShowAdminLoginModal(false);
              }}
              className="text-xs text-slate-500 hover:text-slate-800 font-semibold text-center py-1 transition-colors"
            >
              Batal
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
