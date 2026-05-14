import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import { Upload, ChevronRight, ChevronLeft, Check, CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { parseRateioWorkbook, type ParseResult } from "@/lib/parse-rateio";
import { brl, intBR } from "@/lib/format";
import { computeRateio, type ConsumoMinimoMethod } from "@/lib/compute-rateio";
import { isBandeiraExcluida, segmentoDaBandeira } from "@/lib/segmentos";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/rateios/novo")({
  validateSearch: (search: Record<string, unknown>) => ({
    processoId: typeof search.processoId === "string" ? search.processoId : undefined,
  }),
  component: () => (
    <AppLayout>
      <NovoRateioPage />
    </AppLayout>
  ),
});

interface CompanyRow {
  cod_empresa: number;
  nome: string;
  apelido: string | null;
  cnpj: string | null;
  cnpj_normalizado: string | null;
  is_matriz: boolean;
  bandeira: string | null;
  tipo_negocio: string | null;
}

function NovoRateioPage() {
  const nav = useNavigate();
  const { processoId } = useSearch({ from: "/rateios/novo" });
  const [step, setStep] = useState(1);
  const [mes, setMes] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });

  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [parsing, setParsing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const [sel, setSel] = useState<Record<number, { incluida: boolean; matriz: boolean }>>({});

  const [pct] = useState({
    consumoMinimo: 0.56, pcFixo: 2 / 3, pcAdicional: 0.56, fi: 0.56, adm: 0.56,
  });
  const [consumoMinimoMethod, setConsumoMinimoMethod] = useState<ConsumoMinimoMethod>("matrizes");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // Auto-carga da planilha salva na Etapa 1
  const [loadingFromStorage, setLoadingFromStorage] = useState(false);
  const [storageBlob, setStorageBlob]   = useState<Blob | null>(null);
  const [needsUnicoAuto, setNeedsUnicoAuto] = useState(false);
  const uniAutoRef = useRef<HTMLInputElement>(null);
  const autoParseTriggered = useRef(false);

  // Popup de usuários desconhecidos de "Consulta PF"
  const [pcvDialog, setPcvDialog] = useState<{
    open: boolean;
    file: File | null;
    usuarios: string[];
    segmentos: Record<string, string>; // email → segmento escolhido (ou "" para ignorar)
  }>({ open: false, file: null, usuarios: [], segmentos: {} });
  const [pcvSaving, setPcvSaving] = useState(false);

  // Popup de logons desconhecidos de Consultas ADM Avulsas
  const [admDialog, setAdmDialog] = useState<{
    open: boolean;
    file: File | null;
    logons: string[];
    segmentos: Record<string, string>; // logon → segmento escolhido (ou "" para ignorar)
    extraPcvMap: Map<string, string>;   // repassa o mapa PCV já resolvido
  }>({ open: false, file: null, logons: [], segmentos: {}, extraPcvMap: new Map() });
  const [admSaving, setAdmSaving] = useState(false);

  useEffect(() => {
    supabase
      .from("companies")
      .select("cod_empresa, nome, apelido, cnpj, cnpj_normalizado, is_matriz, bandeira, tipo_negocio")
      .eq("ativo", true)
      .order("bandeira")
      .order("nome")
      .then(({ data }) => {
        const all = (data ?? []) as CompanyRow[];
        // 1) Excluir bandeiras administrativas (FAZENDA, CORRETORA, LOCADORA, RGN)
        const visiveis = all.filter((r) => !isBandeiraExcluida(r.bandeira));
        // 2) Dedupe por CNPJ — prioriza tipo_negocio = 'CONTÁBIL'
        const byCnpj = new Map<string, CompanyRow>();
        const semCnpj: CompanyRow[] = [];
        for (const r of visiveis) {
          const c = r.cnpj_normalizado;
          if (!c) {
            semCnpj.push(r);
            continue;
          }
          const cur = byCnpj.get(c);
          if (!cur) {
            byCnpj.set(c, r);
          } else {
            const curIsContabil = (cur.tipo_negocio ?? "").toUpperCase().includes("CONT");
            const newIsContabil = (r.tipo_negocio ?? "").toUpperCase().includes("CONT");
            if (!curIsContabil && newIsContabil) byCnpj.set(c, r);
          }
        }
        const rows = [...byCnpj.values(), ...semCnpj].sort((a, b) => {
          const ba = (a.bandeira ?? "").localeCompare(b.bandeira ?? "");
          return ba !== 0 ? ba : a.nome.localeCompare(b.nome);
        });
        setCompanies(rows);
        const init: typeof sel = {};
        rows.forEach((r) => {
          const seg = segmentoDaBandeira(r.bandeira);
          init[r.cod_empresa] = { incluida: seg === "AUTOMOVEIS", matriz: r.is_matriz };
        });
        setSel(init);
      });
  }, []);

  // Quando vem de "Disponível para distribuição": pré-preenche o mês e baixa o arquivo do Storage
  useEffect(() => {
    if (!processoId) return;
    setLoadingFromStorage(true);
    supabase
      .from("processos_serasa")
      .select("mes_referencia, arquivo_storage_path")
      .eq("id", processoId)
      .single()
      .then(async ({ data }) => {
        if (data?.mes_referencia) setMes(data.mes_referencia.slice(0, 7));
        if (!data?.arquivo_storage_path) { setLoadingFromStorage(false); return; }
        const { data: blob, error } = await supabase.storage
          .from("rateio-uploads")
          .download(data.arquivo_storage_path);
        if (!error && blob) setStorageBlob(blob);
        setLoadingFromStorage(false);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processoId]);

  // Dispara o parse assim que o blob do Storage E as empresas estiverem prontos
  const companiesReady = companies.length > 0;
  useEffect(() => {
    if (!storageBlob || !companiesReady || autoParseTriggered.current) return;
    autoParseTriggered.current = true;
    const f = new File([storageBlob], "planilha-etapa1.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    doParse(f);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageBlob, companiesReady]);

  // Depois do parse automático, verifica se ÚNICO AUTO está presente
  useEffect(() => {
    if (!parsed || !processoId) return;
    setNeedsUnicoAuto(parsed.unicoAutoPorCnpj.size === 0);
  }, [parsed, processoId]);

  const doParse = async (
    f: File,
    extraPcvMap?: Map<string, string>,
    extraGestoresMap?: Map<string, string>,
  ) => {
    setParsing(true);
    try {
      const buf = await f.arrayBuffer();
      const [{ data: pcvData }, { data: gestoresData }] = await Promise.all([
        supabase.from("pcv_usuarios").select("user_id, segmento").eq("ativo", true),
        supabase.from("gestores_logon").select("logon, segmento").eq("ativo", true),
      ]);
      const basePcvMap = new Map((pcvData ?? []).map((u) => [u.user_id.toLowerCase(), u.segmento]));
      const baseGestoresMap = new Map(
        (gestoresData ?? []).map((g) => [g.logon.toUpperCase().trim(), g.segmento]),
      );
      // Merge extra classifications (from popups) on top of DB data
      const pcvUsuariosPf = extraPcvMap
        ? new Map([...basePcvMap, ...extraPcvMap])
        : basePcvMap;
      const gestoresLogon = extraGestoresMap
        ? new Map([...baseGestoresMap, ...extraGestoresMap])
        : baseGestoresMap;
      const result = parseRateioWorkbook(buf, pcvUsuariosPf, companies, gestoresLogon);
      if (result.abasFaltando.length) {
        toast.warning(
          `Abas não encontradas: ${result.abasFaltando.join(", ")}. Encontradas: ${result.abasEncontradas.join(", ")}`,
        );
      }
      // If there are unknown "Consulta PF" users, open the PCV classification dialog
      if (result.pcvUsuariosDesconhecidos.length > 0) {
        const initSegmentos: Record<string, string> = {};
        for (const u of result.pcvUsuariosDesconhecidos) initSegmentos[u] = "";
        setPcvDialog({ open: true, file: f, usuarios: result.pcvUsuariosDesconhecidos, segmentos: initSegmentos });
        setParsed(result);
        setFile(f);
        return;
      }
      // If there are unknown ADM logons, open the Gestores classification dialog
      if (result.admLogonsDesconhecidos.length > 0) {
        const initSegmentos: Record<string, string> = {};
        for (const l of result.admLogonsDesconhecidos) initSegmentos[l] = "";
        setAdmDialog({
          open: true,
          file: f,
          logons: result.admLogonsDesconhecidos,
          segmentos: initSegmentos,
          extraPcvMap: extraPcvMap ?? new Map(),
        });
        setParsed(result);
        setFile(f);
        return;
      }
      setParsed(result);
      setFile(f);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Falha ao ler planilha");
    } finally {
      setParsing(false);
    }
  };

  const handlePcvDialogConfirm = async () => {
    if (!pcvDialog.file) return;
    setPcvSaving(true);
    try {
      // Save only the users with a chosen segment (non-empty)
      const toSave = Object.entries(pcvDialog.segmentos).filter(([, seg]) => seg !== "");
      if (toSave.length > 0) {
        const { error } = await supabase.from("pcv_usuarios").upsert(
          toSave.map(([user_id, segmento]) => ({ user_id, segmento, ativo: true })),
          { onConflict: "user_id" },
        );
        if (error) throw error;
        toast.success(`${toSave.length} usuário(s) cadastrado(s).`);
      }
      // Build extra map (all chosen + those skipped are simply absent → won't count)
      const extraMap = new Map(toSave.map(([u, s]) => [u, s]));
      setPcvDialog({ open: false, file: null, usuarios: [], segmentos: {} });
      // Re-parse with the new classifications included
      await doParse(pcvDialog.file, extraMap, undefined);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar usuários");
    } finally {
      setPcvSaving(false);
    }
  };

  const handleAdmDialogConfirm = async () => {
    if (!admDialog.file) return;
    setAdmSaving(true);
    try {
      const toSave = Object.entries(admDialog.segmentos).filter(([, seg]) => seg !== "");
      if (toSave.length > 0) {
        const { error } = await supabase.from("gestores_logon").upsert(
          toSave.map(([logon, segmento]) => ({ logon, segmento, ativo: true })),
          { onConflict: "logon" },
        );
        if (error) throw error;
        toast.success(`${toSave.length} gestor(es) cadastrado(s).`);
      }
      const extraGestoresMap = new Map(toSave.map(([l, s]) => [l, s]));
      const savedPcvMap = admDialog.extraPcvMap;
      setAdmDialog({ open: false, file: null, logons: [], segmentos: {}, extraPcvMap: new Map() });
      await doParse(admDialog.file, savedPcvMap.size > 0 ? savedPcvMap : undefined, extraGestoresMap);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar gestores");
    } finally {
      setAdmSaving(false);
    }
  };

  const handleUnicoAutoFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f || !parsed) return;
    try {
      const buf = await f.arrayBuffer();
      const [{ data: pcvData }, { data: gestoresData }] = await Promise.all([
        supabase.from("pcv_usuarios").select("user_id, segmento").eq("ativo", true),
        supabase.from("gestores_logon").select("logon, segmento").eq("ativo", true),
      ]);
      const pcvMap = new Map((pcvData ?? []).map((u) => [u.user_id.toLowerCase(), u.segmento]));
      const gestMap = new Map((gestoresData ?? []).map((g) => [g.logon.toUpperCase().trim(), g.segmento]));
      const sup = parseRateioWorkbook(buf, pcvMap, companies, gestMap);
      if (sup.unicoAutoPorCnpj.size === 0) {
        toast.error("Aba ÚNICO AUTO não encontrada neste arquivo");
        return;
      }
      setParsed({ ...parsed, unicoAutoPorCnpj: sup.unicoAutoPorCnpj });
      setNeedsUnicoAuto(false);
      toast.success(`ÚNICO AUTO carregado — ${sup.unicoAutoPorCnpj.size} CNPJs`);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Erro ao ler arquivo");
    }
    e.target.value = "";
  };

  const selectedCount = Object.values(sel).filter((s) => s.incluida).length;
  const matrizCount = Object.values(sel).filter((s) => s.incluida && s.matriz).length;

  const preview = useMemo(() => {
    if (!parsed) return null;
    return computeRateio({
      parsed,
      empresas: companies.map((c) => ({
        cod_empresa: c.cod_empresa,
        nome: c.nome,
        cnpj_normalizado: c.cnpj_normalizado,
        bandeira: c.bandeira,
        incluida: sel[c.cod_empresa]?.incluida ?? false,
        is_matriz: sel[c.cod_empresa]?.matriz ?? false,
      })),
      pct,
      consumoMinimoMethod,
    });
  }, [parsed, companies, sel, pct, consumoMinimoMethod]);

  const handleSave = async () => {
    if (!parsed || !preview) return;
    setSaving(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (!userId) throw new Error("Não autenticado");

      // upload arquivo bruto
      let storagePath: string | null = null;
      if (file) {
        const path = `${userId}/${crypto.randomUUID()}.xlsx`;
        const { error: upErr } = await supabase.storage
          .from("rateio-uploads")
          .upload(path, file, { upsert: false });
        if (!upErr) storagePath = path;
      }

      const { data: rateio, error: errRateio } = await supabase
        .from("rateios")
        .insert({
          user_id: userId,
          mes_referencia: `${mes}-01`,
          status: "concluido",
          consumo_minimo_grupo: parsed.consumoMinimoGrupo,
          pc_fixo_grupo: parsed.pcFixoGrupo,
          pc_adicional_grupo: parsed.pcAdicionalGrupo,
          fi_intranet_grupo: parsed.fiGrupo,
          adm_rateado_grupo: parsed.admRateadoGrupo,
          pct_auto_consumo_minimo: pct.consumoMinimo,
          pct_auto_pc_fixo: pct.pcFixo,
          pct_auto_pc_adicional: pct.pcAdicional,
          pct_auto_fi: pct.fi,
          pct_auto_adm: pct.adm,
          arquivo_storage_path: storagePath,
          parse_summary: {
            demoTotalLogonPcCredito: parsed.demoTotalLogonPcCredito,
            demoFiPefinPf: parsed.demoFiPefinPf,
            demoFiPefinPj: parsed.demoFiPefinPj,
            abasEncontradas: parsed.abasEncontradas,
            warnings: parsed.warnings,
          },
        })
        .select()
        .single();
      if (errRateio) throw errRateio;

      const rateioId = rateio.id;

      const empresasRows = companies
        .filter((c) => sel[c.cod_empresa]?.incluida)
        .map((c) => ({
          rateio_id: rateioId,
          cod_empresa: c.cod_empresa,
          incluida: true,
          is_matriz_override: sel[c.cod_empresa].matriz,
        }));
      if (empresasRows.length) {
        const { error } = await supabase.from("rateio_empresas").insert(empresasRows);
        if (error) throw error;
      }

      const consultasRows = preview.rows.map((r) => ({
        rateio_id: rateioId,
        cod_empresa: r.cod_empresa,
        qtd_unico_auto_novos: r.qtdUnicoAuto,
        qtd_unico_auto_seminovos: 0,
        qtd_intranet: r.qtdIntranet,
        qtd_pc_segmento: r.qtdPcSegmento,
      }));
      if (consultasRows.length) {
        const { error } = await supabase.from("rateio_consultas").insert(consultasRows);
        if (error) throw error;
      }

      const resultadosRows = preview.rows.map((r) => ({
        rateio_id: rateioId,
        cod_empresa: r.cod_empresa,
        consumo_minimo: r.consumoMinimo,
        pc_fixo: r.pcFixo,
        pc_adicional: r.pcAdicional,
        fi_novos: r.fiNovos,
        fi_seminovos: r.fiSeminovos,
        adm_rateado: r.admRateado,
        total: r.total,
      }));
      if (resultadosRows.length) {
        const { error } = await supabase.from("rateio_resultados").insert(resultadosRows);
        if (error) throw error;
      }

      // Vincula o rateio ao processo Serasa (Etapa 1) se veio de lá
      if (processoId) {
        await supabase
          .from("processos_serasa")
          .update({ rateio_id: rateioId })
          .eq("id", processoId);
      }

      toast.success("Rateio gerado!");
      nav({ to: "/rateios/$id", params: { id: rateioId } });
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h1 className="text-3xl font-bold">Novo Rateio</h1>
        <p className="text-muted-foreground">Passo {step} de 3</p>
      </div>

      <div className="flex gap-2">
        {[1, 2, 3].map((n) => (
          <div
            key={n}
            className={`flex-1 h-2 rounded-full ${n <= step ? "bg-primary" : "bg-muted"}`}
          />
        ))}
      </div>

      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle>1. Mês e Planilha</CardTitle>
            <CardDescription>
              {processoId
                ? "Planilha carregada automaticamente da Etapa 1."
                : "Envie a planilha mensal contendo as abas Demonstrativo, Intranet e Power Curve Variável."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="max-w-xs">
              <Label htmlFor="mes">Mês de referência</Label>
              <Input
                id="mes"
                type="month"
                value={mes}
                onChange={(e) => setMes(e.target.value)}
                disabled={!!processoId}
              />
              {processoId && (
                <p className="text-xs text-muted-foreground mt-1">
                  Mês definido pela Etapa 1 concluída.
                </p>
              )}
            </div>

            {/* ── Fluxo auto-carga (veio de processoId) ── */}
            {processoId ? (
              loadingFromStorage || parsing ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Carregando planilha da Etapa 1…
                </div>
              ) : !storageBlob ? (
                // arquivo_storage_path não existe (processo anterior ao recurso)
                <div className="space-y-3">
                  <p className="text-sm text-amber-600">
                    ⚠ Arquivo não encontrado no servidor — envie a planilha manualmente.
                  </p>
                  <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) doParse(f); e.target.value = ""; }} />
                  <Button onClick={() => fileRef.current?.click()} disabled={parsing}>
                    <Upload className="h-4 w-4" /> {parsing ? "Lendo…" : file ? "Trocar arquivo" : "Enviar planilha"}
                  </Button>
                  {file && <p className="text-sm text-muted-foreground">{file.name}</p>}
                </div>
              ) : (
                // Blob carregado com sucesso
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-sm text-green-700 font-medium">
                    <CheckCircle2 className="h-4 w-4" />
                    Planilha carregada automaticamente da Etapa 1
                  </div>

                  {/* Aviso + upload complementar se ÚNICO AUTO faltar */}
                  {needsUnicoAuto && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 space-y-3">
                      <div className="flex items-start gap-2 text-amber-800">
                        <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                        <div className="space-y-1">
                          <p className="text-sm font-medium">Aba ÚNICO AUTO não encontrada</p>
                          <p className="text-xs">
                            Esta aba é gerada pelo Financeiro e contém as consultas por loja.
                            Envie o arquivo do Financeiro que contém essa aba para continuar.
                          </p>
                        </div>
                      </div>
                      <input ref={uniAutoRef} type="file" accept=".xlsx,.xls" className="hidden"
                        onChange={handleUnicoAutoFile} />
                      <Button size="sm" variant="outline" onClick={() => uniAutoRef.current?.click()}>
                        <Upload className="h-4 w-4" /> Enviar arquivo com ÚNICO AUTO
                      </Button>
                    </div>
                  )}
                </div>
              )
            ) : (
              // ── Fluxo manual (sem processoId) ── */}
              <>
                <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) doParse(f); e.target.value = ""; }} />
                <Button onClick={() => fileRef.current?.click()} disabled={parsing}>
                  <Upload className="h-4 w-4" /> {parsing ? "Lendo…" : file ? "Trocar arquivo" : "Enviar planilha"}
                </Button>
                {file && <p className="text-sm text-muted-foreground">{file.name}</p>}
              </>
            )}

            {parsed && (
              <div className="border rounded-md p-4 space-y-3 bg-muted/30">
                <h3 className="font-medium">Resumo extraído (grupo todo)</h3>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>Consumo Mínimo: <strong>{brl(parsed.consumoMinimoGrupo)}</strong></div>
                  <div>Power Curve Fixo: <strong>{brl(parsed.pcFixoGrupo)}</strong></div>
                  <div>PC Adicional (logon PC CREDITO): <strong>{brl(parsed.pcAdicionalGrupo)}</strong></div>
                  <div>F&I / Cadastros: <strong>{brl(parsed.fiGrupo)}</strong></div>
                  <div>Consultas ADM Avulsas (Rejane e Márcia) — Auto: <strong>{brl(parsed.admRateadoGrupo)}</strong></div>
                  <div className="text-muted-foreground">Total grupo: <strong>{brl(parsed.consumoMinimoGrupo + parsed.pcFixoGrupo + parsed.pcAdicionalGrupo + parsed.fiGrupo + parsed.admRateadoGrupo)}</strong></div>
                </div>
                <div className="text-xs text-muted-foreground">
                  Demonstrativo — F&I PEFIN PF: {brl(parsed.demoFiPefinPf)} · F&I PEFIN PJ: {brl(parsed.demoFiPefinPj)} · Logon "PC CREDITO" total: {brl(parsed.demoTotalLogonPcCredito)}
                </div>
                {parsed.demoFiPefinPfPorLogon.length > 0 && (
                  <div className="text-[11px] text-muted-foreground">
                    PEFIN PF por logon:{" "}
                    {parsed.demoFiPefinPfPorLogon
                      .map((l) => `${l.logon} (${l.count}, ${brl(l.soma)})`)
                      .join(" · ")}
                  </div>
                )}
                {parsed.demoFiPefinPjPorLogon.length > 0 && (
                  <div className="text-[11px] text-muted-foreground">
                    PEFIN PJ por logon:{" "}
                    {parsed.demoFiPefinPjPorLogon
                      .map((l) => `${l.logon} (${l.count}, ${brl(l.soma)})`)
                      .join(" · ")}
                  </div>
                )}
                <div className="text-xs text-muted-foreground">
                  Intranet: {parsed.intranetPorCnpj.size} CNPJs distintos · Novos: {parsed.intranetNovosPorCnpj.size} · Seminovos: {parsed.intranetSeminovosPorCnpj.size}
                </div>
                <div className="text-xs text-muted-foreground">
                  Único Auto: {parsed.unicoAutoPorCnpj.size} CNPJs · {Array.from(parsed.unicoAutoPorCnpj.values()).reduce((a, b) => a + b, 0)} processos
                </div>
                <div className="text-xs text-muted-foreground">
                  Power Curve Variável: {parsed.pcVariavelLinhasAuto}/{parsed.pcVariavelTotalLinhas} linhas para Automóveis
                  {parsed.pcVariavelTotalLinhas > 0
                    ? ` (${((parsed.pcVariavelLinhasAuto / parsed.pcVariavelTotalLinhas) * 100).toFixed(2)}%)`
                    : ""}
                </div>
                {parsed.warnings.length > 0 && (
                  <ul className="text-xs text-amber-700 list-disc pl-5">
                    {parsed.warnings.map((w, i) => <li key={i}>{w}</li>)}
                  </ul>
                )}
                {parsed.abasFaltando.length > 0 && (
                  <p className="text-xs text-destructive">Abas faltando: {parsed.abasFaltando.join(", ")}</p>
                )}
              </div>
            )}

            <div className="flex justify-end">
              <Button onClick={() => setStep(2)} disabled={!parsed || needsUnicoAuto}>
                Continuar <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle>2. Empresas</CardTitle>
            <CardDescription>
              <strong>{selectedCount}</strong> selecionadas / <strong>{matrizCount}</strong> matrizes
            </CardDescription>
          </CardHeader>
          <CardContent>
            {(() => {
              const grupos = new Map<string, CompanyRow[]>();
              for (const c of companies) {
                const key = c.bandeira ?? "(sem bandeira)";
                const arr = grupos.get(key) ?? [];
                arr.push(c);
                grupos.set(key, arr);
              }
              const bandeiras = Array.from(grupos.keys()).sort();
              return (
                <Accordion type="multiple" className="w-full">
                  {bandeiras.map((b) => {
                    const lojas = grupos.get(b)!;
                    const incluidasCount = lojas.filter((c) => sel[c.cod_empresa]?.incluida).length;
                    const allOn = incluidasCount === lojas.length;
                    return (
                      <AccordionItem key={b} value={b}>
                        <AccordionTrigger className="hover:no-underline">
                          <div className="flex items-center gap-3 flex-1">
                            <span className="font-semibold">{b}</span>
                            <Badge variant="secondary">
                              {incluidasCount}/{lojas.length}
                            </Badge>
                            <button
                              type="button"
                              className="ml-auto mr-2 text-xs text-primary hover:underline"
                              onClick={(e) => {
                                e.stopPropagation();
                                const next = { ...sel };
                                lojas.forEach((c) => {
                                  next[c.cod_empresa] = {
                                    ...(next[c.cod_empresa] ?? { incluida: true, matriz: c.is_matriz }),
                                    incluida: !allOn,
                                  };
                                });
                                setSel(next);
                              }}
                            >
                              {allOn ? "Desmarcar todas" : "Marcar todas"}
                            </button>
                          </div>
                        </AccordionTrigger>
                        <AccordionContent>
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Empresa</TableHead>
                                <TableHead>CNPJ</TableHead>
                                <TableHead className="text-center w-24">Incluir</TableHead>
                                <TableHead className="text-center w-24">Matriz</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {lojas.map((c) => {
                                const s = sel[c.cod_empresa] ?? { incluida: true, matriz: c.is_matriz };
                                return (
                                  <TableRow key={c.cod_empresa}>
                                    <TableCell>
                                      <div>{c.nome}</div>
                                      <div className="text-xs text-muted-foreground">Cód {c.cod_empresa}</div>
                                    </TableCell>
                                    <TableCell className="font-mono text-xs">{c.cnpj}</TableCell>
                                    <TableCell className="text-center">
                                      <Checkbox
                                        checked={s.incluida}
                                        onCheckedChange={(v) =>
                                          setSel({ ...sel, [c.cod_empresa]: { ...s, incluida: !!v } })
                                        }
                                      />
                                    </TableCell>
                                    <TableCell className="text-center">
                                      <Checkbox
                                        checked={s.matriz}
                                        disabled={!s.incluida}
                                        onCheckedChange={(v) =>
                                          setSel({ ...sel, [c.cod_empresa]: { ...s, matriz: !!v } })
                                        }
                                      />
                                    </TableCell>
                                  </TableRow>
                                );
                              })}
                            </TableBody>
                          </Table>
                        </AccordionContent>
                      </AccordionItem>
                    );
                  })}
                </Accordion>
              );
            })()}

            <div className="flex justify-between mt-4">
              <Button variant="outline" onClick={() => setStep(1)}>
                <ChevronLeft className="h-4 w-4" /> Voltar
              </Button>
              <Button onClick={() => setStep(3)} disabled={!selectedCount}>
                Continuar <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ---- Popup: classificar usuários de "Consulta PF" não cadastrados ---- */}
      <Dialog open={pcvDialog.open} onOpenChange={(v) => !v && setPcvDialog((d) => ({ ...d, open: false }))}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Usuários desconhecidos — Consulta PF</DialogTitle>
            <DialogDescription>
              Os e-mails abaixo aparecem na aba <strong>Power Curve Variável</strong> com subproduto
              "Consulta PF", mas não estão cadastrados. Escolha o segmento de cada um ou deixe em
              branco para ignorar neste rateio.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 max-h-72 overflow-y-auto py-1">
            {pcvDialog.usuarios.map((u) => (
              <div key={u} className="flex items-center gap-3">
                <span className="font-mono text-xs flex-1 truncate">{u}</span>
                <Select
                  value={pcvDialog.segmentos[u] ?? ""}
                  onValueChange={(v) =>
                    setPcvDialog((d) => ({ ...d, segmentos: { ...d.segmentos, [u]: v } }))
                  }
                >
                  <SelectTrigger className="w-44">
                    <SelectValue placeholder="Ignorar" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="AUTOMOVEIS">AUTOMOVEIS</SelectItem>
                    <SelectItem value="PESADOS">PESADOS</SelectItem>
                    <SelectItem value="MOTOCICLETAS">MOTOCICLETAS</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setPcvDialog((d) => ({ ...d, open: false }))}
              disabled={pcvSaving}
            >
              Fechar (manter sem classificar)
            </Button>
            <Button onClick={handlePcvDialogConfirm} disabled={pcvSaving}>
              {pcvSaving ? "Salvando…" : "Salvar e re-calcular"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- Popup: classificar logons de Consultas ADM Avulsas não cadastrados ---- */}
      <Dialog open={admDialog.open} onOpenChange={(v) => !v && setAdmDialog((d) => ({ ...d, open: false }))}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Logons desconhecidos — Consultas ADM Avulsas</DialogTitle>
            <DialogDescription>
              Os logons abaixo aparecem no <strong>Demonstrativo</strong> mas não estão cadastrados
              como gestores. Escolha o segmento de cada um para classificá-los como{" "}
              <strong>Consultas ADM Avulsas</strong>, ou deixe em branco para ignorar neste rateio.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 max-h-72 overflow-y-auto py-1">
            {admDialog.logons.map((l) => (
              <div key={l} className="flex items-center gap-3">
                <span className="font-mono text-sm flex-1 truncate">{l}</span>
                <Select
                  value={admDialog.segmentos[l] ?? ""}
                  onValueChange={(v) =>
                    setAdmDialog((d) => ({ ...d, segmentos: { ...d.segmentos, [l]: v } }))
                  }
                >
                  <SelectTrigger className="w-44">
                    <SelectValue placeholder="Ignorar" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="AUTOMOVEIS">AUTOMOVEIS</SelectItem>
                    <SelectItem value="PESADOS">PESADOS</SelectItem>
                    <SelectItem value="MOTOCICLETAS">MOTOCICLETAS</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setAdmDialog((d) => ({ ...d, open: false }))}
              disabled={admSaving}
            >
              Fechar (manter sem classificar)
            </Button>
            <Button onClick={handleAdmDialogConfirm} disabled={admSaving}>
              {admSaving ? "Salvando…" : "Salvar e re-calcular"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {step === 3 && parsed && preview && (
        <Card>
          <CardHeader>
            <CardTitle>3. Confirmação</CardTitle>
            <CardDescription>
              Revise os valores calculados para Automóveis e confirme a geração do rateio.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Prévia resumida */}
            <div className="border rounded-md p-4 bg-muted/30 space-y-3">
              <h3 className="font-medium">Prévia (Automóveis)</h3>
              {(() => {
                const fiAuto = preview.fiPorSegmento["AUTOMOVEIS"] ?? 0;
                const intraAuto = preview.intranetUniversoPorSegmento["AUTOMOVEIS"] ?? 0;
                const intraTot = preview.intranetUniversoTotal;
                const fiPct = intraTot > 0 ? (intraAuto / intraTot) * 100 : 0;
                const pcvPct = preview.pcvShareAuto * 100;
                return (
                  <>
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-sm">
                      <Badge variant="outline">Consumo Mín: {brl(preview.fatiaAuto.consumoMinimo)}</Badge>
                      <Badge variant="outline">PC Fixo: {brl(preview.fatiaAuto.pcFixo)}</Badge>
                      <Badge variant="outline">PC Adic: {brl(preview.fatiaAuto.pcAdicional)}</Badge>
                      <Badge variant="outline">F&I: {brl(fiAuto)}</Badge>
                      <Badge variant="outline">Consul. ADM: {brl(preview.fatiaAuto.adm)}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground space-y-1">
                      <div>PC Adicional Auto = PC Adicional grupo × {pcvPct.toFixed(2)}% (linhas Automóveis na PC Variável).</div>
                      <div>F&I Auto = F&I grupo × {fiPct.toFixed(2)}% (Intranet Auto / Intranet universo {intraAuto}/{intraTot}).</div>
                    </div>
                    <p className="text-sm pt-2">
                      Total distribuído: <strong>{brl(preview.totals.total)}</strong> entre{" "}
                      <strong>{selectedCount}</strong> CNPJs ({matrizCount} matrizes).
                    </p>
                  </>
                );
              })()}
            </div>

            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep(2)}>
                <ChevronLeft className="h-4 w-4" /> Voltar
              </Button>
              <Button onClick={() => setConfirmOpen(true)} disabled={saving}>
                <Check className="h-4 w-4" /> Gerar RESUMO RATEIO
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Dialog de confirmação do método de rateio ── */}
      {preview && parsed && (
        <Dialog open={confirmOpen} onOpenChange={(v) => { if (!saving) setConfirmOpen(v); }}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Confirmar método de rateio</DialogTitle>
              <DialogDescription>
                Revise como cada produto Serasa será distribuído entre as lojas antes de gerar o RESUMO RATEIO.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-2.5 max-h-[60vh] overflow-y-auto pr-1">

              {/* Consumo Mínimo — com seletor de método */}
              <div className="rounded-md border p-3.5 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm">Consumo Mínimo</span>
                  <span className="text-sm font-semibold tabular-nums">{brl(preview.fatiaAuto.consumoMinimo)}</span>
                </div>
                <Select
                  value={consumoMinimoMethod}
                  onValueChange={(v) => setConsumoMinimoMethod(v as ConsumoMinimoMethod)}
                >
                  <SelectTrigger className="w-full text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="matrizes">
                      Dividir entre as matrizes do segmento — {matrizCount} matrizes ·{" "}
                      {matrizCount > 0 ? brl(preview.fatiaAuto.consumoMinimo / matrizCount) : "—"} cada
                    </SelectItem>
                    <SelectItem value="todas">
                      Divisão igual para todas as lojas — {selectedCount} lojas ·{" "}
                      {selectedCount > 0 ? brl(preview.fatiaAuto.consumoMinimo / selectedCount) : "—"} cada
                    </SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {consumoMinimoMethod === "matrizes"
                    ? `Apenas matrizes recebem (método atual). Cada uma das ${matrizCount} matrizes recebe ${matrizCount > 0 ? brl(preview.fatiaAuto.consumoMinimo / matrizCount) : "—"}.`
                    : `Todas as ${selectedCount} lojas incluídas recebem parcela igual de ${selectedCount > 0 ? brl(preview.fatiaAuto.consumoMinimo / selectedCount) : "—"}.`}
                </p>
              </div>

              {/* PC Fixo */}
              <div className="rounded-md border p-3.5 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm">PC Fixo</span>
                  <span className="text-sm font-semibold tabular-nums">{brl(preview.fatiaAuto.pcFixo)}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Partes iguais entre as {selectedCount} lojas incluídas →{" "}
                  {selectedCount > 0 ? brl(preview.fatiaAuto.pcFixo / selectedCount) : "—"} cada
                </p>
              </div>

              {/* PC Adicional */}
              <div className="rounded-md border p-3.5 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm">PC Adicional</span>
                  <span className="text-sm font-semibold tabular-nums">{brl(preview.fatiaAuto.pcAdicional)}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Proporcional às consultas no Único Auto —{" "}
                  {intBR(preview.totals.qtdUnicoAuto)} processos entre as lojas incluídas
                </p>
              </div>

              {/* F&I */}
              <div className="rounded-md border p-3.5 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm">F&amp;I / Cadastros</span>
                  <span className="text-sm font-semibold tabular-nums">
                    {brl((preview.fiPorSegmento["AUTOMOVEIS"] ?? 0))}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Proporcional às consultas na Intranet —{" "}
                  {intBR(preview.intranetUniversoPorSegmento["AUTOMOVEIS"] ?? 0)} consultas Automóveis de{" "}
                  {intBR(preview.intranetUniversoTotal)} no universo total
                </p>
              </div>

              {/* Consultas ADM */}
              <div className="rounded-md border p-3.5 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm">Consultas ADM Avulsas</span>
                  <span className="text-sm font-semibold tabular-nums">{brl(preview.fatiaAuto.adm)}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Partes iguais entre as lojas Automóveis incluídas
                </p>
                {(parsed.admLogonsPorSegmento?.["AUTOMOVEIS"]?.length ?? 0) > 0 ? (
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                    {parsed.admLogonsPorSegmento["AUTOMOVEIS"].map((l) => (
                      <span key={l.logon} className="text-xs bg-muted rounded px-2 py-0.5 font-medium">
                        {l.logon}
                        <span className="ml-1 font-normal text-muted-foreground">{brl(l.soma)}</span>
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-[11px] text-muted-foreground italic mt-0.5">
                    Nenhum gestor ADM identificado para Automóveis nesta planilha.
                  </p>
                )}
              </div>

              {/* Totais */}
              <div className="rounded-md bg-muted/50 px-4 py-3 text-sm flex justify-between items-center">
                <span className="text-muted-foreground">Total a distribuir</span>
                <span className="font-bold text-base tabular-nums">{brl(preview.totals.total)}</span>
              </div>
              <p className="text-xs text-muted-foreground text-center pb-1">
                {selectedCount} lojas · {matrizCount} matrizes
              </p>
            </div>

            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={saving}>
                Voltar
              </Button>
              <Button onClick={handleSave} disabled={saving}>
                <Check className="h-4 w-4" />
                {saving ? "Gerando…" : "Confirmar e Gerar"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
