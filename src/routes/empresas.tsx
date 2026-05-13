import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { AppLayout } from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Upload, Search } from "lucide-react";
import { toast } from "sonner";
import { normalizeCnpj, formatCnpj } from "@/lib/cnpj";

export const Route = createFileRoute("/empresas")({
  component: () => (
    <AppLayout>
      <EmpresasPage />
    </AppLayout>
  ),
});

interface Company {
  cod_empresa: number;
  nome: string;
  apelido: string | null;
  cnpj: string | null;
  cnpj_normalizado: string | null;
  estado: string | null;
  cidade: string | null;
  cod_empresa_principal: number | null;
  segmento: string | null;
  bandeira: string | null;
  tipo_negocio: string | null;
  is_matriz: boolean;
  ativo: boolean;
}

type TipoKey = "AUTOS" | "CONTABEIS";

function getTipo(tipo_negocio: string | null): TipoKey {
  const t = (tipo_negocio ?? "").toUpperCase();
  if (t.includes("CONT")) return "CONTABEIS";
  return "AUTOS";
}

const TIPO_LABELS: Record<TipoKey, string> = {
  AUTOS: "Autos",
  CONTABEIS: "Contábeis",
};

const TIPO_ORDER: TipoKey[] = ["AUTOS", "CONTABEIS"];

function EmpresasPage() {
  const [rows, setRows] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("companies")
      .select("*")
      .order("nome")
      .limit(2000);
    if (error) toast.error(error.message);
    else setRows((data ?? []) as Company[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  // Filter by search query
  const filtered = useMemo(() => {
    if (!q) return rows;
    const ql = q.toLowerCase();
    return rows.filter(
      (r) =>
        r.nome.toLowerCase().includes(ql) ||
        (r.apelido ?? "").toLowerCase().includes(ql) ||
        (r.cnpj ?? "").includes(q) ||
        String(r.cod_empresa).includes(q) ||
        (r.bandeira ?? "").toLowerCase().includes(ql),
    );
  }, [rows, q]);

  // Two-level grouping: tipo → bandeira → companies
  const grouped = useMemo(() => {
    const result: Record<TipoKey, Map<string, Company[]>> = {
      AUTOS: new Map(),
      CONTABEIS: new Map(),
    };
    for (const r of filtered) {
      const tipo = getTipo(r.tipo_negocio);
      const bandeira = r.bandeira ?? "(sem bandeira)";
      if (!result[tipo].has(bandeira)) result[tipo].set(bandeira, []);
      result[tipo].get(bandeira)!.push(r);
    }
    // Sort bandeiras alphabetically within each tipo
    for (const tipo of TIPO_ORDER) {
      result[tipo] = new Map([...result[tipo]].sort(([a], [b]) => a.localeCompare(b)));
    }
    return result;
  }, [filtered]);

  const stats = useMemo(() => {
    const auto = rows.filter((r) => r.ativo);
    return {
      total: rows.length,
      autos: rows.filter((r) => getTipo(r.tipo_negocio) === "AUTOS").length,
      contabeis: rows.filter((r) => getTipo(r.tipo_negocio) === "CONTABEIS").length,
      matrizes: auto.filter((r) => r.is_matriz).length,
    };
  }, [rows]);

  const handleUpload = async (file: File) => {
    try {
      const buf = await file.arrayBuffer();
      const isCsv = file.name.toLowerCase().endsWith(".csv");
      let wb: XLSX.WorkBook;
      if (isCsv) {
        const text = new TextDecoder("windows-1252").decode(new Uint8Array(buf));
        wb = XLSX.read(text, { type: "string", FS: ";" });
      } else {
        wb = XLSX.read(buf);
      }
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
      if (!json.length) throw new Error("Planilha vazia");

      const records = json
        .map((row) => {
          const normKey = (s: string) =>
            s.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
          const get = (...keys: string[]) => {
            const targets = keys.map(normKey);
            for (const kk of Object.keys(row)) {
              if (targets.includes(normKey(kk))) return row[kk];
            }
            return null;
          };
          const cod = Number(get("COD_EMPRESA"));
          if (!Number.isFinite(cod)) return null;
          const principal = Number(get("COD_EMPRESA_PRINCIPAL")) || null;
          const cnpjRaw = get("CGC", "CNPJ");
          const cnpjNorm = cnpjRaw ? normalizeCnpj(cnpjRaw) : null;
          return {
            cod_empresa: cod,
            nome: String(get("NOME") ?? ""),
            apelido: get("APELIDO") ? String(get("APELIDO")) : null,
            cnpj: cnpjNorm ? formatCnpj(cnpjNorm) : (cnpjRaw ? String(cnpjRaw) : null),
            cnpj_normalizado: cnpjNorm,
            estado: get("ESTADO") ? String(get("ESTADO")) : null,
            cidade: get("CIDADE") ? String(get("CIDADE")) : null,
            cod_empresa_principal: principal,
            cod_matriz: Number(get("COD_MATRIZ")) || null,
            segmento: get("SEGMENTO") ? String(get("SEGMENTO")).toUpperCase() : null,
            bandeira: get("BANDEIRA") ? String(get("BANDEIRA")) : null,
            tipo_negocio: get("TIPO_NEGOCIO", "TIPO NEGOCIO", "AUTOS / CONTÁBIL", "AUTOS / CONTABIL", "AUTOS/CONTABIL") ? String(get("TIPO_NEGOCIO", "TIPO NEGOCIO", "AUTOS / CONTÁBIL", "AUTOS / CONTABIL", "AUTOS/CONTABIL")) : null,
            grupo_empresa: get("GRUPO_EMPRESA") ? String(get("GRUPO_EMPRESA")) : null,
            is_matriz: principal !== null && principal === cod,
            ativo: true,
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);

      if (!records.length) throw new Error("Nenhuma linha válida (COD_EMPRESA ausente)");

      // upsert em chunks
      const chunkSize = 200;
      for (let i = 0; i < records.length; i += chunkSize) {
        const slice = records.slice(i, i + chunkSize);
        const { error } = await supabase.from("companies").upsert(slice, {
          onConflict: "cod_empresa",
        });
        if (error) throw error;
      }
      toast.success(`${records.length} empresas importadas`);
      load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Falha no upload");
    }
  };

  const toggleField = async (cod: number, field: "ativo" | "is_matriz", value: boolean) => {
    const patch = field === "ativo" ? { ativo: value } : { is_matriz: value };
    const { error } = await supabase
      .from("companies")
      .update(patch)
      .eq("cod_empresa", cod);
    if (error) toast.error(error.message);
    else setRows((prev) => prev.map((r) => (r.cod_empresa === cod ? { ...r, [field]: value } : r)));
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Empresas</h1>
        <p className="text-muted-foreground">Base do grupo Revemar</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total cadastradas</CardDescription>
            <CardTitle className="text-3xl">{stats.total}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Autos</CardDescription>
            <CardTitle className="text-3xl">{stats.autos}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Contábeis</CardDescription>
            <CardTitle className="text-3xl">{stats.contabeis}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Matrizes</CardDescription>
            <CardTitle className="text-3xl">{stats.matrizes}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* Upload */}
      <Card>
        <CardHeader>
          <CardTitle>Importar / Atualizar planilha</CardTitle>
          <CardDescription>
            Envie a planilha "Empresas - Revemar" (.xlsx). Atualiza por COD_EMPRESA.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleUpload(f);
              e.target.value = "";
            }}
          />
          <Button onClick={() => fileRef.current?.click()}>
            <Upload className="h-4 w-4" /> Enviar planilha
          </Button>
        </CardContent>
      </Card>

      {/* Lista com agrupamento */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <CardTitle>Lista</CardTitle>
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar nome, CNPJ, bandeira, código…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="pl-8 w-80"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Carregando…</p>
          ) : (
            <Accordion type="multiple" className="w-full" defaultValue={["AUTOS"]}>
              {TIPO_ORDER.map((tipo) => {
                const bandeiraMap = grouped[tipo];
                const totalTipo = Array.from(bandeiraMap.values()).reduce(
                  (acc, arr) => acc + arr.length,
                  0,
                );
                if (totalTipo === 0) return null;
                return (
                  <AccordionItem key={tipo} value={tipo}>
                    <AccordionTrigger className="hover:no-underline">
                      <div className="flex items-center gap-3 flex-1">
                        <span className="font-bold text-base">{TIPO_LABELS[tipo]}</span>
                        <Badge variant="secondary">{totalTipo}</Badge>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="pb-0">
                      <Accordion type="multiple" className="w-full pl-4">
                        {Array.from(bandeiraMap.entries()).map(([bandeira, lojas]) => (
                          <AccordionItem key={bandeira} value={`${tipo}-${bandeira}`}>
                            <AccordionTrigger className="hover:no-underline py-3">
                              <div className="flex items-center gap-3 flex-1">
                                <span className="font-semibold">{bandeira}</span>
                                <Badge variant="outline">{lojas.length}</Badge>
                              </div>
                            </AccordionTrigger>
                            <AccordionContent>
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead className="w-16">Cód</TableHead>
                                    <TableHead>Nome</TableHead>
                                    <TableHead>CNPJ</TableHead>
                                    <TableHead>UF / Cidade</TableHead>
                                    <TableHead className="text-center w-20">Matriz</TableHead>
                                    <TableHead className="text-center w-20">Ativo</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {lojas.map((r) => (
                                    <TableRow key={r.cod_empresa}>
                                      <TableCell className="font-mono text-xs">
                                        {r.cod_empresa}
                                      </TableCell>
                                      <TableCell>
                                        <div>{r.nome}</div>
                                        {r.apelido && (
                                          <div className="text-xs text-muted-foreground">
                                            {r.apelido}
                                          </div>
                                        )}
                                      </TableCell>
                                      <TableCell className="font-mono text-xs">{r.cnpj}</TableCell>
                                      <TableCell className="text-xs">
                                        {[r.estado, r.cidade].filter(Boolean).join(" · ")}
                                      </TableCell>
                                      <TableCell className="text-center">
                                        <Checkbox
                                          checked={r.is_matriz}
                                          onCheckedChange={(v) =>
                                            toggleField(r.cod_empresa, "is_matriz", !!v)
                                          }
                                        />
                                      </TableCell>
                                      <TableCell className="text-center">
                                        <Checkbox
                                          checked={r.ativo}
                                          onCheckedChange={(v) =>
                                            toggleField(r.cod_empresa, "ativo", !!v)
                                          }
                                        />
                                      </TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            </AccordionContent>
                          </AccordionItem>
                        ))}
                      </Accordion>
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
              {filtered.length === 0 && (
                <p className="text-center text-muted-foreground py-8 text-sm">
                  Nenhuma empresa encontrada.
                </p>
              )}
            </Accordion>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
