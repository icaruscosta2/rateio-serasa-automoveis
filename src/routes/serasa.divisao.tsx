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
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
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
  CAMINHOES:    "Pesados",
  PESADOS:      "Pesados",
  MOTOCICLETAS: "Motocicletas",
  MAQUINAS:     "Máquinas",
  TRATORES:     "Tratores",
  SERVICOS:     "Serviços",
};

/** Mapeamento de nomes do banco para nomes internos do tipo Segmento */
const DB_SEG_TO_CODE: Record<string, string> = {
  PESADOS: "CAMINHOES",
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

  // Dialog 1: confirmação de método
  const [showMethodDialog, setShowMethodDialog] = useState(false);
  const [visibleTable, setVisibleTable] = useState<"MONITORAMENTO" | "PC_FIXO" | "PCV_USUARIOS" | "GESTORES_ADM" | null>(null);

  // Dialog 2: alocação de usuários Consulta PF
  const [showPcvDialog, setShowPcvDialog] = useState(false);
  const [pcvOverrides, setPcvOverrides] = useState<Record<string, string>>({});

  // pcv_usuarios table (para "ver tabela" no dialog 1)
  const [pcvUsuariosTable, setPcvUsuariosTable] = useState<Array<{ user_id: string; segmento: string }>>([]);
  // gestores_logon table (para "ver tabela" ADM no dialog 1)
  const [gestoresList, setGestoresList] = useState<Array<{ logon: string; segmento: string }>>([]);

  // Formulário
  const [mes, setMes] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [pcvInicio, setPcvInicio] = useState("");
  const [pcvFim, setPcvFim] = useState("");
  const [file, setFile]         = useState<File | null>(null);
  const [fileNegat, setFileNegat] = useState<File | null>(null);
  const fileRef      = useRef<HTMLInputElement>(null);
  const fileNegatRef = useRef<HTMLInputElement>(null);

  // Resultado do parse
  const [parsed,  setParsed]  = useState<ParseResult  | null>(null);
  const [summary, setSummary] = useState<SegmentSummary | null>(null);
  const [parsing, setParsing] = useState(false);
  const [saving,  setSaving]  = useState(false);
  const [negatValorTotal, setNegatValorTotal] = useState<number>(0);

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
      for (const u of pcvs ?? []) pm.set(u.user_id.toLowerCase().trim(), u.segmento);
      setPcvMap(pm);
      // Tabela completa para exibição no dialog
      setPcvUsuariosTable(
        (pcvs ?? []).map((u) => ({ user_id: u.user_id, segmento: u.segmento })),
      );

      const gm = new Map<string, string>();
      for (const g of gests ?? [])
        gm.set(
          g.logon.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim(),
          g.segmento,
        );
      setGestoresMap(gm);
      setGestoresList((gests ?? []).map((g) => ({ logon: g.logon, segmento: g.segmento })));

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
    setPcvOverrides({});
  };

  const handleFileNegat = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFileNegat(e.target.files?.[0] ?? null);
    // Não reseta o parsed/summary — o usuário pode subir os dois arquivos em ordens diferentes
    // e clicar em "Processar" quando ambos estiverem prontos.
  };

  const handleParse = async () => {
    if (!file) return toast.error("Selecione o arquivo NF Power Curve");
    if (!mes)  return toast.error("Selecione o mês de referência");
    setParsing(true);
    try {
      const buf = await file.arrayBuffer();
      const result = parseRateioWorkbook(buf, pcvMap, undefined, gestoresMap);

      // Se um arquivo separado de Negativações foi informado, extrai os CNPJs dele
      if (fileNegat) {
        try {
          const bufNegat = await fileNegat.arrayBuffer();
          const negatResult = parseRateioWorkbook(bufNegat);
          // Mescla negativações do arquivo separado (prioridade) com eventuais do arquivo principal
          for (const [cnpj, count] of negatResult.negativacoesPorCnpj) {
            result.negativacoesPorCnpj.set(cnpj, (result.negativacoesPorCnpj.get(cnpj) ?? 0) + count);
          }
          if (negatResult.hasNegativacoes) result.hasNegativacoes = true;
        } catch {
          toast.warning("Não foi possível ler o arquivo de Negativações — verifique o formato.");
        }
      }

      setParsed(result);
      if (result.warnings.length) {
        result.warnings.forEach((w) => toast.warning(w));
      }
      toast.success("Arquivo(s) processado(s)!");
      setShowMethodDialog(true);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Erro ao processar arquivo");
    } finally {
      setParsing(false);
    }
  };

  /** Constrói mapa PCV ajustado: linhas diretas + Consulta PF com overrides aplicados */
  const buildAdjustedPcvMap = (overrides: Record<string, string>): Map<string, number> => {
    if (!parsed) return new Map();
    const map = new Map(parsed.pcVariavelLinhasDiretas);
    for (const { user_id, segmento, count } of parsed.pcvConsultaPfUsers) {
      const effectiveSeg = overrides[user_id] ?? segmento;
      if (effectiveSeg) {
        map.set(effectiveSeg, (map.get(effectiveSeg) ?? 0) + count);
      }
    }
    return map;
  };

  const handleConfirmMethods = () => {
    if (!parsed) return;
    setShowMethodDialog(false);
    setVisibleTable(null);
    // Se há usuários de Consulta PF, abre o Dialog 2 para classificação
    if (parsed.pcvConsultaPfUsers.length > 0) {
      setShowPcvDialog(true);
    } else {
      // Sem Consulta PF — calcula direto
      setSummary(computeSegmentos(parsed, allCompanies, configMaps, buildAdjustedPcvMap({}), negatValorTotal));
    }
  };

  const handleConfirmPcvUsers = () => {
    if (!parsed) return;
    setSummary(computeSegmentos(parsed, allCompanies, configMaps, buildAdjustedPcvMap(pcvOverrides), negatValorTotal));
    setShowPcvDialog(false);
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

      // Enriquece o resultado com dados de negat + todos os dados do parse antes de salvar
      const resultadoComNegat = {
        ...summary,
        negat_valor_total: negatValorTotal,
        has_negativacoes: parsed.hasNegativacoes,
        negat_por_segmento: Object.fromEntries(
          Object.entries(summary.segmentos ?? {}).map(([seg, v]) => [seg, v?.negat ?? 0])
        ),
        // Guarda contagem por CNPJ para que a Etapa 2 distribua sem precisar re-subir o arquivo
        negat_por_cnpj: Object.fromEntries(parsed.negativacoesPorCnpj),
        // Dados completos do parse para que a Etapa 2 não precise re-baixar nenhum arquivo.
        // O Financeiro só precisa enviar o arquivo com a aba ÚNICO AUTO.
        parse_data: {
          consumoMinimoGrupo:          parsed.consumoMinimoGrupo,
          pcFixoGrupo:                 parsed.pcFixoGrupo,
          pcAdicionalGrupo:            parsed.pcAdicionalGrupo,
          fiGrupo:                     parsed.fiGrupo,
          admRateadoGrupo:             parsed.admRateadoGrupo,
          admRateadoPorSegmento:       parsed.admRateadoPorSegmento,
          admLogonsPorSegmento:        parsed.admLogonsPorSegmento,
          demoTotalLogonPcCredito:     parsed.demoTotalLogonPcCredito,
          demoFiPefinPf:               parsed.demoFiPefinPf,
          demoFiPefinPj:               parsed.demoFiPefinPj,
          demoOutrosUsuariosNaoSomado: parsed.demoOutrosUsuariosNaoSomado,
          demoFiPefinPfPorLogon:       parsed.demoFiPefinPfPorLogon,
          demoFiPefinPjPorLogon:       parsed.demoFiPefinPjPorLogon,
          intranetPorCnpj:             Object.fromEntries(parsed.intranetPorCnpj),
          intranetNovosPorCnpj:        Object.fromEntries(parsed.intranetNovosPorCnpj),
          intranetSeminovosPorCnpj:    Object.fromEntries(parsed.intranetSeminovosPorCnpj),
          pcVariavelTotalLinhas:       parsed.pcVariavelTotalLinhas,
          pcVariavelLinhasDiretas:     Object.fromEntries(parsed.pcVariavelLinhasDiretas),
          pcVariavelLinhasPorSegmento: Object.fromEntries(parsed.pcVariavelLinhasPorSegmento),
          pcVariavelLinhasAuto:        parsed.pcVariavelLinhasAuto,
          pcvConsultaPfUsers:          parsed.pcvConsultaPfUsers,
          pcvUsuariosDesconhecidos:    parsed.pcvUsuariosDesconhecidos,
          admLogonsDesconhecidos:      parsed.admLogonsDesconhecidos,
          negativacoesPorCnpj:         Object.fromEntries(parsed.negativacoesPorCnpj),
          hasNegativacoes:             parsed.hasNegativacoes,
          abasEncontradas:             parsed.abasEncontradas,
          abasFaltando:                parsed.abasFaltando,
          warnings:                    parsed.warnings,
        },
      };

      const { error } = await supabase
        .from("processos_serasa")
        .upsert(
          {
            mes_referencia:        mesDate,
            etapa1_status:         "concluida",
            etapa1_resultado:      resultadoComNegat as unknown as import("@/integrations/supabase/types").Json,
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
      setFileNegat(null);
      setNegatValorTotal(0);
      if (fileRef.current)      fileRef.current.value = "";
      if (fileNegatRef.current) fileNegatRef.current.value = "";
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
                          {p.etapa1_status === "concluida" ? (() => {
                            const res = p.etapa1_resultado as unknown as {
                              has_negativacoes?: boolean;
                              negat_valor_total?: number;
                              negat_por_cnpj?: Record<string, number>;
                            } | null;
                            // NF PC verde = processo concluído (arquivo processado com sucesso)
                            const pcOk = true;
                            // NF Negat verde = tem dados de negativações salvos
                            const negatOk =
                              res?.has_negativacoes === true ||
                              (res?.negat_valor_total ?? 0) > 0 ||
                              Object.keys(res?.negat_por_cnpj ?? {}).length > 0;
                            return (
                              <div className="flex items-center gap-2.5">
                                <div className="flex flex-col items-center gap-0.5">
                                  <span className={`h-2.5 w-2.5 rounded-full ${pcOk ? "bg-green-500" : "bg-red-500"}`} />
                                  <span className="text-[9px] text-muted-foreground leading-none">PC</span>
                                </div>
                                <div className="flex flex-col items-center gap-0.5">
                                  <span className={`h-2.5 w-2.5 rounded-full ${negatOk ? "bg-green-500" : "bg-red-500"}`} />
                                  <span className="text-[9px] text-muted-foreground leading-none">Negat</span>
                                </div>
                              </div>
                            );
                          })() : (
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
                          ) : p.etapa1_status === "concluida" ? (() => {
                            const nr = p.etapa1_resultado as unknown as {
                              has_negativacoes?: boolean;
                              negat_valor_total?: number;
                              negat_por_cnpj?: Record<string, number>;
                            } | null;
                            const bothGreen =
                              nr?.has_negativacoes === true ||
                              (nr?.negat_valor_total ?? 0) > 0 ||
                              Object.keys(nr?.negat_por_cnpj ?? {}).length > 0;
                            return bothGreen ? (
                              <Link to="/rateios">
                                <Badge variant="outline" className="text-primary border-primary">
                                  Aguardando Financeiro
                                </Badge>
                              </Link>
                            ) : (
                              <Badge variant="outline" className="text-amber-600 border-amber-400">
                                Faltando NF Negativações
                              </Badge>
                            );
                          })() : (
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
                              <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
                                {([
                                  ["Consumo Mínimo", res.grupo.consumo_minimo],
                                  ["PC Fixo",        res.grupo.pc_fixo],
                                  ["PC Adicional",   res.grupo.pc_adicional],
                                  ["F&I",            res.grupo.fi],
                                  ["ADM Avulsas",    res.grupo.adm],
                                  ["NF Negativações",(res as unknown as {grupo: {negat?: number}}).grupo.negat ?? 0],
                                ] as [string, number][]).map(([label, val]) => (
                                  <div key={label} className="rounded border bg-background p-2.5">
                                    <p className="text-[10px] text-muted-foreground">{label}</p>
                                    <p className="text-sm font-semibold mt-0.5">{brl(val)}</p>
                                  </div>
                                ))}
                              </div>

                              {/* Tabela por segmento */}
                              {(() => {
                                const resEx = res as unknown as {
                                  grupo: typeof res.grupo & { negat?: number };
                                  segmentos: Record<string, (typeof res.segmentos)[keyof typeof res.segmentos] & { negat?: number }>;
                                };
                                const totalNFPc = res.grupo.total - (resEx.grupo.negat ?? 0);
                                const totalNegat = resEx.grupo.negat ?? 0;
                                return (
                                  <Table>
                                    <TableHeader>
                                      <TableRow className="text-xs">
                                        <TableHead>Segmento</TableHead>
                                        <TableHead className="text-right">Cons. Mín.</TableHead>
                                        <TableHead className="text-right">PC Fixo</TableHead>
                                        <TableHead className="text-right">PC Adicional</TableHead>
                                        <TableHead className="text-right">F&I</TableHead>
                                        <TableHead className="text-right">ADM</TableHead>
                                        <TableHead className="text-right">NF Negat.</TableHead>
                                        <TableHead className="text-right font-bold">Total</TableHead>
                                      </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                      {(Object.entries(resEx.segmentos) as [string, import("@/lib/compute-segmentos").SegmentoValores & { negat?: number } | undefined][])
                                        .sort(([a], [b]) => a.localeCompare(b))
                                        .map(([seg, v]) => {
                                          if (!v) return null;
                                          return (
                                            <TableRow key={seg} className="text-xs">
                                              <TableCell className="font-medium py-1.5">{SEG_LABELS[seg] ?? seg}</TableCell>
                                              <TableCell className="text-right py-1.5">{brl(v.consumo_minimo)}</TableCell>
                                              <TableCell className="text-right py-1.5">{brl(v.pc_fixo)}</TableCell>
                                              <TableCell className="text-right py-1.5">{brl(v.pc_adicional)}</TableCell>
                                              <TableCell className="text-right py-1.5">{brl(v.fi_novos + v.fi_seminovos)}</TableCell>
                                              <TableCell className="text-right py-1.5">{brl(v.adm)}</TableCell>
                                              <TableCell className="text-right py-1.5">{brl(v.negat ?? 0)}</TableCell>
                                              <TableCell className="text-right py-1.5 font-semibold">{brl(v.total)}</TableCell>
                                            </TableRow>
                                          );
                                        })}
                                    </TableBody>
                                    <TableFooter>
                                      <TableRow className="text-xs">
                                        <TableCell className="font-bold py-1.5 text-muted-foreground">Total NF Power Curve</TableCell>
                                        <TableCell className="text-right py-1.5">{brl(res.grupo.consumo_minimo)}</TableCell>
                                        <TableCell className="text-right py-1.5">{brl(res.grupo.pc_fixo)}</TableCell>
                                        <TableCell className="text-right py-1.5">{brl(res.grupo.pc_adicional)}</TableCell>
                                        <TableCell className="text-right py-1.5">{brl(res.grupo.fi)}</TableCell>
                                        <TableCell className="text-right py-1.5">{brl(res.grupo.adm)}</TableCell>
                                        <TableCell className="text-right py-1.5">—</TableCell>
                                        <TableCell className="text-right py-1.5 font-semibold">{brl(totalNFPc)}</TableCell>
                                      </TableRow>
                                      <TableRow className="text-xs">
                                        <TableCell className="font-bold py-1.5 text-muted-foreground">NF Negativações</TableCell>
                                        <TableCell colSpan={5} />
                                        <TableCell className="text-right py-1.5">{brl(totalNegat)}</TableCell>
                                        <TableCell className="text-right py-1.5 font-semibold">{brl(totalNegat)}</TableCell>
                                      </TableRow>
                                      <TableRow className="text-xs">
                                        <TableCell className="font-bold py-1.5">Total Geral</TableCell>
                                        <TableCell className="text-right py-1.5">{brl(res.grupo.consumo_minimo)}</TableCell>
                                        <TableCell className="text-right py-1.5">{brl(res.grupo.pc_fixo)}</TableCell>
                                        <TableCell className="text-right py-1.5">{brl(res.grupo.pc_adicional)}</TableCell>
                                        <TableCell className="text-right py-1.5">{brl(res.grupo.fi)}</TableCell>
                                        <TableCell className="text-right py-1.5">{brl(res.grupo.adm)}</TableCell>
                                        <TableCell className="text-right py-1.5">{brl(totalNegat)}</TableCell>
                                        <TableCell className="text-right py-1.5 font-bold">{brl(res.grupo.total)}</TableCell>
                                      </TableRow>
                                    </TableFooter>
                                  </Table>
                                );
                              })()}

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

          {/* Uploads — dois arquivos separados */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* NF Power Curve */}
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5">
                NF Power Curve
                <span className="text-destructive text-xs">*obrigatório</span>
              </Label>
              <div
                className={`border-2 border-dashed rounded-lg p-5 text-center cursor-pointer transition-colors ${
                  file ? "border-green-500 bg-green-50/40" : "hover:border-primary"
                }`}
                onClick={() => fileRef.current?.click()}
              >
                <Upload className={`h-6 w-6 mx-auto mb-1.5 ${file ? "text-green-600" : "text-muted-foreground"}`} />
                {file ? (
                  <p className="text-sm font-medium text-green-700 truncate px-1">{file.name}</p>
                ) : (
                  <p className="text-sm text-muted-foreground">Clique para selecionar</p>
                )}
              </div>
              <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFile} />
            </div>

            {/* NF Negativações */}
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5">
                NF Negativações
                <span className="text-muted-foreground font-normal text-xs">— opcional</span>
              </Label>
              <div
                className={`border-2 border-dashed rounded-lg p-5 text-center cursor-pointer transition-colors ${
                  fileNegat ? "border-green-500 bg-green-50/40" : "hover:border-primary"
                }`}
                onClick={() => fileNegatRef.current?.click()}
              >
                <Upload className={`h-6 w-6 mx-auto mb-1.5 ${fileNegat ? "text-green-600" : "text-muted-foreground"}`} />
                {fileNegat ? (
                  <p className="text-sm font-medium text-green-700 truncate px-1">{fileNegat.name}</p>
                ) : (
                  <p className="text-sm text-muted-foreground">Clique para selecionar</p>
                )}
              </div>
              <input ref={fileNegatRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFileNegat} />
              {fileNegat && (
                <p className="text-xs text-muted-foreground">
                  Os CNPJs da coluna DOCUMENTO CREDOR serão extraídos deste arquivo.
                </p>
              )}
            </div>
          </div>

          {/* Valor NF Negativações */}
          <div className="space-y-1.5">
            <Label>
              Valor NF Negativações (R$){" "}
              <span className="text-muted-foreground font-normal text-xs">— deixe 0 se não houver</span>
            </Label>
            <Input
              type="number"
              min={0}
              step={0.01}
              value={negatValorTotal || ""}
              placeholder="0,00"
              onChange={(e) => setNegatValorTotal(Math.max(0, parseFloat(e.target.value) || 0))}
              className="max-w-xs"
            />
            {parsed?.hasNegativacoes && (
              <p className="text-xs text-green-700 font-medium">
                ✓ {parsed.negativacoesPorCnpj.size} CNPJs com registros detectados
                {fileNegat ? " (arquivo separado)" : " (arquivo principal)"}.
              </p>
            )}
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
              <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
                {[
                  ["Consumo Mínimo", summary.grupo.consumo_minimo],
                  ["PC Fixo",        summary.grupo.pc_fixo],
                  ["PC Adicional",   summary.grupo.pc_adicional],
                  ["F&I",            summary.grupo.fi],
                  ["ADM Avulsas",    summary.grupo.adm],
                  ["NF Negativações",summary.grupo.negat],
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
                NF Negativações pela regra do PC Fixo (sem Serviços).
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
                    <TableHead className="text-right">NF Negat.</TableHead>
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
                          <TableCell className="text-right text-sm">{brl(v.negat)}</TableCell>
                          <TableCell className="text-right font-semibold">{brl(v.total)}</TableCell>
                        </TableRow>
                      );
                    })}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell className="font-bold text-muted-foreground">Total NF Power Curve</TableCell>
                    <TableCell className="text-right">{brl(summary.grupo.consumo_minimo)}</TableCell>
                    <TableCell className="text-right">{brl(summary.grupo.pc_fixo)}</TableCell>
                    <TableCell className="text-right">{brl(summary.grupo.pc_adicional)}</TableCell>
                    <TableCell className="text-right">{brl(summary.grupo.fi)}</TableCell>
                    <TableCell className="text-right">{brl(summary.grupo.adm)}</TableCell>
                    <TableCell className="text-right">—</TableCell>
                    <TableCell className="text-right font-semibold">{brl(summary.grupo.total - summary.grupo.negat)}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-bold text-muted-foreground">NF Negativações</TableCell>
                    <TableCell colSpan={5} />
                    <TableCell className="text-right">{brl(summary.grupo.negat)}</TableCell>
                    <TableCell className="text-right font-semibold">{brl(summary.grupo.negat)}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-bold">Total Geral</TableCell>
                    <TableCell className="text-right">{brl(summary.grupo.consumo_minimo)}</TableCell>
                    <TableCell className="text-right">{brl(summary.grupo.pc_fixo)}</TableCell>
                    <TableCell className="text-right">{brl(summary.grupo.pc_adicional)}</TableCell>
                    <TableCell className="text-right">{brl(summary.grupo.fi)}</TableCell>
                    <TableCell className="text-right">{brl(summary.grupo.adm)}</TableCell>
                    <TableCell className="text-right">{brl(summary.grupo.negat)}</TableCell>
                    <TableCell className="text-right font-bold">{brl(summary.grupo.total)}</TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </CardContent>
          </Card>

          <div className="flex justify-end gap-3">
            <Button
              variant="outline"
              onClick={() => { setParsed(null); setSummary(null); setFile(null); setFileNegat(null); setNegatValorTotal(0); if (fileRef.current) fileRef.current.value = ""; if (fileNegatRef.current) fileNegatRef.current.value = ""; }}
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
      <Dialog
        open={showMethodDialog}
        onOpenChange={(o) => { if (!o) { setShowMethodDialog(false); setVisibleTable(null); } }}
      >
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
            <div className="space-y-3">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Componente</TableHead>
                    <TableHead className="text-right">Valor Grupo</TableHead>
                    <TableHead>Método de Distribuição</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(
                    [
                      {
                        label:    "Consumo Mínimo",
                        value:    parsed.consumoMinimoGrupo,
                        method:   "Proporcional ao nº de matrizes (Tabela Monitoramento)",
                        tableKey: "MONITORAMENTO" as const,
                      },
                      {
                        label:    "PC Fixo",
                        value:    parsed.pcFixoGrupo,
                        method:   "Proporcional ao nº de matrizes (Tabela PC Fixo)",
                        tableKey: "PC_FIXO" as const,
                      },
                      {
                        label:    "PC Adicional",
                        value:    parsed.pcAdicionalGrupo,
                        method:   "Proporcional às consultas PC (por segmento via subproduto2)",
                        tableKey: "PCV_USUARIOS" as const,
                      },
                      {
                        label:    "F&I (Novos + Seminovos)",
                        value:    parsed.fiGrupo,
                        method:   "Proporcional às consultas Intranet",
                        tableKey: null,
                      },
                      {
                        label:    "ADM Avulsas",
                        value:    admDialogTotal,
                        method:   "Demonstrativo Serasa (por gestor/segmento)",
                        tableKey: "GESTORES_ADM" as const,
                      },
                      {
                        label:    "NF Negativações",
                        value:    negatValorTotal,
                        method:   "Proporcional ao nº de CNPJs — regra do PC Fixo, sem Serviços",
                        tableKey: null,
                      },
                    ] as { label: string; value: number; method: string; tableKey: "MONITORAMENTO" | "PC_FIXO" | "PCV_USUARIOS" | "GESTORES_ADM" | null }[]
                  ).map(({ label, value, method, tableKey }) => (
                    <TableRow key={label}>
                      <TableCell className="font-medium">{label}</TableCell>
                      <TableCell className="text-right font-mono text-sm">{brl(value)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        <div className="flex items-center justify-between gap-3">
                          <span>{method}</span>
                          {tableKey && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 px-2 text-xs shrink-0 text-primary hover:text-primary"
                              onClick={() =>
                                setVisibleTable((v) => (v === tableKey ? null : tableKey))
                              }
                            >
                              {visibleTable === tableKey ? "ocultar" : "ver tabela"}
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {/* Mini-tabela expansível */}
              {visibleTable && (
                <div className="border rounded-lg overflow-hidden">
                  <div className="px-3 py-2 bg-muted/50 border-b">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      {visibleTable === "MONITORAMENTO"
                        ? "Tabela Monitoramento"
                        : visibleTable === "PC_FIXO"
                        ? "Tabela PC Fixo"
                        : visibleTable === "GESTORES_ADM"
                        ? "Gestores ADM (cadastro)"
                        : "Usuários PC (cadastro)"}
                    </p>
                  </div>

                  {visibleTable === "GESTORES_ADM" ? (
                    <Table>
                      <TableHeader>
                        <TableRow className="text-xs">
                          <TableHead>Logon</TableHead>
                          <TableHead className="text-right">Segmento</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {gestoresList.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={2} className="text-xs text-center text-muted-foreground py-3">
                              Nenhum gestor cadastrado
                            </TableCell>
                          </TableRow>
                        ) : (
                          gestoresList
                            .sort((a, b) => a.logon.localeCompare(b.logon))
                            .map((g) => (
                              <TableRow key={g.logon} className="text-xs">
                                <TableCell className="py-1.5 font-mono">{g.logon}</TableCell>
                                <TableCell className="text-right py-1.5">
                                  {SEG_LABELS[g.segmento] ?? g.segmento}
                                </TableCell>
                              </TableRow>
                            ))
                        )}
                      </TableBody>
                    </Table>
                  ) : visibleTable === "PCV_USUARIOS" ? (
                    <Table>
                      <TableHeader>
                        <TableRow className="text-xs">
                          <TableHead>Usuário</TableHead>
                          <TableHead className="text-right">Segmento</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {pcvUsuariosTable.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={2} className="text-xs text-center text-muted-foreground py-3">
                              Nenhum usuário cadastrado
                            </TableCell>
                          </TableRow>
                        ) : (
                          pcvUsuariosTable
                            .sort((a, b) => a.user_id.localeCompare(b.user_id))
                            .map((u) => (
                              <TableRow key={u.user_id} className="text-xs">
                                <TableCell className="py-1.5 font-mono">{u.user_id}</TableCell>
                                <TableCell className="text-right py-1.5">
                                  {SEG_LABELS[u.segmento] ?? u.segmento}
                                </TableCell>
                              </TableRow>
                            ))
                        )}
                      </TableBody>
                    </Table>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow className="text-xs">
                          <TableHead>Segmento</TableHead>
                          <TableHead className="text-right w-32">Nº de Matrizes</TableHead>
                          <TableHead className="text-right w-20">%</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(() => {
                          const map =
                            visibleTable === "MONITORAMENTO"
                              ? configMaps.monitoramento
                              : configMaps.pcFixo;
                          const total = Array.from(map.values()).reduce((a, b) => a + b, 0);
                          return Array.from(map.entries())
                            .sort(([a], [b]) => a.localeCompare(b))
                            .map(([seg, qtd]) => (
                              <TableRow key={seg} className="text-xs">
                                <TableCell className="py-1.5">{SEG_LABELS[seg] ?? seg}</TableCell>
                                <TableCell className="text-right py-1.5">{qtd}</TableCell>
                                <TableCell className="text-right py-1.5 text-muted-foreground">
                                  {total > 0 ? ((qtd / total) * 100).toFixed(2) : "0,00"}%
                                </TableCell>
                              </TableRow>
                            ));
                        })()}
                      </TableBody>
                      <TableFooter>
                        {(() => {
                          const map =
                            visibleTable === "MONITORAMENTO"
                              ? configMaps.monitoramento
                              : configMaps.pcFixo;
                          const total = Array.from(map.values()).reduce((a, b) => a + b, 0);
                          return (
                            <TableRow className="text-xs">
                              <TableCell className="py-1.5 font-bold">Total</TableCell>
                              <TableCell className="text-right py-1.5 font-bold">{total}</TableCell>
                              <TableCell className="text-right py-1.5">100,00%</TableCell>
                            </TableRow>
                          );
                        })()}
                      </TableFooter>
                    </Table>
                  )}
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowMethodDialog(false); setVisibleTable(null); }}>
              Cancelar
            </Button>
            <Button onClick={handleConfirmMethods}>
              <CheckCircle2 className="h-4 w-4" />
              Confirmar e calcular
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog 2: Alocação de usuários Consulta PF ── */}
      <Dialog
        open={showPcvDialog}
        onOpenChange={(o) => { if (!o) setShowPcvDialog(false); }}
      >
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Classificar usuários de Consulta PF</DialogTitle>
            <DialogDescription>
              Os usuários abaixo realizaram consultas do tipo <strong>Consulta PF</strong> na PC Variável.
              Todos precisam ter um segmento definido para calcular o PC Adicional.
            </DialogDescription>
          </DialogHeader>

          {parsed && (
            <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Usuário</TableHead>
                    <TableHead className="text-right w-20">Consultas</TableHead>
                    <TableHead className="w-44">Segmento</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {parsed.pcvConsultaPfUsers.map(({ user_id, segmento, count }) => {
                    const effective = pcvOverrides[user_id] ?? segmento ?? "";
                    const isUnallocated = !effective;
                    return (
                      <TableRow key={user_id} className={isUnallocated ? "bg-destructive/5" : ""}>
                        <TableCell className="font-mono text-sm">{user_id}</TableCell>
                        <TableCell className="text-right text-sm">{count}</TableCell>
                        <TableCell>
                          <Select
                            value={effective}
                            onValueChange={(val) =>
                              setPcvOverrides((prev) => ({ ...prev, [user_id]: val }))
                            }
                          >
                            <SelectTrigger
                              className={`h-8 text-xs ${isUnallocated ? "border-destructive" : ""}`}
                            >
                              <SelectValue placeholder="Selecione…" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="AUTOMOVEIS">Automóveis</SelectItem>
                              <SelectItem value="CAMINHOES">Pesados</SelectItem>
                              <SelectItem value="MOTOCICLETAS">Motocicletas</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>

              {parsed.pcvConsultaPfUsers.some(
                ({ user_id, segmento }) => !pcvOverrides[user_id] && !segmento
              ) && (
                <p className="text-xs text-destructive font-medium">
                  ⚠ Todos os usuários devem ter segmento definido antes de confirmar.
                </p>
              )}
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => { setShowPcvDialog(false); setShowMethodDialog(true); }}
            >
              Voltar
            </Button>
            <Button
              onClick={handleConfirmPcvUsers}
              disabled={
                !parsed ||
                parsed.pcvConsultaPfUsers.some(
                  ({ user_id, segmento }) => !pcvOverrides[user_id] && !segmento
                )
              }
            >
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
