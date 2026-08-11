
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, HashRouter, Routes, Route } from "react-router-dom";

// В десктопе (file://) используем HashRouter, в браузере — BrowserRouter
// __IS_DESKTOP__ инжектируется Vite при сборке через vite.config.electron.ts
declare const __IS_DESKTOP__: boolean | undefined;
const isDesktop = typeof __IS_DESKTOP__ !== 'undefined' ? __IS_DESKTOP__ : window.location.protocol === 'file:';
const Router = isDesktop ? HashRouter : BrowserRouter;
import { useEffect, useState, lazy, Suspense } from "react";
import Cad from "./pages/Cad";
import NotFound from "./pages/NotFound";

// ── Ленивая загрузка второстепенных страниц ─────────────────────────────────
// Раньше весь интерфейс собирался в один файл, и при запуске в память
// загружалась в том числе админ-панель управления лицензиями и старая
// демо-страница — обычному пользователю они не нужны никогда.
//
// Теперь эти страницы подгружаются только при переходе на них. Рабочий экран
// (схема вентиляции) остаётся в основном файле и открывается сразу — его
// дробить нельзя, иначе появится задержка на главном сценарии.
const Admin = lazy(() => import("./pages/Admin"));
const Index = lazy(() => import("./pages/Index"));

// Заставка на время подгрузки страницы (доли секунды на локальном диске).
const PageLoading = () => (
  <div style={{
    display: "flex", alignItems: "center", justifyContent: "center",
    height: "100vh", fontFamily: "sans-serif", color: "#64748b", fontSize: 14,
  }}>
    Загрузка…
  </div>
);
import MobileStub from "./components/MobileStub";
import { LicenseProvider } from "./context/LicenseContext";
import AppUpdateBanner from "./components/AppUpdateBanner";

const queryClient = new QueryClient();

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);
  return isMobile;
}

const App = () => {
  const isMobile = useIsMobile();
  // По умолчанию на мобильном сразу открываем десктопную версию.
  // Заглушку «Открыть на компьютере» показываем только если пользователь
  // явно её запросил (?stub=1) или сохранил выбор.
  const [forceDesktop, setForceDesktop] = useState(() => {
    const saved = localStorage.getItem("force-desktop");
    if (saved === "0") return false;          // явно выбрал «остаться на стабе»
    return true;                              // по умолчанию — сразу ПК-версия
  });
  const [showMobileStub, setShowMobileStub] = useState(() => {
    return new URLSearchParams(window.location.search).get("stub") === "1"
      || localStorage.getItem("force-desktop") === "0";
  });

  const applyDesktopViewport = () => {
    const vp = document.getElementById("viewport-meta") as HTMLMetaElement | null;
    if (!vp) return;
    // Вычисляем масштаб: физическая ширина экрана / 1280
    const cssW = window.screen.width;
    const scale = parseFloat((cssW / 1280).toFixed(3));
    vp.content = `width=1280, initial-scale=${scale}, minimum-scale=0.1, maximum-scale=10, user-scalable=yes`;
  };

  const handleForceDesktop = () => {
    localStorage.setItem("force-desktop", "1");
    applyDesktopViewport();
    setForceDesktop(true);
    setShowMobileStub(false);
  };

  useEffect(() => {
    // На мобильном устройстве всегда применяем десктопный viewport,
    // если не показываем заглушку.
    if (isMobile && forceDesktop && !showMobileStub) applyDesktopViewport();
  }, [isMobile, forceDesktop, showMobileStub]);

  if (isMobile && showMobileStub) return <MobileStub onForceDesktop={handleForceDesktop} />;

  return (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <LicenseProvider>
        <Router>
          <Suspense fallback={<PageLoading />}>
            <Routes>
              <Route path="/" element={<Cad />} />
              <Route path="/admin" element={<Admin />} />
              <Route path="/legacy" element={<Index />} />
              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </Router>
        <AppUpdateBanner />
      </LicenseProvider>
    </TooltipProvider>
  </QueryClientProvider>
  );
};

export default App;