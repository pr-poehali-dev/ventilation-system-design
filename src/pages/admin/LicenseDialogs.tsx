import Icon from "@/components/ui/icon";
import { type License, type LicenseForm } from "@/pages/admin/adminTypes";

// ─────────────────────────────────────────────────────────────────────────────
// Диалоги СОЗДАНИЯ и РЕДАКТИРОВАНИЯ лицензии (вынесено из Admin.tsx, 1:1).
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  showCreate: boolean;
  setShowCreate: (v: boolean) => void;
  form: LicenseForm;
  setForm: React.Dispatch<React.SetStateAction<LicenseForm>>;
  createErr: string;
  setCreateErr: (v: string) => void;
  createOk: boolean;
  generatedKey: string;
  setGeneratedKey: (v: string) => void;
  generateKey: () => void;
  handleCreate: (e: React.FormEvent) => void;
  editingLic: License | null;
  editForm: LicenseForm;
  setEditForm: React.Dispatch<React.SetStateAction<LicenseForm>>;
  editErr: string;
  editOk: boolean;
  editSaving: boolean;
  handleUpdate: (e: React.FormEvent) => void;
  closeEdit: () => void;
  inputCls: string;
}

export default function LicenseDialogs({
  showCreate, setShowCreate, form, setForm, createErr, setCreateErr, createOk,
  generatedKey, setGeneratedKey, generateKey, handleCreate,
  editingLic, editForm, setEditForm, editErr, editOk, editSaving, handleUpdate, closeEdit,
  inputCls,
}: Props) {
  return (
    <>
      {/* Модал: создание лицензии */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.5)" }}>
          <form onSubmit={handleCreate}
            className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4"
              style={{ background: "#1a3a6b" }}>
              <div className="text-white font-bold text-[14px] flex items-center gap-2">
                <Icon name="Plus" size={16} />Создать лицензию
              </div>
              <button type="button" onClick={() => { setShowCreate(false); setCreateErr(""); setGeneratedKey(""); }}
                className="text-white/70 hover:text-white"><Icon name="X" size={16} /></button>
            </div>

            <div className="p-5 space-y-3">
              <div>
                <label className="block text-[11px] font-semibold text-gray-600 mb-1">Лицензионный ключ</label>
                <div className="flex gap-2">
                  <input type="text" value={form.key}
                    onChange={e => setForm(f => ({ ...f, key: e.target.value.toUpperCase() }))}
                    placeholder="PVS-XXXX-XXXX-XXXX-XXXX"
                    className={`flex-1 border border-gray-300 rounded-lg px-3 py-2 text-[12px] font-mono focus:outline-none focus:ring-2 focus:ring-blue-300`} />
                  <button type="button" onClick={generateKey}
                    className="px-3 py-2 rounded-lg text-[11px] font-medium text-white flex-shrink-0"
                    style={{ background: "#2563eb" }}>
                    <Icon name="Shuffle" size={14} />
                  </button>
                </div>
                {generatedKey && (
                  <div className="mt-1 text-[11px] text-green-600 font-mono">✓ Сгенерирован: {generatedKey}</div>
                )}
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-gray-600 mb-1">Организация *</label>
                <input required type="text" value={form.owner_name}
                  onChange={e => setForm(f => ({ ...f, owner_name: e.target.value }))}
                  placeholder="ООО Шахта Северная"
                  className={inputCls} />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-gray-600 mb-1">Email</label>
                <input type="email" value={form.owner_email}
                  onChange={e => setForm(f => ({ ...f, owner_email: e.target.value }))}
                  placeholder="info@example.com"
                  className={inputCls} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-gray-600 mb-1">Рабочих мест</label>
                  <input type="number" min={1} max={100} value={form.max_seats}
                    onChange={e => setForm(f => ({ ...f, max_seats: e.target.value }))}
                    className={inputCls} />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-gray-600 mb-1">Действует до</label>
                  <input type="date" value={form.expires_at}
                    onChange={e => setForm(f => ({ ...f, expires_at: e.target.value }))}
                    className={inputCls} />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-gray-600 mb-1">Примечание</label>
                <input type="text" value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="Договор №123..."
                  className={inputCls} />
              </div>

              {createErr && <div className="text-[12px] text-red-600 flex items-center gap-1"><Icon name="AlertCircle" size={13} />{createErr}</div>}
              {createOk && <div className="text-[12px] text-green-600 flex items-center gap-1"><Icon name="CheckCircle2" size={13} />Лицензия создана!</div>}

              <button type="submit"
                className="w-full py-2.5 rounded-lg text-[13px] font-semibold text-white"
                style={{ background: "#16a34a" }}>
                Создать лицензию
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Модал: редактирование лицензии */}
      {editingLic && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.5)" }}>
          <form onSubmit={handleUpdate}
            className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4"
              style={{ background: "#92400e" }}>
              <div className="text-white font-bold text-[14px] flex items-center gap-2">
                <Icon name="Pencil" size={16} />Изменить лицензию
              </div>
              <button type="button" onClick={closeEdit}
                className="text-white/70 hover:text-white"><Icon name="X" size={16} /></button>
            </div>

            <div className="p-5 space-y-3">
              {/* Ключ — только для просмотра */}
              <div>
                <label className="block text-[11px] font-semibold text-gray-600 mb-1">Лицензионный ключ</label>
                <div className="border border-gray-200 rounded-lg px-3 py-2 text-[12px] font-mono text-gray-500 bg-gray-50 select-all">
                  {editingLic.key}
                </div>
                <div className="text-[10px] text-gray-400 mt-0.5">Ключ изменить нельзя</div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-gray-600 mb-1">Организация *</label>
                <input required type="text" value={editForm.owner_name}
                  onChange={e => setEditForm(f => ({ ...f, owner_name: e.target.value }))}
                  placeholder="ООО Шахта Северная"
                  className={inputCls} />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-gray-600 mb-1">Email</label>
                <input type="email" value={editForm.owner_email}
                  onChange={e => setEditForm(f => ({ ...f, owner_email: e.target.value }))}
                  placeholder="info@example.com"
                  className={inputCls} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-gray-600 mb-1">Рабочих мест</label>
                  <input type="number" min={1} max={100} value={editForm.max_seats}
                    onChange={e => setEditForm(f => ({ ...f, max_seats: e.target.value }))}
                    className={inputCls} />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-gray-600 mb-1">Действует до</label>
                  <input type="date" value={editForm.expires_at}
                    onChange={e => setEditForm(f => ({ ...f, expires_at: e.target.value }))}
                    className={inputCls} />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-gray-600 mb-1">Примечание</label>
                <input type="text" value={editForm.notes}
                  onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="Договор №123..."
                  className={inputCls} />
              </div>

              {editErr && <div className="text-[12px] text-red-600 flex items-center gap-1"><Icon name="AlertCircle" size={13} />{editErr}</div>}
              {editOk && <div className="text-[12px] text-green-600 flex items-center gap-1"><Icon name="CheckCircle2" size={13} />Изменения сохранены!</div>}

              <div className="flex gap-2">
                <button type="button" onClick={closeEdit}
                  className="flex-1 py-2.5 rounded-lg text-[13px] font-medium border border-gray-300 text-gray-600 hover:bg-gray-50">
                  Отмена
                </button>
                <button type="submit" disabled={editSaving}
                  className="flex-1 py-2.5 rounded-lg text-[13px] font-semibold text-white disabled:opacity-50"
                  style={{ background: "#b45309" }}>
                  {editSaving ? "Сохранение..." : "Сохранить"}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
