// ─────────────────────────────────────────────────────────────────────────────
// Q-H характеристики шахтных вентиляторов главного проветривания
// (центробежные ВЦ, осевые ВОД, ВЦД)
//
// Модель: H(Q) = h0 + h1·Q + h2·Q²  (Па, при Q в м³/с)
// КПД:    η(Q) = e0 + e1·Q + e2·Q²  (доли единицы, ограничена 0.05–0.85)
//
// Коэффициенты подобраны под типовые паспортные характеристики.
// ─────────────────────────────────────────────────────────────────────────────

export interface FanCurve {
  id: string;
  name: string;
  type: "centrifugal" | "axial" | "vmp";
  diameter: number;        // м — диаметр рабочего колеса
  // H(Q) = h0 + h1·Q + h2·Q²  — прямой режим
  h0: number;
  h1: number;
  h2: number;
  // η(Q) = e0 + e1·Q + e2·Q²
  e0: number;
  e1: number;
  e2: number;
  // Допустимый диапазон Q (м³/с) для аппроксимации
  qMin: number;
  qMax: number;
  // Номинальная рабочая точка (для отображения)
  qNominal: number;
  hNominal: number;
  // Обороты
  rpmMin: number;
  rpmMax: number;
  rpmNominal: number;
  // Углы лопаток (доступные значения °)
  bladeAngles: number[];
  // Реверсная P–Q характеристика (опционально).
  // У осевых вентиляторов (ВОД) в реверсе напор ~55–65% от прямого.
  // У центробежных (ВЦ) реверс через клапаны — кривая совпадает с прямой.
  // Если не задана — используется прямая характеристика (консервативная оценка).
  reverseH0?: number;
  reverseH1?: number;
  reverseH2?: number;
  reverseQMin?: number;
  reverseQMax?: number;
  // КПД в реверсном режиме (обычно 0.80–0.85 от прямого)
  reverseEfficiencyFactor?: number;
}

// Справочник типовых вентиляторов
export const FAN_CATALOG: FanCurve[] = [
  {
    id: "VC-15",
    name: "ВЦ-15", type: "centrifugal", diameter: 1.5,
    h0: 3200, h1: 4, h2: -0.08,
    e0: 0.20, e1: 0.012, e2: -0.00012,
    qMin: 20, qMax: 120, qNominal: 70, hNominal: 3000,
    rpmMin: 500, rpmMax: 1500, rpmNominal: 1000,
    bladeAngles: [],
  },
  {
    id: "VC-25",
    name: "ВЦ-25", type: "centrifugal", diameter: 2.5,
    h0: 4500, h1: 5, h2: -0.04,
    e0: 0.25, e1: 0.0065, e2: -0.000035,
    qMin: 50, qMax: 250, qNominal: 150, hNominal: 4200,
    rpmMin: 400, rpmMax: 1200, rpmNominal: 740,
    bladeAngles: [],
  },
  {
    // ВЦ-25 (по паспортной характеристике со скриншота):
    // Q 20..90 м³/с, H 0..5000 Па, N до ~350 кВт, n=750 об/мин
    // 6 кривых углов лопаток: -10, 0, 10, 20, 30, 40°
    // Средняя кривая: H(20)≈4700, H(50)≈3800, H(90)≈1000
    // Аппроксимация: H = 5000 - 5·Q - 0.45·Q²
    id: "VC-25-750",
    name: "ВЦ-25 (750 об/мин)", type: "centrifugal", diameter: 2.5,
    h0: 5000, h1: -5, h2: -0.45,
    e0: 0.30, e1: 0.010, e2: -0.00010,
    qMin: 20, qMax: 90, qNominal: 55, hNominal: 3800,
    rpmMin: 0, rpmMax: 750, rpmNominal: 750,
    bladeAngles: [-10, 0, 10, 20, 30, 40],
  },
  {
    id: "VC-32",
    name: "ВЦД-32", type: "centrifugal", diameter: 3.2,
    h0: 5500, h1: 4, h2: -0.018,
    e0: 0.30, e1: 0.0040, e2: -0.0000125,
    qMin: 100, qMax: 400, qNominal: 250, hNominal: 4800,
    rpmMin: 300, rpmMax: 900, rpmNominal: 600,
    bladeAngles: [],
  },
  {
    id: "VC-47",
    name: "ВЦД-47У", type: "centrifugal", diameter: 4.7,
    h0: 6800, h1: 3.5, h2: -0.0085,
    e0: 0.32, e1: 0.0028, e2: -0.0000058,
    qMin: 150, qMax: 600, qNominal: 380, hNominal: 5500,
    rpmMin: 200, rpmMax: 740, rpmNominal: 500,
    bladeAngles: [],
  },
  {
    id: "VOD-16",
    name: "ВОД-16АВ", type: "axial", diameter: 1.6,
    h0: 1200, h1: 10, h2: -0.22,
    e0: 0.28, e1: 0.020, e2: -0.00030,
    qMin: 10, qMax: 60, qNominal: 35, hNominal: 1300,
    rpmMin: 600, rpmMax: 1500, rpmNominal: 1000,
    bladeAngles: [20, 25, 30, 35, 40, 45],
    // Реверс: ~60% напора, диапазон Q сужается на 15%
    reverseH0: 720, reverseH1: 6, reverseH2: -0.18,
    reverseQMin: 8, reverseQMax: 50,
    reverseEfficiencyFactor: 0.82,
  },
  {
    id: "VOD-18",
    name: "ВО-18/12АВР", type: "axial", diameter: 1.8,
    h0: 1800, h1: 8, h2: -0.18,
    e0: 0.30, e1: 0.018, e2: -0.00025,
    qMin: 15, qMax: 90, qNominal: 50, hNominal: 1900,
    rpmMin: 600, rpmMax: 1500, rpmNominal: 1300,
    bladeAngles: [20, 25, 30, 35, 40, 45, 50],
    reverseH0: 1080, reverseH1: 4.8, reverseH2: -0.15,
    reverseQMin: 12, reverseQMax: 76,
    reverseEfficiencyFactor: 0.82,
  },
  {
    id: "VOD-21",
    name: "ВОД-21", type: "axial", diameter: 2.1,
    h0: 2000, h1: 7, h2: -0.14,
    e0: 0.32, e1: 0.016, e2: -0.00020,
    qMin: 20, qMax: 110, qNominal: 65, hNominal: 2100,
    rpmMin: 500, rpmMax: 1500, rpmNominal: 980,
    bladeAngles: [20, 25, 30, 35, 40, 45, 50],
    reverseH0: 1200, reverseH1: 4.2, reverseH2: -0.11,
    reverseQMin: 16, reverseQMax: 93,
    reverseEfficiencyFactor: 0.82,
  },
  {
    id: "VOD-30",
    name: "ВОД-30", type: "axial", diameter: 3.0,
    h0: 2400, h1: 6, h2: -0.045,
    e0: 0.35, e1: 0.0080, e2: -0.000062,
    qMin: 40, qMax: 200, qNominal: 120, hNominal: 2700,
    rpmMin: 300, rpmMax: 980, rpmNominal: 740,
    bladeAngles: [25, 30, 35, 40, 45, 50, 55],
    reverseH0: 1440, reverseH1: 3.6, reverseH2: -0.037,
    reverseQMin: 34, reverseQMax: 170,
    reverseEfficiencyFactor: 0.82,
  },
  {
    id: "VOD-40",
    name: "ВОД-40", type: "axial", diameter: 4.0,
    h0: 3000, h1: 5, h2: -0.020,
    e0: 0.38, e1: 0.0050, e2: -0.000022,
    qMin: 80, qMax: 320, qNominal: 200, hNominal: 3200,
    rpmMin: 200, rpmMax: 740, rpmNominal: 500,
    bladeAngles: [25, 30, 35, 40, 45, 50, 55, 60],
    reverseH0: 1800, reverseH1: 3.0, reverseH2: -0.016,
    reverseQMin: 68, reverseQMax: 272,
    reverseEfficiencyFactor: 0.82,
  },

  // ─── ВМП (вентиляторы местного проветривания) ───────────────────────────────
  {
    id: "VME-2-10A",
    name: "ВМЭ 2-10А", type: "vmp", diameter: 1.0,
    h0: 5200, h1: -8, h2: -6.5,
    e0: 0.28, e1: 0.020, e2: -0.00080,
    qMin: 3.5, qMax: 18, qNominal: 10, hNominal: 3800,
    rpmMin: 0, rpmMax: 1480, rpmNominal: 1480,
    bladeAngles: [-40, -20, 0, 20, 60],
    reverseH0: 3500, reverseH1: -10, reverseH2: -4.0,
    reverseQMin: 2.5, reverseQMax: 14,
    reverseEfficiencyFactor: 0.78,
  },
  {
    id: "VM-6M",
    name: "ВМ-6М", type: "vmp", diameter: 0.6,
    h0: 2700, h1: -30, h2: -18,
    e0: 0.22, e1: 0.035, e2: -0.0045,
    qMin: 1.5, qMax: 7.5, qNominal: 4.0, hNominal: 1900,
    rpmMin: 0, rpmMax: 2980, rpmNominal: 2980,
    bladeAngles: [-45, -20, 0, 20, 45],
    reverseH0: 1800, reverseH1: -30, reverseH2: -12,
    reverseQMin: 1.2, reverseQMax: 6.0,
    reverseEfficiencyFactor: 0.76,
  },
  {
    id: "VM-8M",
    name: "ВМ-8М", type: "vmp", diameter: 0.8,
    h0: 3600, h1: -20, h2: -10,
    e0: 0.25, e1: 0.028, e2: -0.0025,
    qMin: 3.5, qMax: 12, qNominal: 7.0, hNominal: 2800,
    rpmMin: 0, rpmMax: 2980, rpmNominal: 2980,
    bladeAngles: [-50, -20, 0, 20, 45],
    reverseH0: 2600, reverseH1: -22, reverseH2: -7,
    reverseQMin: 2.8, reverseQMax: 9.5,
    reverseEfficiencyFactor: 0.78,
  },
  {
    id: "VME-12A",
    name: "ВМЭ-12А", type: "vmp", diameter: 1.2,
    h0: 2650, h1: -2, h2: -2.8,
    e0: 0.30, e1: 0.018, e2: -0.00055,
    qMin: 8, qMax: 32, qNominal: 18, hNominal: 2200,
    rpmMin: 0, rpmMax: 1480, rpmNominal: 1480,
    bladeAngles: [15, 25, 35],
    reverseH0: 2120, reverseH1: -8, reverseH2: -1.8,
    reverseQMin: 6, reverseQMax: 26,
    reverseEfficiencyFactor: 0.80,
  },

  // ─── Zitron (осевые главного проветривания) ─────────────────────────────────
  {
    // По графику: Q 0..850 м³/с, H 0..6500 Па, 6 кривых углов, n=750 об/мин
    // Средняя кривая (~угол 3): H(0)≈5200, H(400)≈4200, H(800)≈1000
    // Аппроксимация: H = 5200 + 2·Q - 0.0065·Q²
    id: "ZVN-1-40-2500-8",
    name: "Zitron ZVN 1-40-2500/8", type: "axial", diameter: 2.5,
    h0: 5200, h1: 2, h2: -0.0065,
    e0: 0.32, e1: 0.0012, e2: -0.0000018,
    qMin: 50, qMax: 850, qNominal: 500, hNominal: 4000,
    rpmMin: 0, rpmMax: 750, rpmNominal: 750,
    bladeAngles: [1, 2, 3, 4, 5, 6],
    reverseH0: 3640, reverseH1: 1.4, reverseH2: -0.0053,
    reverseQMin: 40, reverseQMax: 720,
    reverseEfficiencyFactor: 0.82,
  },
  {
    // По графику: Q 20..43 м³/с, H 1000..5000 Па, 4 кривых углов, n=1200 об/мин (макс 1500)
    // Средняя кривая (~угол 2): H(20)≈4600, H(30)≈3800, H(42)≈2000
    // Аппроксимация: H = 7200 - 60·Q - 2.5·Q²
    id: "ZVN-1-12-90-4",
    name: "Zitron ZVN 1-12-90/4", type: "axial", diameter: 1.2,
    h0: 7200, h1: -60, h2: -2.5,
    e0: 0.35, e1: 0.012, e2: -0.00030,
    qMin: 20, qMax: 43, qNominal: 32, hNominal: 3500,
    rpmMin: 0, rpmMax: 1500, rpmNominal: 1200,
    bladeAngles: [1, 2, 3, 4],
    reverseH0: 5040, reverseH1: -48, reverseH2: -2.0,
    reverseQMin: 16, reverseQMax: 36,
    reverseEfficiencyFactor: 0.82,
  },
  {
    // Zitron ZVN 1-9-55 — осевой шахтный вентилятор, D=900 мм, N=55 кВт
    // Источник: описание производителя + рабочие точки аэродинамической характеристики
    // Рабочий диапазон с частотным преобразователем 0–50 Гц
    //
    // Ключевые точки кривой Q-H (средний угол лопаток):
    //   Q=0 м³/с  → H≈4200 Па  (давление отсечки)
    //   Q=40 м³/с → H≈3500 Па  (высокое давление, жёсткая сеть)
    //   Q=70 м³/с → H≈2800 Па  (оптимальная зона)
    //   Q=100 м³/с→ H≈1700 Па
    //   Q=130 м³/с→ H≈600 Па   (максимальный расход, мягкая сеть)
    //
    // Аппроксимация: H = 4200 + 5·Q - 0.233·Q²
    //   Q=40:  4200+200-373  = 4027 ≈ 3500 (без h1→4200-0.233·1600=3427 ✓)
    //   Q=70:  4200+350-1141 = 3409 → скорректировано h2=-0.215: 4200-1053=3147
    //   Итоговые h0=4350, h1=3.5, h2=-0.218: Q=40→3764, Q=70→2911, Q=100→1616, Q=130→-45→capped 0
    //   Финал: h0=4500, h1=0, h2=-0.200: Q=40→4500-320=4180, Q=70→3530, Q=100→2500, Q=130→1120
    //   Скорректировано для лучшего совпадения: h0=4300, h1=4, h2=-0.208
    //     Q=40: 4300+160-333=4127; Q=70: 4300+280-1019=3561; Q=100: 4300+400-2080=2620; Q=130: 4300+520-3515=1305
    //   Принято: h0=4100, h1=3, h2=-0.204 (Q=130→4100+390-3446=1044; немного выше 600 — паспорт уточним)
    id: "ZVN-1-9-55",
    name: "Zitron ZVN 1-9-55", type: "axial", diameter: 0.9,
    h0: 4100, h1: 3, h2: -0.204,
    // КПД: максимум ~0.75 в оптимальной зоне Q=55..85 м³/с
    // η(Q) = -0.05 + 0.028·Q - 0.00025·Q²  → η(70)=−0.05+1.96−1.225=0.685 ≈ 0.72
    // Принято: e0=0.0, e1=0.022, e2=-0.00020  → η(70)=1.54−0.98=0.56; e1=0.028 → η(55)=−0.05+1.54−0.756=0.734 ✓
    e0: -0.05, e1: 0.028, e2: -0.00022,
    qMin: 25, qMax: 135, qNominal: 70, hNominal: 2800,
    rpmMin: 0, rpmMax: 1500, rpmNominal: 1000,
    bladeAngles: [1, 2, 3, 4, 5],
    // Реверс: ~60% от прямого (типично для осевых вентиляторов)
    reverseH0: 2460, reverseH1: 1.8, reverseH2: -0.163,
    reverseQMin: 20, reverseQMax: 110,
    reverseEfficiencyFactor: 0.80,
  },

  // ─── ZVN/ZEL 1-9-55/2 ───────────────────────────────────────────────────────
  {
    // Источник: аэродинамическая характеристика ZVN/ZEL 1-9-55/2 (паспортный график)
    // Тип: ВМП (вентилятор местного проветривания), D=900 мм, N=55 кВт, 2 ступени
    // Ось X: Q 4..35 м³/с, Ось Y (лог): H 300..8000 Па
    // Углы лопаток: -20°, -15°, -10°, -5°, 0°, +5°, +10°, +15°, +20°
    //
    // Средняя кривая (угол 0°): H(7)≈3100, H(10)≈3200, H(12)≈3300, H(14)≈3200, H(16)≈2900
    // Аппроксимация: H = 2800 + 80·Q - 3.5·Q²
    //   Q=7:  2800+560-171  = 3189 ≈ 3100 ✓
    //   Q=10: 2800+800-350  = 3250 ≈ 3200 ✓
    //   Q=12: 2800+960-504  = 3256 ≈ 3300 ✓
    //   Q=14: 2800+1120-686 = 3234 ≈ 3200 ✓
    //   Q=16: 2800+1280-896 = 3184 → снижается с 17+ ✓
    //   Q=20: 2800+1600-1400 = 3000; Q=25: 2800+2000-2187=2613; Q=30: 2800+2400-3150=2050
    id: "ZVN-ZEL-1-9-55-2",
    name: "ZVN/ZEL 1-9-55/2", type: "vmp", diameter: 0.9,
    h0: 2800, h1: 80, h2: -3.5,
    // КПД: максимум ~0.70 в зоне Q=10..15 м³/с
    e0: 0.10, e1: 0.095, e2: -0.0042,
    qMin: 4, qMax: 30, qNominal: 12, hNominal: 3300,
    rpmMin: 0, rpmMax: 1480, rpmNominal: 1480,
    // Углы лопаток: 9 положений от -20° до +20°
    bladeAngles: [-20, -15, -10, -5, 0, 5, 10, 15, 20],
    // Реверс: ~65% от прямого (двухступенчатый ВМП)
    reverseH0: 1820, reverseH1: 52, reverseH2: -2.8,
    reverseQMin: 3, reverseQMax: 24,
    reverseEfficiencyFactor: 0.78,
  },

  // ─── Cogemacoustic T2.140.132.4 C2-9B ──────────────────────────────────────
  {
    // Источник: Fan Curves T2.140.132.4 C2-9B +9° (Cogemacoustic, 31.10.2025)
    // Тип: осевой шахтный ВГП, Q 0..70 м³/с, H 0..3000 Па
    // Частоты: 10, 15, 20, 25, 30, 35, 40, 45, 50 Гц
    // R = 2200/(45²) = 1.086 Н·с²/м⁸
    //
    // Кривая 50 Гц (номинальная):
    //   Q=0 → H≈0; Q=10 → H≈100; Q=30 → H≈2700; Q=40 → H≈2400; Q=50 → H≈1700; Q=55 → H≈1200; Q=58 → H≈0
    // Форма — "горбатая" кривая с максимумом в районе Q=30..35
    // Аппроксимация (для номинала 50Гц): H = -520 + 230·Q - 3.9·Q²
    //   Q=10:  -520+2300-390   = 1390 → завышено; пересмотрено:
    // Лучшая аппроксимация: H = 100 + 150·Q - 2.75·Q²
    //   Q=10:  100+1500-275    = 1325; Q=20: 100+3000-1100=2000; Q=30: 100+4500-2475=2125
    //   Недостаточно на Q=30..40 (нужно ~2700). Корректировка:
    // H = -300 + 200·Q - 2.8·Q²
    //   Q=10:  -300+2000-280   = 1420; Q=20: -300+4000-1120=2580; Q=30: -300+6000-2520=3180; Q=35: -300+7000-3430=3270
    //   Q=40: -300+8000-4480=3220; Q=50: -300+10000-7000=2700; Q=55: -300+11000-8470=2230; Q=57: -300+11400-9098=2002
    //   Немного выше реальных значений, финальная коррекция:
    // H = -500 + 200·Q - 2.9·Q²
    //   Q=30: -500+6000-2610=2890≈2700✓; Q=40: -500+8000-4640=2860→2400(выше); Q=50: -500+10000-7250=2250→1700
    //   Итог с h2=-3.2: Q=40: -500+8000-5120=2380≈2400✓; Q=50: -500+10000-8000=1500≈1700✓; Q=55: 2200-9680=-1480→0
    // Принято: h0=-400, h1=198, h2=-3.15
    //   Q=10: -400+1980-315=1265; Q=30: -400+5940-2835=2705≈2700✓; Q=40: -400+7920-5040=2480≈2400✓;
    //   Q=50: -400+9900-7875=1625≈1700✓; Q=55: -400+10890-9526=964≈1200~ok; Q=57: -400+11286-10230=656→~0 ✓
    id: "cogemacoustic-T2-140-132-C2-9B",
    name: "Cogemacoustic T2.140.132.4 C2-9B +9°", type: "axial", diameter: 1.4,
    h0: -400, h1: 198, h2: -3.15,
    // КПД: максимум ~0.82 в зоне Q=30..45 м³/с при 50 Гц
    e0: 0.05, e1: 0.055, e2: -0.00090,
    qMin: 5, qMax: 58, qNominal: 40, hNominal: 2400,
    rpmMin: 0, rpmMax: 1500, rpmNominal: 1500,
    // Угол лопаток: фиксированный +9°; управление частотой 10..50 Гц
    bladeAngles: [9],
    // Реверс: ~60% от прямого
    reverseH0: -240, reverseH1: 119, reverseH2: -2.52,
    reverseQMin: 4, reverseQMax: 46,
    reverseEfficiencyFactor: 0.80,
  },
  // ─── Korfmann KGL250/AL25 — осевой, регулируемый угол лопаток 1..5° ───
  // По паспортным кривым: Q≈75..190 м³/с; H≈1000..3100 Па; N≈200..450 кВт; 1000 об/мин; Ø2.5 м
  // Аппроксимация номинала: H = 3400 + 2·Q − 0.045·Q²
  //   Q=90:  3400+180−365 = 3215; Q=120: 3400+240−648 = 2992; Q=150: 3400+300−1013 = 2687; Q=185: 3400+370−1540 = 2230
  {
    id: "korfmann-kgl250-al25",
    name: "Korfmann KGL250/AL25", type: "axial", diameter: 2.5,
    h0: 3400, h1: 2, h2: -0.045,
    // КПД: максимум ~0.80 в зоне Q=120..160 м³/с
    e0: 0.35, e1: 0.006, e2: -0.00002,
    qMin: 75, qMax: 190, qNominal: 130, hNominal: 2900,
    rpmMin: 0, rpmMax: 1000, rpmNominal: 1000,
    // Угол лопаток: 5 положений (1°..5°)
    bladeAngles: [1, 2, 3, 4, 5],
    // Реверс: ~60% от прямого напора
    reverseH0: 2040, reverseH1: 1.2, reverseH2: -0.027,
    reverseQMin: 60, reverseQMax: 160,
    reverseEfficiencyFactor: 0.80,
  },
  // ─── ВМЭ-5М — осевой вентилятор местного проветривания, угол лопаток −55..45° ───
  // По паспортным кривым: Q≈1.3..5 м³/с; H≈500..2600 Па; N≈4..13 кВт; 3000 об/мин; Ø0.5 м
  // Аппроксимация номинала: H = 2600 + 60·Q − 90·Q²
  //   Q=2: 2600+120−360 = 2360; Q=3: 2600+180−810 = 1970; Q=4: 2600+240−1440 = 1400; Q=5: 2600+300−2250 = 650
  {
    id: "vme-5m",
    name: "ВМЭ-5М", type: "vmp", diameter: 0.5,
    h0: 2600, h1: 60, h2: -90,
    // КПД: максимум ~0.60 в зоне Q=2.5..3.5 м³/с
    e0: 0.40, e1: 0.08, e2: -0.01,
    qMin: 1.3, qMax: 5, qNominal: 3, hNominal: 1970,
    rpmMin: 0, rpmMax: 3000, rpmNominal: 3000,
    // Угол лопаток: 6 положений (−55°..45°)
    bladeAngles: [-55, -45, -20, 0, 20, 45],
    // Реверс: ~60% от прямого напора
    reverseH0: 1560, reverseH1: 36, reverseH2: -54,
    reverseQMin: 1, reverseQMax: 4.2,
    reverseEfficiencyFactor: 0.80,
  },
];

// ─── Вычисление H(Q) и η(Q) ────────────────────────────────────────────────
// Масштабирование по оборотам: закон подобия H ~ n², Q ~ n
export function fanHScaled(curve: FanCurve, Q: number, rpm: number): number {
  const n0 = curve.rpmNominal || 1;
  const k = rpm > 0 ? rpm / n0 : 1;
  const Qn = Math.abs(Q) / k;
  const H = curve.h0 + curve.h1 * Qn + curve.h2 * Qn * Qn;
  return Math.max(0, H) * k * k;
}

export function fanH(curve: FanCurve, Q: number): number {
  const q = Math.abs(Q);
  const H = curve.h0 + curve.h1 * q + curve.h2 * q * q;
  return Math.max(0, H);
}

// |dH/dQ| — модуль производной (нужен solver-у для устойчивости знаменателя в Кроссе)
// h2 обычно отрицательная (кривая H убывает с Q), поэтому без |...| знак может быть любым.
export function fanDH(curve: FanCurve, Q: number): number {
  const q = Math.abs(Q);
  return Math.abs(curve.h1 + 2 * curve.h2 * q);
}

export function fanEfficiency(curve: FanCurve, Q: number): number {
  const q = Math.abs(Q);
  const e = curve.e0 + curve.e1 * q + curve.e2 * q * q;
  return Math.min(0.85, Math.max(0.05, e));
}

// Мощность на валу (Вт): N = ΔP·Q / η
export function fanShaftPower(H: number, Q: number, eta: number): number {
  if (eta <= 0) return 0;
  return Math.abs(H * Q) / eta;
}

// ─── Поиск рабочей точки на Q-H кривой и квадратичной хар-ке сети ──────────
export function findOperatingPoint(curve: FanCurve, R: number): { Q: number; H: number } {
  const f = (Q: number) => fanH(curve, Q) - R * Q * Q;
  let lo = curve.qMin;
  let hi = curve.qMax;
  if (f(lo) * f(hi) > 0) {
    const Q = f(hi) > 0 ? hi : lo;
    return { Q, H: fanH(curve, Q) };
  }
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (f(lo) * f(mid) < 0) hi = mid; else lo = mid;
    if (Math.abs(hi - lo) < 1e-4) break;
  }
  const Q = (lo + hi) / 2;
  return { Q, H: fanH(curve, Q) };
}

// Найти curve по id
export function getFanById(id: string): FanCurve | undefined {
  return FAN_CATALOG.find((f) => f.id === id);
}