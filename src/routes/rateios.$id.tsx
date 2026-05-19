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
import { formatCnpj, normalizeCnpj } from "@/lib/cnpj";
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
  parse_summary: Record<string, unknown> | null;
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

  // Negat: recalcular por empresa a partir do parse_summary (sem precisar de coluna no banco)
  const negatByCompany = (() => {
    if (!meta?.parse_summary) return new Map<number, number>();
    const ps = meta.parse_summary;
    const negatValorAuto = Number(ps.negatValorAuto ?? 0);
    const negativacoesPorCnpj = ps.negativacoesPorCnpj as Record<string, number> | undefined;
    if (!negatValorAuto || !negativacoesPorCnpj) return new Map<number, number>();
    const totalNegat = Object.values(negativacoesPorCnpj).reduce((a, b) => a + b, 0);
    if (totalNegat === 0) return new Map<number, number>();
    const map = new Map<number, number>();
    for (const r of rows) {
      const cnpj = normalizeCnpj(r.companies?.cnpj_normalizado ?? "");
      const count = negativacoesPorCnpj[cnpj] ?? 0;
      if (count > 0) map.set(r.cod_empresa, (negatValorAuto * count) / totalNegat);
    }
    return map;
  })();
  const negatTotal = Array.from(negatByCompany.values()).reduce((a, b) => a + b, 0);

  const exportXlsx = () => {
    try {
      const data = rows.map((r) => {
        const negat = negatByCompany.get(r.cod_empresa) ?? 0;
        return {
          CNPJ: r.companies?.cnpj ?? formatCnpj(r.companies?.cnpj_normalizado ?? ""),
          Empresa: r.companies?.nome ?? "",
          "Consumo Mínimo": Number(r.consumo_minimo),
          "PC Fixo": Number(r.pc_fixo),
          "PC Adicional": Number(r.pc_adicional),
          "F&I Novos": Number(r.fi_novos),
          "F&I Seminovos": Number(r.fi_seminovos),
          "Consultas ADM Avulsas": Number(r.adm_rateado),
          "NF Negativações": negat,
          Total: Number(r.total) + negat,
        };
      });
      data.push({
        CNPJ: "", Empresa: "TOTAL",
        "Consumo Mínimo": totals.consumo_minimo,
        "PC Fixo": totals.pc_fixo,
        "PC Adicional": totals.pc_adicional,
        "F&I Novos": totals.fi_novos,
        "F&I Seminovos": totals.fi_seminovos,
        "Consultas ADM Avulsas": totals.adm_rateado,
        "NF Negativações": negatTotal,
        Total: totals.total + negatTotal,
      });
      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "RESUMO RATEIO");

      // ---- Aba 2: Centros de Custos ----
      // Regras AUTOMÓVEIS:
      //   NOVOS             = Consumo Mínimo + F&I Novos + Consultas ADM Avulsas
      //   SEMINOVOS         = F&I Seminovos
      //   PEÇAS             = 75% × (PC Fixo + PC Adicional + NF Negativações)
      //   ASSISTÊNCIA TÉC.  = 25% × (PC Fixo + PC Adicional + NF Negativações)
      const ccRows = rows.map((r) => {
        const cm   = Number(r.consumo_minimo);
        const pcf  = Number(r.pc_fixo);
        const pca  = Number(r.pc_adicional);
        const fiN  = Number(r.fi_novos);
        const fiS  = Number(r.fi_seminovos);
        const adm  = Number(r.adm_rateado);
        const ngt  = negatByCompany.get(r.cod_empresa) ?? 0;
        const pcBase = pcf + pca + ngt;
        const novos    = cm + fiN + adm;
        const seminovos = fiS;
        const pecas    = 0.75 * pcBase;
        const at       = 0.25 * pcBase;
        return {
          CNPJ: r.companies?.cnpj ?? formatCnpj(r.companies?.cnpj_normalizado ?? ""),
          Empresa: r.companies?.nome ?? "",
          NOVOS:    novos,
          SEMINOVOS: seminovos,
          "PEÇAS":  pecas,
          "ASSISTÊNCIA TÉCNICA": at,
          TOTAL:    novos + seminovos + pecas + at,
        };
      });
      const ccTotals = ccRows.reduce(
        (acc, r) => ({
          ...acc,
          NOVOS:    acc.NOVOS + r.NOVOS,
          SEMINOVOS: acc.SEMINOVOS + r.SEMINOVOS,
          "PEÇAS":  acc["PEÇAS"] + r["PEÇAS"],
          "ASSISTÊNCIA TÉCNICA": acc["ASSISTÊNCIA TÉCNICA"] + r["ASSISTÊNCIA TÉCNICA"],
          TOTAL:    acc.TOTAL + r.TOTAL,
        }),
        { CNPJ: "", Empresa: "TOTAL", NOVOS: 0, SEMINOVOS: 0, "PEÇAS": 0, "ASSISTÊNCIA TÉCNICA": 0, TOTAL: 0 },
      );
      ccRows.push(ccTotals);
      const ws2 = XLSX.utils.json_to_sheet(ccRows);
      XLSX.utils.book_append_sheet(wb, ws2, "CENTROS DE CUSTOS");

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

      <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
        {[
          ["Consumo Mín.", totals.consumo_minimo],
          ["PC Fixo", totals.pc_fixo],
          ["PC Adicional", totals.pc_adicional],
          ["F&I (PEFIN PF/PJ)", totals.fi_novos + totals.fi_seminovos],
          ["Consultas ADM Avulsas", totals.adm_rateado],
          ["NF Negativações", negatTotal],
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
                <TableHead rowSpan={2}>Empresa</TableHead>
                <TableHead rowSpan={2} className="text-right">Consumo Mín.</TableHead>
                <TableHead rowSpan={2} className="text-right">PC Fixo</TableHead>
                <TableHead rowSpan={2} className="text-right">PC Adicional</TableHead>
                <TableHead colSpan={3} className="text-center border-l">F&I</TableHead>
                <TableHead rowSpan={2} className="text-right border-l">NF Negat.</TableHead>
                <TableHead rowSpan={2} className="text-right border-l font-bold">Total</TableHead>
              </TableRow>
              <TableRow>
                <TableHead className="text-right border-l">Novos</TableHead>
                <TableHead className="text-right">Seminovos</TableHead>
                <TableHead className="text-right">Consultas ADM</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const negat = negatByCompany.get(r.cod_empresa) ?? 0;
                const totalComNegat = Number(r.total) + negat;
                return (
                  <TableRow key={r.cod_empresa}>
                    <TableCell>
                      <div>{r.companies?.nome}</div>
                      <div className="text-xs text-muted-foreground font-mono">
                        {r.companies?.cnpj ?? formatCnpj(r.companies?.cnpj_normalizado ?? "")}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">{brl(Number(r.consumo_minimo))}</TableCell>
                    <TableCell className="text-right">{brl(Number(r.pc_fixo))}</TableCell>
                    <TableCell className="text-right">{brl(Number(r.pc_adicional))}</TableCell>
                    <TableCell className="text-right border-l">{brl(Number(r.fi_novos))}</TableCell>
                    <TableCell className="text-right">{brl(Number(r.fi_seminovos))}</TableCell>
                    <TableCell className="text-right">{brl(Number(r.adm_rateado))}</TableCell>
                    <TableCell className="text-right border-l">{negat > 0 ? brl(negat) : "—"}</TableCell>
                    <TableCell className="text-right border-l font-medium">{brl(totalComNegat)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell>TOTAL</TableCell>
                <TableCell className="text-right">{brl(totals.consumo_minimo)}</TableCell>
                <TableCell className="text-right">{brl(totals.pc_fixo)}</TableCell>
                <TableCell className="text-right">{brl(totals.pc_adicional)}</TableCell>
                <TableCell className="text-right border-l">{brl(totals.fi_novos)}</TableCell>
                <TableCell className="text-right">{brl(totals.fi_seminovos)}</TableCell>
                <TableCell className="text-right">{brl(totals.adm_rateado)}</TableCell>
                <TableCell className="text-right border-l">{brl(negatTotal)}</TableCell>
                <TableCell className="text-right border-l font-bold">{brl(totals.total + negatTotal)}</TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </CardContent>
      </Card>

      <AlertDialog open={confirmOpen} onOpenChange={(o) => !deleting && setConfirmOpen(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir rateio</AlertDialogTitle>
            <AlertDialogDescription>
              Excluir o rateio de{" "}
              {new Date(meta.mes_referencia + "T12:00:00").toLocaleDateString("pt-BR", {
                month: "long", year: "numeric",
              })}
              ? Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={async (e) => {
                e.preventDefault();
                setDeleting(true);
                try {
                  await deleteRateio(id);
                  toast.success("Rateio excluído");
                  navigate({ to: "/rateios" });
                } catch (err: unknown) {
                  toast.error(err instanceof Error ? err.message : "Erro ao excluir");
                  setDeleting(false);
                }
              }}
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
