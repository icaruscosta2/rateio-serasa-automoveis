import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import * as XLSX from "xlsx";
import { AppLayout } from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ChevronLeft, Download, Trash2 } from "lucide-react";
import { brl } from "@/lib/format";
import { formatCnpj } from "@/lib/cnpj";
import { deleteRateio } from "@/lib/delete-rateio";
import { toast } from "sonner";

export const Route = createFileRoute("/rateios/$id")({
  component: () => (
    <AppLayout>
      <RateioDetailPage />
    </AppLayout>
  ),
});

interface ResultRow {
  cod_empresa: number;
  consumo_minimo: number;
  pc_fixo: number;
  pc_adicional: number;
  fi_novos: number;
  fi_seminovos: number;
  adm_rateado: number;
  total: number;
  companies: { nome: string; cnpj: string | null; cnpj_normalizado: string | null } | null;
}

interface RateioMeta {
  id: string;
  mes_referencia: string;
  consumo_minimo_grupo: number;
  pc_fixo_grupo: number;
  pc_adicional_grupo: number;
  fi_intranet_grupo: number;
  adm_rateado_grupo: number;
}

function RateioDetailPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const [meta, setMeta] = useState<RateioMeta | null>(null);
  const [rows, setRows] = useState<ResultRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    (async () => {
      const [{ data: r }, { data: res }] = await Promise.all([
        supabase.from("rateios").select("*").eq("id", id).single(),
        supabase
          .from("rateio_resultados")
          .select("*, companies(nome, cnpj, cnpj_normalizado)")
          .eq("rateio_id", id)
          .order("total", { ascending: false }),
      ]);
      setMeta(r as RateioMeta | null);
      setRows((res ?? []) as ResultRow[]);
      setLoading(false);
    })();
  }, [id]);

  const totals = rows.reduce(
    (a, r) => ({
      consumo_minimo: a.consumo_minimo + Number(r.consumo_minimo),
      pc_fixo: a.pc_fixo + Number(r.pc_fixo),
      pc_adicional: a.pc_adicional + Number(r.pc_adicional),
      fi_novos: a.fi_novos + Number(r.fi_novos),
      fi_seminovos: a.fi_seminovos + Number(r.fi_seminovos),
      adm_rateado: a.adm_rateado + Number(r.adm_rateado),
      total: a.total + Number(r.total),
    }),
    { consumo_minimo: 0, pc_fixo: 0, pc_adicional: 0, fi_novos: 0, fi_seminovos: 0, adm_rateado: 0, total: 0 },
  );

  const exportXlsx = () => {
    try {
      const data = rows.map((r) => ({
        CNPJ: r.companies?.cnpj ?? formatCnpj(r.companies?.cnpj_normalizado ?? ""),
        Empresa: r.companies?.nome ?? "",
        "Consumo Mínimo": Number(r.consumo_minimo),
        "PC Fixo": Number(r.pc_fixo),
        "PC Adicional": Number(r.pc_adicional),
        "F&I Novos": Number(r.fi_novos),
        "F&I Seminovos": Number(r.fi_seminovos),
        "ADM Rateado": Number(r.adm_rateado),
        Total: Number(r.total),
      }));
      data.push({
        CNPJ: "", Empresa: "TOTAL",
        "Consumo Mínimo": totals.consumo_minimo,
        "PC Fixo": totals.pc_fixo,
        "PC Adicional": totals.pc_adicional,
        "F&I Novos": totals.fi_novos,
        "F&I Seminovos": totals.fi_seminovos,
        "ADM Rateado": totals.adm_rateado,
        Total: totals.total,
      });
      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "RESUMO RATEIO");
      const mes = meta?.mes_referencia.slice(0, 7) ?? "rateio";
      XLSX.writeFile(wb, `RESUMO_RATEIO_${mes}.xlsx`);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Erro ao exportar");
    }
  };

  if (loading) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  if (!meta) return <p>Rateio não encontrado.</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link to="/rateios" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
            <ChevronLeft className="h-4 w-4" /> Rateios
          </Link>
          <h1 className="text-3xl font-bold mt-1">
            RESUMO RATEIO —{" "}
            {new Date(meta.mes_referencia + "T12:00:00").toLocaleDateString("pt-BR", {
              month: "long", year: "numeric",
            })}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={exportXlsx}>
            <Download className="h-4 w-4" /> Exportar XLSX
          </Button>
          <Button variant="destructive" onClick={() => setConfirmOpen(true)}>
            <Trash2 className="h-4 w-4" /> Excluir
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-5 gap-3">
        {[
          ["Consumo Mín.", totals.consumo_minimo],
          ["PC Fixo", totals.pc_fixo],
          ["PC Adicional", totals.pc_adicional],
          ["F&I (PEFIN PF/PJ)", totals.fi_novos + totals.fi_seminovos],
          ["ADM Rateado", totals.adm_rateado],
        ].map(([label, v]) => (
          <Card key={label as string}>
            <CardHeader className="pb-2">
              <CardDescription className="text-xs">{label as string}</CardDescription>
              <CardTitle className="text-lg">{brl(Number(v))}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Distribuição por CNPJ</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead rowSpan={2}>CNPJ</TableHead>
                <TableHead rowSpan={2}>Empresa</TableHead>
                <TableHead rowSpan={2} className="text-right">Consumo Mín.</TableHead>
                <TableHead rowSpan={2} className="text-right">PC Fixo</TableHead>
                <TableHead rowSpan={2} className="text-right">PC Adicional</TableHead>
                <TableHead colSpan={3} className="text-center border-l">F&I</TableHead>
                <TableHead rowSpan={2} className="text-right border-l">Total</TableHead>
              </TableRow>
              <TableRow>
                <TableHead className="text-right border-l">Novos</TableHead>
                <TableHead className="text-right">Seminovos</TableHead>
                <TableHead className="text-right">ADM Rateado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.cod_empresa}>
                  <TableCell className="font-mono text-xs">
                    {r.companies?.cnpj ?? formatCnpj(r.companies?.cnpj_normalizado ?? "")}
                  </TableCell>
                  <TableCell>{r.companies?.nome}</TableCell>
                  <TableCell className="text-right">{brl(Number(r.consumo_minimo))}</TableCell>
                  <TableCell className="text-right">{brl(Number(r.pc_fixo))}</TableCell>
                  <TableCell className="text-right">{brl(Number(r.pc_adicional))}</TableCell>
                  <TableCell className="text-right border-l">{brl(Number(r.fi_novos))}</TableCell>
                  <TableCell className="text-right">{brl(Number(r.fi_seminovos))}</TableCell>
                  <TableCell className="text-right">{brl(Number(r.adm_rateado))}</TableCell>
                  <TableCell className="text-right border-l font-medium">{brl(Number(r.total))}</TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell colSpan={2}>TOTAL</TableCell>
                <TableCell className="text-right">{brl(totals.consumo_minimo)}</TableCell>
                <TableCell className="text-right">{brl(totals.pc_fixo)}</TableCell>
                <TableCell className="text-right">{brl(totals.pc_adicional)}</TableCell>
                <TableCell className="text-right border-l">{brl(totals.fi_novos)}</TableCell>
                <TableCell className="text-right">{brl(totals.fi_seminovos)}</TableCell>
                <TableCell className="text-right">{brl(totals.adm_rateado)}</TableCell>
                <TableCell className="text-right border-l">{brl(totals.total)}</TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
