import { createFileRoute, Link } from "@tanstack/react-router";
import React, { useEffect, useRef, useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableFooter, TableHead,
  TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Upload, CheckCircle2, History, ChevronDown, ChevronRight, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { parseRateioWorkbook, type ParseResult } from "@/lib/parse-rateio";
import {
  computeSegmentos,
  DEFAULT_SEGMENT_CONFIG_MAPS,
  type SegmentConfigMaps,
  type SegmentSummary,
} from "@/lib/compute-segmentos";
import { brl } from "@/lib/format";

export const Route = createFileRoute("/serasa/divisao")({
  component: () => (
    <AppLayout>
      <DivisaoPage />
    </AppLayout>
  ),
});

// ---------------------------------------------------------------------------
// Tipos auxiliares
// ---------------------------------------------------------------------------

interface ProcessoRow {
  id: string;
  mes_referencia: string;
  etapa1_status: string;
  etapa1_pct_cons_min: number;
  etapa1_pct_pc_fixo: number;
  etapa1_pcv_inicio: string | null;
  etapa1_pcv_fim: string | null;
  etapa1_concluida_em: string | null;
  etapa1_resultado: SegmentSummary | null;
  arquivo_storage_path: string | null;
  rateio_id: string | null;
}

const SEG_LABELS: Record<string, string> = {
  AUTOMOVEIS:   "Automóveis",
  CAMINHOES:    "Caminhões",
  PESADOS:      "Pesados",
  MOTOS:        "Motos",
  MOTOCICLETAS: "Motocicletas",
  MAQUINAS:     "Máquinas",
  TRATORES:     "Tratores",
  SERVICOS:     "Serviços",
};

/** Mapeamento de nomes do banco para nomes internos do tipo Segmento */
const DB_SEG_TO_CODE: Record<string, string> = {
  PESADOS:      "CAMINHOES",
  MOTOCICLETAS: "MOTOS",
};

function formatMes(d: string) {
  return new Date(d + "T12:00:00").toLocaleDateString("pt-BR", {
    month: "long", year: "numeric",
  });
}

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------

function DivisaoPage() {
  // ── Estado principal ──────────────────────────────────────────────────────
  const [processos, setProcessos] = useState<ProcessoRow[]>([]);
  const [loadingProcessos, setLoadingProcessos] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [toDelete, setToDelete]     = useState<ProcessoRow | null>(null);
  const [deleting, setDeleting]     = useState(false);

  // Config maps (carregadas do banco)
  const [configMaps, setConfigMaps] = useState<SegmentConfigMaps>(DEFAULT_SEGMENT_CONFIG_MAPS);

  // Dialog de confirmação de método
  const [showMethodDialog, setShowMethodDialog] = useState(false);

  // Formulário
  const [mes, setMes] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [pcvInicio, setPcvInicio] = useState("");
  const [pcvFim, setPcvFim] = useState("");
  const [file, setFile]   = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Resultado do parse
  const [parsed,  setParsed]  = useState<ParseResult  | null>(null);
  const [summary, setSummary] = useState<SegmentSummary | null>(null);
  const [parsing, setParsing] = useState(false);
  const [saving,  setSaving]  = useState(false);

  // Dados de suporte (empresas + mapas de PCV/gestores)
  const [allCompanies, setAllCompanies] = useState<
    Array<{ cnpj_normalizado: string | null; bandeira: string | null }>
  >([]);
  const [pcvMap,      setPcvMap]      = useState<Map<string, string>>(new Map());
  const [gestoresMap, setGestoresMap] = useState<Map<string, string>>(new Map());

  // ── Carga inicial ─────────────────────────────────────────────────────────
  useEffect(() => {
    Promise.all([
      supabase.from("processos_serasa").select("*").order("mes_referencia", { ascending: false }),
      supabase.from("companies").select("cnpj_normalizado, bandeira"),
      supabase.from("pcv_usuarios").select("user_id, segmento").eq("ativo", true),
      supabase.from("gestores_logon").select("logon, segmento").eq("ativo", true),
      supabase.from("rateio_config_segmentos").select("tipo, segmento, qtd_cnpj"),
    ]).then(([{ data: ps }, { data: cos }, { data: pcvs }, { data: gests }, { data: configs }]) => {
      setProcessos((ps ?? []) as ProcessoRow[]);
      setAllCompanies(cos ?? []);

      const pm = new Map<string, string>();
      for (const u of pcvs ?? []) pm.set(u.user_id.toUpperCase().trim(), u.segmento);
      setPcvMap(pm);

      const gm = new Map<string, string>();
      for (const g of gests ?? [])
        gm.set(
          g.logon.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim(),
          g.segmento,
        );
      setGestoresMap(gm);

      // Constrói os mapas de configuração a partir do banco
      const monMap = new Map<string, number>();
      const pcfMap = new Map<string, number>();
      for (const row of configs ?? []) {
        const codeSeg = DB_SEG_TO_CODE[row.segmento] ?? row.segmento;
        if (row.tipo === "MONITORAMENTO") monMap.set(codeSeg, row.qtd_cnpj);
        else if (row.tipo === "PC_FIXO")  pcfMap.set(codeSeg, row.qtd_cnpj);
      }
      // Usa defaults se banco vazio
      if (monMap.size === 0) DEFAULT_SEGMENT_CONFIG_MAPS.monitoramento.forEach((v, k) => monMap.set(k, v));
      if (pcfMap.size === 0) DEFAULT_SEGMENT_CONFIG_MAPS.pcFixo.forEach((v, k) => pcfMap.set(k, v));
      setConfigMaps({ monitoramento: monMap, pcFixo: pcfMap });

      setLoadingProcessos(false);
    });
  }, []);

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFile(e.target.files?.[0] ?? null);
    setParsed(null);
    setSummary(null);
  };

  const handleParse = async () => {
    if (!file) return toast.error("Selecione o arquivo");
    if (!mes)  return toast.error("Selecione o mês de referência");
    setParsing(true);
    try {
      const buf = await file.arrayBuffer();
      const result = parseRateioWorkbook(buf, pcvMap, undefined, gestoresMap);
      setParsed(result);
      if (result.warnings.length) {
        result.warnings.forEach((w) => toast.warning(w));
      }
      toast.success("Arquivo processado!");
      setShowMethodDialog(true);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Erro ao processar arquivo");
    } finally {
      setParsing(false);
    }
  };

  const handleConfirmMethods = () => {
    if (!parsed) return;
    setSummary(computeSegmentos(parsed, allCompanies, configMaps));
    setShowMethodDialog(false);
  };

  const handleConfirm = async () => {
    if (!summary || !parsed) return;
    if (!pcvInicio || !pcvFim) return toast.error("Informe o período do Power Curve Variável");

    setSaving(true);
    try {
      const mesDate = mes + "-01";

      // Percentuais de AUTOMÓVEIS (para colunas legadas no banco)
      const totalMon = Array.from(configMaps.monitoramento.values()).reduce((a, b) => a + b, 0);
      const pctConsMin = totalMon > 0
        ? ((configMaps.monitoramento.get("AUTOMOVEIS") ?? 0) / totalMon) * 100
        : 56;
      const totalPcf = Array.from(configMaps.pcFixo.values()).reduce((a, b) => a + b, 0);
      const pctPcFixo = totalPcf > 0
        ? ((configMaps.pcFixo.get("AUTOMOVEIS") ?? 0) / totalPcf) * 100
        : 66.7;

      // Salva o arquivo no Storage para que a Etapa 2 não precise re-upload
      let storagePath: string | null = null;
      if (file) {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const path = `${user.id}/etapa1-${mesDate}.xlsx`;
          const { error: upErr } = await supabase.storage
            .from("rateio-uploads")
            .upload(path, file, { upsert: true });
          if (upErr) {
            console.warn("Falha ao guardar arquivo no Storage:", upErr.message);
          } else {
            storagePath = path;
          }
        }
      }

      const { error } = await supabase
        .from("processos_serasa")
        .upsert(
          {
            mes_referencia:        mesDate,
            etapa1_status:         "concluida",
            etapa1_resultado:      summary as unknown as import("@/integrations/supabase/types").Json,
            etapa1_pcv_inicio:     pcvInicio,
            etapa1_pcv_fim:        pcvFim,
            etapa1_pct_cons_min:   pctConsMin,
            etapa1_pct_pc_fixo:    pctPcFixo,
            etapa1_concluida_em:   new Date().toISOString(),
            arquivo_storage_path:  storagePath,
          },
          { onConflict: "mes_referencia" },
        );
      if (error) throw error;

      toast.success("Etapa 1 concluída! O Financeiro Auto já pode fazer a distribuição.");
      // Recarrega lista
      const { data } = await supabase
        .from("processos_serasa")
        .select("*")
        .order("mes_referencia", { ascending: false });
      setProcessos((data ?? []) as ProcessoRow[]);
      // Reset form
      setParsed(null);
      setSummary(null);
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteProcesso = async () => {
    if (!toDelete) return;
    setDeleting(true);
    try {
      if (toDelete.arquivo_storage_path) {
        await supabase.storage
          .from("rateio-uploads")
          .remove([toDelete.arquivo_storage_path]);
      }
      const { error } = await supabase
        .from("processos_serasa")
        .delete()
        .eq("id", toDelete.id);
      if (error) throw error;
      setProcessos((prev) => prev.filter((p) => p.id !== toDelete.id));
      if (expandedId === toDelete.id) setExpandedId(null);
      toast.success("Divisão excluída");
      setToDelete(null);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Erro ao excluir");
    } finally {
      setDeleting(false);
    }
  };

  const processoDoMes = processos.find(
    (p) => p.mes_referencia.slice(0, 7) === mes,
  );
  const jaConcluido = processoDoMes?.etapa1_status === "concluida";

  // Totais ADM para o dialog
  const admDialogTotal = parsed
    ? Object.values(parsed.admRateadoPorSegmento ?? {})
        .reduce((a, b) => a + (b as number), 0)
    : 0;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-3xl font-bold">1. Divisão por Segmentos</h1>
        <p className="text-muted-foreground">
          Área de Processos · calcula a parcela de cada segmento na fatura Serasa
        </p>
      </div>

      {/* ── Histórico de processos ── */}
      {!loadingProcessos && processos.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <History className="h-4 w-4" /> Histórico
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mês</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Período PCV</TableHead>
                  <TableHead className="text-right">Etapa 2</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {processos.map((p) => {
                  const isExpanded = expandedId === p.id;
                  const res = p.etapa1_resultado;
                  const canExpand = p.etapa1_status === "concluida" && !!res;
                  return (
                    <React.Fragment key={p.id}>
                      <TableRow
                        className={canExpand ? "cursor-pointer hover:bg-muted/50" : ""}
                        onClick={() => canExpand && setExpandedId(isExpanded ? null : p.id)}
                      >
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-1.5">
                            {canExpand ? (
                              isExpanded
                                ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                                : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                            ) : (
                              <span className="w-3.5" />
                            )}
                            {formatMes(p.mes_referencia)}
                          </div>
                        </TableCell>
                        <TableCell>
                          {p.etapa1_status === "concluida" ? (
                            <Badge variant="default" className="gap-1">
                              <CheckCircle2 className="h-3 w-3" /> Concluída
                            </Badge>
                          ) : (
                            <Badge variant="secondary">Pendente</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {p.etapa1_pcv_inicio && p.etapa1_pcv_fim
                            ? `${new Date(p.etapa1_pcv_inicio + "T12:00:00").toLocaleDateString("pt-BR")} até ${new Date(p.etapa1_pcv_fim + "T12:00:00").toLocaleDateString("pt-BR")}`
                            : "—"}
                        </TableCell>
                        <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                          {p.rateio_id ? (
                            <Link to="/rateios/$id" params={{ id: p.rateio_id }}>
                              <Badge variant="outline">Ver distribuição</Badge>
                            </Link>
                          ) : p.etapa1_status === "concluida" ? (
                            <Link to="/rateios">
                              <Badge variant="outline" className="text-primary border-primary">
                                Aguardando Financeiro
                              </Badge>
                            </Link>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            onClick={() => setToDelete(p)}
                            aria-label="Excluir divisão"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>

                      {/* ── Detalhe expandido ── */}
                      {isExpanded && res && (
                        <TableRow className="bg-muted/30 hover:bg-muted/30">
                          <TableCell colSpan={5} className="p-0">
                            <div className="px-6 py-4 space-y-3">
                              {/* Totais do grupo */}
                              <div className="grid grid-cols-5 gap-2">
                                {([
                                  ["Consumo Mínimo", res.grupo.consumo_minimo],
                                  ["PC Fixo",        res.grupo.pc_fixo],
                                  ["PC Adicional",   res.grupo.pc_adicional],
                                  ["F&I",            res.grupo.fi],
                                  ["ADM Avulsas",    res.grupo.adm],
                                ] as [string, number][]).map(([label, val]) => (
                                  <div key={label} className="rounded border bg-background p-2.5">
                                    <p className="text-[10px] text-muted-foreground">{label}</p>
                                    <p className="text-sm font-semibold mt-0.5">{brl(val)}</p>
                                  </div>
                                ))}
                              </div>

                              {/* Tabela por segmento */}
                              <Table>
                                <TableHeader>
                                  <TableRow className="text-xs">
                                    <TableHead>Segmento</TableHead>
                                    <TableHead className="text-right">Cons. Mín.</TableHead>
                                    <TableHead className="text-right">PC Fixo</TableHead>
                                    <TableHead className="text-right">PC Adicional</TableHead>
                                    <TableHead className="text-right">F&I</TableHead>
                                    <TableHead className="text-right">ADM</TableHead>
                                    <TableHead className="text-right font-bold">Total</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {(Object.entries(res.segmentos) as [string, import("@/lib/compute-segmentos").SegmentoValores | undefined][])
                                    .sort(([a], [b]) => a.localeCompare(b))
                                    .map(([seg, v]) => {
                                      if (!v) return null;
                                      return (
                                        <TableRow key={seg} className="text-xs">
                                          <TableCell className="font-medium py-1.5">
                                            {SEG_LABELS[seg] ?? seg}
                                          </TableCell>
                                          <TableCell className="text-right py-1.5">{brl(v.consumo_minimo)}</TableCell>
                                          <TableCell className="text-right py-1.5">{brl(v.pc_fixo)}</TableCell>
                                          <TableCell className="text-right py-1.5">{brl(v.pc_adicional)}</TableCell>
                                          <TableCell className="text-right py-1.5">{brl(v.fi_novos + v.fi_seminovos)}</TableCell>
                                          <TableCell className="text-right py-1.5">{brl(v.adm)}</TableCell>
                                          <TableCell className="text-right py-1.5 font-semibold">{brl(v.total)}</TableCell>
                                        </TableRow>
                                      );
                                    })}
                                </TableBody>
                                <TableFooter>
                                  <TableRow className="text-xs">
                                    <TableCell className="font-bold py-1.5">TOTAL</TableCell>
                                    <TableCell className="text-right py-1.5">{brl(res.grupo.consumo_minimo)}</TableCell>
                                    <TableCell className="text-right py-1.5">{brl(res.grupo.pc_fixo)}</TableCell>
                                    <TableCell className="text-right py-1.5">{brl(res.grupo.pc_adicional)}</TableCell>
                                    <TableCell className="text-right py-1.5">{brl(res.grupo.fi)}</TableCell>
                                    <TableCell className="text-right py-1.5">{brl(res.grupo.adm)}</TableCell>
                                    <TableCell className="text-right py-1.5 font-bold">{brl(res.grupo.total)}</TableCell>
                                  </TableRow>
                                </TableFooter>
                              </Table>

                              {/* Percentuais usados */}
                              <p className="text-[10px] text-muted-foreground">
                                % Automóveis aplicados — Consumo Mínimo: {(res.pct_consumo_minimo ?? p.etapa1_pct_cons_min).toFixed(2)}% · PC Fixo: {(res.pct_pc_fixo ?? p.etapa1_pct_pc_fixo).toFixed(2)}%
                              </p>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </React.Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* ── Formulário ── */}
      <Card>
        <CardHeader>
          <CardTitle>Nova divisão</CardTitle>
          <CardDescription>
            Selecione o mês, informe o período do Power Curve Variável e envie o
            arquivo Serasa.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Mês */}
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label>Mês de referência</Label>
              <Input
                type="month"
                value={mes}
                onChange={(e) => {
                  setMes(e.target.value);
                  setParsed(null);
                  setSummary(null);
                }}
              />
              {jaConcluido && (
                <p className="text-xs text-amber-600 font-medium">
                  ⚠ Já existe uma divisão concluída para este mês. Confirmar irá
                  substituí-la.
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Início do período PCV</Label>
              <Input
                type="date"
                value={pcvInicio}
                onChange={(e) => setPcvInicio(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Fim do período PCV</Label>
              <Input
                type="date"
                value={pcvFim}
                onChange={(e) => setPcvFim(e.target.value)}
              />
            </div>
          </div>

          {/* Upload */}
          <div className="space-y-1.5">
            <Label>Arquivo Serasa (.xlsx)</Label>
            <div
              className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:border-primary transition-colors"
              onClick={() => fileRef.current?.click()}
            >
              <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
              {file ? (
                <p className="text-sm font-medium">{file.name}</p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Clique para selecionar o arquivo
                </p>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={handleFile}
            />
          </div>

          <Button onClick={handleParse} disabled={!file || parsing} className="w-full">
            {parsing ? "Processando…" : "Processar arquivo"}
          </Button>
        </CardContent>
      </Card>

      {/* ── Resultado ── */}
      {summary && parsed && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Valores do Grupo</CardTitle>
              <CardDescription>Totais da fatura Serasa antes da divisão</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-5 gap-3">
                {[
                  ["Consumo Mínimo", summary.grupo.consumo_minimo],
                  ["PC Fixo",        summary.grupo.pc_fixo],
                  ["PC Adicional",   summary.grupo.pc_adicional],
                  ["F&I",            summary.grupo.fi],
                  ["ADM Avulsas",    summary.grupo.adm],
                ].map(([label, val]) => (
                  <div key={label as string} className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">{label as string}</p>
                    <p className="text-base font-semibold mt-0.5">{brl(val as number)}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Divisão por Segmento</CardTitle>
              <CardDescription>
                Consumo Mínimo e PC Fixo distribuídos pelo nº de CNPJs de cada segmento.
                PC Adicional pela proporção PCV. F&I pela proporção Intranet. ADM direto do Demonstrativo.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Segmento</TableHead>
                    <TableHead className="text-right">Cons. Mín.</TableHead>
                    <TableHead className="text-right">PC Fixo</TableHead>
                    <TableHead className="text-right">PC Adicional</TableHead>
                    <TableHead className="text-right">F&I</TableHead>
                    <TableHead className="text-right">ADM Avulsas</TableHead>
                    <TableHead className="text-right font-bold">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(Object.entries(summary.segmentos) as [string, (typeof summary.segmentos)[keyof typeof summary.segmentos]][])
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([seg, v]) => {
                      if (!v) return null;
                      return (
                        <TableRow key={seg}>
                          <TableCell className="font-medium">
                            {SEG_LABELS[seg] ?? seg}
                          </TableCell>
                          <TableCell className="text-right text-sm">{brl(v.consumo_minimo)}</TableCell>
                          <TableCell className="text-right text-sm">{brl(v.pc_fixo)}</TableCell>
                          <TableCell className="text-right text-sm">{brl(v.pc_adicional)}</TableCell>
                          <TableCell className="text-right text-sm">
                            {brl(v.fi_novos + v.fi_seminovos)}
                          </TableCell>
                          <TableCell className="text-right text-sm">{brl(v.adm)}</TableCell>
                          <TableCell className="text-right font-semibold">{brl(v.total)}</TableCell>
                        </TableRow>
                      );
                    })}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell className="font-bold">TOTAL</TableCell>
                    <TableCell className="text-right">{brl(summary.grupo.consumo_minimo)}</TableCell>
                    <TableCell className="text-right">{brl(summary.grupo.pc_fixo)}</TableCell>
                    <TableCell className="text-right">{brl(summary.grupo.pc_adicional)}</TableCell>
                    <TableCell className="text-right">{brl(summary.grupo.fi)}</TableCell>
                    <TableCell className="text-right">{brl(summary.grupo.adm)}</TableCell>
                    <TableCell className="text-right font-bold">{brl(summary.grupo.total)}</TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </CardContent>
          </Card>

          <div className="flex justify-end gap-3">
            <Button
              variant="outline"
              onClick={() => { setParsed(null); setSummary(null); setFile(null); if (fileRef.current) fileRef.current.value = ""; }}
            >
              Recomeçar
            </Button>
            <Button onClick={handleConfirm} disabled={saving}>
              <CheckCircle2 className="h-4 w-4" />
              {saving ? "Salvando…" : "Confirmar Etapa 1"}
            </Button>
          </div>
        </>
      )}

      {/* ── Dialog de confirmação do método de alocação ── */}
      <Dialog open={showMethodDialog} onOpenChange={(o) => !o && setShowMethodDialog(false)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              Confirmar método de alocação — {formatMes(mes)}
            </DialogTitle>
            <DialogDescription>
              Revise como cada componente da fatura será distribuído entre os segmentos antes de calcular.
            </DialogDescription>
          </DialogHeader>

          {parsed && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Componente</TableHead>
                  <TableHead className="text-right">Valor Grupo</TableHead>
                  <TableHead>Método de Distribuição</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[
                  {
                    label:  "Consumo Mínimo",
                    value:  parsed.consumoMinimoGrupo,
                    method: "Proporcional ao nº de CNPJs (Tabela Monitoramento)",
                  },
                  {
                    label:  "PC Fixo",
                    value:  parsed.pcFixoGrupo,
                    method: "Proporcional ao nº de CNPJs (Tabela PC Fixo)",
                  },
                  {
                    label:  "PC Adicional",
                    value:  parsed.pcAdicionalGrupo,
                    method: "Proporcional às consultas Power Curve Variável",
                  },
                  {
                    label:  "F&I (Novos + Seminovos)",
                    value:  parsed.fiGrupo,
                    method: "Proporcional às consultas Intranet",
                  },
                  {
                    label:  "ADM Avulsas",
                    value:  admDialogTotal,
                    method: "Direto do Demonstrativo (por gestor/segmento)",
                  },
                ].map(({ label, value, method }) => (
                  <TableRow key={label}>
                    <TableCell className="font-medium">{label}</TableCell>
                    <TableCell className="text-right font-mono text-sm">{brl(value)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{method}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowMethodDialog(false)}>
              Cancelar
            </Button>
            <Button onClick={handleConfirmMethods}>
              <CheckCircle2 className="h-4 w-4" />
              Confirmar e calcular
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Confirmar exclusão de processo ── */}
      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && !deleting && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir divisão por segmentos</AlertDialogTitle>
            <AlertDialogDescription>
              {toDelete && (
                <>
                  Excluir a divisão de <strong>{formatMes(toDelete.mes_referencia)}</strong>?
                  {toDelete.rateio_id && (
                    <span className="block mt-2 text-amber-700">
                      ⚠ Este mês já tem um rateio gerado pelo Financeiro. A divisão será removida,
                      mas o rateio continuará existindo.
                    </span>
                  )}
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={(e) => { e.preventDefault(); handleDeleteProcesso(); }}
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
