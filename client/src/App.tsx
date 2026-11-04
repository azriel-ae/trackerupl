import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import Landing from "./components/Landing";
import { ThemeProvider } from "./contexts/ThemeContext";
import PemeriksaanUpl from "./pages/PemeriksaanUpl";
import Tentang from "./pages/Tentang";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Landing} />
      <Route path="/pemeriksaan-upl" component={PemeriksaanUpl} />
      <Route path="/pemeriksaan-upl/*?" component={PemeriksaanUpl} />
      <Route path="/tentang" component={Tentang} />
      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
