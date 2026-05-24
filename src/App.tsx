
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { useEffect, useState } from "react";
import Index from "./pages/Index";
import Cad from "./pages/Cad";
import NotFound from "./pages/NotFound";
import MobileStub from "./components/MobileStub";

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
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Cad />} />
          <Route path="/legacy" element={<Index />} />
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
  );
};

export default App;