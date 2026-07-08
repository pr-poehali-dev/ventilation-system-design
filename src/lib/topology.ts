// ─────────────────────────────────────────────────────────────────────────────
// Модель топологии вентиляционной сети шахты
// (узлы и ветви с физическими координатами X/Y/Z)
// ─────────────────────────────────────────────────────────────────────────────

export interface TopoNode {
  id: string;
  // Общие свойства
  name: string;
  number: string;
  // Видимость на схеме (управляется из панели информации). undefined = видим
  visible?: boolean;
  // Физические координаты (метры)
  x: number;
  y: number;
  z: number;        // высотная отметка
  // Вентиляция
  airTemp: number;       // °C
  atmosphereLink: boolean;
  // Теплофизика
  wallTemp: number;      // °C — температура стенок
  // Воздушная съёмка
  reducedPressure: number; // Па — приведённое давление
  // Вычисленные параметры (заполняются расчётом)
  computedGasConc: number;     // % — концентрация газа
  computedAirTemp: number;     // °C
  computedWallTemp: number;    // °C
  computedPressure: number;    // Па — абсолютное давление
  computedExplosivePressure: number; // кПа
  // ─── Противопожарное водоснабжение ────────────────────────────
  fireNodeType: "none" | "reservoir" | "consumer" | "junction"; // тип узла ППЗ
  fireConsumerType: "fire_hydrant" | "sprinkler" | "monitor" | "other"; // тип потребителя
  fireHydrantOpen: boolean;           // кран открыт
  fireRequiredFlow: number;           // м³/ч — требуемый расход
  fireInitPressure: number;           // МПа — начальное давление (для резервуара)
  fireCapacity: number;               // м³ — ёмкость резервуара
  fireHydrantDiameter: number;        // мм — диаметр выходного отверстия крана
  fireResistanceMode: "project" | "manual"; // способ задания гидравлического сопротивления
  fireManualR: number;                // МН·с²/м⁸ — ручное сопротивление
  fireDescription: string;            // описание узла ППЗ
  // Вычисленные параметры ППЗ
  fireComputedStaticP: number;        // МПа — статическое давление
  fireComputedDynamicP: number;       // МПа — динамическое давление
  fireComputedFlow: number;           // м³/ч — расход
  fireComputedR: number;              // МН·с²/м⁸ — сопротивление
  fireComputedDrainTime: number;      // мин — время истечения (для резервуара)
}

export interface TopoBranch {
  id: string;
  fromId: string;
  toId: string;
  type: string;
  // ─── Геометрия выработки ─────────────────────────────
  shape: "round" | "rect" | "trap" | "arch" | "custom";
  diameter: number;         // м (для круглого)
  rectWidth: number;        // м (a — ширина прямоугольника / основание)
  rectHeight: number;       // м (b — высота прямой части)
  trapTopWidth: number;     // м (верхнее основание трапеции)
  archHeight: number;       // м (высота свода)
  area: number;             // м² — итог сечения
  perimeter: number;        // м — итог периметра
  dh: number;               // м — гидравлический диаметр (4S/P)
  length: number;           // м — рассчитывается из координат, но может задаваться
  angle: number;            // ° — угол наклона (-90..+90), авто из координат или вручную
  manualAngle: boolean;     // если true — угол задан вручную, не пересчитывается из координат
  manualLength: boolean;
  manualSection: boolean;   // S и P заданы вручную (mode=custom)
  // ─── Аэродинамика ────────────────────────────────────
  resistanceMode: "alpha" | "surface" | "roughness" | "manual" | "pipe";
  alphaCoef: number;        // ×10⁻⁴ Н·с²/м⁴ — коэффициент сопротивления крепи
  surfaceId: string;        // ID типа поверхности из справочника
  surface: string;          // подпись (для отображения)
  roughness: number;        // мм — эквивалентная шероховатость
  manualR: number;          // Н·с²/м⁸ — ручной ввод сопротивления
  pipeAlpha: number;        // α для трубопровода (round), ×10⁻⁴ Н·с²/м⁴ (формула 10.2)
  pipeDiameter: number;     // D — диаметр трубопровода, м (формула R = 6.48αL/D⁵)
  localXi: number;          // суммарный ξ местных сопротивлений
  vMax: number;             // м/с — макс. допустимая скорость
  // ─── Вентилятор (источник напора) ────────────────────
  hasFan: boolean;          // ветвь содержит вентилятор
  fanType: "ГВУ" | "ВВУ" | "ВМП"; // тип: главная/вспомогательная/местного проветривания
  fanMode: "constant" | "curve"; // постоянная депрессия или Q-H хар-ка
  fanPressure: number;      // Па — депрессия (для mode=constant), или фактическая (mode=curve)
  fanName: string;
  fanCurveId: string;       // ID из справочника FAN_CATALOG (mode=curve)
  fanRpm: number;           // обороты, об/мин
  fanBladeAngle: number;    // угол лопаток, °
  fanParallel: number;      // количество вентиляторов в параллель
  fanInstall: string;       // установка: "Внутри перемычки" / "Без перемычки"
  fanCrossingR: number;     // сопротивление перемычки, мюрг (только при установке "Внутри перемычки")
  fanWindowArea: number;    // ΔS — площадь поперечного сечения вентиляционного окна, м² (R = ρ/(2·ΔS²))
  fanEfficiency: number;    // расчётный КПД на рабочей точке
  fanShaftPower: number;    // расчётная мощность на валу, Вт
  fanReverse: boolean;      // реверс: вентилятор работает в обратном направлении
  fanStopped: boolean;      // вентилятор остановлен (H=0, Q=0 через него)
  // ─── Расчётные ───────────────────────────────────────
  resistance: number;       // итог R, Н·с²/м⁸
  rFriction: number;        // R от трения
  rLocal: number;           // R от местных
  lambda: number;           // коэф. Дарси (если режим roughness)
  flow: number;             // м³/с
  velocity: number;         // м/с
  dP: number;               // Па
  isDead: boolean;          // тупиковая ветвь (Q=0, проветривание диффузией)
  isLeakage: boolean;       // утечка: ветвь моделирует перетечку через перемычку/целик
  leakageCoeff: number;     // коэффициент утечки 0..1 (доля от Q вентилятора), 0 = не задан
  // ─── Перемычка ──────────────────────────────────────
  hasBulkhead: boolean;         // ветвь содержит перемычку
  bulkheadId: string;           // ID из справочника рудника (MineBulkheadExport.id)
  bulkheadName: string;         // название перемычки (для отображения)
  bulkheadR: number;            // сопротивление перемычки, Мюрг (добавляется к resistance ветви)
  bulkheadAirPerm: number;      // воздухопроницаемость, м²/(с·√Па)
  // Аэродинамическое сопротивление перемычки (отдельно от ветви)
  bulkheadResMode: "project" | "survey" | "manual"; // способ задания R перемычки
  bulkheadManualAirPerm: boolean;  // воздухопроницаемость задана вручную (режим project)
  bulkheadCustomAirPerm: number;   // вручную заданная воздухопроницаемость, м²/(с·√Па)
  bulkheadSurveyQ: number;         // расход (воздушная съемка), м³/с
  bulkheadSurveyDP: number;        // падение давления (воздушная съемка), Па
  bulkheadManualR: number;         // вручную заданное R, кМюрг
  bulkheadWindowArea: number;      // площадь окна/проёма, м² (для перемычек с окном/проёмом)
  bulkheadFailurePressure: number; // давление разрушения, МПа (из справочника)
  bulkheadDestroyedByExplosion: boolean; // перемычка разрушена взрывом (ΔP > failurePressure)
  power: number;                // Вт
  reynolds: number;         // Re
  // ─── Отображение ────────────────────────────────────
  lineWidth: number;        // px — толщина линии на схеме (по умолчанию 2)
  lineBorder: number;       // px — толщина обводки (по умолчанию 0.2)
  capital: boolean;         // Капитальная выработка
  designed: boolean;        // Проектируемая выработка
  labelOffsetX?: number;    // смещение блока индикаторов от середины ветви, px по X
  labelOffsetY?: number;    // смещение блока индикаторов от середины ветви, px по Y
  labelAngle?: number;      // поворот блока индикаторов, градусы (0 = горизонтально)
  labelSize?: number;       // множитель размера текста индикаторов (1.0 = по умолчанию)
  // ─── Общие ───────────────────────────────────────────
  layer: string;
  horizonId: string;        // ID горизонта (см. Horizon[]), пустая строка = без привязки
  comment: string;          // Примечание (произвольный текст)
  // ─── Индивидуальные индикаторы на схеме ──────────────
  // Если задано — переопределяет глобальный infoConfig только для этой ветви.
  // Ключи соответствуют InfoDisplayConfig (только branch-поля). undefined = не задан (берётся глобал).
  indicators?: Record<string, boolean>;
  // ─── Водопровод (ППЗ) ────────────────────────────────
  hasWaterPipe: boolean;           // ветвь содержит трубопровод ППЗ
  wpDiameter: number;              // мм — внутренний диаметр трубы
  wpMaterial: string;              // материал трубы
  wpLengthManual: boolean;         // длина задана вручную
  wpLength: number;                // м — длина трубопровода
  wpRoughnessMode: "smooth" | "rough" | "manual"; // способ задания шероховатости
  wpRoughness: number;             // мм — абсолютная шероховатость
  wpManualR: number;               // МН·с²/м⁸ — ручное сопротивление
  wpLocalXi: number;               // сумма ξ местных сопротивлений
  // Вычисленные параметры водопровода
  wpComputedR: number;             // МН·с²/м⁸
  wpComputedFlow: number;          // м³/ч
  wpComputedVelocity: number;      // м/с
  wpComputedDeltaP: number;        // МПа — потери давления
  // ─── Редукционный клапан ─────────────────────────────────
  wpHasReducer: boolean;           // установлен редукционный клапан
  wpReducerModel: string;          // ID модели из справочника pressureReducingValves
  wpReducerOutPressure: number;    // МПа — настроенное выходное давление
  wpReducerMaxFlow: number;        // м³/ч — макс. расход (для ручного режима)

  // ─── Воздухопровод (сжатый воздух) ───────────────────────
  hasAirPipe?: boolean;            // ветвь содержит воздухопровод (сжатый воздух)
  apDiameter?: number;             // мм — внутренний диаметр трубы
  apMaterial?: string;             // материал трубы
  apLengthManual?: boolean;        // длина задана вручную
  apLength?: number;               // м — длина воздухопровода
  apPressure?: number;             // атм — рабочее давление сжатого воздуха

  // ─── Пожар (вентиляционный расчёт аварийного режима) ────────────────
  hasFire: boolean;                // в ветви установлен очаг пожара
  fireT: number;                   // позиция очага вдоль ветви 0..1 (0=fromId, 1=toId)
  fireHeatRelease: number;         // МВт — тепловыделение (мощность пожара Q)
  fireMode: "heat" | "temp";       // задаётся: мощностью или температурой
  fireTemperature: number;         // °C — если задаётся температурой напрямую
  fireCombustible: string;         // вид горючего (уголь, масло, дерево, кабель, vehicle=техника)
  fireStartTime: number;           // мин — время начала от старта расчёта
  // Параметры для горючего материала «Техника» (3 составляющих)
  fireVehicleName: string;         // название/марка техники
  fireVehicleMassRubber: number;   // кг — масса резины
  fireVehicleMassDiesel: number;   // кг — масса дизельного топлива
  fireVehicleMassOil: number;      // кг — масса масла
  // Параметры для горючего материала «Конвейерная лента»
  fireBeltName: string;            // пользовательское название
  fireBeltBurnRate: string;        // ψ, кг/(м²·с)
  fireBeltDensity: string;         // ρ, кг/м³
  fireBeltWidth: string;           // ширина ленты, м
  fireBeltLength: string;          // длина конвейера, м
  fireBeltThickness: string;       // толщина ленты, м
  fireBeltFlameSpeed: string;      // скорость пламени, м/с
  // Параметры для горючего материала «Электрокабель»
  fireCableName: string;           // пользовательское название
  fireCableHeatValue: string;      // Q_н, МДж/кг
  fireCableBurnRate: string;       // ψ, кг/(м²·с)
  fireCableDensity: string;        // ρ, кг/м³
  fireCableLength: string;         // длина, м
  fireCableWidth: string;          // диаметр/ширина, м
  fireCableThick: string;          // толщина, м
  // Параметры для горючего материала «Деревянная крепь»
  fireWoodName: string;            // пользовательское название
  fireWoodHeatValue: string;       // Q_н, МДж/кг
  fireWoodBurnRate: string;        // ψ, кг/(м²·с)
  fireWoodDensity: string;         // ρ, кг/м³
  fireWoodLength: string;          // длина, м
  fireWoodWidth: string;           // периметр сечения выработки, м
  fireWoodThick: string;           // толщина доски крепи, м
  fireWoodFlameSpeed: string;      // v_пл, м/с — скорость продвижения пламени
  fireWoodCalcTime: string;        // t, мин — время расчёта (нарастающий пожар)
  // Вычисленные результаты расчёта пожара
  fireComputedTemp: number;        // °C — вычисленная температура продуктов горения
  fireComputedNatDep: number;      // Па — тепловая депрессия пожара
  fireComputedSmokeDens: number;   // м⁻¹ — оптическая плотность дыма на выходе
  fireComputedCO: number;          // % — концентрация CO на выходе ветви
  fireComputedCO2: number;         // % — концентрация CO₂ на выходе ветви
  // Рабочие поля итеративного расчёта (не сохраняются в файл)
  fireThermalDepression?: number;  // Па — тепловая депрессия пожара (передаётся в solver)
  originalFlow?: number;           // м³/с — расход до итераций (для обнаружения опрокидывания)

  // ─── Пожарная нагрузка ────────────────────────────────────────────────
  fireLoadTech: boolean;           // Техника (самоходная, ДВС)
  fireLoadConveyor: boolean;       // Конвейерная лента
  fireLoadCable: boolean;          // Кабель (электро/связи)
  fireLoadWoodSupport: boolean;    // Деревянная крепь

  // ─── Вентиляционный трубопровод (ВМП / тупиковые забои) ─────────────
  hasVentPipe: boolean;            // ветвь содержит вентрубопровод
  vpDiameter: number;              // мм — внутренний диаметр трубы
  vpMaterial: string;              // материал: Пластик / Металл / Гибкий рукав
  vpLengthManual: boolean;         // длина задана вручную
  vpLength: number;                // м — длина вентрубопровода
  vpLeakageCoeff: number;          // % утечки на 100 м (0 = без утечек)
  vpJointCount: number;            // кол-во стыков на маршруте
  vpLocalXi: number;               // сумма ξ местных сопротивлений (повороты, фасонины)
  vpManualR: number;               // Н·с²/м⁸ — ручное сопротивление (если задан вручную)
  vpRoughnessMode: "auto" | "manual"; // авто = по материалу, ручной = vpRoughness
  vpRoughness: number;             // мм — шероховатость (при ручном режиме)
  // Вычисленные параметры вентрубопровода
  vpComputedR: number;             // Н·с²/м⁸ — аэродинамическое сопротивление трубы
  vpComputedFlow: number;          // м³/с — расход в трубе
  vpComputedVelocity: number;      // м/с — скорость воздуха
  vpComputedDeltaP: number;        // Па — потери давления
  vpComputedLeakage: number;       // м³/с — суммарные утечки

  // ─── Взрыв (расчёт параметров воздушных ударных волн) ───────────────
  hasExplosion: boolean;                   // в ветви установлен источник взрыва
  explosionT: number;                      // позиция источника вдоль ветви 0..1
  explosionMethod: "gas_dynamics" | "fnip_494"; // методика расчёта
  explosionSourceType: "gas" | "mass";     // способ задания: по газу или по массе ВВ
  // По газу
  explosionGasId: string;                  // ID газа из GAS_TYPES
  explosionGasVolume: number;              // м³ — объём взрывоопасной смеси
  explosionGasConcentration: number;       // % — концентрация газа
  // По массе ВВ
  explosionExplosiveId: string;            // ID ВВ из EXPLOSIVE_TYPES
  explosionExplosiveMass: number;          // кг — масса ВВ
  // Настройки
  explosionConsiderWalls: boolean;         // учитывать отражение от стенок
  // Вычисленные результаты
  explosionComputedQtnt: number;           // кг ТНТ — тротиловый эквивалент
  explosionComputedMaxP: number;           // кПа — давление в эпицентре
  explosionComputedWaveSpeed: number;      // м/с — скорость фронта
  explosionComputedR_lethal: number;       // м — радиус летальной зоны
  explosionComputedR_heavy: number;        // м — радиус тяжёлых поражений
  explosionComputedR_medium: number;       // м — радиус средних поражений
  explosionComputedR_light: number;        // м — радиус лёгких поражений
  explosionComputedDeltaP: number;         // кПа — давление в данной ветви (от расстояния)

  // ─── Качество воздуха ───────────────────────────────────────────────────
  pollutesAir: boolean;  // ветвь является источником загрязнения воздуха;
                          // стрелки потока ниже по направлению движения воздуха
                          // окрашиваются в синий цвет (исходящий загрязнённый поток)
}

// ─── Горизонты (как в ПО Аэросеть): группировка ветвей по высотным отметкам ───
// Каждый горизонт — это «слой» сети с уникальным цветом и высотной отметкой.
// Можно скрывать/показывать целиком, перекрашивать ветви, переключать активный.
// Опционально к горизонту прикрепляется подложка-картинка плана (PNG/JPG).
export interface HorizonImage {
  /** PNG/JPG, закодированный в data:URL (хранится локально в браузере). */
  dataUrl: string;
  /** Углы прямоугольника подложки в мировых координатах (метры). */
  bounds: { x1: number; y1: number; x2: number; y2: number };
  /** Прозрачность 0..1 (по умолчанию 0.6). */
  opacity: number;
  /** Видимость подложки (отдельно от видимости ветвей горизонта). */
  visible: boolean;
}

/** Форматы бумаги для слоя печати */
export type PaperFormat = "A4" | "A3" | "A2" | "A1" | "A0";

/** Соотношения сторон форматов (ширина/высота в мм) */
export const PAPER_SIZES_MM: Record<PaperFormat, { w: number; h: number }> = {
  A4: { w: 297, h: 210 },
  A3: { w: 420, h: 297 },
  A2: { w: 594, h: 420 },
  A1: { w: 841, h: 594 },
  A0: { w: 1189, h: 841 },
};

/** Конфигурация слоя печати горизонта (УО + штамп + оглавление) */
export interface HorizonPrintLayer {
  /** Слой видим в предпросмотре/при печати */
  visible: boolean;
  /** Заголовок чертежа (напр. "Вентиляционный план горизонта 290м.") */
  title: string;
  /** Масштаб (напр. "1:2000") */
  scale: string;
  /** Название организации для штампа */
  orgName: string;
  /** Должность утверждающего */
  approverTitle: string;
  /** ФИО утверждающего */
  approverName: string;
  /** День (число месяца) */
  day?: string;
  /** Месяц (название) */
  month?: string;
  /** Год */
  year: string;
  /** Период действия (напр. "II-е полугодие 2025 года") */
  period: string;
  /** Разработал */
  developer: string;
  /** Проверил */
  checker: string;
  /** Номер листа */
  sheetNum: string;
  /** Всего листов */
  sheetTotal: string;
  /** Показывать условные обозначения */
  showLegend: boolean;
  /** Показывать штамп */
  showStamp: boolean;
  /** Показывать блок «УТВЕРЖДАЮ» в правом верхнем углу */
  showApprover?: boolean;
  /** Формат бумаги */
  paperFormat: PaperFormat;
  /** Ориентация: landscape = альбом, portrait = книжная */
  orientation: "landscape" | "portrait";
  /** Положение и размер подложки в мировых координатах (м). null = автовычисление из bbox горизонта */
  bounds?: { x1: number; y1: number; x2: number; y2: number };
  /** Смещение заголовка относительно центра рамки в пикселях (экранные) */
  titleOffsetX?: number;
  titleOffsetY?: number;
  /** Смещение блока УО от нижнего-левого угла рамки (экранные px) */
  legendOffsetX?: number;
  legendOffsetY?: number;
  /** Смещение штампа от нижнего-правого угла рамки (экранные px) */
  stampOffsetX?: number;
  stampOffsetY?: number;
  /** Дополнительные поля штампа */
  projectName?: string;
  modeName?: string;
  /** ── Поля стандартного штампа ГОСТ (основная надпись) ── */
  /** Обозначение документа (шифр) — верхняя правая графа */
  docCode?: string;
  /** Стадия проектирования (напр. "Р", "П") */
  stage?: string;
  /** Роли в левом столбце: ФИО */
  designerName?: string;   // Разраб.
  checkerName?: string;    // Пров.
  normContrName?: string;  // Н.контр.
  approverName2?: string;  // Утв.
  /** Роли: подписи (обычно пусто, но редактируемы) */
  designerSign?: string;
  checkerSign?: string;
  normContrSign?: string;
  approverSign?: string;
  /** Роли: даты */
  designerDate?: string;
  checkerDate?: string;
  normContrDate?: string;
  approverDate?: string;
}

export interface Horizon {
  id: string;
  name: string;
  z: number;        // высотная отметка, м
  color: string;    // HEX цвет (#RRGGBB)
  visible: boolean; // отображать ли ветви этого горизонта на схеме
  image?: HorizonImage; // подложка-картинка (опционально)
  printLayer?: HorizonPrintLayer; // слой печати (опционально)
}

export function makeHorizon(id: string, partial?: Partial<Horizon>): Horizon {
  return {
    id,
    name: id,
    z: 0,
    color: "#3b82f6",
    visible: true,
    ...partial,
  };
}

// Дефолтный набор горизонтов — пустой, пользователь добавляет сам
export const DEFAULT_HORIZONS: Horizon[] = [];

/** ID специального горизонта "Общий вид" — bounds авто-подстраиваются под всю схему */
export const OVERVIEW_HORIZON_ID = "H_OVERVIEW";

export function makeNode(id: string, partial?: Partial<TopoNode>): TopoNode {
  return {
    id,
    name: "",
    number: "",
    visible: true,
    x: 0,
    y: 0,
    z: 0,
    airTemp: 20,
    atmosphereLink: false,
    wallTemp: 20,
    reducedPressure: 0,
    computedGasConc: 0,
    computedAirTemp: 20,
    computedWallTemp: 0,
    computedPressure: 910,
    computedExplosivePressure: 0,
    fireNodeType: "none",
    fireConsumerType: "fire_hydrant",
    fireHydrantOpen: false,
    fireRequiredFlow: 0,
    fireInitPressure: 0,
    fireCapacity: 0,
    fireHydrantDiameter: 0,
    fireResistanceMode: "project",
    fireManualR: 0,
    fireDescription: "",
    fireComputedStaticP: 0,
    fireComputedDynamicP: 0,
    fireComputedFlow: 0,
    fireComputedR: 0,
    fireComputedDrainTime: 0,
    ...partial,
  };
}

export function makeBranch(id: string, fromId: string, toId: string, partial?: Partial<TopoBranch>): TopoBranch {
  return {
    id,
    fromId,
    toId,
    type: "Ствол ЮВС",
    // Геометрия — по умолчанию прямоугольник 7×5.5 м (≈ 38.5 м²)
    shape: "rect",
    diameter: 7,
    rectWidth: 7,
    rectHeight: 5.5,
    trapTopWidth: 5,
    archHeight: 3.5,   // a/2 = 7/2 — полукруг по умолчанию
    area: 38.5,
    perimeter: 25,
    dh: (4 * 38.5) / 25,
    length: 0,
    angle: 0,
    manualAngle: false,
    manualLength: false,
    manualSection: false,
    // Аэродинамика
    resistanceMode: "surface",
    alphaCoef: 9,                               // ×10⁻⁴ Н·с²/м⁴
    surfaceId: "smooth",
    surface: "Воздухоподающая выработка, без неровностей",
    roughness: 1,                               // мм
    manualR: 0,
    pipeAlpha: 9,                               // ×10⁻⁴ Н·с²/м⁴ (гладкий металл)
    pipeDiameter: 0.5,                          // м — диаметр трубопровода
    localXi: 0,
    vMax: 15,
    hasFan: false,
    fanType: "ГВУ",
    fanMode: "constant",
    fanPressure: 0,
    fanName: "",
    fanCurveId: "",
    fanRpm: 0,
    fanBladeAngle: 45,
    fanParallel: 1,
    fanInstall: "Внутри перемычки",
    fanCrossingR: 0,
    fanWindowArea: 0,
    fanEfficiency: 0,
    fanShaftPower: 0,
    fanReverse: false,
    fanStopped: false,
    // Расчётные
    resistance: 0,
    rFriction: 0,
    rLocal: 0,
    lambda: 0,
    flow: 0,
    velocity: 0,
    dP: 0,
    power: 0,
    reynolds: 0,
    isDead: false,
    isLeakage: false,
    leakageCoeff: 0,
    hasBulkhead: false,
    bulkheadId: "",
    bulkheadName: "",
    bulkheadR: 0,
    bulkheadAirPerm: 0,
    bulkheadResMode: "project",
    bulkheadManualAirPerm: false,
    bulkheadCustomAirPerm: 0,
    bulkheadSurveyQ: 0,
    bulkheadSurveyDP: 0,
    bulkheadManualR: 0,
    bulkheadWindowArea: 0,
    bulkheadFailurePressure: 0,
    bulkheadDestroyedByExplosion: false,
    lineWidth: 7,
    lineBorder: 0.6,
    capital: false,
    designed: false,
    layer: "Стволы",
    horizonId: "",
    comment: "",
    hasWaterPipe: false,
    wpDiameter: 100,
    wpMaterial: "Сталь",
    wpLengthManual: false,
    wpLength: 0,
    wpRoughnessMode: "rough",
    wpRoughness: 0.5,
    wpManualR: 0,
    wpLocalXi: 0,
    wpComputedR: 0,
    wpComputedFlow: 0,
    wpComputedVelocity: 0,
    wpComputedDeltaP: 0,
    wpHasReducer: false,
    wpReducerModel: "kppr_50",
    wpReducerOutPressure: 0.5,
    wpReducerMaxFlow: 25,
    // Вентрубопровод
    hasVentPipe: false,
    vpDiameter: 500,
    vpMaterial: "Пластик",
    vpLengthManual: false,
    vpLength: 0,
    vpLeakageCoeff: 0.5,
    vpJointCount: 0,
    vpLocalXi: 0,
    vpManualR: 0,
    vpRoughnessMode: "auto",
    vpRoughness: 0.2,
    vpComputedR: 0,
    vpComputedFlow: 0,
    vpComputedVelocity: 0,
    vpComputedDeltaP: 0,
    vpComputedLeakage: 0,
    // Пожар
    hasFire: false,
    fireT: 0.5,              // позиция очага вдоль ветви 0..1 (0=fromId, 1=toId)
    fireHeatRelease: 5,
    fireMode: "heat",
    fireTemperature: 300,
    fireCombustible: "vehicle",
    fireStartTime: 0,
    fireVehicleName: "",
    fireVehicleMassRubber: 1200,
    fireVehicleMassDiesel: 400,
    fireVehicleMassOil: 200,
    fireBeltName: "Конвейерная лента",
    fireBeltBurnRate: "0.013",
    fireBeltDensity: "1200",
    fireBeltWidth: "1.2",
    fireBeltLength: "100",
    fireBeltThickness: "0.016",
    fireBeltFlameSpeed: "0.013",
    fireCableName: "Электрокабель",
    fireCableHeatValue: "25",
    fireCableBurnRate: "0.007",
    fireCableDensity: "900",
    fireCableLength: "100",
    fireCableWidth: "0.05",
    fireCableThick: "0.05",
    fireWoodName: "Деревянная крепь",
    fireWoodHeatValue: "18.5",
    fireWoodBurnRate: "0.027",
    fireWoodDensity: "500",
    fireWoodLength: "50",
    fireWoodWidth: "0.15",
    fireWoodThick: "0.15",
    fireComputedTemp: 0,
    fireComputedNatDep: 0,
    fireComputedSmokeDens: 0,
    fireComputedCO: 0,
    fireComputedCO2: 0,
    // Пожарная нагрузка
    fireLoadTech: false,
    fireLoadConveyor: false,
    fireLoadCable: false,
    fireLoadWoodSupport: false,
    // Взрыв
    hasExplosion: false,
    explosionT: 0.5,
    explosionMethod: "fnip_494",
    explosionSourceType: "mass",
    explosionGasId: "methane",
    explosionGasVolume: 100,
    explosionGasConcentration: 9.5,
    explosionExplosiveId: "ammonit",
    explosionExplosiveMass: 100,
    explosionConsiderWalls: true,
    explosionComputedQtnt: 0,
    explosionComputedMaxP: 0,
    explosionComputedWaveSpeed: 0,
    explosionComputedR_lethal: 0,
    explosionComputedR_heavy: 0,
    explosionComputedR_medium: 0,
    explosionComputedR_light: 0,
    explosionComputedDeltaP: 0,
    // Качество воздуха
    pollutesAir: false,
    ...partial,
  };
}

// Угол наклона ветви в градусах (-90..+90) из координат узлов
// +90 — вертикально вверх (to выше from), -90 — вертикально вниз (to ниже from), 0 — горизонтально
// Знак критичен для расчёта тепловой депрессии пожара: нисходящая = отрицательный угол
export function calcBranchAngle(from: TopoNode, to: TopoNode): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const horizLen = Math.sqrt(dx * dx + dy * dy);
  const len3d = Math.sqrt(horizLen * horizLen + dz * dz);
  if (len3d < 0.001) return 0;
  // Знак угла = знак dz: to выше from → +, to ниже from → −
  return Math.round(Math.asin(dz / len3d) * (180 / Math.PI) * 10) / 10;
}

// Длина ветви в 3D пространстве по координатам узлов
export function calcBranchLength(from: TopoNode, to: TopoNode): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// Барометрическое давление от высотной отметки (упрощённая формула)
// P(z) = P0 * (1 - 0.0065·z/288)^5.25
export function pressureAtZ(z: number, p0: number = 101325): number {
  const ratio = 1 - (0.0065 * z) / 288.15;
  if (ratio <= 0) return 0;
  return p0 * Math.pow(ratio, 5.25588);
}

// ─────────────────────────────────────────────────────────────────────────────
// Камера / проекция X/Y/Z → 2D screen
//
// azimuth (φ): поворот вокруг оси Z (мира), 0° — взгляд вдоль -Y
// elevation (θ): угол подъёма камеры над горизонтом, 0° — фронт, 90° — план сверху
//
// Преобразование:
//   1) поворот вокруг Z на -azimuth: x' = cos·x + sin·y; y' = -sin·x + cos·y
//   2) наклон вокруг X' на elevation: y'' = sin(θ)·y' - cos(θ)·z; depth = cos(θ)·y' + sin(θ)·z
//   3) на экран: sx = offsetX + x'·scale; sy = offsetY - y''·scale
// ─────────────────────────────────────────────────────────────────────────────
export interface ProjOptions {
  scale: number;       // м → px
  offsetX: number;
  offsetY: number;
  azimuth?: number;    // ° — поворот вокруг Z
  elevation?: number;  // ° — наклон камеры (90 = план, 0 = фронт)
  // Совместимость со старым API (план):
  isoAngle?: number;   // не используется в 3D, оставлено для backward compat
  zScale?: number;     // ignore in 3D
}

export interface Projected { sx: number; sy: number; depth: number; }

export function project3D(p: { x: number; y: number; z: number }, opts: ProjOptions): Projected {
  const az = ((opts.azimuth ?? 0) * Math.PI) / 180;
  const el = ((opts.elevation ?? 90) * Math.PI) / 180;   // 90° по умолчанию = план

  // 1) Поворот вокруг Z (мира) на -azimuth
  const cosA = Math.cos(az);
  const sinA = Math.sin(az);
  const x1 =  cosA * p.x + sinA * p.y;
  const y1 = -sinA * p.x + cosA * p.y;

  // 2) Наклон: при elevation=90° (план) экран Y совпадает с миром Y; Z = глубина.
  //    Принято в горном деле: z=0 — поверхность, z<0 — глубина (стволы, лавы).
  //    Поэтому положительный z должен идти ВВЕРХ на экране (sy меньше),
  //    а отрицательный — ВНИЗ. Знак при cosE·z подобран соответствующе.
  const cosE = Math.cos(el);
  const sinE = Math.sin(el);
  const y2 = sinE * y1 + cosE * p.z;
  const depth = cosE * y1 - sinE * p.z;  // дальность до камеры (для z-sort)

  return {
    sx: opts.offsetX + x1 * opts.scale,
    sy: opts.offsetY - y2 * opts.scale,
    depth,
  };
}

// ─── Стандартные ракурсы ────────────────────────────────────────────────────
export const VIEW_PRESETS = {
  plan:    { azimuth: 0,    elevation: 90 },   // сверху (XY)
  front:   { azimuth: 0,    elevation: 0 },    // спереди (XZ), смотрим вдоль -Y
  back:    { azimuth: 180,  elevation: 0 },    // сзади
  left:    { azimuth: -90,  elevation: 0 },    // слева (YZ)
  right:   { azimuth: 90,   elevation: 0 },    // справа
  isoSW:   { azimuth: -45,  elevation: 30 },   // изометрия Юго-Запад
  isoSE:   { azimuth: 45,   elevation: 30 },   // изометрия Юго-Восток
  isoNW:   { azimuth: -135, elevation: 30 },
  isoNE:   { azimuth: 135,  elevation: 30 },
} as const;

export type ViewPreset = keyof typeof VIEW_PRESETS;

// Обратная проекция: screen → world (только для плана, elevation=90°, az=0°)
// Для 3D создание узлов осуществляется на плоскости z=zLevel.
export function unproject2D(sx: number, sy: number, opts: ProjOptions, zLevel: number = 0): { x: number; y: number; z: number } {
  return {
    x: (sx - opts.offsetX) / opts.scale,
    y: -(sy - opts.offsetY) / opts.scale,
    z: zLevel,
  };
}

// ─── Универсальная обратная проекция: screen + рабочая плоскость → world ───
// Принцип: курсор задаёт ЛУЧ в 3D, а рабочая плоскость (x=const, y=const или z=const)
// — вторую сущность для пересечения. Возвращаем точку пересечения луча с плоскостью.
//
// При вырождении (плоскость параллельна лучу взгляда) возвращаем null —
// в таком случае пользователь должен сменить рабочую плоскость.
//
// Прямые формулы (см. project3D):
//   x1 =  cosA·x + sinA·y                (поворот вокруг Z)
//   y1 = -sinA·x + cosA·y
//   y2 = sinE·y1 + cosE·z                (наклон вокруг X', +z идёт ВВЕРХ)
//   sx = ox + x1·s   →   u = (sx-ox)/s = x1
//   sy = oy - y2·s   →   v = -(sy-oy)/s = y2
// ──────────────────────────────────────────────────────────────────────────
export type WorkPlane =
  | { axis: "z"; value: number }   // фикс по Z (горизонтальная плоскость) — для плана/изо
  | { axis: "y"; value: number }   // фикс по Y (вертикальная) — для фронт/тыл
  | { axis: "x"; value: number };  // фикс по X (вертикальная) — для лев/прав

const EPS = 1e-6;

export function unprojectToPlane(
  sx: number, sy: number, opts: ProjOptions, plane: WorkPlane
): { x: number; y: number; z: number } | null {
  const az = ((opts.azimuth ?? 0) * Math.PI) / 180;
  const el = ((opts.elevation ?? 90) * Math.PI) / 180;
  const cosA = Math.cos(az), sinA = Math.sin(az);
  const cosE = Math.cos(el), sinE = Math.sin(el);

  const u = (sx - opts.offsetX) / opts.scale;   // = x1
  const v = -(sy - opts.offsetY) / opts.scale;  // = y2

  // Извлекаем (x, y, z) при заданной фиксированной координате.
  if (plane.axis === "z") {
    const z0 = plane.value;
    if (Math.abs(sinE) < EPS) return null;     // вид «в горизонт» — Z-плоскость параллельна лучу
    // y2 = sinE·y1 + cosE·z0  →  y1 = (v − cosE·z0)/sinE
    const y1 = (v - cosE * z0) / sinE;
    // x1 = u; решаем поворот вокруг Z обратно
    const x1 = u;
    const x =  cosA * x1 - sinA * y1;
    const y =  sinA * x1 + cosA * y1;
    return { x, y, z: z0 };
  }

  if (plane.axis === "y") {
    const y0 = plane.value;
    // x1 = cosA·x + sinA·y0  →  x = (u - sinA·y0)/cosA
    if (Math.abs(cosA) < EPS) return null;
    const x = (u - sinA * y0) / cosA;
    const y1 = -sinA * x + cosA * y0;
    // y2 = sinE·y1 + cosE·z  →  z = (v − sinE·y1)/cosE
    if (Math.abs(cosE) < EPS) return null;     // план — Y-плоскость параллельна лучу (взгляд сверху)
    const z = (v - sinE * y1) / cosE;
    return { x, y: y0, z };
  }

  // axis === "x"
  const x0 = plane.value;
  // x1 = cosA·x0 + sinA·y  →  y = (u - cosA·x0)/sinA
  if (Math.abs(sinA) < EPS) return null;
  const y = (u - cosA * x0) / sinA;
  const y1 = -sinA * x0 + cosA * y;
  if (Math.abs(cosE) < EPS) return null;
  const z = (v - sinE * y1) / cosE;
  return { x: x0, y, z };
}

// Подобрать «логичную» рабочую плоскость по текущему ракурсу
// (для авто-режима в UI). Возвращает плоскость + признак пригодности.
export function autoWorkPlane(
  azimuth: number, elevation: number,
  defaults: { z: number; y: number; x: number }
): WorkPlane {
  const el = elevation;
  const az = ((azimuth % 360) + 360) % 360;
  // План / почти-план / изометрия — XY-плоскость (фикс Z)
  if (el >= 25) return { axis: "z", value: defaults.z };
  // Низкий горизонт: выбираем XZ или YZ по ближайшей оси взгляда
  // az≈0 или 180 → смотрим вдоль ±Y → рабочая XZ (фикс Y)
  // az≈90 или 270 → смотрим вдоль ±X → рабочая YZ (фикс X)
  const distY = Math.min(Math.abs(az - 0), Math.abs(az - 180), Math.abs(az - 360));
  const distX = Math.min(Math.abs(az - 90), Math.abs(az - 270));
  return distY <= distX
    ? { axis: "y", value: defaults.y }
    : { axis: "x", value: defaults.x };
}

// ─── Демо-сеть: два вертикальных ствола + горизонт + вент. канал с ВО-18 ────
//
// Схема (вид спереди/фронт):
//
//  [Атм]   [Вент.канал]
//   N1          N6
//   |    \     /
//   N2 (надшахтное здание ЮВС, z=0)
//   |
//   N3 (сопряжение ЮВС дно, z=-20) ─── [горизонт] ─── N4 (сопряжение СВС дно, z=-20)
//                                                       |
//                                                       N5 (устье СВС, z=100, атм.)
//
// Стволы: круглое сечение S=38 м² → d ≈ 6.96 м
// Горизонт: арочное сечение S=21 м²
// Вент.канал: круглое S=10 м², вентилятор ВО-18

export const DEMO_NODES: TopoNode[] = [
  makeNode("1", { name: "Устье ЮВС (атмосфера)",        number: "1", x:   0, y: 0, z: 100, atmosphereLink: true }),
  makeNode("2", { name: "Сопряжение ЮВС гор. −100 м",   number: "2", x:   0, y: 0, z: -100 }),
  makeNode("3", { name: "Сопряжение СВС гор. −100 м",   number: "3", x: 500, y: 0, z: -100 }),
  makeNode("4", { name: "Надшахтное здание СВС",         number: "4", x: 500, y: 0, z:  60 }),
  makeNode("5", { name: "Устье СВС (атмосфера)",         number: "5", x: 500, y: 0, z: 100, atmosphereLink: true }),
];

// S=38 м² → круг → d=6.96 м; P=21.86 м
// S=21 м² → арка 5×2 + свод 1.2 м → P=14.77 м

export const DEMO_BRANCHES: TopoBranch[] = [
  // Ствол ЮВС: поверхность → горизонт −100 м (подающий), L=200 м
  makeBranch("1", "1", "2", {
    type: "Ствол ЮВС", layer: "Стволы",
    shape: "round", diameter: 6.96, area: 38, perimeter: 21.86, dh: 6.96, manualSection: true,
    surfaceId: "shaft_smooth", surface: "Ствол с тюбинговой крепью",
    alphaCoef: 15, roughness: 5,
    flow: 0, vMax: 15,
  }),
  // Горизонт −100 м (квершлаг): ЮВС → СВС, L=500 м
  makeBranch("2", "2", "3", {
    type: "Квершлаг", layer: "Квершлаги",
    shape: "arch", rectWidth: 5, rectHeight: 2, archHeight: 1.2,
    area: 21, perimeter: 14.77, dh: 5.69, manualSection: true,
    surfaceId: "concrete", surface: "Бетонная крепь гладкая",
    alphaCoef: 12, roughness: 3,
    flow: 0, vMax: 8,
  }),
  // Ствол СВС нижний: горизонт → надшахтное здание СВС (выдающий), L=160 м
  makeBranch("3", "3", "4", {
    type: "Ствол СВС", layer: "Стволы",
    shape: "round", diameter: 6.96, area: 38, perimeter: 21.86, dh: 6.96, manualSection: true,
    surfaceId: "shaft_smooth", surface: "Ствол с тюбинговой крепью",
    alphaCoef: 15, roughness: 5,
    flow: 0, vMax: 15,
  }),
  // Вентилятор ВГП в надшахтном здании СВС: надшахтное → устье (поверхность), L=40 м
  makeBranch("4", "4", "5", {
    type: "Ствол СВС", layer: "Стволы",
    shape: "round", diameter: 6.96, area: 38, perimeter: 21.86, dh: 6.96, manualSection: true,
    surfaceId: "shaft_smooth", surface: "Ствол с тюбинговой крепью",
    alphaCoef: 15, roughness: 5,
    flow: 0, vMax: 15,
    hasFan: true, fanMode: "curve", fanCurveId: "VOD-18",
    fanPressure: 1900, fanName: "ВО-18/12АВР (главный)",
  }),
];

// Авто-расчёт длин и угла наклона на основе координат узлов
export function recalcLengths(nodes: TopoNode[], branches: TopoBranch[]): TopoBranch[] {
  return branches.map((b) => {
    const from = nodes.find((n) => n.id === b.fromId);
    const to = nodes.find((n) => n.id === b.toId);
    if (!from || !to) return b;
    const len = Math.round(calcBranchLength(from, to));
    const ang = calcBranchAngle(from, to);
    return {
      ...b,
      length: b.manualLength ? b.length : len,
      angle: b.manualAngle ? b.angle : ang,
    };
  });
}

// ─── Полный пересчёт аэродинамики ветви ─────────────────────────────────────
// Пересчитывает: геометрию сечения (S, P, Dh), сопротивление R,
// скорость, депрессию, мощность, Re — на основании заданных входов.
import { calcSection, calcResistance, velocity as calcVel, depression, airPower, reynolds } from "./aerodynamics";

export function recalcBranchAero(b: TopoBranch, rho = 1.2): TopoBranch {
  // 1) Геометрия сечения (если не задана вручную)
  let area = b.area;
  let perimeter = b.perimeter;
  let dh = b.dh;
  if (!b.manualSection) {
    const s = calcSection({
      shape: b.shape,
      diameter: b.diameter,
      width: b.rectWidth,
      height: b.rectHeight,
      topWidth: b.trapTopWidth,
      archHeight: b.archHeight,
    });
    area = s.area;
    perimeter = s.perimeter;
    dh = s.dh;
  } else {
    dh = perimeter > 0 ? Math.round((4 * area) / perimeter * 1000) / 1000 : 0;
  }

  // 2) Сопротивление с учётом плотности воздуха
  // manualR хранится в кМюрг (ввод пользователя). 1 кМюрг = 1 Н·с²/м⁸ в системе расчёта.
  const r = calcResistance({
    mode: b.resistanceMode,
    alpha: b.alphaCoef,
    roughness: b.roughness,
    manualR: b.manualR,
    localXi: b.localXi,
    S: area,
    P: perimeter,
    L: b.length,
    Q: b.flow,
    rho,
    pipeAlpha: b.pipeAlpha,
    pipeDiameter: b.pipeDiameter,
  });


  // Примечание: сопротивление перемычек считается отдельно в Cad.tsx
  // (параметры хранятся в SchemaSymbol.bk* для каждого символа независимо)
  const totalR = r.R;


  // 3) Поток
  const V = calcVel(b.flow, area);
  const dP = depression(totalR, b.flow);
  const N = airPower(dP, b.flow);
  const Re = area > 0 && dh > 0 ? reynolds(V, dh) : 0;

  return {
    ...b,
    area,
    perimeter,
    dh,
    resistance: totalR,
    rFriction: r.Rfriction,
    rLocal: r.Rlocal,
    lambda: r.lambda ?? 0,
    velocity: Math.round(V * 100) / 100,
    dP: Math.round(dP * 10) / 10,
    power: Math.round(N),
    reynolds: Math.round(Re),
  };
}

// Пересчёт всех ветвей: длины + аэродинамика
export function recalcAll(nodes: TopoNode[], branches: TopoBranch[]): TopoBranch[] {
  return recalcLengths(nodes, branches).map(b => recalcBranchAero(b));
}