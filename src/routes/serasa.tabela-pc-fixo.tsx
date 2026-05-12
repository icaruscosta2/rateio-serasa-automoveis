import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableFooter, TableHead,
  TableHeader, TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";

export const Route = createFileRoute("/serasa/tabela-pc-fixo")({
  component: () => (
    <AppLayout>
      <TabelaPcFixoPage />
    </AppLayout>
  ),
});

const SEG_LABELS: Record<string, string> = {
  AUTOMOVEIS:   "Automóveis",
  CAMINHOES:    "Pesados",
  PESADOS:      "Pesados",
  MOTOCICLETAS: "Motocicletas",
  MAQUINAS:     "Máquinas",
  TRATORES:     "Tratores",
  SERVICOS:     "Serviços",
};

interface ConfigRow {
  tipo: string;
  segmento: string;
  qtd_cnpj: number;
}

function TabelaPcFixoPage() {
  const [rows, setRows]       = useState<ConfigRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [edited, setEdited]   = useState<Record<string, number>>({});
  const [saving, setSaving]   = useState(false);

  useEffect(() => {
    supabase
      .from("rateio_config_segmentos")
      .select("tipo, segmento, qtd_cnpj")
      .eq("tipo", "PC_FIXO")
      .order("segmento")
      .then(({ data }) => {
        setRows((data ?? []) as ConfigRow[]);
        setLoading(false);
      });
  }, []);

  const effectiveQtd = (seg: string) => edited[seg] ?? rows.find(r => r.segmento === seg)?.qtd_cnpj ?? 0;
  const total = rows.reduce((sum, r) => sum + effectiveQtd(r.segmento), 0);

  const handleSave = async () => {
    const entries = Object.entries(edited);
    if (entries.length === 0) return;
    setSaving(true);
    try {
      for (const [segmento, qtd_cnpj] of entries) {
        const { error } = await supabase
          .from("rateio_config_segmentos")
          .update({ qtd_cnpj })
          .eq("tipo", "PC_FIXO")
          .eq("segmento", segmento);
        if (error) throw error;
      }
      setRows(prev =>
        prev.map(r => ({ ...r, qtd_cnpj: edited[r.segmento] ?? r.qtd_cnpj }))
      );
      setEdited({});
      toast.success("Tabela de PC Fixo atualizada");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="text-sm text-muted-foreground">Carregando…</p>;

  return (
    <div className="space-y-6 max-w-lg">
      <div>
        <h1 className="text-3xl font-bold">Tabela PC Fixo</h1>
        <p className="text-muted-foreground">
          Nº de matrizes por segmento para alocação do <strong>PC Fixo</strong> Serasa
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Distribuição por Segmento</CardTitle>
          <CardDescription>
            O percentual de cada segmento é calculado automaticamente com base no total de matrizes.
            Serviços não participa do PC Fixo.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Segmento</TableHead>
                <TableHead className="text-right w-32">Nº de Matrizes</TableHead>
                <TableHead className="text-right w-24">%</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(r => {
                const qtd = effectiveQtd(r.segmento);
                const pct = total > 0 ? (qtd / total) * 100 : 0;
                return (
                  <TableRow key={r.segmento}>
                    <TableCell className="font-medium">
                      {SEG_LABELS[r.segmento] ?? r.segmento}
                    </TableCell>
                    <TableCell className="text-right">
                      <Input
                        type="number"
                        min="0"
                        value={qtd}
                        onChange={(e) =>
                          setEdited(prev => ({ ...prev, [r.segmento]: Number(e.target.value) }))
                        }
                        className="w-24 ml-auto text-right"
                      />
                    </TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground">
                      {pct.toFixed(2)}%
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell className="font-bold">Total</TableCell>
                <TableCell className="text-right font-bold">{total}</TableCell>
                <TableCell className="text-right text-sm">100,00%</TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </CardContent>
      </Card>

      {Object.keys(edited).length > 0 && (
        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Salvando…" : "Salvar alterações"}
          </Button>
        </div>
      )}
    </div>
  );
}
