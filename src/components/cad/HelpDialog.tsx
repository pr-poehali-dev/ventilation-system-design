import { useState } from "react";
import Icon from "@/components/ui/icon";
import { type Section } from "@/components/cad/help/HelpPrimitives";
import { HELP_SECTIONS_BASICS } from "@/components/cad/help/helpSectionsBasics";
import { HELP_SECTIONS_SCHEMA } from "@/components/cad/help/helpSectionsSchema";
import { HELP_SECTIONS_ADVANCED } from "@/components/cad/help/helpSectionsAdvanced";

interface Props {
  onClose: () => void;
}

export default function HelpDialog({ onClose }: Props) {
  const [activeSection, setActiveSection] = useState("overview");

  // Порядок разделов сохранён в точности как был в едином файле:
  // обзор → быстрый старт → интерфейс → файлы → импорт →
  // топология → свойства ветви → вентиляция → УО →
  // аварии → ППЗ → горноспасатели → отображение → клавиши →
  // справочники → печать → советы.
  const sections: Section[] = [
    ...HELP_SECTIONS_BASICS,
    ...HELP_SECTIONS_SCHEMA,
    ...HELP_SECTIONS_ADVANCED,
  ];

  const active = sections.find(s => s.id === activeSection) ?? sections[0];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.5)" }}>
      <div className="bg-white rounded-xl shadow-2xl flex overflow-hidden"
        style={{ width: "min(1100px, 96vw)", height: "min(800px, 92vh)" }}>

        {/* Боковое меню */}
        <div className="flex flex-col flex-shrink-0 overflow-y-auto"
          style={{ width: 210, background: "#1a3a6b", minWidth: 180 }}>
          {/* Логотип */}
          <div className="px-4 py-4 flex-shrink-0" style={{ borderBottom: "1px solid rgba(255,255,255,0.12)" }}>
            <div className="flex items-center gap-2 mb-1">
              <Icon name="BookOpen" size={18} className="text-blue-300" />
              <span className="text-white font-bold text-[14px]">Руководство</span>
            </div>
            <div className="text-[11px] text-blue-300">ПВ-Система</div>
          </div>

          {/* Разделы */}
          <div className="flex-1 py-2">
            {sections.map(s => (
              <button key={s.id}
                onClick={() => setActiveSection(s.id)}
                className="w-full flex items-center gap-2.5 px-4 py-2.5 text-left transition-colors"
                style={{
                  background: activeSection === s.id ? "rgba(255,255,255,0.15)" : "transparent",
                  borderLeft: activeSection === s.id ? "3px solid #60a5fa" : "3px solid transparent",
                  color: activeSection === s.id ? "white" : "rgba(255,255,255,0.7)",
                }}>
                <Icon name={s.icon as Parameters<typeof Icon>[0]["name"]} size={14}
                  className={activeSection === s.id ? "text-blue-300" : "text-blue-400"} />
                <span className="text-[12px] font-medium leading-tight">{s.title}</span>
              </button>
            ))}
          </div>

          {/* Версия */}
          <div className="px-4 py-3 flex-shrink-0 text-[10px] text-blue-400"
            style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
            © 2026 ПВ-Система
          </div>
        </div>

        {/* Контент */}
        <div className="flex flex-col flex-1 min-w-0">
          {/* Заголовок */}
          <div className="flex items-center justify-between px-6 py-4 flex-shrink-0"
            style={{ borderBottom: "1px solid #e5e7eb", background: "#f8fafc" }}>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "#dbeafe" }}>
                <Icon name={active.icon as Parameters<typeof Icon>[0]["name"]} size={18} className="text-blue-600" />
              </div>
              <h2 className="font-bold text-gray-800 text-[16px]">{active.title}</h2>
            </div>
            <button onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors">
              <Icon name="X" size={18} />
            </button>
          </div>

          {/* Текст */}
          <div className="flex-1 overflow-y-auto px-6 py-5" style={{ fontSize: 12, lineHeight: "1.6" }}>
            {active.content}
          </div>

          {/* Кнопки внизу */}
          <div className="flex items-center justify-between px-6 py-3 flex-shrink-0"
            style={{ borderTop: "1px solid #e5e7eb", background: "#f8fafc" }}>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  const idx = sections.findIndex(s => s.id === activeSection);
                  if (idx > 0) setActiveSection(sections[idx - 1].id);
                }}
                disabled={sections.findIndex(s => s.id === activeSection) === 0}
                className="flex items-center gap-1 px-3 py-1.5 rounded text-[12px] border border-gray-300 text-gray-600 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                <Icon name="ChevronLeft" size={14} /> Назад
              </button>
              <button
                onClick={() => {
                  const idx = sections.findIndex(s => s.id === activeSection);
                  if (idx < sections.length - 1) setActiveSection(sections[idx + 1].id);
                }}
                disabled={sections.findIndex(s => s.id === activeSection) === sections.length - 1}
                className="flex items-center gap-1 px-3 py-1.5 rounded text-[12px] border border-gray-300 text-gray-600 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                Вперёд <Icon name="ChevronRight" size={14} />
              </button>
            </div>
            <button onClick={onClose}
              className="px-5 py-1.5 rounded text-[12px] font-semibold text-white"
              style={{ background: "#1a3a6b" }}>
              Закрыть
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
