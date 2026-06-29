/**
 * Централизованный реестр URL backend-функций.
 * В desktop-режиме все запросы идут на локальный Python-сервер.
 * В web-режиме — на облачные функции из func2url.json.
 */

declare const __DESKTOP_SERVER__: string | undefined;
declare const __IS_DESKTOP__: boolean | undefined;

const isDesktop = typeof __IS_DESKTOP__ !== "undefined" && __IS_DESKTOP__;
const localBase = typeof __DESKTOP_SERVER__ !== "undefined"
  ? __DESKTOP_SERVER__
  : "http://127.0.0.1:54321";

// Импортируем cloud URLs (в desktop-билде они будут переопределены)
import FUNC2URL from "../../backend/func2url.json";

function url(name: string, localPath: string): string {
  if (isDesktop) return `${localBase}${localPath}`;
  return (FUNC2URL as Record<string, string>)[name] ?? "";
}

export const API_URLS = {
  aerodynamics:       url("aerodynamics",        "/aerodynamics"),
  airflow:            url("airflow",             "/airflow"),
  rescueCalculator:   url("rescue-calculator",   "/rescue-calculator"),
  waterHydraulics:    url("water-hydraulics",    "/water-hydraulics"),
  explosionCalculator:url("explosion-calculator","/explosion-calculator"),
  svgToPdf:           url("svg-to-pdf",          "/svg-to-pdf"),
  license:            url("license",             "/license"),
  adminLicenses:      url("admin-licenses",      "/admin-licenses"),
} as const;

export { isDesktop };
