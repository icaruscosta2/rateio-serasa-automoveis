import { createFileRoute } from "@tanstack/react-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { AppLayout } from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { buscarNbsLancamento, type NbsRow } from "@/lib/nbs-mock-data";
import { segmentoDaBandeira } from "@/lib/segmentos";
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
  TableFooter,
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
  History,
  Pencil,
  Percent,
  RefreshCw,
  Search,
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
  cc_recebedor: number;
}

interface HistoricoEntry {
  id: string;
  data: string;
  nr_nota: string;
  nr_processo: string;
  pagadora: string;
  total_empresas: number;
  valor_total: number;
}

const HISTORICO_KEY = "rg_historico";
const CC_FINANCEIRO = 3;

/* ─── Helpers ─── */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
function round2(n: number) {
  return Math.round(n * 100) / 100 || 0;
}
function formatDate(iso: string): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

/* Distribui cc3Val entre N empresas × M CCs usando aritmética inteira de centavos.
   Garante sum == cc3Val exato. O "centavo sobrando" de cada coluna vai para empresas
   diferentes (offset = índice da coluna) para evitar que a mesma empresa leve
   sempre a desvantagem de arredondamento. */
function allocateRateio(
  cc3Val: number,
  distrib: Map<number, number>,
  n: number,
): Map<number, number[]> {
  const totalCents = Math.round(cc3Val * 100);
  const ccs = Array.from(distrib.keys()).sort((a, b) => a - b);

  // Passo 1: alocar centavos por coluna de CC (largest remainder)
  const rawCcCents = ccs.map((cc) => totalCents * (distrib.get(cc)! / 100));
  const floorCcCents = rawCcCents.map((x) => Math.floor(x));
  const ccRemainder = totalCents - floorCcCents.reduce((s, v) => s + v, 0);
  const ccByFrac = [...Array(ccs.length).keys()].sort(
    (a, b) => (rawCcCents[b] - floorCcCents[b]) - (rawCcCents[a] - floorCcCents[a]),
  );
  const ccCents = [...floorCcCents];
  for (let i = 0; i < ccRemainder; i++) ccCents[ccByFrac[i]]++;

  // Passo 2: dentro de cada coluna, distribuir entre N empresas
  const result = new Map<number, number[]>();
  ccs.forEach((cc, j) => {
    const colCents = ccCents[j];
    const base = Math.floor(colCents / n);
    const extra = colCents % n;
    result.set(
      cc,
      Array.from({ length: n }, (_, i) => ((i + j) % n < extra ? base + 1 : base) / 100),
    );
  });
  return result;
}

/* ─── Sub-componente: grupo colapsável ─── */

function CollapseGroup({
  title,
  count,
  selectedCount,
  defaultOpen = true,
  indent = false,
  children,
  onSelectAll,
  onDeselectAll,
}: {
  title: string;
  count: number;
  selectedCount: number;
  defaultOpen?: boolean;
  indent?: boolean;
  children: React.ReactNode;
  onSelectAll: () => void;
  onDeselectAll: () => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const allSelected = selectedCount === count && count > 0;
  const someSelected = selectedCount > 0 && !allSelected;

  return (
    <div className={cn("border rounded-md overflow-hidden", indent && "border-muted ml-4")}>
      <div
        className={cn(
          "flex items-center gap-2 px-3 py-2 cursor-pointer select-none",
          indent ? "bg-muted/20" : "bg-muted/50",
        )}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        )}
        <span className={cn("flex-1", indent ? "text-xs font-medium" : "text-sm font-semibold")}>
          {title}
        </span>
        <Badge variant={selectedCount > 0 ? "default" : "secondary"} className="text-xs">
          {selectedCount}/{count}
        </Badge>
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
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  items: { cod: number; label: string }[];
  currentPercs: Map<number, number>;
  onSave: (percs: Map<number, number>) => void;
}) {
  const [draft, setDraft] = useState<Map<number, string>>(new Map());

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
                <span className="flex-1 text-sm truncate">{it.label}</span>
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
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={save} disabled={!ok}>Confirmar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Componente principal ─── */

function RateiosGeraisPage() {
  /* ── Dados base ── */
  const [empresasArr, setEmpresasArr] = useState<Empresa[]>([]);
  const [contas, setContas] = useState<ContaContabil[]>([]);
  const [centrosTodos, setCentrosTodos] = useState<CentroCusto[]>([]);
  const [loadingBase, setLoadingBase] = useState(true);

  /* ── Nº Processo ── */
  const [nrProcesso, setNrProcesso] = useState("");

  /* ── Busca NBS ── */
  const [searchEmpCod, setSearchEmpCod] = useState("");
  const [searchLanc, setSearchLanc] = useState("");
  const [searching, setSearching] = useState(false);
  const [nbsLinhas, setNbsLinhas] = useState<NbsRow[]>([]);
  const [nbsSelected, setNbsSelected] = useState(false);

  /* ── Distribuição CC por contábil (auto-calculada, editável)
        Map<cod_contabil, Map<cc_code, percentage>> ── */
  const [ccDistrib, setCcDistrib] = useState<Map<string, Map<number, number>>>(new Map());

  /* ── Contabils expandidas na Tela 1 (padrão: todas fechadas) ── */
  const [expandedContabils, setExpandedContabils] = useState<Set<string>>(new Set());

  /* ── Filtros do painel de empresas ── */
  const [filterEmpNome, setFilterEmpNome] = useState("");
  const [filterEmpCod, setFilterEmpCod] = useState("");

  /* ── Seleção de empresas ── */
  const [selectedEmps, setSelectedEmps] = useState<Set<number>>(new Set());

  /* ── Etapas: 1=consulta, 2=empresas, 3=prévia ── */
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [previewMode, setPreviewMode] = useState<"matrix" | "table">("matrix");
  const [editMode, setEditMode] = useState(false);
  const [valueOverrides, setValueOverrides] = useState<Map<string, number>>(new Map());

  /* ── Histórico ── */
  const [historico, setHistorico] = useState<HistoricoEntry[]>(() => {
    try { return JSON.parse(localStorage.getItem(HISTORICO_KEY) ?? "[]"); }
    catch { return []; }
  });

  /* ─────────── Carregamento base ─────────── */
  useEffect(() => {
    (async () => {
      setLoadingBase(true);
      const [{ data: emps }, { data: contas_ }, { data: centros_ }] = await Promise.all([
        supabase
          .from("companies")
          .select("cod_empresa, nome, bandeira")
          .eq("ativo", true)
          .order("bandeira", { ascending: true })
          .order("nome", { ascending: true }),
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
      setEmpresasArr((emps ?? []) as Empresa[]);
      setContas((contas_ ?? []) as ContaContabil[]);
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

  const contasMap = useMemo(() => {
    const m = new Map<string, ContaContabil>();
    for (const c of contas) m.set(c.cod_contabil, c);
    return m;
  }, [contas]);

  const centrosMap = useMemo(() => {
    const m = new Map<number, CentroCusto>();
    for (const cc of centrosTodos) m.set(cc.cod_centro_custo, cc);
    return m;
  }, [centrosTodos]);

  /* ─────────── Grupos de empresas: Segmento → Bandeira ─────────── */
  const empresasBySegBandeira = useMemo(() => {
    const segMap = new Map<string, Map<string, Empresa[]>>();
    for (const e of empresasArr) {
      const seg = segmentoDaBandeira(e.bandeira) ?? "Outros";
      const band = e.bandeira?.trim() || "Sem Bandeira";
      if (!segMap.has(seg)) segMap.set(seg, new Map());
      const bandMap = segMap.get(seg)!;
      if (!bandMap.has(band)) bandMap.set(band, []);
      bandMap.get(band)!.push(e);
    }
    return Array.from(segMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([seg, bandMap]) => ({
        seg,
        bandeiras: Array.from(bandMap.entries())
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([band, emps]) => ({ band, emps })),
      }));
  }, [empresasArr]);

  /* ─────────── Derivados: nota NBS ─────────── */
  const notaInfo = useMemo(() => {
    if (nbsLinhas.length === 0) return null;
    const f = nbsLinhas[0];
    return {
      cod_empresa: f.cod_empresa,
      lancamento: f.lancamento,
      data_entrada: f.data_entrada,
      data_vencimento: f.data_vencimento,
    };
  }, [nbsLinhas]);

  // Agrupado por COD_CONTABIL (ordem de inserção)
  const contabilGroups = useMemo(() => {
    const m = new Map<string, NbsRow[]>();
    for (const r of nbsLinhas) {
      if (!m.has(r.cod_contabil)) m.set(r.cod_contabil, []);
      m.get(r.cod_contabil)!.push(r);
    }
    return m;
  }, [nbsLinhas]);

  const valorTotalNota = useMemo(
    () => nbsLinhas.reduce((s, r) => s + Number(r.valor), 0),
    [nbsLinhas],
  );
  const valorRateio = useMemo(
    () => nbsLinhas.filter((r) => r.cod_centro_custo === CC_FINANCEIRO).reduce((s, r) => s + Number(r.valor), 0),
    [nbsLinhas],
  );

  // Contábeis elegíveis: têm pelo menos uma linha com CC=3
  const eligibleContabils = useMemo(() => {
    const result: string[] = [];
    for (const [c, rows] of contabilGroups) {
      if (rows.some((r) => r.cod_centro_custo === CC_FINANCEIRO)) result.push(c);
    }
    return result.sort();
  }, [contabilGroups]);

  /* ─────────── Busca NBS ─────────── */
  const handleBuscar = useCallback(() => {
    const empNum = Number(searchEmpCod);
    const lancNum = Number(searchLanc);
    if (!empNum || !lancNum) {
      toast.error("Informe empresa e número do lançamento.");
      return;
    }
    setSearching(true);
    setNbsLinhas([]);
    setNbsSelected(false);
    setCcDistrib(new Map());
    setStep((s) => Math.min(s, 1) as 1 | 2 | 3);
    const resultado = buscarNbsLancamento(empNum, lancNum);
    setSearching(false);
    if (resultado.length === 0) {
      toast.error("Nenhum lançamento encontrado.");
      return;
    }
    setNbsLinhas(resultado);
  }, [searchEmpCod, searchLanc]);

  /* ─────────── Selecionar nota → inicializa distribuição de CCs ─────────── */
  const handleSelecionar = useCallback(() => {
    const distrib = new Map<string, Map<number, number>>();

    for (const contabil of eligibleContabils) {
      const rows = contabilGroups.get(contabil)!;
      const others = rows.filter((r) => r.cod_centro_custo !== CC_FINANCEIRO);
      if (others.length === 0) continue;

      const totalOthers = others.reduce((s, r) => s + Number(r.valor), 0);
      // Calcula proporção baseada nos valores originais da nota
      const pcts = others.map((r) => ({
        cc: r.cod_centro_custo,
        pct: totalOthers > 0
          ? round2((Number(r.valor) / totalOthers) * 100)
          : round2(100 / others.length),
      }));
      // Corrige arredondamento no último item
      const sumPcts = pcts.reduce((s, x) => s + x.pct, 0);
      const diff = round2(100 - sumPcts);
      pcts[pcts.length - 1].pct = round2(pcts[pcts.length - 1].pct + diff);

      const ccMap = new Map<number, number>();
      for (const { cc, pct } of pcts) ccMap.set(cc, pct);
      distrib.set(contabil, ccMap);
    }

    setCcDistrib(distrib);
    setNbsSelected(true);
    setStep((s) => Math.min(s, 1) as 1 | 2 | 3);
    setEditMode(false);
    setValueOverrides(new Map());
  }, [eligibleContabils, contabilGroups]);

  /* ─────────── Toggle empresa ─────────── */
  const toggleEmp = useCallback((cod: number) => {
    setSelectedEmps((prev) => {
      const next = new Set(prev);
      next.has(cod) ? next.delete(cod) : next.add(cod);
      return next;
    });
    setStep((s) => Math.min(s, 2) as 1 | 2 | 3);
  }, []);

  const selectAllEmps = useCallback((cods: number[]) => {
    setSelectedEmps((prev) => new Set([...prev, ...cods]));
    setStep((s) => Math.min(s, 2) as 1 | 2 | 3);
  }, []);

  const deselectAllEmps = useCallback((cods: number[]) => {
    setSelectedEmps((prev) => {
      const next = new Set(prev);
      for (const c of cods) next.delete(c);
      return next;
    });
    setStep((s) => Math.min(s, 2) as 1 | 2 | 3);
  }, []);

  /* ─────────── Derivados: seleção empresas ─────────── */
  const selectedEmpsList = useMemo(
    () =>
      empresasArr
        .filter((e) => selectedEmps.has(e.cod_empresa))
        .sort((a, b) => a.nome.localeCompare(b.nome)),
    [empresasArr, selectedEmps],
  );

  const filteredEmpsList = useMemo(() => {
    const nome = filterEmpNome.toLowerCase().trim();
    const cod  = filterEmpCod.trim();
    return empresasArr.filter((e) => {
      if (nome && !e.nome.toLowerCase().includes(nome)) return false;
      if (cod  && !String(e.cod_empresa).includes(cod)) return false;
      return true;
    });
  }, [empresasArr, filterEmpNome, filterEmpCod]);

  /* ─────────── Validação para prévia ─────────── */
  const distribOk =
    eligibleContabils.length > 0 &&
    eligibleContabils.every((c) => {
      const m = ccDistrib.get(c);
      if (!m || m.size === 0) return false;
      const sum = Array.from(m.values()).reduce((s, v) => s + v, 0);
      return Math.abs(sum - 100) < 0.01;
    });

  const canStep2 = nbsSelected && distribOk;
  const canStep3 = canStep2 && selectedEmpsList.length > 0;
  const canPreview = canStep3;

  /* ─────────── Dados para view matriz ─────────── */
  const matrizData = useMemo(() => {
    if (!canPreview || step !== 3) return [];
    const n = selectedEmpsList.length;
    return eligibleContabils.map((contabil) => {
      const distrib = ccDistrib.get(contabil)!;
      const cc3Val = Number(
        contabilGroups.get(contabil)!.find((r) => r.cod_centro_custo === CC_FINANCEIRO)?.valor ?? 0,
      );
      const ccs = Array.from(distrib.keys()).sort((a, b) => a - b);
      const allocation = allocateRateio(cc3Val, distrib, n);
      const rows = selectedEmpsList.map((emp, empIdx) => {
        const cells = new Map<number, number>();
        for (const cc of ccs) {
          cells.set(cc, allocation.get(cc)![empIdx]);
        }
        const rowTotal = round2(Array.from(cells.values()).reduce((s, v) => s + v, 0));
        return { empresa: emp, cells, rowTotal };
      });
      const colTotals = new Map<number, number>();
      for (const cc of ccs) {
        colTotals.set(cc, round2(rows.reduce((s, r) => s + (r.cells.get(cc) ?? 0), 0)));
      }
      const matrizTotal = round2(rows.reduce((s, r) => s + r.rowTotal, 0));
      return { contabil, cc3Val, ccs, rows, colTotals, matrizTotal };
    });
  }, [canPreview, step, eligibleContabils, ccDistrib, contabilGroups, selectedEmpsList]);

  /* ─────────── Linhas geradas ─────────── */
  const linhas = useMemo<LinhaLancamento[]>(() => {
    if (!canPreview || step !== 3 || !notaInfo) return [];
    const result: LinhaLancamento[] = [];

    for (const contabil of eligibleContabils) {
      const distrib = ccDistrib.get(contabil);
      if (!distrib) continue;
      const cc3Val = Number(
        contabilGroups.get(contabil)!.find((r) => r.cod_centro_custo === CC_FINANCEIRO)?.valor ?? 0,
      );

      const allocation = allocateRateio(cc3Val, distrib, selectedEmpsList.length);
      for (let empIdx = 0; empIdx < selectedEmpsList.length; empIdx++) {
        const emp = selectedEmpsList[empIdx];
        for (const [cc, vals] of allocation) {
          const v = vals[empIdx];
          if (v <= 0) continue;
          result.push({
            cod_recebedor: notaInfo.cod_empresa,
            nome_recebedor: empresasMap.get(notaInfo.cod_empresa)?.nome ?? String(notaInfo.cod_empresa),
            cod_pagador: emp.cod_empresa,
            nome_pagador: emp.nome,
            nr_fatura: String(notaInfo.lancamento),
            data_rateio: notaInfo.data_entrada,
            cod_centro_custo: cc,
            cod_conta_contabil: contabil,
            valor: v,
            cc_recebedor: CC_FINANCEIRO,
          });
        }
      }
    }
    return result;
  }, [
    canPreview,
    step,
    notaInfo,
    eligibleContabils,
    ccDistrib,
    contabilGroups,
    selectedEmpsList,
    empresasMap,
  ]);

  const totalGeral = linhas.reduce((s, l) => s + l.valor, 0);

  const effectiveTotalGeral = useMemo(() => {
    if (valueOverrides.size === 0) return totalGeral;
    return linhas.reduce((s, l) => {
      const key = `${l.cod_pagador}-${l.cod_conta_contabil}-${l.cod_centro_custo}`;
      return s + (valueOverrides.has(key) ? valueOverrides.get(key)! : l.valor);
    }, 0);
  }, [linhas, valueOverrides, totalGeral]);

  useEffect(() => {
    if (step !== 3) {
      setEditMode(false);
      setValueOverrides(new Map());
    }
  }, [step]);

  /* ─────────── Export ─────────── */
  const handleExport = () => {
    if (!linhas.length) { toast.error("Nenhuma linha para exportar."); return; }
    try {
      const wsData = linhas.map((l) => {
        const key = `${l.cod_pagador}-${l.cod_conta_contabil}-${l.cod_centro_custo}`;
        const valorFinal = valueOverrides.has(key) ? valueOverrides.get(key)! : l.valor;
        return {
          "CÓDIGO EMPRESA RECEBER": l.cod_recebedor,
          "NOME EMPRESA RECEBER": l.nome_recebedor,
          "CÓDIGO EMPRESA A PAGAR": l.cod_pagador,
          "NOME EMPRESA A PAGAR": l.nome_pagador,
          "NÚMERO FATURA": l.nr_fatura,
          "DATA RATEIO": l.data_rateio,
          "CÓDIGO CENTRO DE CUSTO": l.cod_centro_custo,
          "CÓDIGO CONTA CONTÁBIL": l.cod_conta_contabil,
          "VALOR": valorFinal,
          "CÓDIGO CONTROLE": "",
          "CÓDIGO CC RECEBEDOR": l.cc_recebedor,
          "HISTÓRICO": nrProcesso || "",
        };
      });
      const ws = XLSX.utils.json_to_sheet(wsData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "LANÇAMENTOS NBS");
      XLSX.writeFile(wb, `LANCAMENTOS_NBS_GERAL_${todayIso().slice(0, 7)}.xlsx`);

      const entry: HistoricoEntry = {
        id: crypto.randomUUID(),
        data: todayIso(),
        nr_nota: String(notaInfo?.lancamento ?? ""),
        nr_processo: nrProcesso,
        pagadora: empresasMap.get(notaInfo?.cod_empresa ?? 0)?.nome ?? String(notaInfo?.cod_empresa ?? ""),
        total_empresas: selectedEmpsList.length,
        valor_total: round2(effectiveTotalGeral),
      };
      const updated = [entry, ...historico].slice(0, 50);
      localStorage.setItem(HISTORICO_KEY, JSON.stringify(updated));
      setHistorico(updated);
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
          Consulte o lançamento no NBS e distribua o valor entre as empresas participantes.
        </p>
      </div>

      {/* ── Histórico ── */}
      {historico.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <History className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-base">Histórico de Exportações</CardTitle>
              <span className="text-xs text-muted-foreground">
                {historico.length} registro{historico.length !== 1 ? "s" : ""}
              </span>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="max-h-52 overflow-y-auto divide-y text-sm">
              {historico.map((h) => (
                <div key={h.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30">
                  <span className="text-xs text-muted-foreground font-mono w-24 shrink-0">
                    {new Date(h.data + "T12:00:00").toLocaleDateString("pt-BR")}
                  </span>
                  <span className="font-mono text-xs text-muted-foreground w-28 shrink-0">
                    NF {h.nr_nota || "—"}{h.nr_processo ? ` · ${h.nr_processo}` : ""}
                  </span>
                  <span className="flex-1 truncate text-xs">{h.pagadora}</span>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {h.total_empresas} empresa{h.total_empresas !== 1 ? "s" : ""}
                  </span>
                  <span className="font-semibold tabular-nums text-xs w-28 text-right shrink-0">
                    {brl(h.valor_total)}
                  </span>
                  <button
                    type="button"
                    title="Remover"
                    className="ml-1 shrink-0 text-muted-foreground/40 hover:text-destructive transition-colors"
                    onClick={() => {
                      const updated = historico.filter((x) => x.id !== h.id);
                      localStorage.setItem(HISTORICO_KEY, JSON.stringify(updated));
                      setHistorico(updated);
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Step indicator ── */}
      <div className="flex items-center">
        {([
          { n: 1 as const, label: "Lançamento" },
          { n: 2 as const, label: "Empresas" },
          { n: 3 as const, label: "Prévia" },
        ]).map(({ n, label }, i) => (
          <React.Fragment key={n}>
            {i > 0 && (
              <div className={cn("flex-1 h-px mx-2", step > i ? "bg-primary" : "bg-border")} />
            )}
            <div
              className={cn(
                "flex items-center gap-2 text-sm font-medium shrink-0",
                step === n
                  ? "text-primary"
                  : step > n
                    ? "text-muted-foreground"
                    : "text-muted-foreground/40",
              )}
            >
              <span
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold border-2",
                  step === n
                    ? "border-primary bg-primary text-primary-foreground"
                    : step > n
                      ? "border-muted-foreground/60 bg-muted text-muted-foreground"
                      : "border-muted-foreground/20 text-muted-foreground/40",
                )}
              >
                {n}
              </span>
              <span className="hidden sm:inline">{label}</span>
            </div>
          </React.Fragment>
        ))}
      </div>

      {/* ══════════════════════════════════
          STEP 1 — Consulta do Lançamento
      ══════════════════════════════════ */}
      {step === 1 && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Consulta do Lançamento</CardTitle>
              <CardDescription>
                Informe a empresa e o número do lançamento no NBS para carregar os dados.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">

              {/* Nº Processo */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Nº Processo (Único Auto)</label>
                <Input
                  placeholder="Ex: PROC-2026-001"
                  value={nrProcesso}
                  onChange={(e) => setNrProcesso(e.target.value)}
                  className="w-52 font-mono"
                />
              </div>

              {/* Campos de busca */}
              <div className="flex flex-wrap gap-3 items-end">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Cód. Empresa</label>
                  <Input
                    placeholder="Ex: 2"
                    value={searchEmpCod}
                    onChange={(e) => setSearchEmpCod(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleBuscar()}
                    className="w-32 font-mono"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Nº Lançamento</label>
                  <Input
                    placeholder="Ex: 8773225"
                    value={searchLanc}
                    onChange={(e) => setSearchLanc(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleBuscar()}
                    className="w-44 font-mono"
                  />
                </div>
                <Button
                  onClick={handleBuscar}
                  disabled={searching || loadingBase}
                  className="gap-2"
                >
                  <Search className="h-4 w-4" />
                  {searching ? "Buscando…" : "Buscar"}
                </Button>
              </div>

              {/* ── Resultado da busca ── */}
              {nbsLinhas.length > 0 && notaInfo && (
                <div className="space-y-4 pt-2 border-t">

                  {/* Cabeçalho da nota */}
                  <div className="flex flex-wrap gap-x-8 gap-y-2 rounded-md bg-muted/40 px-4 py-3 text-sm">
                    <div>
                      <span className="text-muted-foreground">Empresa: </span>
                      <span className="font-semibold font-mono">{notaInfo.cod_empresa}</span>
                      {empresasMap.get(notaInfo.cod_empresa) && (
                        <span className="ml-1 text-muted-foreground">
                          — {empresasMap.get(notaInfo.cod_empresa)?.nome}
                        </span>
                      )}
                    </div>
                    <div>
                      <span className="text-muted-foreground">Lançamento: </span>
                      <span className="font-semibold font-mono">{notaInfo.lancamento}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Data Entrada: </span>
                      <span className="font-semibold">{formatDate(notaInfo.data_entrada)}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Data Vencimento: </span>
                      <span className="font-semibold">{formatDate(notaInfo.data_vencimento)}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Valor Total: </span>
                      <span className="font-semibold tabular-nums">{brl(valorTotalNota)}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Valor para Rateio </span>
                      <span className="text-xs text-muted-foreground">(CC={CC_FINANCEIRO}): </span>
                      <span className="font-semibold tabular-nums text-blue-700">{brl(valorRateio)}</span>
                    </div>
                  </div>

                  {/* Tabela de linhas agrupada por contábil — colapsável */}
                  <div className="rounded-md border overflow-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-6" />
                          <TableHead>Conta Contábil</TableHead>
                          <TableHead className="w-20 text-center">CC</TableHead>
                          <TableHead>Descrição CC</TableHead>
                          <TableHead className="text-right">Valor</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {Array.from(contabilGroups.entries()).map(([contabil, rows]) => {
                          const conta = contasMap.get(contabil);
                          const rowTotal = rows.reduce((s, r) => s + Number(r.valor), 0);
                          const hasFinanceiro = rows.some((r) => r.cod_centro_custo === CC_FINANCEIRO);
                          const isOpen = expandedContabils.has(contabil);
                          const toggleContabil = () =>
                            setExpandedContabils((prev) => {
                              const next = new Set(prev);
                              next.has(contabil) ? next.delete(contabil) : next.add(contabil);
                              return next;
                            });
                          return (
                            <React.Fragment key={contabil}>
                              <TableRow
                                className="bg-muted/30 hover:bg-muted/50 cursor-pointer select-none"
                                onClick={toggleContabil}
                              >
                                <TableCell className="py-2 pl-3 pr-0 w-6">
                                  {isOpen
                                    ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                                    : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                                </TableCell>
                                <TableCell className="py-2">
                                  <span className="font-mono font-semibold text-sm">{contabil}</span>
                                  {conta && (
                                    <span className="ml-2 text-xs text-muted-foreground">{conta.descricao}</span>
                                  )}
                                  {hasFinanceiro && (
                                    <Badge className="ml-2 text-[10px] py-0 h-4 bg-blue-100 text-blue-700 border-blue-200 hover:bg-blue-100">
                                      CC {CC_FINANCEIRO} ✓
                                    </Badge>
                                  )}
                                </TableCell>
                                <TableCell />
                                <TableCell className="text-xs text-muted-foreground py-2">
                                  {rows.length} CC{rows.length !== 1 ? "s" : ""}
                                </TableCell>
                                <TableCell className="text-right font-semibold font-mono text-sm tabular-nums py-2">
                                  {brl(rowTotal)}
                                </TableCell>
                              </TableRow>
                              {isOpen && rows.map((r) => (
                                <TableRow
                                  key={`${contabil}-${r.cod_centro_custo}`}
                                  className={r.cod_centro_custo === CC_FINANCEIRO ? "bg-blue-50/40" : ""}
                                >
                                  <TableCell />
                                  <TableCell />
                                  <TableCell className="text-center font-mono text-sm">
                                    <span className={cn(r.cod_centro_custo === CC_FINANCEIRO && "font-bold text-blue-600")}>
                                      {r.cod_centro_custo}
                                    </span>
                                  </TableCell>
                                  <TableCell className="text-sm text-muted-foreground">
                                    {centrosMap.get(r.cod_centro_custo)?.descricao ?? "—"}
                                    {r.cod_centro_custo === CC_FINANCEIRO && (
                                      <Badge variant="secondary" className="ml-2 text-[10px] py-0 h-4 text-blue-600">
                                        Financeiro
                                      </Badge>
                                    )}
                                  </TableCell>
                                  <TableCell className="text-right font-mono text-sm tabular-nums">
                                    {brl(Number(r.valor))}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </React.Fragment>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>

                  {/* Botão Selecionar */}
                  <div className="flex items-center gap-3">
                    <Button
                      onClick={handleSelecionar}
                      disabled={eligibleContabils.length === 0}
                    >
                      Selecionar
                    </Button>
                    {eligibleContabils.length === 0 ? (
                      <p className="text-sm text-amber-600">
                        Nenhuma conta com CC={CC_FINANCEIRO} (Financeiro) encontrada neste lançamento.
                      </p>
                    ) : !nbsSelected ? (
                      <p className="text-sm text-muted-foreground">
                        {eligibleContabils.length} conta{eligibleContabils.length !== 1 ? "s" : ""} com
                        CC={CC_FINANCEIRO} elegível{eligibleContabils.length !== 1 ? "is" : ""} para rateio.
                      </p>
                    ) : (
                      <p className="text-sm text-emerald-600">✓ Lançamento selecionado.</p>
                    )}
                  </div>

                  {/* Distribuição por Conta Contábil */}
                  {nbsSelected && ccDistrib.size > 0 && (
                    <div className="space-y-4 border-t pt-4">
                      <div>
                        <h3 className="text-sm font-semibold">Distribuição por Conta Contábil</h3>
                        <p className="text-xs text-muted-foreground mt-1">
                          Proporção calculada automaticamente com base nos CCs da nota original
                          (excluindo CC={CC_FINANCEIRO}). Ajuste se necessário.
                        </p>
                      </div>

                      {eligibleContabils.map((contabil) => {
                        const conta = contasMap.get(contabil);
                        const cc3Val = Number(
                          contabilGroups
                            .get(contabil)!
                            .find((r) => r.cod_centro_custo === CC_FINANCEIRO)?.valor ?? 0,
                        );
                        const distrib = ccDistrib.get(contabil) ?? new Map<number, number>();
                        const distribSum = Array.from(distrib.values()).reduce((s, v) => s + v, 0);
                        const distribOkLocal = Math.abs(distribSum - 100) < 0.01;

                        return (
                          <div key={contabil} className="rounded-md border p-4 space-y-3">
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <span className="font-mono font-semibold">{contabil}</span>
                                {conta && (
                                  <span className="ml-2 text-sm text-muted-foreground">
                                    {conta.descricao}
                                  </span>
                                )}
                              </div>
                              <div className="text-right shrink-0">
                                <span className="text-xs text-muted-foreground">Valor CC={CC_FINANCEIRO}: </span>
                                <span className="font-semibold font-mono text-sm">{brl(cc3Val)}</span>
                              </div>
                            </div>

                            <div className="space-y-2">
                              {Array.from(distrib.entries()).map(([cc, pct]) => {
                                const ccDesc = centrosMap.get(cc);
                                return (
                                  <div key={cc} className="flex items-center gap-3">
                                    <span className="font-mono text-sm w-8 shrink-0 text-right text-muted-foreground">
                                      {cc}
                                    </span>
                                    <span className="text-sm flex-1 truncate">
                                      {ccDesc?.descricao ?? "—"}
                                    </span>
                                    <div className="flex items-center gap-1 shrink-0">
                                      <Input
                                        type="number"
                                        min={0}
                                        max={100}
                                        step={0.001}
                                        value={pct}
                                        onChange={(e) => {
                                          const v = Number(e.target.value) || 0;
                                          setCcDistrib((prev) => {
                                            const next = new Map(prev);
                                            const m = new Map(next.get(contabil) ?? new Map());
                                            m.set(cc, v);
                                            next.set(contabil, m);
                                            return next;
                                          });
                                          setStep((s) => Math.min(s, 1) as 1 | 2 | 3);
                                        }}
                                        className="w-24 h-8 font-mono text-sm text-right"
                                      />
                                      <span className="text-sm text-muted-foreground w-4">%</span>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>

                            <div
                              className={cn(
                                "flex items-center justify-between rounded px-3 py-1.5 text-xs font-medium border",
                                distribOkLocal
                                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                  : "bg-red-50 text-red-700 border-red-200",
                              )}
                            >
                              <span>Total</span>
                              <span className="font-mono">{round2(distribSum).toFixed(3)}%</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button disabled={!canStep2} onClick={() => setStep(2)} className="gap-2">
              Próximo
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </>
      )}

      {/* ══════════════════════════════════
          STEP 2 — Empresas Participantes
      ══════════════════════════════════ */}
      {step === 2 && (
        <>
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle>Empresas Participantes</CardTitle>
                  <CardDescription>
                    Selecione as empresas que vão dividir o custo. O percentual será distribuído igualmente.
                  </CardDescription>
                </div>
                {selectedEmpsList.length > 0 && (
                  <Badge variant="default" className="shrink-0">
                    {selectedEmpsList.length} selecionada{selectedEmpsList.length !== 1 ? "s" : ""} · {round2(100 / selectedEmpsList.length).toFixed(2)}% cada
                  </Badge>
                )}
              </div>
            </CardHeader>

            <CardContent className="p-0">
              {loadingBase ? (
                <p className="text-sm text-muted-foreground p-6">Carregando…</p>
              ) : (
                <>
                  <div className="flex gap-2 px-4 pt-3 pb-2 border-b">
                    <div className="relative flex-1">
                      <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                      <Input
                        placeholder="Filtrar por nome…"
                        value={filterEmpNome}
                        onChange={(e) => setFilterEmpNome(e.target.value)}
                        className="pl-8 h-8 text-sm"
                      />
                    </div>
                    <Input
                      placeholder="Código"
                      value={filterEmpCod}
                      onChange={(e) => setFilterEmpCod(e.target.value)}
                      className="w-24 h-8 text-sm font-mono"
                    />
                    {(filterEmpNome || filterEmpCod) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 px-2 text-xs text-muted-foreground"
                        onClick={() => { setFilterEmpNome(""); setFilterEmpCod(""); }}
                      >
                        Limpar
                      </Button>
                    )}
                  </div>

                  <div className="max-h-64 overflow-y-auto divide-y">
                    {filteredEmpsList.length === 0 ? (
                      <p className="text-sm text-muted-foreground px-4 py-3">Nenhuma empresa encontrada.</p>
                    ) : (
                      filteredEmpsList.map((emp) => {
                        const isSelected = selectedEmps.has(emp.cod_empresa);
                        return (
                          <div
                            key={emp.cod_empresa}
                            className="flex items-center gap-3 px-4 py-2 cursor-pointer hover:bg-muted/40 transition-colors"
                            onClick={() => toggleEmp(emp.cod_empresa)}
                          >
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={() => toggleEmp(emp.cod_empresa)}
                              onClick={(e) => e.stopPropagation()}
                            />
                            <span className="text-sm flex-1">{emp.nome}</span>
                            <span className="text-xs text-muted-foreground font-mono shrink-0">{emp.cod_empresa}</span>
                          </div>
                        );
                      })
                    )}
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <div className="flex items-center justify-between">
            <Button variant="outline" onClick={() => setStep(1)} className="gap-2">
              <ChevronRight className="h-4 w-4 rotate-180" />
              Voltar
            </Button>
            <Button disabled={!canStep3} onClick={() => setStep(3)} className="gap-2">
              Próximo
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </>
      )}

      {/* ══════════════════════════════════
          STEP 3 — Prévia
      ══════════════════════════════════ */}
      {step === 3 && (
        <>
          <Card className="border-primary/40 shadow-md">
            <CardHeader>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle className="text-primary">Prévia dos Lançamentos</CardTitle>
                  <CardDescription>
                    {selectedEmpsList.length} empresa{selectedEmpsList.length !== 1 ? "s" : ""} ·{" "}
                    Total: <span className="font-semibold text-foreground">{brl(effectiveTotalGeral)}</span>
                    {valueOverrides.size > 0 && (
                      <span className="ml-2 text-amber-600">
                        ({valueOverrides.size} valor{valueOverrides.size !== 1 ? "es" : ""} editado{valueOverrides.size !== 1 ? "s" : ""})
                      </span>
                    )}
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    variant={editMode ? "default" : "outline"}
                    size="sm"
                    onClick={() => setEditMode((v) => !v)}
                    className="gap-2"
                  >
                    <Pencil className="h-4 w-4" />
                    {editMode ? "Editando" : "Editar"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPreviewMode((m) => m === "matrix" ? "table" : "matrix")}
                    className="gap-2"
                  >
                    <Table2 className="h-4 w-4" />
                    {previewMode === "matrix" ? "Ver Tabela" : "Ver Matriz"}
                  </Button>
                </div>
              </div>
            </CardHeader>

            <CardContent className={previewMode === "matrix" ? "space-y-8" : "p-0"}>
              {previewMode === "matrix" ? (
                /* ── MATRIX VIEW ── */
                matrizData.map(({ contabil, cc3Val, ccs, rows }) => {
                  const conta = contasMap.get(contabil);
                  // Apply overrides to get effective values for totals
                  const effectiveRows = rows.map(({ empresa, cells }) => {
                    const effectiveCells = new Map<number, number>();
                    for (const cc of ccs) {
                      const key = `${empresa.cod_empresa}-${contabil}-${cc}`;
                      effectiveCells.set(cc, valueOverrides.has(key) ? valueOverrides.get(key)! : (cells.get(cc) ?? 0));
                    }
                    const effectiveRowTotal = round2(Array.from(effectiveCells.values()).reduce((s, v) => s + v, 0));
                    return { empresa, effectiveCells, effectiveRowTotal };
                  });
                  const effectiveColTotals = new Map<number, number>();
                  for (const cc of ccs) {
                    effectiveColTotals.set(cc, round2(effectiveRows.reduce((s, r) => s + (r.effectiveCells.get(cc) ?? 0), 0)));
                  }
                  const effectiveMatrizTotal = round2(effectiveRows.reduce((s, r) => s + r.effectiveRowTotal, 0));
                  return (
                    <div key={contabil} className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono font-semibold">{contabil}</span>
                        {conta && (
                          <span className="text-sm text-muted-foreground">{conta.descricao}</span>
                        )}
                        <span className="ml-auto text-xs text-muted-foreground shrink-0">
                          Valor CC={CC_FINANCEIRO}:{" "}
                          <span className="font-semibold font-mono text-blue-700">{brl(cc3Val)}</span>
                        </span>
                      </div>
                      <div className="overflow-auto rounded-md border">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="min-w-[180px]">Empresa</TableHead>
                              {ccs.map((cc) => (
                                <TableHead key={cc} className="text-right min-w-[120px]">
                                  <div>CC {cc}</div>
                                  <div className="text-[10px] font-normal text-muted-foreground">
                                    {centrosMap.get(cc)?.descricao ?? ""}
                                  </div>
                                </TableHead>
                              ))}
                              <TableHead className="text-right min-w-[110px] font-bold">Total</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {effectiveRows.map(({ empresa, effectiveCells, effectiveRowTotal }) => (
                              <TableRow key={empresa.cod_empresa}>
                                <TableCell className="text-sm">
                                  <div>{empresa.nome}</div>
                                  <div className="text-xs text-muted-foreground font-mono">
                                    {empresa.cod_empresa}
                                  </div>
                                </TableCell>
                                {ccs.map((cc) => {
                                  const key = `${empresa.cod_empresa}-${contabil}-${cc}`;
                                  const val = effectiveCells.get(cc) ?? 0;
                                  const hasOverride = valueOverrides.has(key);
                                  return (
                                    <TableCell key={cc} className={cn("text-right p-1", hasOverride && "text-amber-700")}>
                                      {editMode ? (
                                        <Input
                                          type="number"
                                          step={0.01}
                                          value={val}
                                          onChange={(e) => {
                                            const v = parseFloat(e.target.value) || 0;
                                            setValueOverrides((prev) => {
                                              const next = new Map(prev);
                                              next.set(key, round2(v));
                                              return next;
                                            });
                                          }}
                                          className="h-7 w-28 text-right font-mono text-xs ml-auto"
                                        />
                                      ) : (
                                        <span className={cn("font-mono text-sm tabular-nums", hasOverride && "font-medium")}>
                                          {brl(val)}
                                        </span>
                                      )}
                                    </TableCell>
                                  );
                                })}
                                <TableCell className="text-right font-mono text-sm tabular-nums font-semibold">
                                  {brl(effectiveRowTotal)}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                          <TableFooter>
                            <TableRow>
                              <TableCell className="font-bold text-sm">Total</TableCell>
                              {ccs.map((cc) => (
                                <TableCell key={cc} className="text-right font-bold font-mono text-sm tabular-nums">
                                  {brl(effectiveColTotals.get(cc) ?? 0)}
                                </TableCell>
                              ))}
                              <TableCell className="text-right font-bold font-mono text-sm tabular-nums text-primary">
                                {brl(effectiveMatrizTotal)}
                              </TableCell>
                            </TableRow>
                          </TableFooter>
                        </Table>
                      </div>
                    </div>
                  );
                })
              ) : (
                /* ── TABLE VIEW ── */
                <div className="overflow-auto max-h-[60vh]">
                  <Table>
                    <TableHeader className="sticky top-0 bg-card z-10">
                      <TableRow>
                        <TableHead className="min-w-[180px]">Empresa</TableHead>
                        <TableHead className="min-w-[140px]">Conta Contábil</TableHead>
                        <TableHead className="w-16 text-center">CC</TableHead>
                        <TableHead className="text-right min-w-[110px]">Valor</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {linhas.map((l, i) => {
                        const key = `${l.cod_pagador}-${l.cod_conta_contabil}-${l.cod_centro_custo}`;
                        const hasOverride = valueOverrides.has(key);
                        const displayVal = hasOverride ? valueOverrides.get(key)! : l.valor;
                        const conta = contasMap.get(l.cod_conta_contabil);
                        return (
                          <TableRow key={i} className={hasOverride ? "bg-amber-50/40" : ""}>
                            <TableCell className="text-sm">
                              <div>{l.nome_pagador}</div>
                              <div className="text-xs text-muted-foreground font-mono">{l.cod_pagador}</div>
                            </TableCell>
                            <TableCell className="font-mono text-sm">
                              <div>{l.cod_conta_contabil}</div>
                              {conta && (
                                <div className="text-xs text-muted-foreground font-sans">{conta.descricao}</div>
                              )}
                            </TableCell>
                            <TableCell className="text-center font-mono text-sm">{l.cod_centro_custo}</TableCell>
                            <TableCell
                              className={cn(
                                "text-right tabular-nums text-sm p-1",
                                hasOverride && "text-amber-700",
                              )}
                            >
                              {editMode ? (
                                <Input
                                  type="number"
                                  step={0.01}
                                  value={displayVal}
                                  onChange={(e) => {
                                    const v = parseFloat(e.target.value) || 0;
                                    setValueOverrides((prev) => {
                                      const next = new Map(prev);
                                      next.set(key, round2(v));
                                      return next;
                                    });
                                  }}
                                  className="h-7 w-28 text-right font-mono text-xs ml-auto"
                                />
                              ) : (
                                <span className={cn(hasOverride && "font-medium")}>{brl(displayVal)}</span>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                    <TableFooter>
                      <TableRow>
                        <TableCell colSpan={3} className="text-sm font-bold">Total</TableCell>
                        <TableCell className="text-right font-bold text-sm tabular-nums text-primary">
                          {brl(effectiveTotalGeral)}
                        </TableCell>
                      </TableRow>
                    </TableFooter>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="flex items-center justify-between">
            <Button variant="outline" onClick={() => setStep(2)} className="gap-2">
              <ChevronRight className="h-4 w-4 rotate-180" />
              Voltar
            </Button>
            <Button onClick={handleExport} className="gap-2">
              <Download className="h-4 w-4" />
              Confirmar e Exportar XLSX
            </Button>
          </div>
        </>
      )}

    </div>
  );
}
