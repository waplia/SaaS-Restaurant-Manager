import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, useAuth } from "@/lib/auth";
import { Layout } from "@/components/Layout";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import RestaurantDetail from "@/pages/RestaurantDetail";
import Visits from "@/pages/Visits";
import Rewards from "@/pages/Rewards";
import Network from "@/pages/Network";
import Profile from "@/pages/Profile";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } },
});

function AuthedRouter() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/r/:rid" component={RestaurantDetail} />
        <Route path="/visits" component={Visits} />
        <Route path="/rewards" component={Rewards} />
        <Route path="/network" component={Network} />
        <Route path="/profile" component={Profile} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function Shell() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[rgb(var(--bg))]">
        <div className="skeleton h-10 w-32" />
      </div>
    );
  }
  return user ? <AuthedRouter /> : <Login />;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
        <AuthProvider>
          <Shell />
        </AuthProvider>
      </WouterRouter>
    </QueryClientProvider>
  );
}

export default App;
