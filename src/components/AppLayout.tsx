import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useEffect } from "react";
import {
  LogOut,
  Building2,
  FileSpreadsheet,
  Users,
  UserCog,
  SlidersHorizontal,
  History,
  ChevronRight,
} from "lucide-react";
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

  const sectionLabel = (label: string) => (
    <p className="px-2 pt-4 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 select-none">
      {label}
    </p>
  );

  const navItem = (to: string, label: string, Icon: typeof Building2, indent = false) => {
    const active = pathname === to || pathname.startsWith(to + "/");
    return (
      <Link
        to={to}
        className={cn(
          "flex items-center gap-2 rounded-md py-2 text-sm font-medium transition-colors",
          indent ? "px-3 pl-5" : "px-3",
          active ? "bg-primary text-primary-foreground" : "hover:bg-accent",
        )}
      >
        <Icon className="h-4 w-4 shrink-0" />
        <span>{label}</span>
      </Link>
    );
  };

  const subLabel = (label: string) => (
    <div className="flex items-center gap-1 px-3 pt-3 pb-0.5">
      <ChevronRight className="h-3 w-3 text-muted-foreground/50" />
      <p className="text-[11px] font-semibold text-muted-foreground/70 select-none">{label}</p>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-muted/30">
      <aside className="w-60 border-r bg-card p-4 flex flex-col">
        <div className="px-2 py-3 mb-1">
          <h1 className="text-lg font-semibold">Revemar</h1>
          <p className="text-xs text-muted-foreground">Gestão de despesas</p>
        </div>

        {/* ── GRUPO REVEMAR ── */}
        {sectionLabel("Grupo Revemar")}
        {navItem("/empresas", "Empresas", Building2)}

        {/* ── RATEIO DE DESPESAS ── */}
        {sectionLabel("Rateio de Despesas")}
        {subLabel("Serasa")}
        {navItem("/serasa/processos", "Processos", SlidersHorizontal, true)}
        {navItem("/rateios/novo", "Financeiro Auto", FileSpreadsheet, true)}
        {navItem("/rateios", "Histórico", History, true)}

        {/* ── CONFIGURAÇÕES ── */}
        {sectionLabel("Configurações")}
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
