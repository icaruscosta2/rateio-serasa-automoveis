import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useEffect } from "react";
import { LogOut, Building2, FileSpreadsheet, Users, UserCog } from "lucide-react";
import { cn } from "@/lib/utils";

export function AppLayout({ children }: { children?: React.ReactNode } = {}) {
  const { user, loading } = useAuth();
  const nav = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    if (!loading && !user) nav({ to: "/login" });
  }, [loading, user, nav]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        Carregando…
      </div>
    );
  }
  if (!user) return null;

  const navItem = (to: string, label: string, Icon: typeof Building2) => {
    const active = pathname === to || pathname.startsWith(to + "/");
    return (
      <Link
        to={to}
        className={cn(
          "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
          active ? "bg-primary text-primary-foreground" : "hover:bg-accent",
        )}
      >
        <Icon className="h-4 w-4" /> {label}
      </Link>
    );
  };

  return (
    <div className="flex min-h-screen bg-muted/30">
      <aside className="w-60 border-r bg-card p-4 flex flex-col gap-2">
        <div className="px-2 py-3 mb-2">
          <h1 className="text-lg font-semibold">Rateio Revemar</h1>
          <p className="text-xs text-muted-foreground">Consultas de crédito</p>
        </div>
        {navItem("/rateios", "Rateios", FileSpreadsheet)}
        {navItem("/empresas", "Empresas", Building2)}
        {navItem("/usuarios-pcv", "Usuários PCV", Users)}
        {navItem("/gestores-logon", "Gestores ADM", UserCog)}
        <div className="mt-auto pt-4 border-t">
          <p className="px-2 text-xs text-muted-foreground truncate mb-2">{user.email}</p>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start"
            onClick={async () => {
              await supabase.auth.signOut();
              nav({ to: "/login" });
            }}
          >
            <LogOut className="h-4 w-4" /> Sair
          </Button>
        </div>
      </aside>
      <main className="flex-1 p-8 overflow-auto">
        {children ?? <Outlet />}
      </main>
    </div>
  );
}
