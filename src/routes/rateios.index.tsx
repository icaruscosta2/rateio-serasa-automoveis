import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus, FileSpreadsheet } from "lucide-react";
import { Badge } from "@/components/ui/badge";

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

function RateiosListPage() {
  const [rows, setRows] = useState<Rateio[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from("rateios")
      .select("id, mes_referencia, status, created_at")
      .order("mes_referencia", { ascending: false })
      .then(({ data }) => {
        setRows((data ?? []) as Rateio[]);
        setLoading(false);
      });
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Rateios</h1>
          <p className="text-muted-foreground">Histórico mensal de rateio</p>
        </div>
        <Link to="/rateios/novo">
          <Button>
            <Plus className="h-4 w-4" /> Novo rateio
          </Button>
        </Link>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : !rows.length ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            <FileSpreadsheet className="h-12 w-12 mx-auto mb-3 opacity-50" />
            Nenhum rateio ainda. Comece criando o primeiro.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-3 gap-4">
          {rows.map((r) => (
            <Link key={r.id} to="/rateios/$id" params={{ id: r.id }}>
              <Card className="hover:border-primary transition-colors cursor-pointer">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg">
                      {new Date(r.mes_referencia + "T12:00:00").toLocaleDateString("pt-BR", {
                        month: "long", year: "numeric",
                      })}
                    </CardTitle>
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
          ))}
        </div>
      )}
    </div>
  );
}
