
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
  const [forceDesktop, setForceDesktop] = useState(
    () => localStorage.getItem("force-desktop") === "1"
  );

  const applyDesktopViewport = () => {
    const vp = document.getElementById("viewport-meta") as HTMLMetaElement | null;
    if (!vp) return;
    vp.content = "width=1280, user-scalable=yes";
    // Растягиваем html/body на весь физический экран
    document.documentElement.style.width = "100%";
    document.documentElement.style.height = "100%";
    document.body.style.width = "100%";
    document.body.style.height = "100%";
    document.body.style.background = "#000";
  };

  const handleForceDesktop = () => {
    localStorage.setItem("force-desktop", "1");
    applyDesktopViewport();
    setForceDesktop(true);
  };

  useEffect(() => {
    if (forceDesktop) applyDesktopViewport();
  }, [forceDesktop]);

  if (isMobile && !forceDesktop) return <MobileStub onForceDesktop={handleForceDesktop} />;

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