import { useMemo, useState } from "react";
import Icon from "@/components/ui/icon";
import {
  FAN_CATALOG, FAN_TYPE_NAMES, selectFans, fanPressure, fanEfficiency,
  type FanModel, type FanType, type FanSelection,
} from "@/lib/fans";

interface Props {
  requiredQ: number;     // м³/ч (нужный расход)
  requiredH: number;     // Па (потери сети)
  open: boolean;
  onClose: () => void;
  onSelect?: (fan: FanModel) => void;
}

export default function FanSelector({ requiredQ, requiredH, open, onClose, onSelect }: Props) {
  const [filterType, setFilterType] = useState<FanType | "all">("all");
  const [selectedFanId, setSelectedFanId] = useState<string | null>(null);

  const selections = useMemo(() => {
    const sel = selectFans(requiredQ, requiredH, filterType === "all" ? undefined : filterType);
    return sel.slice(0, 12); // топ-12
  }, [requiredQ, requiredH, filterType]);

  const selectedSel = selections.find((s) => s.fan.id === selectedFanId) ?? selections[0];

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center animate-fade-in"
      style={{ background: "rgba(0,0,0,0.75)" }}
      onClick={onClose}>
      <div className="w-[1100px] max-w-[95vw] max-h-[92vh] rounded-lg overflow-hidden flex flex-col"
        style={{ background: "hsl(220,20%,11%)", border: "1px solid hsl(220,15%,22%)" }}
        onClick={(e) => e.stopPropagation()}>

        {/* ─── Шапка ──────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <div>
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Icon name="Gauge" size={14} style={{ color: "hsl(45,90%,65%)" }} />
              Подбор вентилятора
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5 font-mono">
              Требуется: Q = {requiredQ} м³/ч · H = {requiredH} Па
            </p>
          </div>
          <button onClick={onClose}
            className="w-8 h-8 rounded hover:bg-muted flex items-center justify-center text-muted-foreground">
            <Icon name="X" size={16} />
          </button>
        </div>

        {/* ─── Фильтр типов ──────────────────────────────────────────── */}
        <div className="flex gap-1 px-4 py-2 border-b border-border overflow-x-auto">
          <button onClick={() => setFilterType("all")}
            className="px-3 py-1 rounded text-xs font-medium transition-all flex-shrink-0"
            style={filterType === "all"
              ? { background: "hsl(210,100%,56%)", color: "hsl(220,20%,8%)" }
              : { background: "hsl(220,15%,14%)", color: "hsl(215,15%,55%)" }}>
            Все типы
          </button>
          {(Object.entries(FAN_TYPE_NAMES) as [FanType, string][]).map(([type, name]) => (
            <button key={type}
              onClick={() => setFilterType(type)}
              className="px-3 py-1 rounded text-xs font-medium transition-all flex-shrink-0"
              style={filterType === type
                ? { background: "hsl(210,100%,56%)", color: "hsl(220,20%,8%)" }
                : { background: "hsl(220,15%,14%)", color: "hsl(215,15%,55%)" }}>
              {name}
            </button>
          ))}
        </div>

        {/* ─── Контент: список + график ──────────────────────────────── */}
        <div className="flex flex-1 overflow-hidden">
          {/* Список моделей */}
          <div className="w-[420px] overflow-y-auto border-r border-border">
            {selections.length === 0 && (
              <div className="p-6 text-center text-muted-foreground text-sm">
                Нет подходящих моделей
              </div>
            )}
            {selections.map((sel) => {
              const isSel = (selectedSel?.fan.id === sel.fan.id);
              const scoreColor = sel.score >= 80 ? "#10b981" : sel.score >= 50 ? "#f59e0b" : "#ef4444";
              return (
                <div key={sel.fan.id}
                  onClick={() => setSelectedFanId(sel.fan.id)}
                  className="px-4 py-3 cursor-pointer transition-colors border-b border-border hover:bg-muted"
                  style={isSel ? { background: "hsl(210,100%,56%,0.08)" } : {}}>
                  <div className="flex items-start gap-3">
                    {/* Скор */}
                    <div className="flex flex-col items-center justify-center rounded-md w-12 h-12 flex-shrink-0"
                      style={{ background: `${scoreColor}18`, border: `1px solid ${scoreColor}40` }}>
                      <span className="text-sm font-mono font-bold" style={{ color: scoreColor }}>{sel.score}</span>
                      <span className="text-[8px] uppercase" style={{ color: scoreColor, opacity: 0.7 }}>скор</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono" style={{ color: "hsl(215,15%,55%)" }}>{sel.fan.brand}</span>
                        {sel.point.inOptimalZone && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded font-mono"
                            style={{ background: "hsl(142,76%,36%,0.18)", color: "hsl(142,70%,55%)" }}>
                            ОПТИМУМ
                          </span>
                        )}
                      </div>
                      <p className="text-sm font-medium truncate" style={{ color: "hsl(210,20%,90%)" }}>
                        {sel.fan.model}
                      </p>
                      <div className="flex items-center gap-3 mt-1 text-xs font-mono" style={{ color: "hsl(215,15%,50%)" }}>
                        <span>Q={sel.point.Q}</span>
                        <span>H={sel.point.H}Па</span>
                        <span>η={(sel.point.eta * 100).toFixed(0)}%</span>
                        <span>{sel.point.power}кВт</span>
                      </div>
                      {sel.warnings.length > 0 && (
                        <div className="mt-1 text-[10px]" style={{ color: "hsl(45,90%,65%)" }}>
                          ⚠ {sel.warnings[0]}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Детали + график */}
          <div className="flex-1 overflow-y-auto p-5">
            {selectedSel && (
              <FanDetails sel={selectedSel} requiredQ={requiredQ} requiredH={requiredH} />
            )}
          </div>
        </div>

        {/* ─── Футер ─────────────────────────────────────────────────── */}
        <div className="px-5 py-3 border-t border-border flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            Найдено: {selections.length} моделей · показаны топ-{selections.length}
          </span>
          <div className="flex gap-2">
            <button onClick={onClose}
              className="px-4 py-1.5 rounded text-xs font-medium"
              style={{ background: "hsl(220,15%,14%)", color: "hsl(215,15%,70%)", border: "1px solid hsl(220,15%,22%)" }}>
              Закрыть
            </button>
            {selectedSel && onSelect && (
              <button onClick={() => { onSelect(selectedSel.fan); onClose(); }}
                className="px-4 py-1.5 rounded text-xs font-semibold hover:brightness-110"
                style={{ background: "hsl(210,100%,56%)", color: "hsl(220,20%,8%)" }}>
                Выбрать «{selectedSel.fan.model}»
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Детальная карточка вентилятора с графиком ──────────────────────────────

function FanDetails({ sel, requiredQ, requiredH }: { sel: FanSelection; requiredQ: number; requiredH: number }) {
  const { fan, point } = sel;

  // ─── Построение кривых ──────────────────────────────────────────────
  const W = 540, H = 280;
  const pad = { l: 50, r: 30, t: 20, b: 35 };
  const Qmax = Math.max(fan.Qmax * 1.1, requiredQ * 1.2, point.Q * 1.2);
  const Hmax = Math.max(fan.H0 * 1.15, requiredH * 1.3, point.H * 1.3);

  const xScale = (q: number) => pad.l + (q / Qmax) * (W - pad.l - pad.r);
  const yScale = (h: number) => H - pad.b - (h / Hmax) * (H - pad.t - pad.b);

  // Кривая вентилятора
  const fanCurve = useMemo(() => {
    const pts: [number, number][] = [];
    const steps = 60;
    for (let i = 0; i <= steps; i++) {
      const Q = (i / steps) * Qmax;
      const H = fanPressure(fan, Q);
      if (H > 0) pts.push([Q, H]);
    }
    return pts;
  }, [fan, Qmax]);

  // Кривая сети: H = S·Q²
  const S = requiredH / (requiredQ * requiredQ);
  const netCurve = useMemo(() => {
    const pts: [number, number][] = [];
    for (let i = 0; i <= 60; i++) {
      const Q = (i / 60) * Qmax;
      pts.push([Q, S * Q * Q]);
    }
    return pts;
  }, [S, Qmax]);

  // Кривая КПД (вторая ось Y слева)
  const etaCurve = useMemo(() => {
    const pts: [number, number][] = [];
    for (let i = 0; i <= 60; i++) {
      const Q = (i / 60) * Qmax;
      const eta = fanEfficiency(fan, Q);
      pts.push([Q, eta]);
    }
    return pts;
  }, [fan, Qmax]);

  const path = (pts: [number, number][], yfn: (v: number) => number) =>
    pts.map((p, i) => `${i === 0 ? "M" : "L"}${xScale(p[0])},${yfn(p[1])}`).join(" ");

  return (
    <div className="space-y-4">
      {/* Шапка модели */}
      <div className="flex items-start justify-between pb-3 border-b border-border">
        <div>
          <p className="text-xs uppercase tracking-wider" style={{ color: "hsl(215,15%,45%)" }}>
            {fan.brand} · {FAN_TYPE_NAMES[fan.type]}
          </p>
          <h4 className="text-lg font-semibold" style={{ color: "hsl(210,20%,92%)" }}>{fan.model}</h4>
          {fan.priceRub && (
            <p className="text-sm font-mono mt-1" style={{ color: "hsl(142,70%,55%)" }}>
              {fan.priceRub.toLocaleString("ru-RU")} ₽
            </p>
          )}
        </div>
        <div className="text-right">
          <p className="text-xs uppercase tracking-wider" style={{ color: "hsl(215,15%,45%)" }}>Скор подбора</p>
          <p className="text-3xl font-mono font-bold"
            style={{ color: sel.score >= 80 ? "#10b981" : sel.score >= 50 ? "#f59e0b" : "#ef4444" }}>
            {sel.score}
          </p>
        </div>
      </div>

      {/* График Q–H */}
      <div className="rounded-md p-3" style={{ background: "hsl(220,15%,11%)", border: "1px solid hsl(220,15%,20%)" }}>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs uppercase tracking-wider" style={{ color: "hsl(215,15%,55%)" }}>
            Аэродинамическая характеристика
          </span>
          <div className="flex gap-3 text-[10px]">
            <span style={{ color: "hsl(210,100%,65%)" }}>━ Вентилятор H(Q)</span>
            <span style={{ color: "#ef4444" }}>━ Сеть S·Q²</span>
            <span style={{ color: "#10b981" }}>┄ КПД η(Q)</span>
          </div>
        </div>
        <svg width={W} height={H} className="w-full h-auto">
          {/* Сетка */}
          {Array.from({ length: 6 }, (_, i) => i * (Hmax / 5)).map((h) => (
            <g key={`gh${h}`}>
              <line x1={pad.l} y1={yScale(h)} x2={W - pad.r} y2={yScale(h)}
                stroke="hsl(220,15%,18%)" strokeWidth="0.5" />
              <text x={pad.l - 6} y={yScale(h) + 3} textAnchor="end" fontSize="9"
                fontFamily="IBM Plex Mono" fill="hsl(215,15%,45%)">{Math.round(h)}</text>
            </g>
          ))}
          {Array.from({ length: 7 }, (_, i) => i * (Qmax / 6)).map((q) => (
            <g key={`gv${q}`}>
              <line x1={xScale(q)} y1={pad.t} x2={xScale(q)} y2={H - pad.b}
                stroke="hsl(220,15%,18%)" strokeWidth="0.5" />
              <text x={xScale(q)} y={H - pad.b + 14} textAnchor="middle" fontSize="9"
                fontFamily="IBM Plex Mono" fill="hsl(215,15%,45%)">{Math.round(q)}</text>
            </g>
          ))}

          {/* Оси */}
          <text x={W / 2} y={H - 4} textAnchor="middle" fontSize="9" fill="hsl(215,15%,55%)">Q, м³/ч</text>
          <text x={12} y={H / 2} textAnchor="middle" fontSize="9" fill="hsl(215,15%,55%)"
            transform={`rotate(-90, 12, ${H / 2})`}>H, Па</text>

          {/* Рабочая зона вентилятора (Qmin..Qmax) */}
          <rect x={xScale(fan.Qmin)} y={pad.t}
            width={xScale(fan.Qmax) - xScale(fan.Qmin)} height={H - pad.t - pad.b}
            fill="hsl(210,100%,56%,0.04)" />
          {/* Оптимальная зона ±20% от Qopt */}
          <rect x={xScale(fan.Qopt * 0.8)} y={pad.t}
            width={xScale(fan.Qopt * 1.2) - xScale(fan.Qopt * 0.8)} height={H - pad.t - pad.b}
            fill="hsl(142,76%,36%,0.06)" />

          {/* КПД (вторая ось — масштаб 0..1 → высота графика) */}
          <path d={path(etaCurve, (v) => H - pad.b - v * (H - pad.t - pad.b))}
            stroke="#10b981" strokeWidth="1.2" strokeDasharray="3 3" fill="none" />

          {/* Кривая сети */}
          <path d={path(netCurve, yScale)}
            stroke="#ef4444" strokeWidth="2" fill="none" />

          {/* Кривая вентилятора */}
          <path d={path(fanCurve, yScale)}
            stroke="hsl(210,100%,65%)" strokeWidth="2.5" fill="none" />

          {/* Точка требуемого режима */}
          <circle cx={xScale(requiredQ)} cy={yScale(requiredH)} r="4"
            fill="none" stroke="#f59e0b" strokeWidth="1.5" strokeDasharray="2 2" />
          <text x={xScale(requiredQ) + 8} y={yScale(requiredH) - 4} fontSize="9"
            fontFamily="IBM Plex Mono" fill="#f59e0b">требуется</text>

          {/* Рабочая точка (пересечение кривых) */}
          {point.found && (
            <>
              <line x1={xScale(point.Q)} y1={H - pad.b} x2={xScale(point.Q)} y2={yScale(point.H)}
                stroke="hsl(45,90%,65%)" strokeWidth="0.8" strokeDasharray="2 2" />
              <line x1={pad.l} y1={yScale(point.H)} x2={xScale(point.Q)} y2={yScale(point.H)}
                stroke="hsl(45,90%,65%)" strokeWidth="0.8" strokeDasharray="2 2" />
              <circle cx={xScale(point.Q)} cy={yScale(point.H)} r="6"
                fill="hsl(45,90%,55%)" stroke="hsl(220,20%,8%)" strokeWidth="2">
                <animate attributeName="r" values="6;9;6" dur="1.5s" repeatCount="indefinite" />
              </circle>
              <text x={xScale(point.Q) + 10} y={yScale(point.H) + 4} fontSize="10"
                fontFamily="IBM Plex Mono" fontWeight="600" fill="hsl(45,90%,70%)">
                раб.точка
              </text>
            </>
          )}

          {/* Оптимальная точка */}
          <circle cx={xScale(fan.Qopt)} cy={yScale(fanPressure(fan, fan.Qopt))} r="3"
            fill="#10b981" />
        </svg>
      </div>

      {/* Параметры рабочей точки */}
      <div className="grid grid-cols-4 gap-2">
        <ParamBox label="Расход Q" value={`${point.Q}`} unit="м³/ч"
          color="#3b82f6"
          delta={point.marginQ >= 0 ? `+${point.marginQ}%` : `${point.marginQ}%`}
          deltaColor={point.marginQ >= 0 ? "#10b981" : "#ef4444"} />
        <ParamBox label="Напор H" value={`${point.H}`} unit="Па"
          color="#f59e0b"
          delta={point.marginH >= 0 ? `+${point.marginH}%` : `${point.marginH}%`}
          deltaColor={point.marginH >= 0 ? "#10b981" : "#ef4444"} />
        <ParamBox label="КПД η" value={`${(point.eta * 100).toFixed(0)}`} unit="%"
          color="#10b981"
          delta={point.inOptimalZone ? "оптимум" : "вне зоны"}
          deltaColor={point.inOptimalZone ? "#10b981" : "#f59e0b"} />
        <ParamBox label="Мощность" value={`${point.power}`} unit="кВт"
          color="#a855f7"
          delta={`P_ном ${fan.power}`}
          deltaColor="hsl(215,15%,55%)" />
      </div>

      {/* Тех. параметры */}
      <div className="rounded-md p-3 grid grid-cols-2 gap-x-6 gap-y-1.5"
        style={{ background: "hsl(220,15%,11%)", border: "1px solid hsl(220,15%,20%)" }}>
        <DetailRow label="Двигатель" value={`${fan.power} кВт · ${fan.voltage} В · ${fan.current} А`} />
        <DetailRow label="Обороты" value={`${fan.rpm} об/мин`} />
        <DetailRow label="Габариты" value={`${fan.dimensions.length}×${fan.dimensions.width}×${fan.dimensions.height} мм`} />
        <DetailRow label="Масса" value={`${fan.weight} кг`} />
        <DetailRow label="Шум" value={`${fan.noise} дБА`} />
        <DetailRow label="Q раб. диапазон" value={`${fan.Qmin}…${fan.Qmax} м³/ч`} />
      </div>

      {/* Предупреждения */}
      {sel.warnings.length > 0 && (
        <div className="rounded-md p-3 space-y-1"
          style={{ background: "hsl(45,90%,55%,0.07)", border: "1px solid hsl(45,90%,55%,0.3)" }}>
          {sel.warnings.map((w, i) => (
            <p key={i} className="text-xs flex items-start gap-2" style={{ color: "hsl(45,90%,70%)" }}>
              <Icon name="AlertTriangle" size={11} className="mt-0.5 flex-shrink-0" />
              {w}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function ParamBox({ label, value, unit, color, delta, deltaColor }: {
  label: string; value: string; unit: string; color: string; delta: string; deltaColor: string;
}) {
  return (
    <div className="rounded-md p-2.5"
      style={{ background: `${color}0e`, border: `1px solid ${color}30` }}>
      <p className="text-[10px] uppercase tracking-wider" style={{ color: "hsl(215,15%,50%)" }}>{label}</p>
      <div className="flex items-baseline gap-1 mt-0.5">
        <span className="text-lg font-mono font-bold" style={{ color }}>{value}</span>
        <span className="text-xs" style={{ color: "hsl(215,15%,50%)" }}>{unit}</span>
      </div>
      <p className="text-[10px] font-mono mt-0.5" style={{ color: deltaColor }}>{delta}</p>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span style={{ color: "hsl(215,15%,50%)" }}>{label}</span>
      <span className="font-mono" style={{ color: "hsl(210,20%,80%)" }}>{value}</span>
    </div>
  );
}
