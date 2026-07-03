import { useState } from "react";

// Основной логотип проекта (CDN). Работает онлайн.
const LOGO_URL =
  "https://cdn.poehali.dev/projects/564c75d6-cb0f-4378-9852-c88803b7dcf2/bucket/f615a5b6-1200-469a-956d-b8be955dd6d0.png";

// Локальный запасной логотип — используется, если CDN недоступен
// (например, в десктопной программе без интернета).
const FALLBACK_URL = "/icon.svg";

interface Props {
  className?: string;
  style?: React.CSSProperties;
  alt?: string;
}

export default function AppLogo({ className, style, alt = "ПВ-Система" }: Props) {
  const [src, setSrc] = useState(LOGO_URL);
  return (
    <img
      src={src}
      alt={alt}
      className={className}
      style={style}
      draggable={false}
      onError={() => {
        if (src !== FALLBACK_URL) setSrc(FALLBACK_URL);
      }}
    />
  );
}
