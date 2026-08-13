import Icon from "@/components/ui/icon";

// ─────────────────────────────────────────────────────────────────────────────
// Экран ВХОДА в панель администратора (вынесено из Admin.tsx, перенос 1:1).
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  password: string;
  setPassword: (v: string) => void;
  authErr: string;
  setAuthErr: (v: string) => void;
  loading: boolean;
  handleLogin: (e: React.FormEvent) => void;
}

export default function AdminLogin({ password, setPassword, authErr, setAuthErr, loading, handleLogin }: Props) {
  return (
      <div className="min-h-screen flex items-center justify-center"
        style={{ background: "linear-gradient(135deg,#0f172a,#1e3a5f)" }}>
        <form onSubmit={handleLogin}
          className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-8">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ background: "#1a3a6b" }}>
              <Icon name="ShieldCheck" size={22} className="text-white" />
            </div>
            <div>
              <div className="text-[16px] font-bold" style={{ color: "#1a3a6b" }}>Панель администратора</div>
              <div className="text-[11px] text-gray-400">ПВ-Система — Лицензии</div>
            </div>
          </div>
          <label className="block text-[12px] font-semibold text-gray-600 mb-1.5">Пароль администратора</label>
          <input type="password" value={password}
            onChange={e => { setPassword(e.target.value); setAuthErr(""); }}
            className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-300"
            placeholder="Введите пароль" autoFocus />
          {authErr && <div className="mt-2 text-[12px] text-red-600">{authErr}</div>}
          <button type="submit" disabled={loading}
            className="mt-4 w-full py-2.5 rounded-lg text-[13px] font-semibold text-white disabled:opacity-50"
            style={{ background: "#1a3a6b" }}>
            {loading ? "Вход..." : "Войти"}
          </button>
          <a href="/" className="mt-4 block text-center text-[11px] text-gray-400 hover:text-gray-600">
            ← Вернуться в приложение
          </a>
        </form>
      </div>
  );
}
