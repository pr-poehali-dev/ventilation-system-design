// SVG слоя печати (рамки) поверх canvas в предпросмотре печати.
// Вынесено из PrintPreviewCanvas.tsx без изменений логики.
import { type TopoBranch, type Horizon } from "@/lib/topology";
import { type SchemaSymbol } from "@/pages/Cad";
import { renderPrintLayerSvgContent } from "@/lib/printLayerSvg";

interface Props {
  printLayerRects: Array<{ h: Horizon; pl: NonNullable<Horizon["printLayer"]>; rx: number; ry: number; rw: number; rh: number }>;
  schemaSymbols: SchemaSymbol[];
  branches: TopoBranch[];
  width: number;
  height: number;
}

export default function PrintLayerOverlay({
  printLayerRects,
  schemaSymbols,
  branches,
  width,
  height,
}: Props) {
  return (
    <svg
      style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "visible" }}
      width={width} height={height}
    >
      {printLayerRects.map(({ h, pl, rx, ry, rw, rh }) => (
        <g key={h.id}>
          {renderPrintLayerSvgContent({ pl, rx, ry, rw, rh, schemaSymbols, branches })}
        </g>
      ))}
    </svg>
  );
}
