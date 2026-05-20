import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { AppLayout } from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Download, Eye } from "lucide-react";
import { brl } from "@/lib/format";
import { toast } from "sonner";

export const Route = createFileRoute("/serasa/envio")({
  component: () => (
    <AppLayout>
      <EnvioPage />
    </AppLayout>
  ),
});

/* ─── Tipos ─── */

interface RateioMeta {
  id: string;
  mes_referencia: string;
  status: string;
}

interface ResultRow {
  cod_empresa: number;
  consumo_minimo: number;
  pc_fixo: number;
  pc_adicional: number;
  fi_novos: number;
  fi_seminovos: number;
  adm_rateado: number;
  total: number;
}

interface MapeamentoCC {
  coluna: string;
  descricao: string;
  cod_centro_custo: number | null;
  cc_descricao: string | null;
}

interface ContaContabil {
  cod_contabil: string;
  descricao: string;
}

interface Empresa {
  cod_empresa: number;
  nome: string;
  cnpj: string | null;
  cnpj_normalizado: string | null;
}

interface CentroCusto {
  cod_centro_custo: number;
  descricao: string;
}

interface LinhaLancamento {
  coluna: string;                  // VN | VU | PC | AT
  cod_recebedor: number;
  nome_recebedor: string;
  cod_pagador: number;
  nome_pagador: string;
  cod_centro_custo: number;
  centro_custo: string;
  cod_conta_contabil: string;
  conta_contabil: string;
  valor: number;
  data_rateio: string;
  cc_recebedor: number | string;
}

/* ─── Helpers ─── */

function formatMes(iso: string): string {
  return new Date(iso + "T12:00:00").toLocaleDateString("pt-BR", {
    month: "long",
    year: "numeric",
  });
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function todayBr(): string {
  return new Date().toLocaleDateString("pt-BR");
}

const COLUNAS_ORDER = ["VN", "VU", "PC", "AT"] as const;

/* ─── Componente principal ─── */

function EnvioPage() {
  /* ── Dados base ── */
  const [rateios, setRateios]       = useState<RateioMeta[]>([]);
  const [resultados, setResultados] = useState<ResultRow[]>([]);
  const [mapeamentos, setMapeamentos] = useState<MapeamentoCC[]>([]);
  const [contas, setContas]         = useState<ContaContabil[]>([]);
  const [empresas, setEmpresas]     = useState<Map<number, Empresa>>(new Map());
  const [centrosTodos, setCentrosTodos] = useState<Map<number, CentroCusto>>(new Map());

  const [loadingBase, setLoadingBase]         = useState(true);
  const [loadingResultados, setLoadingResultados] = useState(false);

  /* ── Seletor rateio ── */
  const [rateioId, setRateioId] = useState("");

  /* ── Empresa fornecedora (código + nome com auto-fill) ── */
  const [fCod, setFCod]   = useState("");
  const [fNome, setFNome] = useState("");

  /* ── Conta contábil (código + nome com auto-fill) ── */
  const [cCod, setCCod]   = useState("");
  const [cNome, setCNome] = useState("");

  /* ── CC Recebedor (código + nome auto-fill) ── */
  const [ccRecCod, setCcRecCod]   = useState("");
  const [ccRecNome, setCcRecNome] = useState("");

  /* ─────────── Carregamento base ─────────── */
  useEffect(() => {
    (async () => {
      setLoadingBase(true);
      const [
        { data: ratData },
        { data: mapRaw },
        { data: contas_ },
        { data: emps },
        { data: centros_ },
      ] = await Promise.all([
        supabase
          .from("rateios")
          .select("id, mes_referencia, status")
          .eq("status", "concluido")
          .order("mes_referencia", { ascending: false }),
        supabase
          .from("erp_mapeamento_cc")
          .select("coluna, descricao, cod_centro_custo")
          .order("coluna"),
        supabase
          .from("conta_contabil")
          .select("cod_contabil, descricao")
          .eq("conta_ativa", true)
          .order("cod_contabil"),
        supabase
          .from("companies")
          .select("cod_empresa, nome, cnpj, cnpj_normalizado")
          .eq("ativo", true)
          .order("nome"),
        supabase
          .from("centro_custo")
          .select("cod_centro_custo, descricao")
          .order("cod_centro_custo"),
      ]);

      /* Montar mapa centros */
      const centroMap = new Map<number, CentroCusto>();
      for (const cc of (centros_ ?? []) as CentroCusto[])
        centroMap.set(cc.cod_centro_custo, cc);
      setCentrosTodos(centroMap);

      setRateios((ratData ?? []) as RateioMeta[]);

      const mapsNorm: MapeamentoCC[] = (mapRaw ?? []).map((m) => ({
        coluna: m.coluna,
        descricao: m.descricao,
        cod_centro_custo: m.cod_centro_custo,
        cc_descricao:
          m.cod_centro_custo != null
            ? (centroMap.get(m.cod_centro_custo)?.descricao ?? null)
            : null,
      }));
      setMapeamentos(mapsNorm);

      setContas((contas_ ?? []) as ContaContabil[]);

      const empMap = new Map<number, Empresa>();
      for (const e of (emps ?? []) as Empresa[]) empMap.set(e.cod_empresa, e);
      setEmpresas(empMap);

      setLoadingBase(false);
    })();
  }, []);

  /* ─────────── Resultados do rateio selecionado ─────────── */
  useEffect(() => {
    if (!rateioId) { setResultados([]); return; }
    (async () => {
      setLoadingResultados(true);
      const { data, error } = await supabase
        .from("rateio_resultados")
        .select(
          "cod_empresa, consumo_minimo, pc_fixo, pc_adicional, fi_novos, fi_seminovos, adm_rateado, total",
        )
        .eq("rateio_id", rateioId)
        .order("cod_empresa");
      if (error) toast.error(error.message);
      else setResultados((data ?? []) as ResultRow[]);
      setLoadingResultados(false);
    })();
  }, [rateioId]);

  /* ─────────── Auto-fill: Empresa Fornecedora ─────────── */
  const handleFCodChange = useCallback(
    (val: string) => {
      setFCod(val);
      const num = Number(val);
      if (Number.isFinite(num) && num > 0) {
        const emp = empresas.get(num);
        if (emp) setFNome(emp.nome);
      } else if (!val) {
        setFNome("");
      }
    },
    [empresas],
  );

  const handleFNomeChange = useCallback(
    (val: string) => {
      setFNome(val);
      const lower = val.toLowerCase();
      for (const [cod, emp] of empresas) {
        if (emp.nome.toLowerCase() === lower) {
          setFCod(String(cod));
          return;
        }
      }
    },
    [empresas],
  );

  /* ─────────── Auto-fill: Conta Contábil ─────────── */
  const handleCCodChange = useCallback(
    (val: string) => {
      setCCod(val);
      const c = contas.find((x) => x.cod_contabil === val.trim());
      if (c) setCNome(c.descricao);
      else if (!val) setCNome("");
    },
    [contas],
  );

  const handleCNomeChange = useCallback(
    (val: string) => {
      setCNome(val);
      const lower = val.toLowerCase();
      const c = contas.find((x) => x.descricao.toLowerCase() === lower);
      if (c) setCCod(c.cod_contabil);
    },
    [contas],
  );

  /* ─────────── Auto-fill: CC Recebedor ─────────── */
  const handleCcRecCodChange = useCallback(
    (val: string) => {
      setCcRecCod(val);
      const num = Number(val);
      if (Number.isFinite(num) && num > 0) {
        const cc = centrosTodos.get(num);
        if (cc) setCcRecNome(cc.descricao);
      } else if (!val) {
        setCcRecNome("");
      }
    },
    [centrosTodos],
  );

  const handleCcRecNomeChange = useCallback(
    (val: string) => {
      setCcRecNome(val);
      const lower = val.toLowerCase();
      for (const [cod, cc] of centrosTodos) {
        if (cc.descricao.toLowerCase() === lower) {
          setCcRecCod(String(cod));
          return;
        }
      }
    },
    [centrosTodos],
  );

  /* ─────────── Derivados ─────────── */
  const mapCC = useMemo(() => {
    const m = new Map<string, MapeamentoCC>();
    for (const mm of mapeamentos) m.set(mm.coluna, mm);
    return m;
  }, [mapeamentos]);

  const fornecedora = useMemo(() => {
    const num = Number(fCod);
    return Number.isFinite(num) && num > 0 ? empresas.get(num) : undefined;
  }, [fCod, empresas]);

  const contaSelecionada = useMemo(
    () => contas.find((c) => c.cod_contabil === cCod.trim()),
    [cCod, contas],
  );

  /* ─────────── Linhas de lançamento ─────────── */
  const linhas = useMemo<LinhaLancamento[]>(() => {
    if (!rateioId || !fornecedora || !contaSelecionada) return [];

    const hoje = todayBr();
    const ccRec: number | string = ccRecCod ? (Number(ccRecCod) || ccRecCod) : "";
    const result: LinhaLancamento[] = [];

    for (const r of resultados) {
      const cm     = Number(r.consumo_minimo);
      const pcf    = Number(r.pc_fixo);
      const pca    = Number(r.pc_adicional);
      const fiN    = Number(r.fi_novos);
      const fiS    = Number(r.fi_seminovos);
      const adm    = Number(r.adm_rateado);
      const pcBase = pcf + pca;

      const valoresPorColuna: Record<string, number> = {
        VN: cm + fiN + adm,
        VU: fiS,
        PC: 0.75 * pcBase,
        AT: 0.25 * pcBase,
      };

      const pagador = empresas.get(r.cod_empresa);
      const nomePag = pagador?.nome ?? String(r.cod_empresa);

      for (const col of COLUNAS_ORDER) {
        const valor = valoresPorColuna[col];
        if (!valor || valor <= 0) continue;

        const mcc = mapCC.get(col);
        if (!mcc || mcc.cod_centro_custo == null) continue;

        result.push({
          coluna:           col,
          cod_recebedor:    fornecedora.cod_empresa,
          nome_recebedor:   fornecedora.nome,
          cod_pagador:      r.cod_empresa,
          nome_pagador:     nomePag,
          cod_centro_custo: mcc.cod_centro_custo,
          centro_custo:     mcc.cc_descricao ?? mcc.descricao,
          cod_conta_contabil: contaSelecionada.cod_contabil,
          conta_contabil:   contaSelecionada.descricao,
          valor,
          data_rateio:      hoje,
          cc_recebedor:     ccRec,
        });
      }
    }

    return result;
  }, [rateioId, fornecedora, contaSelecionada, ccRecCod, resultados, mapCC, empresas]);

  /* ─────────── Export ─────────── */
  const handleExport = () => {
    if (!linhas.length) { toast.error("Nenhuma linha para exportar."); return; }
    try {
      const wsData = linhas.map((l) => ({
        "CÓDIGO EMPRESA RECEBER":    l.cod_recebedor,
        "NOME EMPRESA RECEBER":      l.nome_recebedor,
        "CÓDIGO EMPRESA A PAGAR":    l.cod_pagador,
        "NOME EMPRESA A PAGAR":      l.nome_pagador,
        "NÚMERO FATURA":             "",
        "DATA RATEIO":               l.data_rateio,
        "CÓDIGO CENTRO DE CUSTO":    l.cod_centro_custo,
        "CÓDIGO CONTA CONTÁBIL":     l.cod_conta_contabil,
        "VALOR":                     l.valor,
        "CÓDIGO CONTROLE":           "",
        "CÓDIGO CC RECEBEDOR":       l.cc_recebedor,
        "HISTÓRICO":                 "",
      }));
      const ws = XLSX.utils.json_to_sheet(wsData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "LANÇAMENTOS NBS");

      const mesStr =
        rateios.find((r) => r.id === rateioId)?.mes_referencia.slice(0, 7) ??
        todayIso().slice(0, 7);
      XLSX.writeFile(wb, `LANCAMENTOS_NBS_${mesStr}.xlsx`);
      toast.success("Arquivo exportado com sucesso.");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Erro ao exportar");
    }
  };

  /* ─────────── UI helpers ─────────── */
  const totalGeral = linhas.reduce((s, l) => s + l.valor, 0);
  const rateioSelecionado = rateios.find((r) => r.id === rateioId);

  /* Arrays para datalist */
  const empresasArr = useMemo(() => Array.from(empresas.values()), [empresas]);
  const centrosArr  = useMemo(() => Array.from(centrosTodos.values()), [centrosTodos]);

  /* ─────────── Render ─────────── */
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">3. Envio ao NBS</h1>
        <p className="text-muted-foreground">Gera o arquivo de lançamentos para importação no NBS</p>
      </div>

      {/* ── Datalists (hidden) ── */}
      <datalist id="dl-empresas-nome">
        {empresasArr.map((e) => (
          <option key={e.cod_empresa} value={e.nome} />
        ))}
      </datalist>
      <datalist id="dl-contas-nome">
        {contas.map((c) => (
          <option key={c.cod_contabil} value={c.descricao} />
        ))}
      </datalist>
      <datalist id="dl-centros-nome">
        {centrosArr.map((cc) => (
          <option key={cc.cod_centro_custo} value={cc.descricao} />
        ))}
      </datalist>

      {/* ── Configuração ── */}
      <Card>
        <CardHeader>
          <CardTitle>Configuração do lançamento</CardTitle>
          <CardDescription>
            Selecione o rateio e preencha os campos abaixo. Código e nome se preenchem
            mutuamente ao encontrar correspondência exata.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loadingBase ? (
            <p className="text-sm text-muted-foreground">Carregando…</p>
          ) : (
            <div className="space-y-5">
              {/* Mês */}
              <div className="space-y-1.5 max-w-xs">
                <label className="text-sm font-medium">Mês de referência</label>
                <Select value={rateioId} onValueChange={setRateioId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione o rateio…" />
                  </SelectTrigger>
                  <SelectContent>
                    {rateios.length === 0 ? (
                      <SelectItem value="__none" disabled>
                        Nenhum rateio concluído
                      </SelectItem>
                    ) : (
                      rateios.map((r) => (
                        <SelectItem key={r.id} value={r.id}>
                          {formatMes(r.mes_referencia)}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>

              {/* Empresa fornecedora */}
              <fieldset className="space-y-1.5">
                <legend className="text-sm font-medium mb-1.5">
                  Empresa fornecedora
                  <span className="ml-1.5 text-xs text-muted-foreground font-normal">
                    (quem pagou a fatura Serasa)
                  </span>
                </legend>
                <div className="flex gap-2">
                  <Input
                    placeholder="Código"
                    value={fCod}
                    onChange={(e) => handleFCodChange(e.target.value)}
                    className="w-28 font-mono"
                  />
                  <Input
                    placeholder="Nome da empresa…"
                    value={fNome}
                    list="dl-empresas-nome"
                    onChange={(e) => handleFNomeChange(e.target.value)}
                    className="flex-1"
                  />
                </div>
                {fornecedora && (
                  <p className="text-xs text-emerald-600 pl-1">
                    ✓ Empresa encontrada — código {fornecedora.cod_empresa}
                  </p>
                )}
              </fieldset>

              {/* Conta contábil */}
              <fieldset className="space-y-1.5">
                <legend className="text-sm font-medium mb-1.5">Conta contábil</legend>
                <div className="flex gap-2">
                  <Input
                    placeholder="Código"
                    value={cCod}
                    onChange={(e) => handleCCodChange(e.target.value)}
                    className="w-36 font-mono"
                  />
                  <Input
                    placeholder="Descrição da conta…"
                    value={cNome}
                    list="dl-contas-nome"
                    onChange={(e) => handleCNomeChange(e.target.value)}
                    className="flex-1"
                  />
                </div>
                {contaSelecionada && (
                  <p className="text-xs text-emerald-600 pl-1">
                    ✓ Conta encontrada — {contaSelecionada.cod_contabil}
                  </p>
                )}
              </fieldset>

              {/* CC Recebedor */}
              <fieldset className="space-y-1.5">
                <legend className="text-sm font-medium mb-1.5">
                  CC Recebedor
                  <span className="ml-1.5 text-xs text-muted-foreground font-normal">
                    (centro de custo onde a empresa recebedora vai lançar)
                  </span>
                </legend>
                <div className="flex gap-2">
                  <Input
                    placeholder="Código"
                    value={ccRecCod}
                    onChange={(e) => handleCcRecCodChange(e.target.value)}
                    className="w-28 font-mono"
                  />
                  <Input
                    placeholder="Descrição do centro de custo…"
                    value={ccRecNome}
                    list="dl-centros-nome"
                    onChange={(e) => handleCcRecNomeChange(e.target.value)}
                    className="flex-1"
                  />
                </div>
                {ccRecCod && centrosTodos.get(Number(ccRecCod)) && (
                  <p className="text-xs text-emerald-600 pl-1">
                    ✓ CC encontrado — {centrosTodos.get(Number(ccRecCod))?.descricao}
                  </p>
                )}
              </fieldset>

              {/* Composição dos produtos Serasa por coluna */}
              <div className="rounded-md border bg-muted/40 px-4 py-3 text-xs">
                <p className="font-medium text-foreground mb-2">Composição por produto Serasa</p>
                <div className="grid grid-cols-2 gap-x-8 gap-y-1.5">
                  {(
                    [
                      ["VN", "Cons. Mínimo + F&I Novos + ADM"],
                      ["VU", "F&I Seminovos"],
                      ["PC", "75% × (PC Fixo + PC Adicional + NF Negat.)"],
                      ["AT", "25% × (PC Fixo + PC Adicional + NF Negat.)"],
                    ] as const
                  ).map(([col, desc]) => (
                    <div key={col} className="flex items-baseline gap-2">
                      <Badge
                        variant={
                          col === "VN" ? "default"
                          : col === "VU" ? "secondary"
                          : col === "PC" ? "outline"
                          : "destructive"
                        }
                        className="font-mono text-xs shrink-0"
                      >
                        {col}
                      </Badge>
                      <span className="text-muted-foreground">{desc}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>


      {/* ── Preview ── */}
      {(rateioId || loadingResultados) && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Eye className="h-4 w-4" />
                  Prévia dos lançamentos
                  {rateioSelecionado && (
                    <Badge variant="secondary" className="ml-1 font-normal">
                      {formatMes(rateioSelecionado.mes_referencia)}
                    </Badge>
                  )}
                </CardTitle>
                {linhas.length > 0 && (
                  <p className="text-sm text-muted-foreground mt-0.5">
                    {linhas.length} linhas · Total:{" "}
                    <span className="font-semibold text-foreground">{brl(totalGeral)}</span>
                  </p>
                )}
              </div>
              <Button onClick={handleExport} disabled={linhas.length === 0}>
                <Download className="h-4 w-4" />
                Exportar XLSX
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {loadingResultados ? (
              <p className="text-sm text-muted-foreground p-6">Carregando resultados…</p>
            ) : linhas.length === 0 ? (
              <p className="text-sm text-muted-foreground p-6 text-center">
                {!fornecedora || !contaSelecionada
                  ? "Preencha a empresa fornecedora e a conta contábil para visualizar os lançamentos."
                  : "Nenhum lançamento gerado. Verifique se o rateio possui resultados e se o mapeamento de CC está configurado."}
              </p>
            ) : (
              <div className="max-h-[60vh] overflow-y-auto">
                <Table>
                  <TableHeader className="sticky top-0 bg-card z-10">
                    <TableRow>
                      <TableHead className="w-16">Produto</TableHead>
                      <TableHead className="w-20 text-right">Cód. Rec.</TableHead>
                      <TableHead>Recebedor</TableHead>
                      <TableHead className="w-20 text-right">Cód. Pag.</TableHead>
                      <TableHead>Pagador</TableHead>
                      <TableHead className="w-16 text-right">CC</TableHead>
                      <TableHead className="w-36">Conta</TableHead>
                      <TableHead className="text-right w-28">Valor</TableHead>
                      <TableHead className="w-20 text-right">CC Rec.</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {linhas.map((l, i) => (
                      <TableRow key={i}>
                        <TableCell>
                          <Badge
                            variant={
                              l.coluna === "VN" ? "default"
                              : l.coluna === "VU" ? "secondary"
                              : l.coluna === "PC" ? "outline"
                              : "destructive"
                            }
                            className="font-mono text-xs"
                          >
                            {l.coluna}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs text-right text-muted-foreground">
                          {l.cod_recebedor}
                        </TableCell>
                        <TableCell className="text-sm">{l.nome_recebedor}</TableCell>
                        <TableCell className="font-mono text-xs text-right text-muted-foreground">
                          {l.cod_pagador}
                        </TableCell>
                        <TableCell className="text-sm">{l.nome_pagador}</TableCell>
                        <TableCell className="font-mono text-xs text-right text-muted-foreground">
                          {l.cod_centro_custo}
                        </TableCell>
                        <TableCell>
                          <div className="font-mono text-xs">{l.cod_conta_contabil}</div>
                          <div
                            className="text-xs text-muted-foreground truncate max-w-[130px]"
                            title={l.conta_contabil}
                          >
                            {l.conta_contabil}
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-semibold text-sm tabular-nums">
                          {brl(l.valor)}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-right text-muted-foreground">
                          {l.cc_recebedor || "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
