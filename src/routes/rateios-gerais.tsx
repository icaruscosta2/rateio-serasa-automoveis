import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { AppLayout } from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ChevronDown,
  ChevronRight,
  Download,
  Percent,
  RefreshCw,
  Table2,
} from "lucide-react";
import { brl } from "@/lib/format";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/rateios-gerais")({
  component: () => (
    <AppLayout>
      <RateiosGeraisPage />
    </AppLayout>
  ),
});

/* ─── Tipos ─── */

interface Empresa {
  cod_empresa: number;
  nome: string;
  bandeira: string | null;
}

interface ContaContabil {
  cod_contabil: string;
  descricao: string;
}

interface CentroCusto {
  cod_centro_custo: number;
  descricao: string;
}

interface LinhaLancamento {
  cod_recebedor: number;
  nome_recebedor: string;
  cod_pagador: number;
  nome_pagador: string;
  nr_fatura: string;
  data_rateio: string;
  cod_centro_custo: number;
  cod_conta_contabil: string;
  valor: number;
  cc_recebedor: number | string;
}

/* ─── Helpers ─── */

function todayBr(): string {
  return new Date().toLocaleDateString("pt-BR");
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Arredonda para 2 casas e evita -0 */
function round2(n: number) {
  return Math.round(n * 100) / 100 || 0;
}

/* ─── Sub-componente: grupo colapsável ─── */

function CollapseGroup({
  title,
  count,
  selectedCount,
  defaultOpen = true,
  children,
  onSelectAll,
  onDeselectAll,
}: {
  title: string;
  count: number;
  selectedCount: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
  onSelectAll: () => void;
  onDeselectAll: () => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const allSelected = selectedCount === count;
  const someSelected = selectedCount > 0 && !allSelected;

  return (
    <div className="border rounded-md overflow-hidden">
      <div
        className="flex items-center gap-2 px-3 py-2 bg-muted/40 cursor-pointer select-none"
        onClick={() => setOpen((o) => !o)}
      >
        {open ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
        )}
        <span className="text-sm font-semibold flex-1">{title}</span>
        <Badge
          variant={selectedCount > 0 ? "default" : "secondary"}
          className="text-xs"
        >
          {selectedCount}/{count}
        </Badge>
        {/* Selecionar / Deselecionar todos — não propaga o click para o collapse */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            allSelected || someSelected ? onDeselectAll() : onSelectAll();
          }}
          className="text-xs text-muted-foreground hover:text-foreground underline ml-1"
        >
          {allSelected ? "Nenhum" : "Todos"}
        </button>
      </div>
      {open && <div className="divide-y">{children}</div>}
    </div>
  );
}

/* ─── Sub-componente: diálogo de percentuais ─── */

function PercentDialog({
  open,
  onOpenChange,
  title,
  items,
  currentPercs,
  onSave,
  highlightCod,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  items: { cod: number; label: string }[];
  currentPercs: Map<number, number>;
  onSave: (percs: Map<number, number>) => void;
  highlightCod?: number;
}) {
  const [draft, setDraft] = useState<Map<number, string>>(new Map());

  /* Inicializa o draft quando abre */
  useEffect(() => {
    if (!open) return;
    const n = items.length;
    const base = n > 0 ? round2(100 / n) : 0;
    const m = new Map<number, string>();
    for (const it of items) {
      m.set(it.cod, currentPercs.has(it.cod) ? String(currentPercs.get(it.cod)!) : String(base));
    }
    setDraft(m);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const total = useMemo(() => {
    let s = 0;
    for (const v of draft.values()) s += Number(v) || 0;
    return round2(s);
  }, [draft]);

  const ok = Math.abs(total - 100) < 0.01;

  const equalize = () => {
    const n = items.length;
    const base = n > 0 ? round2(100 / n) : 0;
    const m = new Map<number, string>();
    for (const it of items) m.set(it.cod, String(base));
    setDraft(m);
  };

  const save = () => {
    if (!ok) { toast.error("A soma deve ser exatamente 100%."); return; }
    const m = new Map<number, number>();
    for (const [k, v] of draft) m.set(k, Number(v) || 0);
    onSave(m);
    onOpenChange(false);
    toast.success("Divisão configurada.");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="flex justify-between items-center">
            <p className="text-sm text-muted-foreground">
              {items.length} item{items.length !== 1 ? "s" : ""}
            </p>
            <Button variant="outline" size="sm" onClick={equalize}>
              <RefreshCw className="h-3.5 w-3.5" /> Igualar
            </Button>
          </div>

          <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
            {items.map((it) => (
              <div key={it.cod} className="flex items-center gap-3">
                <span
                  className={cn(
                    "flex-1 text-sm truncate",
                    it.cod === highlightCod && "font-semibold text-primary",
                  )}
                >
                  {it.label}
                  {it.cod === highlightCod && (
                    <span className="ml-1 text-[10px] text-primary/70">(pagadora)</span>
                  )}
                </span>
                <div className="flex items-center gap-1 shrink-0">
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    step={0.01}
                    value={draft.get(it.cod) ?? ""}
                    onChange={(e) =>
                      setDraft((prev) => {
                        const next = new Map(prev);
                        next.set(it.cod, e.target.value);
                        return next;
                      })
                    }
                    className="w-20 h-8 font-mono text-sm text-right"
                  />
                  <span className="text-sm text-muted-foreground w-4">%</span>
                </div>
              </div>
            ))}
          </div>

          <div
            className={cn(
              "flex items-center justify-between rounded-md px-3 py-2 text-sm font-medium border",
              ok
                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                : "bg-red-50 text-red-700 border-red-200",
            )}
          >
            <span>Total</span>
            <span className="font-mono">{total.toFixed(2)}%</span>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={!ok}>
            Confirmar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Componente principal ─── */

function RateiosGeraisPage() {
  /* ── Dados base ── */
  const [empresasArr, setEmpresasArr] = useState<Empresa[]>([]);
  const [contas, setContas]           = useState<ContaContabil[]>([]);
  const [centrosTodos, setCentrosTodos] = useState<CentroCusto[]>([]);
  const [loadingBase, setLoadingBase] = useState(true);

  /* ── Formulário NF ── */
  const [nrNota,  setNrNota]  = useState("");
  const [valor,   setValor]   = useState("");

  /* ── Empresa pagadora (auto-fill) ── */
  const [pagCod,  setPagCod]  = useState("");
  const [pagNome, setPagNome] = useState("");

  /* ── Conta contábil (auto-fill) ── */
  const [cCod,  setCCod]  = useState("");
  const [cNome, setCNome] = useState("");

  /* ── CC Recebedor (auto-fill) ── */
  const [ccRecCod,  setCcRecCod]  = useState("");
  const [ccRecNome, setCcRecNome] = useState("");

  /* ── Seleção empresas ── */
  const [selectedEmps, setSelectedEmps] = useState<Set<number>>(new Set());
  const [empPercs,     setEmpPercs]     = useState<Map<number, number>>(new Map());
  const [splitEmpOpen, setSplitEmpOpen] = useState(false);

  /* ── Seleção CCs ── */
  const [selectedCCs, setSelectedCCs] = useState<Set<number>>(new Set());
  const [ccPercs,     setCcPercs]     = useState<Map<number, number>>(new Map());
  const [splitCcOpen, setSplitCcOpen] = useState(false);

  /* ── Tela de prévia ── */
  const [showPreview, setShowPreview] = useState(false);

  /* ─────────── Carregamento base ─────────── */
  useEffect(() => {
    (async () => {
      setLoadingBase(true);
      const [{ data: emps }, { data: contas_ }, { data: centros_ }] =
        await Promise.all([
          supabase
            .from("companies")
            .select("cod_empresa, nome, bandeira")
            .eq("ativo", true)
            .order("bandeira", { ascending: true })
            .order("nome",     { ascending: true }),
          supabase
            .from("conta_contabil")
            .select("cod_contabil, descricao")
            .eq("conta_ativa", true)
            .order("cod_contabil"),
          supabase
            .from("centro_custo")
            .select("cod_centro_custo, descricao")
            .order("cod_centro_custo"),
        ]);

      setEmpresasArr((emps   ?? []) as Empresa[]);
      setContas(     (contas_ ?? []) as ContaContabil[]);
      setCentrosTodos((centros_ ?? []) as CentroCusto[]);
      setLoadingBase(false);
    })();
  }, []);

  /* ─────────── Maps rápidos ─────────── */
  const empresasMap = useMemo(() => {
    const m = new Map<number, Empresa>();
    for (const e of empresasArr) m.set(e.cod_empresa, e);
    return m;
  }, [empresasArr]);

  const centrosMap = useMemo(() => {
    const m = new Map<number, CentroCusto>();
    for (const cc of centrosTodos) m.set(cc.cod_centro_custo, cc);
    return m;
  }, [centrosTodos]);

  /* ─────────── Grupos de empresas por bandeira ─────────── */
  const empresaGroups = useMemo(() => {
    const m = new Map<string, Empresa[]>();
    for (const e of empresasArr) {
      const key = e.bandeira?.trim() || "Outros";
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(e);
    }
    return Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [empresasArr]);

  /* ─────────── Auto-fill: Pagadora ─────────── */
  const handlePagCodChange = useCallback(
    (val: string) => {
      setPagCod(val);
      const num = Number(val);
      if (Number.isFinite(num) && num > 0) {
        const emp = empresasMap.get(num);
        if (emp) {
          setPagNome(emp.nome);
          setSelectedEmps((prev) => new Set([...prev, num]));
          setEmpPercs(new Map()); // reset divisão ao mudar pagadora
        }
      } else if (!val) {
        setPagNome("");
      }
    },
    [empresasMap],
  );

  const handlePagNomeChange = useCallback(
    (val: string) => {
      setPagNome(val);
      const lower = val.toLowerCase();
      for (const [cod, emp] of empresasMap) {
        if (emp.nome.toLowerCase() === lower) {
          setPagCod(String(cod));
          setSelectedEmps((prev) => new Set([...prev, cod]));
          setEmpPercs(new Map());
          return;
        }
      }
    },
    [empresasMap],
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
        const cc = centrosMap.get(num);
        if (cc) setCcRecNome(cc.descricao);
      } else if (!val) {
        setCcRecNome("");
      }
    },
    [centrosMap],
  );

  const handleCcRecNomeChange = useCallback(
    (val: string) => {
      setCcRecNome(val);
      const lower = val.toLowerCase();
      for (const [, cc] of centrosMap) {
        if (cc.descricao.toLowerCase() === lower) {
          setCcRecCod(String(cc.cod_centro_custo));
          return;
        }
      }
    },
    [centrosMap],
  );

  /* ─────────── Toggle empresa ─────────── */
  const toggleEmp = useCallback((cod: number) => {
    setSelectedEmps((prev) => {
      const next = new Set(prev);
      next.has(cod) ? next.delete(cod) : next.add(cod);
      return next;
    });
    setEmpPercs(new Map()); // reset divisão ao mudar seleção
    setShowPreview(false);
  }, []);

  const selectAllEmps = useCallback((cods: number[]) => {
    setSelectedEmps((prev) => new Set([...prev, ...cods]));
    setEmpPercs(new Map());
    setShowPreview(false);
  }, []);

  const deselectAllEmps = useCallback((cods: number[]) => {
    setSelectedEmps((prev) => {
      const next = new Set(prev);
      for (const c of cods) next.delete(c);
      return next;
    });
    setEmpPercs(new Map());
    setShowPreview(false);
  }, []);

  /* ─────────── Toggle CC ─────────── */
  const toggleCC = useCallback((cod: number) => {
    setSelectedCCs((prev) => {
      const next = new Set(prev);
      next.has(cod) ? next.delete(cod) : next.add(cod);
      return next;
    });
    setCcPercs(new Map());
    setShowPreview(false);
  }, []);

  const selectAllCCs = useCallback((cods: number[]) => {
    setSelectedCCs((prev) => new Set([...prev, ...cods]));
    setCcPercs(new Map());
    setShowPreview(false);
  }, []);

  const deselectAllCCs = useCallback((cods: number[]) => {
    setSelectedCCs((prev) => {
      const next = new Set(prev);
      for (const c of cods) next.delete(c);
      return next;
    });
    setCcPercs(new Map());
    setShowPreview(false);
  }, []);

  /* ─────────── Derivados: listas ordenadas de selecionados ─────────── */
  const pagNum = Number(pagCod);

  const selectedEmpsList = useMemo(
    () =>
      empresasArr
        .filter((e) => selectedEmps.has(e.cod_empresa))
        .sort((a, b) => {
          if (a.cod_empresa === pagNum) return -1;
          if (b.cod_empresa === pagNum) return 1;
          return a.nome.localeCompare(b.nome);
        }),
    [empresasArr, selectedEmps, pagNum],
  );

  const selectedCCsList = useMemo(
    () =>
      centrosTodos
        .filter((cc) => selectedCCs.has(cc.cod_centro_custo))
        .sort((a, b) => a.cod_centro_custo - b.cod_centro_custo),
    [centrosTodos, selectedCCs],
  );

  const pagadora = useMemo(
    () => (Number.isFinite(pagNum) && pagNum > 0 ? empresasMap.get(pagNum) : undefined),
    [pagNum, empresasMap],
  );

  const contaSelecionada = useMemo(
    () => contas.find((c) => c.cod_contabil === cCod.trim()),
    [cCod, contas],
  );

  const empPercsOk =
    empPercs.size > 0 && empPercs.size === selectedEmpsList.length;
  const ccPercsOk =
    ccPercs.size > 0 && ccPercs.size === selectedCCsList.length;

  /* Itens para os diálogos de % */
  const empItems = useMemo(
    () => selectedEmpsList.map((e) => ({ cod: e.cod_empresa, label: e.nome })),
    [selectedEmpsList],
  );
  const ccItems = useMemo(
    () =>
      selectedCCsList.map((cc) => ({
        cod: cc.cod_centro_custo,
        label: `${cc.cod_centro_custo} — ${cc.descricao}`,
      })),
    [selectedCCsList],
  );

  /* ─────────── Validação para exibir prévia ─────────── */
  const canPreview =
    !!pagadora &&
    !!contaSelecionada &&
    !!valor &&
    Number(valor.replace(",", ".")) > 0 &&
    selectedEmpsList.length > 0 &&
    selectedCCsList.length > 0 &&
    empPercsOk &&
    ccPercsOk;

  /* ─────────── Linhas geradas (produto cruzado) ─────────── */
  const linhas = useMemo<LinhaLancamento[]>(() => {
    if (!canPreview || !showPreview) return [];
    const totalVal = Number(valor.replace(",", "."));
    const hoje = todayBr();
    const ccRec: number | string = ccRecCod ? Number(ccRecCod) || ccRecCod : "";
    const result: LinhaLancamento[] = [];
    for (const emp of selectedEmpsList) {
      const ePerc = empPercs.get(emp.cod_empresa) ?? 0;
      if (ePerc <= 0) continue;
      for (const cc of selectedCCsList) {
        const cPerc = ccPercs.get(cc.cod_centro_custo) ?? 0;
        if (cPerc <= 0) continue;
        result.push({
          cod_recebedor:      pagadora!.cod_empresa,
          nome_recebedor:     pagadora!.nome,
          cod_pagador:        emp.cod_empresa,
          nome_pagador:       emp.nome,
          nr_fatura:          nrNota,
          data_rateio:        hoje,
          cod_centro_custo:   cc.cod_centro_custo,
          cod_conta_contabil: contaSelecionada!.cod_contabil,
          valor:              round2(totalVal * (ePerc / 100) * (cPerc / 100)),
          cc_recebedor:       ccRec,
        });
      }
    }
    return result;
  }, [
    canPreview,
    showPreview,
    valor,
    nrNota,
    ccRecCod,
    pagadora,
    contaSelecionada,
    selectedEmpsList,
    selectedCCsList,
    empPercs,
    ccPercs,
  ]);

  /* ─────────── Tabela de prévia (matriz empresa × CC) ─────────── */
  // cell[emp_cod][cc_cod] = valor
  const previewMatrix = useMemo(() => {
    const m = new Map<number, Map<number, number>>();
    for (const l of linhas) {
      if (!m.has(l.cod_pagador)) m.set(l.cod_pagador, new Map());
      m.get(l.cod_pagador)!.set(l.cod_centro_custo as number, l.valor);
    }
    return m;
  }, [linhas]);

  const totalGeral = linhas.reduce((s, l) => s + l.valor, 0);

  /* ─────────── Export ─────────── */
  const handleExport = () => {
    if (!linhas.length) { toast.error("Nenhuma linha para exportar."); return; }
    try {
      const wsData = linhas.map((l) => ({
        "CÓDIGO EMPRESA RECEBER": l.cod_recebedor,
        "NOME EMPRESA RECEBER":   l.nome_recebedor,
        "CÓDIGO EMPRESA A PAGAR": l.cod_pagador,
        "NOME EMPRESA A PAGAR":   l.nome_pagador,
        "NÚMERO FATURA":          l.nr_fatura,
        "DATA RATEIO":            l.data_rateio,
        "CÓDIGO CENTRO DE CUSTO": l.cod_centro_custo,
        "CÓDIGO CONTA CONTÁBIL":  l.cod_conta_contabil,
        "VALOR":                  l.valor,
        "CÓDIGO CONTROLE":        "",
        "CÓDIGO CC RECEBEDOR":    l.cc_recebedor,
        "HISTÓRICO":              "",
      }));
      const ws = XLSX.utils.json_to_sheet(wsData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "LANÇAMENTOS NBS");
      XLSX.writeFile(wb, `LANCAMENTOS_NBS_GERAL_${todayIso().slice(0, 7)}.xlsx`);
      toast.success("Arquivo exportado com sucesso.");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Erro ao exportar");
    }
  };

  /* ─────────── Render ─────────── */
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Rateios Gerais</h1>
        <p className="text-muted-foreground">
          Divida o valor de uma nota fiscal entre empresas e centros de custo
        </p>
      </div>

      {/* ── Datalists ── */}
      <datalist id="dl-rg-emp-nome">
        {empresasArr.map((e) => <option key={e.cod_empresa} value={e.nome} />)}
      </datalist>
      <datalist id="dl-rg-conta-nome">
        {contas.map((c) => <option key={c.cod_contabil} value={c.descricao} />)}
      </datalist>
      <datalist id="dl-rg-cc-nome">
        {centrosTodos.map((cc) => <option key={cc.cod_centro_custo} value={cc.descricao} />)}
      </datalist>

      {/* ══════════════════════════════════
          CARD 1 — Dados da Nota Fiscal
      ══════════════════════════════════ */}
      <Card>
        <CardHeader>
          <CardTitle>Dados da Nota Fiscal</CardTitle>
          <CardDescription>
            Preencha as informações da NF. Código e nome se preenchem
            mutuamente ao encontrar correspondência exata.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loadingBase ? (
            <p className="text-sm text-muted-foreground">Carregando…</p>
          ) : (
            <div className="space-y-5">
              {/* NF + Valor */}
              <div className="flex flex-wrap gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Nº Nota Fiscal</label>
                  <Input
                    placeholder="Ex: 001234"
                    value={nrNota}
                    onChange={(e) => { setNrNota(e.target.value); setShowPreview(false); }}
                    className="w-36 font-mono"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Valor Total (R$)</label>
                  <Input
                    placeholder="0,00"
                    value={valor}
                    onChange={(e) => { setValor(e.target.value); setShowPreview(false); }}
                    className="w-36 font-mono"
                  />
                </div>
              </div>

              {/* Empresa pagadora */}
              <fieldset className="space-y-1.5">
                <legend className="text-sm font-medium mb-1.5">
                  Empresa Pagadora
                  <span className="ml-1.5 text-xs text-muted-foreground font-normal">
                    (quem pagou a NF)
                  </span>
                </legend>
                <div className="flex gap-2">
                  <Input
                    placeholder="Código"
                    value={pagCod}
                    onChange={(e) => handlePagCodChange(e.target.value)}
                    className="w-28 font-mono"
                  />
                  <Input
                    placeholder="Nome da empresa…"
                    value={pagNome}
                    list="dl-rg-emp-nome"
                    onChange={(e) => handlePagNomeChange(e.target.value)}
                    className="flex-1"
                  />
                </div>
                {pagadora && (
                  <p className="text-xs text-emerald-600 pl-1">
                    ✓ Empresa encontrada — código {pagadora.cod_empresa}
                  </p>
                )}
              </fieldset>

              {/* Conta contábil */}
              <fieldset className="space-y-1.5">
                <legend className="text-sm font-medium mb-1.5">Conta Contábil</legend>
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
                    list="dl-rg-conta-nome"
                    onChange={(e) => handleCNomeChange(e.target.value)}
                    className="flex-1"
                  />
                </div>
                {contaSelecionada && (
                  <p className="text-xs text-emerald-600 pl-1">
                    ✓ {contaSelecionada.cod_contabil} — {contaSelecionada.descricao}
                  </p>
                )}
              </fieldset>

              {/* CC Recebedor */}
              <fieldset className="space-y-1.5">
                <legend className="text-sm font-medium mb-1.5">
                  CC Recebedor
                  <span className="ml-1.5 text-xs text-muted-foreground font-normal">
                    (centro de custo da empresa pagadora)
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
                    placeholder="Descrição…"
                    value={ccRecNome}
                    list="dl-rg-cc-nome"
                    onChange={(e) => handleCcRecNomeChange(e.target.value)}
                    className="flex-1"
                  />
                </div>
                {ccRecCod && centrosMap.get(Number(ccRecCod)) && (
                  <p className="text-xs text-emerald-600 pl-1">
                    ✓ {centrosMap.get(Number(ccRecCod))?.descricao}
                  </p>
                )}
              </fieldset>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ══════════════════════════════════
          CARD 2 — Empresas
      ══════════════════════════════════ */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle>Empresas Participantes</CardTitle>
              <CardDescription>
                Selecione as empresas que vão dividir o custo.
                {pagadora && (
                  <span className="ml-1 text-primary font-medium">
                    {pagadora.nome} (pagadora) está pré-selecionada.
                  </span>
                )}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Badge variant={selectedEmpsList.length > 0 ? "default" : "secondary"}>
                {selectedEmpsList.length} selecionada{selectedEmpsList.length !== 1 ? "s" : ""}
              </Badge>
              <Button
                variant="outline"
                size="sm"
                disabled={selectedEmpsList.length === 0}
                onClick={() => setSplitEmpOpen(true)}
              >
                <Percent className="h-4 w-4" /> % Empresas
              </Button>
            </div>
          </div>

          {empPercsOk && (
            <div className="mt-3 rounded-md bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-800 flex flex-wrap gap-x-4 gap-y-1">
              {selectedEmpsList.map((e) => (
                <span key={e.cod_empresa}>
                  <span className={cn("font-medium", e.cod_empresa === pagNum && "text-primary")}>
                    {e.nome}
                  </span>{" "}
                  <span className="font-mono">{empPercs.get(e.cod_empresa) ?? 0}%</span>
                </span>
              ))}
            </div>
          )}
          {!empPercsOk && selectedEmpsList.length > 0 && (
            <p className="mt-2 text-xs text-amber-600">
              ⚠ Clique em "% Empresas" para configurar a divisão.
            </p>
          )}
        </CardHeader>

        <CardContent className="p-0">
          {loadingBase ? (
            <p className="text-sm text-muted-foreground p-6">Carregando…</p>
          ) : (
            <div className="p-4 space-y-2 max-h-[50vh] overflow-y-auto">
              {empresaGroups.map(([bandeira, emps]) => {
                const groupCods = emps.map((e) => e.cod_empresa);
                const selCount  = groupCods.filter((c) => selectedEmps.has(c)).length;
                return (
                  <CollapseGroup
                    key={bandeira}
                    title={bandeira}
                    count={emps.length}
                    selectedCount={selCount}
                    onSelectAll={() => selectAllEmps(groupCods)}
                    onDeselectAll={() => deselectAllEmps(groupCods)}
                  >
                    {emps.map((emp) => {
                      const isPag      = emp.cod_empresa === pagNum;
                      const isSelected = selectedEmps.has(emp.cod_empresa);
                      return (
                        <div
                          key={emp.cod_empresa}
                          className={cn(
                            "flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-muted/40 transition-colors",
                            isPag && "bg-primary/5 border-l-2 border-l-primary",
                            !isSelected && "opacity-50",
                          )}
                          onClick={() => toggleEmp(emp.cod_empresa)}
                        >
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => toggleEmp(emp.cod_empresa)}
                            onClick={(e) => e.stopPropagation()}
                          />
                          <span className={cn("text-sm flex-1", isPag && "font-semibold text-primary")}>
                            {emp.nome}
                          </span>
                          {isPag && (
                            <Badge variant="default" className="text-[10px] py-0 h-4">
                              Pagadora
                            </Badge>
                          )}
                          <span className="text-xs text-muted-foreground font-mono">
                            {emp.cod_empresa}
                          </span>
                        </div>
                      );
                    })}
                  </CollapseGroup>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ══════════════════════════════════
          CARD 3 — Centros de Custo
      ══════════════════════════════════ */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle>Centros de Custo</CardTitle>
              <CardDescription>
                Selecione os CCs que vão receber os lançamentos de cada empresa.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Badge variant={selectedCCsList.length > 0 ? "default" : "secondary"}>
                {selectedCCsList.length} selecionado{selectedCCsList.length !== 1 ? "s" : ""}
              </Badge>
              <Button
                variant="outline"
                size="sm"
                disabled={selectedCCsList.length === 0}
                onClick={() => setSplitCcOpen(true)}
              >
                <Percent className="h-4 w-4" /> % CCs
              </Button>
            </div>
          </div>

          {ccPercsOk && (
            <div className="mt-3 rounded-md bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-800 flex flex-wrap gap-x-4 gap-y-1">
              {selectedCCsList.map((cc) => (
                <span key={cc.cod_centro_custo}>
                  <span className="font-medium">{cc.descricao}</span>{" "}
                  <span className="font-mono">{ccPercs.get(cc.cod_centro_custo) ?? 0}%</span>
                </span>
              ))}
            </div>
          )}
          {!ccPercsOk && selectedCCsList.length > 0 && (
            <p className="mt-2 text-xs text-amber-600">
              ⚠ Clique em "% CCs" para configurar a divisão.
            </p>
          )}
        </CardHeader>

        <CardContent className="p-0">
          {loadingBase ? (
            <p className="text-sm text-muted-foreground p-6">Carregando…</p>
          ) : (
            <div className="p-4">
              <CollapseGroup
                title="Todos os Centros de Custo"
                count={centrosTodos.length}
                selectedCount={selectedCCsList.length}
                onSelectAll={() => selectAllCCs(centrosTodos.map((cc) => cc.cod_centro_custo))}
                onDeselectAll={() => deselectAllCCs(centrosTodos.map((cc) => cc.cod_centro_custo))}
              >
                <div className="max-h-64 overflow-y-auto divide-y">
                  {centrosTodos.map((cc) => {
                    const isSelected = selectedCCs.has(cc.cod_centro_custo);
                    return (
                      <div
                        key={cc.cod_centro_custo}
                        className={cn(
                          "flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-muted/40 transition-colors",
                          !isSelected && "opacity-50",
                        )}
                        onClick={() => toggleCC(cc.cod_centro_custo)}
                      >
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => toggleCC(cc.cod_centro_custo)}
                          onClick={(e) => e.stopPropagation()}
                        />
                        <span className="font-mono text-xs text-muted-foreground w-12 shrink-0">
                          {cc.cod_centro_custo}
                        </span>
                        <span className="text-sm flex-1">{cc.descricao}</span>
                      </div>
                    );
                  })}
                </div>
              </CollapseGroup>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Botão Gerar Prévia ── */}
      <div className="flex items-center gap-3">
        <Button
          size="lg"
          disabled={!canPreview}
          onClick={() => setShowPreview(true)}
          className="gap-2"
        >
          <Table2 className="h-5 w-5" />
          Gerar Prévia
        </Button>
        {!canPreview && (
          <p className="text-sm text-muted-foreground">
            Preencha todos os campos, selecione empresas e CCs e configure os percentuais.
          </p>
        )}
      </div>

      {/* ══════════════════════════════════
          CARD 4 — Prévia (matriz)
      ══════════════════════════════════ */}
      {showPreview && linhas.length > 0 && (
        <Card className="border-primary/40 shadow-md">
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle className="text-primary">Prévia dos Lançamentos</CardTitle>
                <CardDescription>
                  Verifique os valores antes de exportar.{" "}
                  {linhas.length} linha{linhas.length !== 1 ? "s" : ""} · Total:{" "}
                  <span className="font-semibold text-foreground">{brl(totalGeral)}</span>
                </CardDescription>
              </div>
              <Button onClick={handleExport} className="gap-2 shrink-0">
                <Download className="h-4 w-4" />
                Confirmar e Exportar XLSX
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-auto max-h-[60vh]">
              <Table>
                <TableHeader className="sticky top-0 bg-card z-10">
                  <TableRow>
                    <TableHead className="min-w-[180px]">Empresa</TableHead>
                    {selectedCCsList.map((cc) => (
                      <TableHead key={cc.cod_centro_custo} className="text-right min-w-[120px]">
                        <div className="font-mono text-xs">{cc.cod_centro_custo}</div>
                        <div
                          className="text-[10px] text-muted-foreground font-normal truncate max-w-[110px]"
                          title={cc.descricao}
                        >
                          {cc.descricao}
                        </div>
                      </TableHead>
                    ))}
                    <TableHead className="text-right font-bold min-w-[100px]">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {selectedEmpsList.map((emp) => {
                    const isPag   = emp.cod_empresa === pagNum;
                    const rowMap  = previewMatrix.get(emp.cod_empresa) ?? new Map();
                    const rowTotal = Array.from(rowMap.values()).reduce((s, v) => s + v, 0);
                    return (
                      <TableRow
                        key={emp.cod_empresa}
                        className={cn(isPag && "bg-primary/5 font-medium")}
                      >
                        <TableCell>
                          <span className={cn("text-sm", isPag && "text-primary font-semibold")}>
                            {emp.nome}
                          </span>
                          {isPag && (
                            <Badge variant="default" className="ml-2 text-[10px] py-0 h-4">
                              Pagadora
                            </Badge>
                          )}
                        </TableCell>
                        {selectedCCsList.map((cc) => (
                          <TableCell key={cc.cod_centro_custo} className="text-right tabular-nums text-sm">
                            {rowMap.has(cc.cod_centro_custo)
                              ? brl(rowMap.get(cc.cod_centro_custo)!)
                              : "—"}
                          </TableCell>
                        ))}
                        <TableCell className="text-right font-semibold tabular-nums text-sm">
                          {brl(rowTotal)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>

                {/* Linha de totais por coluna */}
                <tfoot>
                  <tr className="border-t-2 bg-muted/30">
                    <td className="px-4 py-2 text-sm font-bold">Total</td>
                    {selectedCCsList.map((cc) => {
                      const colTotal = selectedEmpsList.reduce((s, emp) => {
                        return s + (previewMatrix.get(emp.cod_empresa)?.get(cc.cod_centro_custo) ?? 0);
                      }, 0);
                      return (
                        <td key={cc.cod_centro_custo} className="px-4 py-2 text-right font-bold text-sm tabular-nums">
                          {brl(colTotal)}
                        </td>
                      );
                    })}
                    <td className="px-4 py-2 text-right font-bold text-sm tabular-nums text-primary">
                      {brl(totalGeral)}
                    </td>
                  </tr>
                </tfoot>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Diálogos de % ── */}
      <PercentDialog
        open={splitEmpOpen}
        onOpenChange={setSplitEmpOpen}
        title="Divisão % — Empresas"
        items={empItems}
        currentPercs={empPercs}
        onSave={(m) => { setEmpPercs(m); setShowPreview(false); }}
        highlightCod={pagNum}
      />
      <PercentDialog
        open={splitCcOpen}
        onOpenChange={setSplitCcOpen}
        title="Divisão % — Centros de Custo"
        items={ccItems}
        currentPercs={ccPercs}
        onSave={(m) => { setCcPercs(m); setShowPreview(false); }}
      />
    </div>
  );
}
