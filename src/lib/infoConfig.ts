// Конфигурация панели информации — какие параметры отображать на схеме
export interface InfoDisplayConfig {
  // ─── Параметры узлов ────────────────────────────────────────────
  nodeNumber: boolean;
  nodeX: boolean;
  nodeY: boolean;
  nodeZ: boolean;
  nodePressure: boolean;
  nodeTemp: boolean;
  nodeMethane: boolean;
  nodeHumidity: boolean;
  nodeCO: boolean;
  // ─── Параметры ветвей ───────────────────────────────────────────
  branchNumber: boolean;
  branchName: boolean;
  branchLength: boolean;
  branchAngle: boolean;
  branchSection: boolean;
  branchResistance: boolean;
  branchResistanceSum: boolean;
  branchVelocity: boolean;
  branchExtraFan: boolean;
  branchFlowCalc: boolean;
  branchFlow: boolean;
  branchHeight: boolean;
  branchPeople: boolean;
  branchDepression: boolean;
  branchNatDragC: boolean;
  branchNatDragT: boolean;
  branchNatDragW: boolean;
  branchGasEmission: boolean;
  branchGasSpreadTime: boolean;
  branchMethane: boolean;
  branchAlpha: boolean;
  branchLocalXi: boolean;
  branchCOEmission: boolean;
  branchCOStart: boolean;
  branchCOEnd: boolean;
  branchQCOStart: boolean;
  branchQCOEnd: boolean;
}

export const DEFAULT_INFO_CONFIG: InfoDisplayConfig = {
  nodeNumber: false,
  nodeX: false,
  nodeY: false,
  nodeZ: false,
  nodePressure: false,
  nodeTemp: false,
  nodeMethane: false,
  nodeHumidity: false,
  nodeCO: false,
  branchNumber: false,
  branchName: true,
  branchLength: false,
  branchAngle: false,
  branchSection: false,
  branchResistance: false,
  branchResistanceSum: false,
  branchVelocity: false,
  branchExtraFan: false,
  branchFlowCalc: false,
  branchFlow: true,
  branchHeight: false,
  branchPeople: false,
  branchDepression: false,
  branchNatDragC: false,
  branchNatDragT: false,
  branchNatDragW: false,
  branchGasEmission: false,
  branchGasSpreadTime: false,
  branchMethane: false,
  branchAlpha: false,
  branchLocalXi: false,
  branchCOEmission: false,
  branchCOStart: false,
  branchCOEnd: false,
  branchQCOStart: false,
  branchQCOEnd: false,
};
