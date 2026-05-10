import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus, FileSpreadsheet, Trash2, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { deleteRateio } from "@/lib/delete-rateio";
import { toast } from "sonner";

export const Route = createFileRoute("/rateios/")({
  component: () => (
    <AppLayout>
      <RateiosListPage />
    </AppLayout>
  ),
});

interface Rateio {
  id: string;
  mes_referencia: string;
  status: string;
  created_at: string;
}

interface ProcessoDisponivel {
  id: string;
  mes_referencia: string;
}

function formatMes(d: string) {
  return new Date(d + "T12:00:00").toLocaleDateString("pt-BR", {
    month: "long", year: "numeric",
  });
}

function RateiosListPage() {
  const [rows, setRows] = useState<Rateio[]>([]);
  const [loading, setLoading] = useState(true);
  const [toDelete, setToDelete] = useState<Rateio | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [disponiveis, setDisponiveis] = useState<ProcessoDisponivel[]>([]);

  useEffect(() => {
    Promise.all([
      supabase
        .from("rateios")
        .select("id, mes_referencia, status, created_at")
        .order("mes_referencia", { ascending: false }),
      supabase
        .from("processos_serasa")
        .select("id, mes_referencia")
        .eq("etapa1_status", "concluida")
        .is("rateio_id", null)
        .order("mes_referencia", { ascending: false }),
    ]).then(([{ data: rateios }, { data: procs }]) => {
      setRows((rateios ?? []) as Rateio[]);
      setDisponiveis((procs ?? []) as ProcessoDisponivel[]);
      setLoading(false);
    });
  }, []);

  const handleConfirmDelete = async () => {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await deleteRateio(toDelete.id);
      setRows((prev) => prev.filter((r) => r.id !== toDelete.id));
      toast.success("Rateio excluído");
      setToDelete(null);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Erro ao excluir");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">2. Financeiro Auto</h1>
          <p className="text-muted-foreground">Distribuição entre as lojas de Automóveis</p>
        </div>
      </div>

      {/* ── Meses disponíveis para distribuição ── */}
      {disponiveis.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Disponível para distribuição
          </h2>
          {disponiveis.map((p) => (
            <Link key={p.id} to="/rateios/novo" search={{ processoId: p.id }}>
              <div className="flex items-center justify-between p-4 rounded-lg border border-primary/40 bg-primary/5 hover:bg-primary/10 transition-colors cursor-pointer">
                <div>
                  <p className="font-semibold">{formatMes(p.mes_referencia)}</p>
                  <p className="text-xs text-muted-foreground">
                    Etapa 1 concluída · aguardando distribuição
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="default">Novo rateio</Badge>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {disponiveis.length === 0 && !loading && rows.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground text-sm">
            Nenhum mês disponível para distribuição.{" "}
            <Link to="/serasa/divisao" className="underline text-primary">
              Conclua a Etapa 1 primeiro.
            </Link>
          </CardContent>
        </Card>
      )}

      {/* ── Histórico ── */}
      {rows.length > 0 && (
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Histórico
        </h2>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : !rows.length ? null : (
        <div className="grid grid-cols-3 gap-4">
          {rows.map((r) => (
            <div key={r.id} className="relative">
              <Link to="/rateios/$id" params={{ id: r.id }}>
                <Card className="hover:border-primary transition-colors cursor-pointer">
                  <CardHeader>
                    <div className="flex items-center justify-between gap-2">
                      <CardTitle className="text-lg">{formatMes(r.mes_referencia)}</CardTitle>
                      <Badge variant={r.status === "concluido" ? "default" : "secondary"}>
                        {r.status}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-xs text-muted-foreground">
                      Criado em {new Date(r.created_at).toLocaleDateString("pt-BR")}
                    </p>
                  </CardContent>
                </Card>
              </Link>
              <Button
                variant="ghost"
                size="icon"
                className="absolute top-2 right-2 h-8 w-8 text-muted-foreground hover:text-destructive"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setToDelete(r);
                }}
                aria-label="Excluir rateio"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && !deleting && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir rateio</AlertDialogTitle>
            <AlertDialogDescription>
              {toDelete
                ? `Excluir o rateio de ${formatMes(toDelete.mes_referencia)}? Esta ação não pode ser desfeita.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={(e) => { e.preventDefault(); handleConfirmDelete(); }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? "Excluindo…" : "Excluir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
