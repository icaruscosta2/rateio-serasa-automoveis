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
import { Badge } from "@/components/ui/badge";
import { Upload, CheckCircle2, History, ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { parseRateioWorkbook, type ParseResult } from "@/lib/parse-rateio";
import {
  computeSegmentos,
  DEFAULT_SEGMENT_CONFIG,
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
  rateio_id: string | null;
}

const SEG_LABELS: Record<string, string> = {
  AUTOMOVEIS:  "Automóveis",
  CAMINHOES:   "Caminhões",
  MOTOS:       "Motos",
  MAQUINAS:    "Máquinas",
  TRATORES:    "Tratores",
  SERVICOS:    "Serviços",
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

  // Formulário
  const [mes, setMes] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [pcvInicio, setPcvInicio] = useState("");
  const [pcvFim, setPcvFim] = useState("");
  const [file, setFile]   = useState<File | null>(null);
  const [pctConsMin, setPctConsMin] = useState(56);
  const [pctPcFixo,  setPctPcFixo]  = useState(66.7);
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
    ]).then(([{ data: ps }, { data: cos }, { data: pcvs }, { data: gests }]) => {
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
      setLoadingProcessos(false);
    });
  }, []);

  // Recalcula resumo ao mudar os percentuais (sem re-parsear o arquivo)
  useEffect(() => {
    if (!parsed) return;
    setSummary(
      computeSegmentos(parsed, allCompanies, {
        pctConsMin,
        pctPcFixo,
      }),
    );
  }, [parsed, allCompanies, pctConsMin, pctPcFixo]);

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
      // parseRateioWorkbook: (buffer, pcvUsuariosPf, empresas, gestoresLogon)
      const result = parseRateioWorkbook(buf, pcvMap, undefined, gestoresMap);
      setParsed(result);
      setSummary(computeSegmentos(result, allCompanies, { pctConsMin, pctPcFixo }));
      if (result.warnings.length) {
        result.warnings.forEach((w) => toast.warning(w));
      }
      toast.success("Arquivo processado!");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Erro ao processar arquivo");
    } finally {
      setParsing(false);
    }
  };

  const handleConfirm = async () => {
    if (!summary || !parsed) return;
    if (!pcvInicio || !pcvFim) return toast.error("Informe o período do Power Curve Variável");

    setSaving(true);
    try {
      const mesDate = mes + "-01"; // date no banco

      // Salva o arquivo no Storage para que a Etapa 2 não precise re-upload
      let storagePath: string | null = null;
      if (file) {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const path = `processos/${user.id}/${mesDate}.xlsx`;
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

  const processoDoMes = processos.find(
    (p) => p.mes_referencia.slice(0, 7) === mes,
  );
  const jaConcluido = processoDoMes?.etapa1_status === "concluida";

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
                      </TableRow>

                      {/* ── Detalhe expandido ── */}
                      {isExpanded && res && (
                        <TableRow className="bg-muted/30 hover:bg-muted/30">
                          <TableCell colSpan={4} className="p-0">
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
                                Percentuais aplicados — Consumo Mínimo: {res.pct_consumo_minimo ?? p.etapa1_pct_cons_min}% · PC Fixo: {res.pct_pc_fixo ?? p.etapa1_pct_pc_fixo}%
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

          {/* Percentuais fixos */}
          <div className="grid grid-cols-2 gap-4 p-4 rounded-lg bg-muted/50">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                % Consumo Mínimo → Automóveis
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  step="0.1"
                  min="0"
                  max="100"
                  value={pctConsMin}
                  onChange={(e) => setPctConsMin(Number(e.target.value))}
                  className="w-24"
                />
                <span className="text-sm text-muted-foreground">%</span>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                % PC Fixo → Automóveis
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  step="0.1"
                  min="0"
                  max="100"
                  value={pctPcFixo}
                  onChange={(e) => setPctPcFixo(Number(e.target.value))}
                  className="w-24"
                />
                <span className="text-sm text-muted-foreground">%</span>
              </div>
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
                Consumo Mínimo e PC Fixo calculados pelo percentual configurado.
                PC Adicional pela proporção PCV. F&I e ADM pela proporção Intranet/Demonstrativo.
                Outros segmentos (Caminhões, Motos, etc.) terão regras específicas em breve.
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
    </div>
  );
}
