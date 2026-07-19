import React, { useState, useMemo, useEffect, useRef, useCallback } from "react";
import Icon from "@/components/ui/icon";
import type { TopoNode, TopoBranch } from "@/lib/topology";
import { findMainRoute, buildPointsFromBranchIds } from "./depressogram-utils";

// ─────────────────────────────────────────────────────────────────────────────
// Депрессиограмма — перетаскиваемый диалог без overlay-блокировки
// Авто-маршрут: BFS от поверхности до ВГП по макс. расходу (без перемычек)
// Ручной маршрут: клик по ветвям прямо на схеме
// Несколько ВГП: выбирается тот, до которого кратчайший путь с макс. суммарным ΔP
// ─────────────────────────────────────────────────────────────────────────────

export interface DepressogramPoint {
  nodeId: string;
  nodeName: string;
  nodeNumber: string;
  branchId: string | null;
  branchName: string;
  branchNumber: string | null;
  cumulativeLength: number;
  pressure: number;
  dP: number;
}

interface Props {
  nodes: TopoNode[];
  branches: TopoBranch[];
  onClose: () => void;
  onHighlightPath?: (branchIds: string[]) => void;
  pickMode: boolean;
  onPickModeChange: (active: boolean) => void;
  manualBranchIds: Set<string>;
  onClearManual: () => void;
}

// Алгоритм маршрута (findMainRoute) и построение точек (buildPointsFromBranchIds)
// вынесены в общий модуль ./depressogram-utils — импорт сверху файла.
// Это гарантирует, что браузер и десктоп считают депрессиограмму одинаково.

// ─── SVG-График ──────────────────────────────────────────────────────────────
function DepressogramChart({ points, width, height }: { points: DepressogramPoint[]; width: number; height: number }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const padL = 58, padR = 22, padT = 18, padB = 40;
  const W = width - padL - padR;
  const H = height - padT - padB;

  const maxLen = Math.max(...points.map(p => p.cumulativeLength), 1);
  const allP = points.map(p => p.pressure);
  const maxP = Math.max(...allP, 0);
  const minP = Math.min(...allP, 0);
  const pRange = (maxP - minP) || 1;

  const toX = (l: number) => padL + (l / maxLen) * W;
  const toY = (p: number) => padT + ((maxP - p) / pRange) * H;

  const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"} ${toX(p.cumulativeLength).toFixed(1)} ${toY(p.pressure).toFixed(1)}`).join(" ");
  const lastPt = points[points.length - 1];
  const areaD = points.length > 1 ? `${pathD} L ${toX(lastPt.cumulativeLength).toFixed(1)} ${toY(minP).toFixed(1)} L ${toX(0).toFixed(1)} ${toY(minP).toFixed(1)} Z` : "";

  return (
    <svg width={width} height={height} style={{ fontFamily: "system-ui, sans-serif", display: "block" }}>
      <defs>
        <linearGradient id="dg-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.2} />
          <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.02} />
        </linearGradient>
      </defs>
      <rect x={padL} y={padT} width={W} height={H} fill="#f8faff" rx={2} />
      {Array.from({ length: 7 }, (_, i) => {
        const val = minP + (pRange * i) / 6;
        const y = toY(val);
        return <g key={`y${i}`}><line x1={padL} y1={y} x2={padL + W} y2={y} stroke="#dde4f0" strokeWidth={1} /><text x={padL - 6} y={y + 3.5} textAnchor="end" fontSize={9.5} fill="#64748b">{val.toFixed(1)}</text></g>;
      })}
      {Array.from({ length: 9 }, (_, i) => {
        const val = (maxLen * i) / 8;
        const x = toX(val);
        return <g key={`x${i}`}><line x1={x} y1={padT} x2={x} y2={padT + H} stroke="#dde4f0" strokeWidth={1} /><text x={x} y={padT + H + 17} textAnchor="middle" fontSize={9.5} fill="#64748b">{Math.round(val)}</text></g>;
      })}
      {minP < 0 && maxP > 0 && <line x1={padL} y1={toY(0)} x2={padL + W} y2={toY(0)} stroke="#94a3b8" strokeWidth={1} strokeDasharray="4,3" />}
      <line x1={padL} y1={padT} x2={padL} y2={padT + H + 1} stroke="#94a3b8" strokeWidth={1.5} />
      <line x1={padL - 1} y1={padT + H} x2={padL + W} y2={padT + H} stroke="#94a3b8" strokeWidth={1.5} />
      <text x={15} y={padT + H / 2} textAnchor="middle" fontSize={10.5} fill="#475569" fontWeight={500} transform={`rotate(-90, 15, ${padT + H / 2})`}>Напор, Па</text>
      <text x={padL + W / 2} y={height - 5} textAnchor="middle" fontSize={10.5} fill="#475569" fontWeight={500}>Длина, м</text>
      {areaD && <path d={areaD} fill="url(#dg-fill)" />}
      <path d={pathD} fill="none" stroke="#2563eb" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p, i) => {
        const x = toX(p.cumulativeLength), y = toY(p.pressure), isHov = hovered === i;
        return (
          <g key={i}>
            {p.nodeNumber && <text x={x} y={y - 9} textAnchor="middle" fontSize={8.5} fill="#1e40af" fontWeight={600}>{p.nodeNumber}</text>}
            <circle cx={x} cy={y} r={isHov ? 6 : 4} fill={isHov ? "#1d4ed8" : "#3b82f6"} stroke="white" strokeWidth={2} style={{ cursor: "crosshair" }} onMouseEnter={() => setHovered(i)} onMouseLeave={() => setHovered(null)} />
          </g>
        );
      })}
      {hovered !== null && (() => {
        const p = points[hovered], x = toX(p.cumulativeLength), y = toY(p.pressure);
        const tw = 178, th = hovered > 0 ? 65 : 50;
        const tx = Math.min(x + 12, padL + W - tw - 4), ty = Math.max(y - th - 8, padT + 2);
        return (
          <g>
            <rect x={tx} y={ty} width={tw} height={th} rx={5} fill="#0f172a" opacity={0.93} />
            <text x={tx + 9} y={ty + 15} fontSize={10} fill="white" fontWeight={700}>{p.nodeNumber ? `Узел ${p.nodeNumber}` : "Начало маршрута"}</text>
            <text x={tx + 9} y={ty + 28} fontSize={9} fill="#94a3b8">{p.nodeName.slice(0, 26)}</text>
            <text x={tx + 9} y={ty + 42} fontSize={9} fill="#7dd3fc">L = {p.cumulativeLength.toFixed(1)} м · h = {p.pressure.toFixed(2)} Па</text>
            {hovered > 0 && <text x={tx + 9} y={ty + 56} fontSize={9} fill="#fca5a5">ΔP = −{p.dP.toFixed(2)} Па  ({p.branchName.slice(0, 20)})</text>}
          </g>
        );
      })()}
    </svg>
  );
}

// ─── Хук перетаскивания ───────────────────────────────────────────────────────
function useDraggable(initialPos: { x: number; y: number }) {
  const [pos, setPos] = useState(initialPos);
  const dragRef = useRef<{ startX: number; startY: number; posX: number; posY: number } | null>(null);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("button,input,select,textarea,a")) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, posX: pos.x, posY: pos.y };
    e.preventDefault();
  }, [pos]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      setPos({ x: dragRef.current.posX + e.clientX - dragRef.current.startX, y: dragRef.current.posY + e.clientY - dragRef.current.startY });
    };
    const onUp = () => { dragRef.current = null; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, []);

  return { pos, onMouseDown };
}

// ─── Основной диалог (без overlay — не блокирует схему) ──────────────────────
export default function DepressogramDialog({
  nodes, branches, onClose, onHighlightPath,
  pickMode, onPickModeChange, manualBranchIds, onClearManual,
}: Props) {
  const [activeTab, setActiveTab] = useState<"chart" | "table">("chart");
  const [mode, setMode] = useState<"auto" | "manual">("auto");

  // Начальная позиция — по центру сверху, немного ниже ribbon
  const initX = Math.max(20, (window.innerWidth - Math.min(window.innerWidth - 40, 1000)) / 2);
  const initY = 100;
  const { pos, onMouseDown: onHeaderDrag } = useDraggable({ x: initX, y: initY });

  const W = Math.min(window.innerWidth - 40, 1000);
  const chartH = Math.max(window.innerHeight - pos.y - 200, 280);

  // Список ВГП (главных вентиляторов) для выбора стартовой точки маршрута.
  const fanBranchList = useMemo(
    () => branches.filter(b => b.hasFan && !b.fanStopped)
      .sort((a, b) => (a.fanType === "ГВУ" ? -1 : 1) - (b.fanType === "ГВУ" ? -1 : 1)),
    [branches]
  );
  // "" = авто-выбор ВГП, иначе id конкретной ветви ВГП, заданной пользователем.
  const [selectedFanId, setSelectedFanId] = useState<string>("");

  const autoRoute = useMemo(
    () => findMainRoute(nodes, branches, selectedFanId || undefined),
    [nodes, branches, selectedFanId]
  );
  const autoPoints = useMemo(() => autoRoute ? buildPointsFromBranchIds(autoRoute.branchPath, nodes, branches) : [], [autoRoute, nodes, branches]);
  const manualPoints = useMemo(() => manualBranchIds.size > 0 ? buildPointsFromBranchIds(Array.from(manualBranchIds), nodes, branches) : [], [manualBranchIds, nodes, branches]);

  const points = mode === "auto" ? autoPoints : manualPoints;
  const branchIds = mode === "auto" ? (autoRoute?.branchPath ?? []) : Array.from(manualBranchIds);

  const totalLength = points.length > 0 ? points[points.length - 1].cumulativeLength : 0;
  const totalDep = points.length > 0 ? points[0].pressure : 0;

  // Кол-во ВГП в сети
  const fanCount = useMemo(() => branches.filter(b => b.hasFan && b.fanType === "ГВУ" && !b.fanStopped).length, [branches]);

  useEffect(() => {
    if (onHighlightPath) onHighlightPath(branchIds);
    return () => { if (onHighlightPath) onHighlightPath([]); };
  }, [branchIds.join(",")]);

  const handleModeChange = (m: "auto" | "manual") => {
    setMode(m);
    onPickModeChange(m === "manual");
    if (m === "auto") onClearManual();
  };

  const handleExport = async () => {
    // ── 1. Рисуем график в canvas (800×380) ──────────────────────────────────
    // Рендерим в увеличенном разрешении (супер-сэмплинг ×SCALE) — при вставке в
    // Excel картинка занимает ту же область, но остаётся чёткой (без пикселизации).
    const CW = 800, CH = 380;
    const SCALE = 3;
    const padL = 65, padR = 24, padT = 24, padB = 50;
    const GW = CW - padL - padR, GH = CH - padT - padB;
    const canvas = document.createElement("canvas");
    canvas.width = CW * SCALE; canvas.height = CH * SCALE;
    const ctx = canvas.getContext("2d")!;
    // Масштабируем контекст — весь код рисования использует логические координаты
    ctx.scale(SCALE, SCALE);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    // Фон
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, CW, CH);
    ctx.fillStyle = "#f0f6ff"; ctx.fillRect(padL, padT, GW, GH);

    const maxLen = Math.max(...points.map(p => p.cumulativeLength), 1);
    const allP = points.map(p => p.pressure);
    const maxP = Math.max(...allP, 0);
    const minP = Math.min(...allP, 0);
    const pRange = (maxP - minP) || 1;
    const toX = (l: number) => padL + (l / maxLen) * GW;
    const toY = (p: number) => padT + ((maxP - p) / pRange) * GH;

    // Сетка
    ctx.strokeStyle = "#dde4f0"; ctx.lineWidth = 1;
    for (let i = 0; i <= 6; i++) {
      const val = minP + (pRange * i) / 6;
      const y = toY(val);
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + GW, y); ctx.stroke();
      ctx.fillStyle = "#64748b"; ctx.font = "11px Arial"; ctx.textAlign = "right";
      ctx.fillText(val.toFixed(1), padL - 6, y + 4);
    }
    for (let i = 0; i <= 8; i++) {
      const val = (maxLen * i) / 8;
      const x = toX(val);
      ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + GH); ctx.stroke();
      ctx.fillStyle = "#64748b"; ctx.font = "11px Arial"; ctx.textAlign = "center";
      ctx.fillText(Math.round(val).toString(), x, padT + GH + 18);
    }

    // Оси
    ctx.strokeStyle = "#64748b"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(padL, padT); ctx.lineTo(padL, padT + GH + 1); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(padL - 1, padT + GH); ctx.lineTo(padL + GW, padT + GH); ctx.stroke();

    // Подписи осей
    ctx.fillStyle = "#374151"; ctx.font = "bold 12px Arial"; ctx.textAlign = "center";
    ctx.save(); ctx.translate(16, padT + GH / 2); ctx.rotate(-Math.PI / 2);
    ctx.fillText("Напор, Па", 0, 0); ctx.restore();
    ctx.fillText("Длина, м", padL + GW / 2, CH - 8);

    // Площадь под кривой
    if (points.length > 1) {
      ctx.beginPath();
      points.forEach((p, i) => {
        const x = toX(p.cumulativeLength), y = toY(p.pressure);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      const last = points[points.length - 1];
      ctx.lineTo(toX(last.cumulativeLength), toY(minP));
      ctx.lineTo(toX(0), toY(minP));
      ctx.closePath();
      const grad = ctx.createLinearGradient(0, padT, 0, padT + GH);
      grad.addColorStop(0, "rgba(59,130,246,0.22)");
      grad.addColorStop(1, "rgba(59,130,246,0.02)");
      ctx.fillStyle = grad; ctx.fill();
    }

    // Линия
    ctx.strokeStyle = "#2563eb"; ctx.lineWidth = 2.5;
    ctx.lineJoin = "round"; ctx.lineCap = "round";
    ctx.beginPath();
    points.forEach((p, i) => {
      const x = toX(p.cumulativeLength), y = toY(p.pressure);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Точки и номера узлов
    points.forEach(p => {
      const x = toX(p.cumulativeLength), y = toY(p.pressure);
      ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fillStyle = "#3b82f6"; ctx.fill();
      ctx.strokeStyle = "white"; ctx.lineWidth = 2; ctx.stroke();
      if (p.nodeNumber) {
        ctx.fillStyle = "#1e40af"; ctx.font = "bold 9px Arial"; ctx.textAlign = "center";
        ctx.fillText(p.nodeNumber, x, y - 8);
      }
    });

    const pngBase64 = canvas.toDataURL("image/png").split(",")[1];

    // ── 2. Собираем Excel через ExcelJS ────────────────────────────────────────
    const ExcelJS = await import("exceljs");
    const wb = new ExcelJS.default.Workbook();
    wb.creator = "ПВ-Система";
    wb.created = new Date();

    const ws = wb.addWorksheet("Депрессиограмма", { views: [{ showGridLines: false }] });

    // Ширины колонок
    ws.columns = [
      { key: "A", width: 14 },
      { key: "B", width: 14 },
      { key: "C", width: 40 },
      { key: "D", width: 12 },
      { key: "E", width: 14 },
      { key: "F", width: 14 },
      { key: "G", width: 14 },
    ];

    // ── Заголовок ──
    ws.mergeCells("A1:G1");
    const titleCell = ws.getCell("A1");
    titleCell.value = "ДЕПРЕССИОГРАММА";
    titleCell.font = { name: "Arial", size: 16, bold: true, color: { argb: "FF1E3A5F" } };
    titleCell.alignment = { horizontal: "center", vertical: "middle" };
    titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8F0FB" } };
    ws.getRow(1).height = 36;

    ws.mergeCells("A2:G2");
    const subCell = ws.getCell("A2");
    subCell.value = `ПВ-Система  |  Дата: ${new Date().toLocaleDateString("ru-RU")}  |  h = ${totalDep.toFixed(1)} Па  ·  L = ${totalLength.toFixed(0)} м  ·  ${points.length - 1} участков`;
    subCell.font = { name: "Arial", size: 11, color: { argb: "FF475569" } };
    subCell.alignment = { horizontal: "center" };
    subCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF0F6FF" } };
    ws.getRow(2).height = 20;

    ws.addRow([]); // строка 3 — пустая

    // ── Вставляем изображение (строка 4) ──
    const imgId = wb.addImage({ base64: pngBase64, extension: "png" });
    ws.addImage(imgId, { tl: { col: 0, row: 3 }, br: { col: 7, row: 23 } });
    for (let r = 4; r <= 23; r++) ws.getRow(r).height = 18;

    ws.addRow([]); // строка 24 — пустая

    // ── Заголовок таблицы (строка 25) ──
    const headers = ["Нач. узел", "Кон. узел", "Название выработки", "Ветвь №", "Длина, м", "ΔP, Па", "Напор, Па"];
    const hRow = ws.addRow(headers);
    hRow.eachCell(cell => {
      cell.font = { name: "Arial", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1D4ED8" } };
      cell.alignment = { horizontal: "center", vertical: "middle" };
      cell.border = {
        top: { style: "thin", color: { argb: "FF93C5FD" } },
        bottom: { style: "thin", color: { argb: "FF93C5FD" } },
        left: { style: "thin", color: { argb: "FF93C5FD" } },
        right: { style: "thin", color: { argb: "FF93C5FD" } },
      };
    });
    hRow.height = 22;

    // ── Строки данных ──
    points.forEach((p, i) => {
      const prev = i > 0 ? points[i - 1] : null;
      const isEven = i % 2 === 0;
      const row = ws.addRow([
        prev ? (prev.nodeNumber || prev.nodeId) : "—",
        p.nodeNumber || p.nodeId,
        p.branchName || (i === 0 ? "(начало маршрута)" : "—"),
        p.branchNumber ?? "",
        +p.cumulativeLength.toFixed(2),
        p.dP > 0 ? +p.dP.toFixed(2) : 0,
        +p.pressure.toFixed(2),
      ]);

      const bgColor = isEven ? "FFFAFCFF" : "FFF0F6FF";
      row.eachCell((cell, colNum) => {
        cell.font = { name: "Arial", size: 10 };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bgColor } };
        cell.border = {
          bottom: { style: "hair", color: { argb: "FFE2E8F0" } },
          left: { style: "hair", color: { argb: "FFE2E8F0" } },
          right: { style: "hair", color: { argb: "FFE2E8F0" } },
        };
        if (colNum === 3) { cell.alignment = { horizontal: "left" }; }
        else if (colNum >= 5) {
          cell.alignment = { horizontal: "right" };
          cell.numFmt = "#,##0.00";
          if (colNum === 6 && (cell.value as number) > 0) cell.font = { name: "Arial", size: 10, color: { argb: "FFDC2626" } };
          if (colNum === 7) cell.font = { name: "Arial", size: 10, bold: true, color: { argb: "FF1D4ED8" } };
        } else {
          cell.alignment = { horizontal: "center" };
        }
      });
      row.height = 18;
    });

    // ── Итоговая строка ──
    const totRow = ws.addRow([
      "", "ИТОГО", "", "",
      +totalLength.toFixed(2),
      +points.reduce((s, p) => s + p.dP, 0).toFixed(2),
      "",
    ]);
    totRow.eachCell((cell, colNum) => {
      cell.font = { name: "Arial", size: 10, bold: true };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFF6FF" } };
      cell.border = {
        top: { style: "medium", color: { argb: "FF3B82F6" } },
        bottom: { style: "medium", color: { argb: "FF3B82F6" } },
      };
      if (colNum >= 5) { cell.alignment = { horizontal: "right" }; cell.numFmt = "#,##0.00"; }
      else { cell.alignment = { horizontal: "center" }; }
    });
    totRow.height = 20;

    // ── Скачиваем файл ──
    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "депрессиограмма.xlsx"; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    // Без overlay-фона — диалог плавает поверх схемы, схема остаётся кликабельной
    <div style={{ position: "fixed", left: pos.x, top: pos.y, zIndex: 9000, width: W, maxHeight: window.innerHeight - pos.y - 20, background: "white", borderRadius: 7, boxShadow: "0 8px 40px rgba(0,0,0,0.32)", display: "flex", flexDirection: "column", overflow: "hidden", border: "1px solid #cbd5e1" }}>

      {/* ── Заголовок (перетаскивание) ── */}
      <div
        onMouseDown={onHeaderDrag}
        style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 12px", borderBottom: "1px solid #e5e7eb", background: "linear-gradient(180deg,#f0f6ff,#e8f0fb)", flexShrink: 0, cursor: "grab", userSelect: "none" }}>
        <Icon name="TrendingDown" size={15} style={{ color: "#2563eb", flexShrink: 0 }} />
        <span style={{ fontWeight: 700, fontSize: 13, color: "#1e293b" }}>Депрессиограмма</span>
        {points.length > 1 && (
          <span style={{ fontSize: 11, background: "#dbeafe", color: "#1d4ed8", borderRadius: 12, padding: "2px 9px", fontWeight: 600, flexShrink: 0 }}>
            h = {totalDep.toFixed(1)} Па · L = {totalLength.toFixed(0)} м · {points.length - 1} вет.
          </span>
        )}
        {fanCount > 1 && mode === "auto" && (
          <span style={{ fontSize: 10, background: "#fef3c7", color: "#92400e", borderRadius: 10, padding: "2px 8px", fontWeight: 600 }}>
            ВГП: {fanCount} · выбран маршрут с наибольшим расходом
          </span>
        )}
        <div style={{ flex: 1 }} />
        <Icon name="GripHorizontal" size={14} style={{ color: "#9ca3af" }} />
        <button onClick={onClose} style={{ width: 22, height: 22, border: "none", background: "transparent", cursor: "pointer", fontSize: 17, color: "#6b7280", lineHeight: 1, flexShrink: 0, marginLeft: 4 }}>×</button>
      </div>

      {/* ── Панель: маршрут + вкладки ── */}
      <div style={{ display: "flex", alignItems: "center", borderBottom: "1px solid #e5e7eb", background: "#f9fafb", flexShrink: 0, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 12px", borderRight: "1px solid #e5e7eb" }}>
          <span style={{ fontSize: 11, color: "#6b7280", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>Маршрут:</span>
          <button onClick={() => handleModeChange("auto")}
            style={{ padding: "3px 11px", fontSize: 11, fontWeight: 600, borderRadius: 4, border: "1px solid", cursor: "pointer", background: mode === "auto" ? "#2563eb" : "#f1f5f9", color: mode === "auto" ? "white" : "#374151", borderColor: mode === "auto" ? "#1d4ed8" : "#d1d5db" }}>
            Авто
          </button>
          <button onClick={() => handleModeChange("manual")}
            style={{ padding: "3px 11px", fontSize: 11, fontWeight: 600, borderRadius: 4, border: "1px solid", cursor: "pointer", background: mode === "manual" ? "#7c3aed" : "#f1f5f9", color: mode === "manual" ? "white" : "#374151", borderColor: mode === "manual" ? "#6d28d9" : "#d1d5db" }}>
            Ручной
          </button>
          {mode === "auto" && fanBranchList.length > 0 && (
            <>
              <span style={{ fontSize: 11, color: "#6b7280", fontWeight: 600, marginLeft: 4 }}>ВГП:</span>
              <select
                value={selectedFanId}
                onChange={e => setSelectedFanId(e.target.value)}
                style={{ fontSize: 11, padding: "3px 6px", borderRadius: 4, border: "1px solid #d1d5db", background: "white", color: "#374151", cursor: "pointer", maxWidth: 220 }}
                title="Ветвь главного вентилятора, от которой строится маршрут">
                <option value="">Авто (наибольший расход)</option>
                {fanBranchList.map(f => (
                  <option key={f.id} value={f.id}>
                    {`${f.fanType} · ${f.fanName ? f.fanName : `ветвь ${f.id}`}`}
                  </option>
                ))}
              </select>
            </>
          )}
          {mode === "manual" && (
            <span style={{ fontSize: 10.5, color: "#7c3aed", fontWeight: 600 }}>
              {`✦ клик по ветви на схеме (${manualBranchIds.size} вет.)`}
            </span>
          )}
          {mode === "manual" && manualBranchIds.size > 0 && (
            <button onClick={onClearManual}
              style={{ padding: "2px 7px", fontSize: 10, color: "#ef4444", background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 3, cursor: "pointer" }}>
              Сбросить
            </button>
          )}
        </div>
        {(["chart", "table"] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            style={{ padding: "6px 14px", fontSize: 12, fontWeight: activeTab === tab ? 600 : 400, color: activeTab === tab ? "#2563eb" : "#374151", borderBottom: activeTab === tab ? "2px solid #2563eb" : "2px solid transparent", background: "transparent", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}>
            <Icon name={tab === "chart" ? "BarChart2" : "Table"} size={13} />
            {tab === "chart" ? "График" : "Таблица"}
          </button>
        ))}
      </div>

      {/* ── Тело ── */}
      <div style={{ flex: 1, overflow: "auto", padding: activeTab === "chart" ? "8px 8px 0" : 0, minHeight: 0 }}>
        {mode === "manual" && manualBranchIds.size === 0 ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 260, gap: 10 }}>
            <Icon name="MousePointer2" size={36} style={{ color: "#7c3aed" }} />
            <div style={{ fontWeight: 600, fontSize: 13, color: "#1e293b" }}>Выберите ветви маршрута на схеме</div>
            <div style={{ fontSize: 12, maxWidth: 360, textAlign: "center", lineHeight: 1.6, color: "#6b7280" }}>
              Кликайте по выработкам на схеме — каждая добавляется в маршрут.<br />
              Повторный клик убирает ветвь. Схема полностью активна.
            </div>
          </div>
        ) : points.length === 0 ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 260, gap: 8 }}>
            <Icon name="AlertCircle" size={30} style={{ color: "#f59e0b" }} />
            <div style={{ fontWeight: 600, fontSize: 13, color: "#1e293b" }}>Маршрут не найден</div>
            <div style={{ fontSize: 11, maxWidth: 360, textAlign: "center", lineHeight: 1.5, color: "#6b7280" }}>
              Убедитесь, что выполнен расчёт сети (F9), в схеме есть ветвь ВГП с ненулевым расходом и поверхностный узел (atmosphereLink = true).
            </div>
          </div>
        ) : activeTab === "chart" ? (
          <DepressogramChart points={points} width={W - 18} height={chartH} />
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
            <thead>
              <tr style={{ background: "#f1f5f9" }}>
                {["Нач. узел", "Кон. узел", "Название выработки", "Номер", "Длина, м", "ΔP, Па", "Напор, Па"].map(h => (
                  <th key={h} style={{ padding: "5px 8px", textAlign: h === "Название выработки" ? "left" : "right", fontWeight: 600, color: "#374151", borderBottom: "2px solid #cbd5e1", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.03em", position: "sticky", top: 0, background: "#f1f5f9" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {points.map((p, i) => {
                const prev = i > 0 ? points[i - 1] : null;
                return (
                  <tr key={i} style={{ background: i % 2 === 0 ? "white" : "#f8faff", borderBottom: "1px solid #f1f5f9" }}>
                    <td style={{ padding: "4px 8px", textAlign: "right", fontWeight: 600, color: "#475569" }}>{prev ? (prev.nodeNumber || prev.nodeId) : "—"}</td>
                    <td style={{ padding: "4px 8px", textAlign: "right", fontWeight: 600, color: "#475569" }}>{p.nodeNumber || p.nodeId}</td>
                    <td style={{ padding: "4px 8px", color: "#1e293b" }}>{p.branchName || (i === 0 ? "(начало маршрута)" : "—")}</td>
                    <td style={{ padding: "4px 8px", textAlign: "right", color: "#94a3b8" }}>{p.branchNumber ?? ""}</td>
                    <td style={{ padding: "4px 8px", textAlign: "right", color: "#374151" }}>{p.cumulativeLength.toFixed(2)}</td>
                    <td style={{ padding: "4px 8px", textAlign: "right", color: "#ef4444", fontWeight: 500 }}>{p.dP > 0 ? `−${p.dP.toFixed(2)}` : "—"}</td>
                    <td style={{ padding: "4px 8px", textAlign: "right", color: "#2563eb", fontWeight: 700 }}>{p.pressure.toFixed(2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Футер ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "7px 12px", borderTop: "1px solid #e5e7eb", background: "#f9fafb", flexShrink: 0 }}>
        <div style={{ fontSize: 10, color: "#6b7280" }}>
          {mode === "auto"
            ? (selectedFanId
                ? `Авто: маршрут наибольшего расхода от выбранного ВГП до поверхности (без перемычек)`
                : `Авто: маршрут наибольшего расхода от ГВУ до поверхности, без перемычек${fanCount > 1 ? ` (${fanCount} ВГП в схеме)` : ""}`)
            : `Ручной: ${manualBranchIds.size} ветв. · кликайте по схеме`}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {points.length > 1 && (
            <button onClick={handleExport} style={{ padding: "4px 12px", fontSize: 11, fontWeight: 500, background: "#f0fdf4", color: "#15803d", border: "1px solid #86efac", borderRadius: 4, cursor: "pointer" }}>
              Экспорт в Excel
            </button>
          )}
          <button onClick={onClose} style={{ padding: "4px 16px", fontSize: 11, fontWeight: 600, background: "#2563eb", color: "white", border: "none", borderRadius: 4, cursor: "pointer" }}>
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
}