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
  is_matriz: boolean;
  ativo: boolean;
}

function EmpresasPage() {
  const [rows, setRows] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [seg, setSeg] = useState<string>("AUTOMOVEIS");
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

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (seg !== "TODOS" && r.segmento !== seg) return false;
      if (!q) return true;
      const ql = q.toLowerCase();
      return (
        r.nome.toLowerCase().includes(ql) ||
        (r.apelido ?? "").toLowerCase().includes(ql) ||
        (r.cnpj ?? "").includes(q) ||
        String(r.cod_empresa).includes(q)
      );
    });
  }, [rows, q, seg]);

  const stats = useMemo(() => {
    const auto = rows.filter((r) => r.segmento === "AUTOMOVEIS" && r.ativo);
    return {
      autoAtivas: auto.length,
      matrizes: auto.filter((r) => r.is_matriz).length,
    };
  }, [rows]);

  const handleUpload = async (file: File) => {
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf);
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
      if (!json.length) throw new Error("Planilha vazia");

      const records = json
        .map((row) => {
          const get = (...keys: string[]) => {
            for (const k of keys) {
              const found = Object.keys(row).find(
                (kk) => kk.trim().toLowerCase() === k.trim().toLowerCase(),
              );
              if (found) return row[found];
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
    const { error } = await supabase
      .from("companies")
      .update({ [field]: value })
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

      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total cadastradas</CardDescription>
            <CardTitle className="text-3xl">{rows.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Automóveis ativas</CardDescription>
            <CardTitle className="text-3xl">{stats.autoAtivas}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Matrizes Auto</CardDescription>
            <CardTitle className="text-3xl">{stats.matrizes}</CardTitle>
          </CardHeader>
        </Card>
      </div>

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

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <CardTitle>Lista</CardTitle>
            <div className="flex items-center gap-2">
              <select
                className="h-9 rounded-md border bg-background px-3 text-sm"
                value={seg}
                onChange={(e) => setSeg(e.target.value)}
              >
                <option value="AUTOMOVEIS">Automóveis</option>
                <option value="PESADOS">Pesados</option>
                <option value="MOTOCICLETAS">Motos</option>
                <option value="TODOS">Todos</option>
              </select>
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar nome, CNPJ, código…"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  className="pl-8 w-72"
                />
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Carregando…</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">Cód</TableHead>
                  <TableHead>Nome</TableHead>
                  <TableHead>CNPJ</TableHead>
                  <TableHead>UF</TableHead>
                  <TableHead>Bandeira</TableHead>
                  <TableHead className="text-center">Matriz</TableHead>
                  <TableHead className="text-center">Ativo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => (
                  <TableRow key={r.cod_empresa}>
                    <TableCell className="font-mono text-xs">{r.cod_empresa}</TableCell>
                    <TableCell>
                      <div>{r.nome}</div>
                      {r.apelido && (
                        <div className="text-xs text-muted-foreground">{r.apelido}</div>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{r.cnpj}</TableCell>
                    <TableCell>{r.estado}</TableCell>
                    <TableCell>
                      {r.bandeira && <Badge variant="outline">{r.bandeira}</Badge>}
                    </TableCell>
                    <TableCell className="text-center">
                      <Checkbox
                        checked={r.is_matriz}
                        onCheckedChange={(v) => toggleField(r.cod_empresa, "is_matriz", !!v)}
                      />
                    </TableCell>
                    <TableCell className="text-center">
                      <Checkbox
                        checked={r.ativo}
                        onCheckedChange={(v) => toggleField(r.cod_empresa, "ativo", !!v)}
                      />
                    </TableCell>
                  </TableRow>
                ))}
                {!filtered.length && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                      Nenhuma empresa. Importe a planilha acima.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
