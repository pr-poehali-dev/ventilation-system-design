// Слой текстовых блоков для предпросмотра печати — как в рабочей области.
// Вынесено из PrintPreviewCanvas.tsx без изменений логики.
import {
  type ProjOptions,
  project3D,
} from "@/lib/topology";
import { type TextBlock } from "@/pages/cad/cadTypes";

interface Props {
  textBlocks: TextBlock[];
  proj: ProjOptions;
  viewState: { scale: number; offsetX: number; offsetY: number; azimuth: number; elevation: number };
  activeView: ProjOptions & { scale: number; offsetX: number; offsetY: number };
  xyScale?: number;
  width: number;
  height: number;
}

export default function PrintTextBlocksOverlay({
  textBlocks,
  proj,
  viewState,
  activeView,
  xyScale,
  width,
  height,
}: Props) {
  const _xySF = xyScale ?? 1;
  const previewK = viewState.scale > 0 ? activeView.scale / viewState.scale : 1;
  const pxPerMm = 3.78 * Math.min(8, Math.max(0.25, viewState.scale / (_xySF * 0.5))) * previewK;
  return (
    <svg
      style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "visible" }}
      width={width} height={height}
    >
      {textBlocks.map((tb) => {
        const { sx, sy } = project3D({ x: tb.x * _xySF, y: tb.y * _xySF, z: 0 }, proj);
        const fsPx = tb.fontSize * pxPerMm;
        const lines = tb.text.split("\n");
        const lineH = fsPx * 1.35;
        const maxLen = Math.max(...lines.map(l => l.length), 4);
        const estW = Math.max(60 * previewK, maxLen * fsPx * 0.58 + 16 * previewK);
        const estH = lines.length * lineH + 12 * previewK;
        return (
          <g key={tb.id} transform={`translate(${sx},${sy})`}>
            {tb.background !== "none" && (
              <rect x={-estW/2} y={-estH/2} width={estW} height={estH} fill={tb.background} rx={3} />
            )}
            {tb.borderColor !== "none" && (
              <rect x={-estW/2} y={-estH/2} width={estW} height={estH}
                fill="none" stroke={tb.borderColor} strokeWidth={1} rx={3} />
            )}
            {lines.map((line, li) => (
              <text key={li}
                x={0} y={(-estH/2 + 8 * previewK) + li * lineH + fsPx * 0.8}
                textAnchor="middle" fill={tb.color} fontSize={fsPx}
                fontWeight={tb.bold ? "bold" : "normal"}
                fontStyle={tb.italic ? "italic" : "normal"}
                fontFamily="sans-serif"
                style={{ userSelect: "none" }}
              >{line}</text>
            ))}
          </g>
        );
      })}
    </svg>
  );
}
