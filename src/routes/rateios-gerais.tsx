import { createFileRoute } from "@tanstack/react-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { AppLayout } from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { buscarNbsNotaServer } from "@/lib/nbs-oracle";
import type { NbsRow } from "@/lib/nbs-mock-data";
import { segmentoDaBandeira } from "@/lib/segmentos";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  Plus,
  RefreshCw,
  Search,
  Table2,
  X,
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
  cnpj: string | null;
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

interface HistoricoEmpresa {
  cod: number;
  nome: string;
  bandeira: string | null;
  nr_nd: string;
  valor: number;
}

interface HistoricoEntry {
  id: string;
  data: string;
  numero_nota: number;
  controle: string;
  nr_processo: string;
  pagadora: string;
  bandeira: string | null;
  total_empresas: number;
  valor_total: number;
  contabils: { cod: string; valor: number }[];
  empresas: HistoricoEmpresa[];
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

/* Distribui cc3Val entre N empresas × M CCs usando aritmética inteira de centavos. */
function allocateRateio(
  cc3Val: number,
  distrib: Map<number, number>,
  n: number,
): Map<number, number[]> {
  const totalCents = Math.round(cc3Val * 100);
  const ccs = Array.from(distrib.keys()).sort((a, b) => a - b);

  const rawCcCents = ccs.map((cc) => totalCents * (distrib.get(cc)! / 100));
  const floorCcCents = rawCcCents.map((x) => Math.floor(x));
  const ccRemainder = totalCents - floorCcCents.reduce((s, v) => s + v, 0);
  const ccByFrac = [...Array(ccs.length).keys()].sort(
    (a, b) => (rawCcCents[b] - floorCcCents[b]) - (rawCcCents[a] - floorCcCents[a]),
  );
  const ccCents = [...floorCcCents];
  for (let i = 0; i < ccRemainder; i++) ccCents[ccByFrac[i]]++;

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
  forceOpen,
  indent = false,
  children,
  onSelectAll,
  onDeselectAll,
}: {
  title: string;
  count: number;
  selectedCount: number;
  defaultOpen?: boolean;
  forceOpen?: boolean;
  indent?: boolean;
  children: React.ReactNode;
  onSelectAll: () => void;
  onDeselectAll: () => void;
}) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const open = forceOpen !== undefined ? forceOpen : internalOpen;
  const allSelected = selectedCount === count && count > 0;
  const someSelected = selectedCount > 0 && !allSelected;

  return (
    <div className={cn("border rounded-md overflow-hidden", indent && "border-muted ml-4")}>
      <div
        className={cn(
          "flex items-center gap-2 px-3 py-2 cursor-pointer select-none",
          indent ? "bg-muted/20" : "bg-muted/50",
        )}
        onClick={() => setInternalOpen((o) => !o)}
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

  /* ── Abas principais ── */
  const [activeTab, setActiveTab] = useState<"rateio" | "historico">("rateio");

  /* ── Nº Processo ── */
  const [nrProcesso, setNrProcesso] = useState("");

  /* ── Busca NBS ── */
  const [searchEmpCod, setSearchEmpCod] = useState("");
  const [searchNota, setSearchNota] = useState("");

  /* ── Histórico expandido ── */
  const [expandedHistorico, setExpandedHistorico] = useState<Set<string>>(new Set());
  const [searching, setSearching] = useState(false);
  const [nbsLinhas, setNbsLinhas] = useState<NbsRow[]>([]);
  const [nbsSelected, setNbsSelected] = useState(false);

  /* ── Distribuição CC por contábil ── */
  const [ccDistrib, setCcDistrib] = useState<Map<string, Map<number, number>>>(new Map());

  /* ── Overrides de valor CC=3 por contábil (editável) ── */
  const [cc3ValOverrides, setCc3ValOverrides] = useState<Map<string, number>>(new Map());

  /* ── Contábils adicionados manualmente (não vêm da nota NBS) ── */
  const [addedContabils, setAddedContabils] = useState<string[]>([]);

  /* ── Diálogo: adicionar CC a um contábil ── */
  const [addCCContabil, setAddCCContabil] = useState<string | null>(null);
  const [addCCCode, setAddCCCode] = useState("");

  /* ── Diálogo: adicionar conta contábil ── */
  const [addContabilOpen, setAddContabilOpen] = useState(false);
  const [addContabilCod, setAddContabilCod] = useState("");
  const [addContabilCc3Val, setAddContabilCc3Val] = useState("");

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
          .select("cod_empresa, nome, bandeira, cnpj")
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

  /* ─────────── Grupos filtrados para Step 2 ─────────── */
  const hasEmpFilter = !!(filterEmpNome.trim() || filterEmpCod.trim());

  const filteredEmpsBySegBandeira = useMemo(() => {
    if (!hasEmpFilter) return empresasBySegBandeira;
    const nome = filterEmpNome.toLowerCase().trim();
    const cod = filterEmpCod.trim();
    return empresasBySegBandeira
      .map(({ seg, bandeiras }) => ({
        seg,
        bandeiras: bandeiras
          .map(({ band, emps }) => ({
            band,
            emps: emps.filter((e) => {
              if (nome && !e.nome.toLowerCase().includes(nome)) return false;
              if (cod && !String(e.cod_empresa).includes(cod)) return false;
              return true;
            }),
          }))
          .filter((b) => b.emps.length > 0),
      }))
      .filter((s) => s.bandeiras.length > 0);
  }, [empresasBySegBandeira, filterEmpNome, filterEmpCod, hasEmpFilter]);

  /* ─────────── Derivados: nota NBS ─────────── */
  const notaInfo = useMemo(() => {
    if (nbsLinhas.length === 0) return null;
    const f = nbsLinhas[0];
    return {
      cod_empresa: f.cod_empresa,
      numero_nota: f.numero_nota,
      controle: f.controle,
      data_entrada: f.data_entrada,
      data_vencimento: f.data_vencimento,
    };
  }, [nbsLinhas]);

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

  const eligibleContabils = useMemo(() => {
    const result: string[] = [];
    for (const [c, rows] of contabilGroups) {
      if (rows.some((r) => r.cod_centro_custo === CC_FINANCEIRO)) result.push(c);
    }
    return result.sort();
  }, [contabilGroups]);

  /* Todos os contábils para rateio: NBS elegíveis + adicionados manualmente */
  const allContabilsForRateio = useMemo(() => {
    const s = new Set([...eligibleContabils, ...addedContabils]);
    return Array.from(s).sort();
  }, [eligibleContabils, addedContabils]);

  /* Helper: valor CC=3 efetivo (override ou original da nota) */
  const getCC3Val = useCallback(
    (contabil: string): number => {
      if (cc3ValOverrides.has(contabil)) return cc3ValOverrides.get(contabil)!;
      return Number(
        contabilGroups.get(contabil)?.find((r) => r.cod_centro_custo === CC_FINANCEIRO)?.valor ?? 0,
      );
    },
    [cc3ValOverrides, contabilGroups],
  );

  /* ─────────── Busca NBS ─────────── */
  const handleBuscar = useCallback(async () => {
    const empNum = Number(searchEmpCod);
    const notaNum = Number(searchNota);
    if (!empNum || !notaNum) {
      toast.error("Informe a empresa e o número da nota.");
      return;
    }
    setSearching(true);
    setNbsLinhas([]);
    setNbsSelected(false);
    setCcDistrib(new Map());
    setCc3ValOverrides(new Map());
    setAddedContabils([]);
    setStep((s) => Math.min(s, 1) as 1 | 2 | 3);
    try {
      const resultado = await buscarNbsNotaServer({ data: { numeroNota: notaNum, codEmpresa: empNum } });
      if (resultado.length === 0) {
        toast.error("Nota não encontrada para esta empresa.");
        return;
      }
      setNbsLinhas(resultado as NbsRow[]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Erro: ${msg}`);
      console.error(err);
    } finally {
      setSearching(false);
    }
  }, [searchEmpCod, searchNota]);

  /* ─────────── Selecionar nota → inicializa distribuição de CCs ─────────── */
  const handleSelecionar = useCallback(() => {
    const distrib = new Map<string, Map<number, number>>();

    for (const contabil of eligibleContabils) {
      const rows = contabilGroups.get(contabil)!;
      const others = rows.filter((r) => r.cod_centro_custo !== CC_FINANCEIRO);

      if (others.length === 0) {
        // Contábil com apenas CC=3: inicializa vazio, usuário deve adicionar CCs
        distrib.set(contabil, new Map());
        continue;
      }

      const totalOthers = others.reduce((s, r) => s + Number(r.valor), 0);
      const pcts = others.map((r) => ({
        cc: r.cod_centro_custo,
        pct: totalOthers > 0
          ? round2((Number(r.valor) / totalOthers) * 100)
          : round2(100 / others.length),
      }));
      const sumPcts = pcts.reduce((s, x) => s + x.pct, 0);
      const diff = round2(100 - sumPcts);
      pcts[pcts.length - 1].pct = round2(pcts[pcts.length - 1].pct + diff);

      const ccMap = new Map<number, number>();
      for (const { cc, pct } of pcts) ccMap.set(cc, pct);
      distrib.set(contabil, ccMap);
    }

    setCcDistrib(distrib);
    setCc3ValOverrides(new Map());
    setAddedContabils([]);
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

  /* ─────────── Validação para prévia ─────────── */
  const distribOk =
    allContabilsForRateio.length > 0 &&
    allContabilsForRateio.every((c) => {
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
    return allContabilsForRateio.map((contabil) => {
      const distrib = ccDistrib.get(contabil);
      if (!distrib || distrib.size === 0) return null;
      const cc3Val = getCC3Val(contabil);
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
    }).filter(Boolean) as NonNullable<ReturnType<typeof allocateRateio>> extends Map<number, number[]> ? never : {
      contabil: string; cc3Val: number; ccs: number[];
      rows: { empresa: Empresa; cells: Map<number, number>; rowTotal: number }[];
      colTotals: Map<number, number>; matrizTotal: number;
    }[];
  }, [canPreview, step, allContabilsForRateio, ccDistrib, getCC3Val, selectedEmpsList]);

  /* ─────────── Linhas geradas ─────────── */
  const linhas = useMemo<LinhaLancamento[]>(() => {
    if (!canPreview || step !== 3 || !notaInfo) return [];
    const result: LinhaLancamento[] = [];

    for (const contabil of allContabilsForRateio) {
      const distrib = ccDistrib.get(contabil);
      if (!distrib || distrib.size === 0) continue;
      const cc3Val = getCC3Val(contabil);

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
            nr_fatura: notaInfo.controle,
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
    canPreview, step, notaInfo, allContabilsForRateio,
    ccDistrib, getCC3Val, selectedEmpsList, empresasMap,
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
          "DATA RATEIO": formatDate(l.data_rateio),
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

      const contabilTotals: { cod: string; valor: number }[] = allContabilsForRateio
        .map((c) => {
          const distrib = ccDistrib.get(c);
          if (!distrib || distrib.size === 0) return null;
          return { cod: c, valor: round2(getCC3Val(c)) };
        })
        .filter(Boolean) as { cod: string; valor: number }[];
      const empresasHistorico: HistoricoEmpresa[] = selectedEmpsList.map((emp) => {
        const valorEmp = round2(
          linhas
            .filter((l) => l.cod_pagador === emp.cod_empresa)
            .reduce((s, l) => {
              const key = `${l.cod_pagador}-${l.cod_conta_contabil}-${l.cod_centro_custo}`;
              return s + (valueOverrides.has(key) ? valueOverrides.get(key)! : l.valor);
            }, 0),
        );
        return {
          cod: emp.cod_empresa,
          nome: emp.nome,
          bandeira: emp.bandeira ?? null,
          nr_nd: String(Math.floor(10000000 + Math.random() * 89999999)),
          valor: valorEmp,
        };
      });
      const pagadoraEmp = empresasMap.get(notaInfo?.cod_empresa ?? 0);
      const entry: HistoricoEntry = {
        id: crypto.randomUUID(),
        data: todayIso(),
        numero_nota: notaInfo?.numero_nota ?? 0,
        controle: notaInfo?.controle ?? "",
        nr_processo: nrProcesso,
        pagadora: pagadoraEmp?.nome ?? String(notaInfo?.cod_empresa ?? ""),
        bandeira: pagadoraEmp?.bandeira ?? null,
        total_empresas: selectedEmpsList.length,
        valor_total: round2(effectiveTotalGeral),
        contabils: contabilTotals,
        empresas: empresasHistorico,
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
          Consulte a nota no NBS e distribua o valor entre as empresas participantes.
        </p>
      </div>

      {/* ── Abas ── */}
      <div className="flex gap-1 border-b">
        {(["rateio", "historico"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={cn(
              "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
              activeTab === tab
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab === "rateio" ? "Novo Rateio" : (
              <span className="flex items-center gap-1.5">
                <History className="h-3.5 w-3.5" />
                Histórico
                {historico.length > 0 && (
                  <span className="ml-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-mono">
                    {historico.length}
                  </span>
                )}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ══════════════════════════════════
          ABA: Histórico
      ══════════════════════════════════ */}
      {activeTab === "historico" && (
        <div className="space-y-3">
          {historico.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              Nenhum rateio exportado ainda.
            </p>
          ) : (
            historico.map((h) => {
              const expanded = expandedHistorico.has(h.id);
              const toggleExpand = () =>
                setExpandedHistorico((prev) => {
                  const next = new Set(prev);
                  next.has(h.id) ? next.delete(h.id) : next.add(h.id);
                  return next;
                });
              return (
                <Card key={h.id}>
                  <CardContent className="pt-3 pb-3 px-4 space-y-2">
                    {/* cabeçalho */}
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={toggleExpand} className="shrink-0 text-muted-foreground hover:text-foreground">
                        {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </button>
                      <div className="flex-1 min-w-0 cursor-pointer space-y-0.5" onClick={toggleExpand}>
                        <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
                          <span>
                            <span className="text-muted-foreground">Nota: </span>
                            <span className="font-mono font-semibold">{h.numero_nota}</span>
                          </span>
                          <span>
                            <span className="text-muted-foreground">Controle: </span>
                            <span className="font-mono text-xs">{h.controle}</span>
                          </span>
                          {h.nr_processo && (
                            <span>
                              <span className="text-muted-foreground">Processo: </span>
                              <span className="font-mono text-xs">{h.nr_processo}</span>
                            </span>
                          )}
                          <span className="text-muted-foreground text-xs">
                            {new Date(h.data + "T12:00:00").toLocaleDateString("pt-BR")}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-x-4 gap-y-1 items-center">
                          <span className="font-medium text-sm">{h.pagadora}</span>
                          {h.bandeira && <Badge variant="secondary" className="text-[10px] h-4">{h.bandeira}</Badge>}
                          <span className="text-xs text-muted-foreground">
                            {h.total_empresas} empresa{h.total_empresas !== 1 ? "s" : ""}
                          </span>
                        </div>
                        {h.contabils?.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 pt-0.5">
                            {h.contabils.map((c) => (
                              <span key={c.cod} className="rounded bg-muted/60 px-1.5 py-0.5 text-[10px] font-mono">
                                {c.cod} <span className="font-semibold">{brl(c.valor)}</span>
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="font-semibold tabular-nums text-sm">{brl(h.valor_total)}</span>
                        <button
                          type="button"
                          title="Remover"
                          className="text-muted-foreground/40 hover:text-destructive transition-colors"
                          onClick={() => {
                            const updated = historico.filter((x) => x.id !== h.id);
                            localStorage.setItem(HISTORICO_KEY, JSON.stringify(updated));
                            setHistorico(updated);
                          }}
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    </div>

                    {/* tabela por empresa */}
                    {expanded && h.empresas?.length > 0 && (
                      <div className="rounded-md border overflow-auto mt-1">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Empresa</TableHead>
                              <TableHead>Bandeira</TableHead>
                              <TableHead className="font-mono">Nº ND</TableHead>
                              <TableHead className="text-right">Valor Rateado</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {h.empresas.map((e) => (
                              <TableRow key={e.cod}>
                                <TableCell className="text-sm">
                                  <div>{e.nome}</div>
                                  <div className="text-xs text-muted-foreground font-mono">{e.cod}</div>
                                </TableCell>
                                <TableCell className="text-xs text-muted-foreground">{e.bandeira ?? "—"}</TableCell>
                                <TableCell className="font-mono text-sm font-semibold">{e.nr_nd}</TableCell>
                                <TableCell className="text-right font-mono text-sm tabular-nums font-semibold">{brl(e.valor)}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                          <TableFooter>
                            <TableRow>
                              <TableCell colSpan={3} className="font-bold text-sm">Total</TableCell>
                              <TableCell className="text-right font-bold font-mono text-sm tabular-nums text-primary">
                                {brl(h.valor_total)}
                              </TableCell>
                            </TableRow>
                          </TableFooter>
                        </Table>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>
      )}

      {activeTab === "rateio" && (<>

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
                  <label className="text-sm font-medium">Empresa <span className="text-destructive">*</span></label>
                  <Select value={searchEmpCod} onValueChange={setSearchEmpCod}>
                    <SelectTrigger className="w-64">
                      <SelectValue placeholder="Selecione a empresa…" />
                    </SelectTrigger>
                    <SelectContent>
                      {empresas.map((e) => (
                        <SelectItem key={e.cod_empresa} value={String(e.cod_empresa)}>
                          {e.nome}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Nº Nota <span className="text-destructive">*</span></label>
                  <Input
                    placeholder="Ex: 52817873"
                    value={searchNota}
                    onChange={(e) => setSearchNota(e.target.value)}
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
                      <span className="text-muted-foreground">Nota: </span>
                      <span className="font-semibold font-mono">{notaInfo.numero_nota}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Controle: </span>
                      <span className="font-mono text-xs">{notaInfo.controle}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Empresa: </span>
                      <span className="font-semibold font-mono">{notaInfo.cod_empresa}</span>
                      {empresasMap.get(notaInfo.cod_empresa) && (
                        <span className="ml-1 text-muted-foreground">
                          — {empresasMap.get(notaInfo.cod_empresa)?.nome}
                        </span>
                      )}
                    </div>
                    {empresasMap.get(notaInfo.cod_empresa)?.cnpj && (
                      <div>
                        <span className="text-muted-foreground">CNPJ: </span>
                        <span className="font-mono text-xs">{empresasMap.get(notaInfo.cod_empresa)?.cnpj}</span>
                      </div>
                    )}
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

                  {/* Tabela de linhas agrupada por contábil */}
                  <div className="rounded-md border overflow-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-6" />
                          <TableHead>Conta Contábil</TableHead>
                          <TableHead className="w-20 text-center">CC</TableHead>
                          <TableHead>Descrição CC</TableHead>
                          <TableHead className="text-right">Valor</TableHead>
                          <TableHead className="text-right text-blue-700">Valor Rateio</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {Array.from(contabilGroups.entries()).map(([contabil, rows]) => {
                          const conta = contasMap.get(contabil);
                          const rowTotal = rows.reduce((s, r) => s + Number(r.valor), 0);
                          const hasFinanceiro = rows.some((r) => r.cod_centro_custo === CC_FINANCEIRO);
                          const cc3ValRow = rows
                            .filter((r) => r.cod_centro_custo === CC_FINANCEIRO)
                            .reduce((s, r) => s + Number(r.valor), 0);
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
                                <TableCell className="text-xs text-muted-foreground py-2 text-center">
                                  {rows.length} CC{rows.length !== 1 ? "s" : ""}
                                </TableCell>
                                <TableCell />
                                <TableCell className="text-right font-semibold font-mono text-sm tabular-nums py-2">
                                  {brl(rowTotal)}
                                </TableCell>
                                <TableCell className="text-right font-semibold font-mono text-sm tabular-nums py-2 text-blue-700">
                                  {hasFinanceiro ? brl(cc3ValRow) : "—"}
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
                                  <TableCell className="text-right font-mono text-sm tabular-nums text-blue-700">
                                    {r.cod_centro_custo === CC_FINANCEIRO ? brl(Number(r.valor)) : ""}
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

                      {allContabilsForRateio.filter((c) => ccDistrib.has(c)).map((contabil) => {
                        const conta = contasMap.get(contabil);
                        const cc3ValOriginal = Number(
                          contabilGroups
                            .get(contabil)
                            ?.find((r) => r.cod_centro_custo === CC_FINANCEIRO)?.valor ?? 0,
                        );
                        const cc3ValEffective = getCC3Val(contabil);
                        const distrib = ccDistrib.get(contabil) ?? new Map<number, number>();
                        const distribSum = Array.from(distrib.values()).reduce((s, v) => s + v, 0);
                        const distribOkLocal = Math.abs(distribSum - 100) < 0.01;
                        const isAdded = addedContabils.includes(contabil);

                        return (
                          <div key={contabil} className="rounded-md border p-4 space-y-3">
                            {/* Header do card */}
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <span className="font-mono font-semibold">{contabil}</span>
                                {conta && (
                                  <span className="ml-2 text-sm text-muted-foreground">
                                    {conta.descricao}
                                  </span>
                                )}
                                {isAdded && (
                                  <Badge variant="secondary" className="ml-2 text-[10px]">
                                    Adicionado
                                  </Badge>
                                )}
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <div className="text-right">
                                  <span className="text-xs text-muted-foreground">
                                    Valor CC={CC_FINANCEIRO}:
                                  </span>
                                  <div className="flex items-center gap-1 mt-0.5">
                                    <Input
                                      type="number"
                                      min={0}
                                      step={0.01}
                                      value={cc3ValEffective}
                                      onChange={(e) => {
                                        const v = parseFloat(e.target.value) || 0;
                                        setCc3ValOverrides((prev) => new Map(prev).set(contabil, round2(v)));
                                        setStep((s) => Math.min(s, 1) as 1 | 2 | 3);
                                      }}
                                      className="w-28 h-7 font-mono text-sm text-right"
                                    />
                                    {cc3ValOverrides.has(contabil) && cc3ValOriginal > 0 && (
                                      <button
                                        type="button"
                                        title="Restaurar valor original"
                                        className="text-xs text-muted-foreground hover:text-foreground"
                                        onClick={() => {
                                          setCc3ValOverrides((prev) => {
                                            const next = new Map(prev);
                                            next.delete(contabil);
                                            return next;
                                          });
                                          setStep((s) => Math.min(s, 1) as 1 | 2 | 3);
                                        }}
                                      >
                                        <RefreshCw className="h-3.5 w-3.5" />
                                      </button>
                                    )}
                                  </div>
                                </div>
                                {isAdded && (
                                  <button
                                    type="button"
                                    title="Remover conta contábil"
                                    className="text-muted-foreground/40 hover:text-destructive transition-colors"
                                    onClick={() => {
                                      setAddedContabils((prev) => prev.filter((c) => c !== contabil));
                                      setCcDistrib((prev) => {
                                        const next = new Map(prev);
                                        next.delete(contabil);
                                        return next;
                                      });
                                      setCc3ValOverrides((prev) => {
                                        const next = new Map(prev);
                                        next.delete(contabil);
                                        return next;
                                      });
                                      setStep((s) => Math.min(s, 1) as 1 | 2 | 3);
                                    }}
                                  >
                                    <X className="h-4 w-4" />
                                  </button>
                                )}
                              </div>
                            </div>

                            {/* Linhas de CC */}
                            {distrib.size === 0 ? (
                              <p className="text-xs text-amber-600 italic">
                                Nenhum CC de destino configurado. Adicione ao menos um CC abaixo.
                              </p>
                            ) : (
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
                                        <button
                                          type="button"
                                          title="Remover CC"
                                          className="text-muted-foreground/40 hover:text-destructive transition-colors ml-1"
                                          onClick={() => {
                                            setCcDistrib((prev) => {
                                              const next = new Map(prev);
                                              const m = new Map(next.get(contabil) ?? new Map());
                                              m.delete(cc);
                                              next.set(contabil, m);
                                              return next;
                                            });
                                            setStep((s) => Math.min(s, 1) as 1 | 2 | 3);
                                          }}
                                        >
                                          <X className="h-3.5 w-3.5" />
                                        </button>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}

                            {/* Total % + botão adicionar CC */}
                            <div className="flex items-center gap-2">
                              <div
                                className={cn(
                                  "flex-1 flex items-center justify-between rounded px-3 py-1.5 text-xs font-medium border",
                                  distribOkLocal
                                    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                    : "bg-red-50 text-red-700 border-red-200",
                                )}
                              >
                                <span>Total</span>
                                <span className="font-mono">{round2(distribSum).toFixed(3)}%</span>
                              </div>
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 gap-1 text-xs shrink-0"
                                onClick={() => {
                                  setAddCCContabil(contabil);
                                  setAddCCCode("");
                                }}
                              >
                                <Plus className="h-3 w-3" />
                                CC
                              </Button>
                            </div>
                          </div>
                        );
                      })}

                      {/* Botão adicionar conta contábil */}
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-2"
                        onClick={() => {
                          setAddContabilCod("");
                          setAddContabilCc3Val("");
                          setAddContabilOpen(true);
                        }}
                      >
                        <Plus className="h-4 w-4" />
                        Adicionar Conta Contábil
                      </Button>
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
                  {/* Filtros */}
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
                    {hasEmpFilter && (
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

                  {/* Grupos Segmento → Bandeira */}
                  <div className="max-h-96 overflow-y-auto p-3 space-y-2">
                    {filteredEmpsBySegBandeira.length === 0 ? (
                      <p className="text-sm text-muted-foreground px-1 py-2">Nenhuma empresa encontrada.</p>
                    ) : (
                      filteredEmpsBySegBandeira.map(({ seg, bandeiras }) => {
                        const segEmps = bandeiras.flatMap((b) => b.emps);
                        const segSelected = segEmps.filter((e) => selectedEmps.has(e.cod_empresa)).length;
                        return (
                          <CollapseGroup
                            key={seg}
                            title={seg}
                            count={segEmps.length}
                            selectedCount={segSelected}
                            defaultOpen={false}
                            forceOpen={hasEmpFilter ? true : undefined}
                            onSelectAll={() => selectAllEmps(segEmps.map((e) => e.cod_empresa))}
                            onDeselectAll={() => deselectAllEmps(segEmps.map((e) => e.cod_empresa))}
                          >
                            <div className="p-2 space-y-1.5">
                              {bandeiras.map(({ band, emps }) => {
                                const bandSelected = emps.filter((e) => selectedEmps.has(e.cod_empresa)).length;
                                return (
                                  <CollapseGroup
                                    key={band}
                                    title={band}
                                    count={emps.length}
                                    selectedCount={bandSelected}
                                    defaultOpen={false}
                                    forceOpen={hasEmpFilter ? true : undefined}
                                    indent
                                    onSelectAll={() => selectAllEmps(emps.map((e) => e.cod_empresa))}
                                    onDeselectAll={() => deselectAllEmps(emps.map((e) => e.cod_empresa))}
                                  >
                                    {emps.map((emp) => {
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
                                    })}
                                  </CollapseGroup>
                                );
                              })}
                            </div>
                          </CollapseGroup>
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
                (matrizData as Array<{
                  contabil: string; cc3Val: number; ccs: number[];
                  rows: { empresa: Empresa; cells: Map<number, number>; rowTotal: number }[];
                  colTotals: Map<number, number>; matrizTotal: number;
                }>).map(({ contabil, cc3Val, ccs, rows }) => {
                  const conta = contasMap.get(contabil);
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

      {/* ══════════════════════════════════
          DIÁLOGO: Adicionar CC
      ══════════════════════════════════ */}
      <Dialog open={addCCContabil !== null} onOpenChange={(open) => !open && setAddCCContabil(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Adicionar Centro de Custo</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <p className="text-xs text-muted-foreground">
              Conta: <span className="font-mono font-medium">{addCCContabil}</span>
            </p>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Centro de Custo</label>
              <select
                value={addCCCode}
                onChange={(e) => setAddCCCode(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">Selecione…</option>
                {centrosTodos
                  .filter(
                    (cc) =>
                      cc.cod_centro_custo !== CC_FINANCEIRO &&
                      !(ccDistrib.get(addCCContabil ?? "")?.has(cc.cod_centro_custo) ?? false),
                  )
                  .map((cc) => (
                    <option key={cc.cod_centro_custo} value={cc.cod_centro_custo}>
                      {cc.cod_centro_custo} — {cc.descricao}
                    </option>
                  ))}
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddCCContabil(null)}>Cancelar</Button>
            <Button
              disabled={!addCCCode}
              onClick={() => {
                if (!addCCCode || !addCCContabil) return;
                const cc = Number(addCCCode);
                setCcDistrib((prev) => {
                  const next = new Map(prev);
                  const m = new Map(next.get(addCCContabil) ?? new Map());
                  if (!m.has(cc)) {
                    const currentSum = Array.from(m.values()).reduce((s, v) => s + v, 0);
                    m.set(cc, Math.max(0, round2(100 - currentSum)));
                  }
                  next.set(addCCContabil, m);
                  return next;
                });
                setAddCCContabil(null);
                setAddCCCode("");
                setStep((s) => Math.min(s, 1) as 1 | 2 | 3);
              }}
            >
              Adicionar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      </>) /* end activeTab === "rateio" */}

      {/* ══════════════════════════════════
          DIÁLOGO: Adicionar Conta Contábil
      ══════════════════════════════════ */}
      <Dialog open={addContabilOpen} onOpenChange={setAddContabilOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Adicionar Conta Contábil</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Conta Contábil</label>
              <select
                value={addContabilCod}
                onChange={(e) => setAddContabilCod(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">Selecione…</option>
                {contas
                  .filter((c) => !allContabilsForRateio.includes(c.cod_contabil))
                  .map((c) => (
                    <option key={c.cod_contabil} value={c.cod_contabil}>
                      {c.cod_contabil} — {c.descricao}
                    </option>
                  ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                Valor para Rateio (CC={CC_FINANCEIRO})
              </label>
              <Input
                type="number"
                min={0}
                step={0.01}
                placeholder="0,00"
                value={addContabilCc3Val}
                onChange={(e) => setAddContabilCc3Val(e.target.value)}
                className="font-mono"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddContabilOpen(false)}>Cancelar</Button>
            <Button
              disabled={!addContabilCod}
              onClick={() => {
                if (!addContabilCod) return toast.error("Selecione uma conta contábil.");
                const val = parseFloat(addContabilCc3Val) || 0;
                if (val <= 0) return toast.error("Informe o valor para rateio.");
                setAddedContabils((prev) => [...prev, addContabilCod]);
                setCc3ValOverrides((prev) => new Map(prev).set(addContabilCod, round2(val)));
                setCcDistrib((prev) => new Map(prev).set(addContabilCod, new Map()));
                setAddContabilOpen(false);
                setAddContabilCod("");
                setAddContabilCc3Val("");
                setStep((s) => Math.min(s, 1) as 1 | 2 | 3);
                toast.success("Conta contábil adicionada.");
              }}
            >
              Adicionar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
