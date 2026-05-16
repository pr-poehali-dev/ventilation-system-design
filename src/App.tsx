
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

  const handleForceDesktop = () => {
    localStorage.setItem("force-desktop", "1");
    const vp = document.getElementById("viewport-meta") as HTMLMetaElement | null;
    if (vp) vp.content = "width=1280, initial-scale=0.25";
    setForceDesktop(true);
  };

  useEffect(() => {
    if (forceDesktop) {
      const vp = document.getElementById("viewport-meta") as HTMLMetaElement | null;
      if (vp) vp.content = "width=1280, initial-scale=0.25";
    }
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