import React from "react";

interface Props { children: React.ReactNode; title?: string }
interface State { error: Error | null }

/**
 * Предохранитель для боковых панелей расчётов (горноспасатели, горнорабочий).
 * Без него любая ошибка внутри панели роняла всё React-дерево приложения —
 * пользователь видел чёрный экран и терял несохранённую схему.
 * Теперь ошибка локализуется в панели, схема и остальной интерфейс живут.
 */
export class PanelErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error): State {
    return { error };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[PanelErrorBoundary] Ошибка панели расчёта:", error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <div className="p-3 text-[11px]">
          <div className="border border-red-300 bg-red-50 rounded p-3 flex flex-col gap-2">
            <div className="font-semibold text-red-800 text-[12px]">
              ⚠ Ошибка в расчёте{this.props.title ? `: ${this.props.title}` : ""}
            </div>
            <div className="text-red-700 break-words">{this.state.error.message}</div>
            <div className="text-gray-600">
              Схема и остальные расчёты не пострадали. Проверьте исходные данные
              и повторите расчёт.
            </div>
            <button
              onClick={() => this.setState({ error: null })}
              className="self-start px-3 py-1 rounded bg-red-600 text-white hover:bg-red-700">
              Вернуть панель
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default PanelErrorBoundary;
