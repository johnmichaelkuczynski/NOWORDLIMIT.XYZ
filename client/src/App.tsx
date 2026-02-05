import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Home from "@/pages/Home";
import PaymentSuccess from "@/pages/PaymentSuccess";
import PositionsManager from "@/pages/PositionsManager";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/positions" component={PositionsManager} />
      <Route path="/payment/success" component={PaymentSuccess} />
      <Route path="/payment/cancel" component={Home} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;