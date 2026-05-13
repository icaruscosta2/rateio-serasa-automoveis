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
import { Badge } from "@/components/ui/badge";
import { Upload, Search } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/conta-contabil")({
  component: () => (
    <AppLayout>
      <ContaContabilPage />
    </AppLayout>
  ),
});

interface ContaContabil {
  cod_contabil: string;
  descricao: string;
  cod_reduzido: number | null;
  tipo_conta: string | null;
  conta_ativa: boolean;
}

function ContaContabilPage() {
  const [rows, setRows] = useState<ContaContabil[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("conta_contabil")
      .select("*")
      .order("cod_contabil");
    if (error) toast.error(error.message);
    else setRows((data ?? []) as ContaContabil[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    if (!q) return rows;
    const ql = q.toLowerCase();
    return rows.filter(
      (r) =>
        r.descricao.toLowerCase().includes(ql) ||
        r.cod_contabil.includes(q) ||
        String(r.cod_reduzido ?? "").includes(q),
    );
  }, [rows, q]);

  const handleUpload = async (file: File) => {
    try {
      const buf = await file.arrayBuffer();
      const isCsv = file.name.toLowerCase().endsWith(".csv");
      let wb: XLSX.WorkBook;
      if (isCsv) {
        const text = new TextDecoder("windows-1252").decode(new Uint8Array(buf));
        wb = XLSX.read(text, { type: "string", FS: ";" });
      } else {
        wb = XLSX.read(buf, { type: "array" });
      }
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
        defval: null,
        raw: false,
      });
      if (!json.length) throw new Error("Arquivo vazio");

      const normKey = (s: string) =>
        s.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toUpperCase();
      const get = (row: Record<string, unknown>, ...keys: string[]) => {
        const targets = keys.map(normKey);
        for (const k of Object.keys(row)) {
          if (targets.includes(normKey(k))) return row[k];
        }
        return null;
      };

      const records = json
        .map((row) => {
          const cod = String(get(row, "COD_CONTABIL") ?? "").trim();
          if (!cod) return null;
          const reduzido = Number(get(row, "COD_REDUZIDO"));
          const ativoRaw = String(get(row, "CONTA_ATIVA") ?? "").trim();
          return {
            cod_contabil: cod,
            descricao: String(get(row, "DESCRICAO") ?? "").trim(),
            cod_reduzido: Number.isFinite(reduzido) && reduzido > 0 ? reduzido : null,
            tipo_conta: get(row, "TIPO_CONTA") ? String(get(row, "TIPO_CONTA")).trim().toUpperCase() : null,
            conta_ativa: ativoRaw === "1" || ativoRaw === "S" || ativoRaw === "TRUE",
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);

      if (!records.length) throw new Error("Nenhuma linha válida (COD_CONTABIL ausente)");

      const chunkSize = 200;
      for (let i = 0; i < records.length; i += chunkSize) {
        const { error } = await supabase
          .from("conta_contabil")
          .upsert(records.slice(i, i + chunkSize), { onConflict: "cod_contabil" });
        if (error) throw error;
      }
      toast.success(`${records.length} contas contábeis importadas`);
      load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Falha no upload");
    }
  };

  const ativas = rows.filter((r) => r.conta_ativa).length;
  const analiticas = rows.filter((r) => r.tipo_conta === "A").length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Conta Contábil</h1>
        <p className="text-muted-foreground">Cadastro utilizado na geração de lançamentos para o ERP</p>
      </div>

      {/* Stats */}
      {!loading && rows.length > 0 && (
        <div className="flex gap-3 flex-wrap">
          <Badge variant="secondary">{rows.length} total</Badge>
          <Badge variant="default">{ativas} ativas</Badge>
          <Badge variant="outline">{analiticas} analíticas</Badge>
        </div>
      )}

      {/* Upload */}
      <Card>
        <CardHeader>
          <CardTitle>Importar planilha</CardTitle>
          <CardDescription>CSV ou XLSX exportado do sistema. Colunas esperadas: COD_CONTABIL, DESCRICAO, COD_REDUZIDO, TIPO_CONTA, CONTA_ATIVA</CardDescription>
        </CardHeader>
        <CardContent>
          <div
            className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:border-primary transition-colors"
            onClick={() => fileRef.current?.click()}
          >
            <Upload className="h-7 w-7 mx-auto mb-2 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Clique para selecionar o arquivo (.csv ou .xlsx)</p>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleUpload(f);
              e.target.value = "";
            }}
          />
        </CardContent>
      </Card>

      {/* Tabela */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Search className="h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por código, descrição ou cód. reduzido…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="max-w-xs h-8 text-sm"
            />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <p className="text-sm text-muted-foreground p-6">Carregando…</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-28">Cód. Contábil</TableHead>
                  <TableHead>Descrição</TableHead>
                  <TableHead className="w-24">Cód. Reduzido</TableHead>
                  <TableHead className="w-24 text-center">Tipo</TableHead>
                  <TableHead className="w-20 text-center">Ativa</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                      {rows.length === 0 ? "Nenhum registro. Importe uma planilha." : "Nenhum resultado."}
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((r) => (
                    <TableRow key={r.cod_contabil}>
                      <TableCell className="font-mono text-sm">{r.cod_contabil}</TableCell>
                      <TableCell className="text-sm">{r.descricao}</TableCell>
                      <TableCell className="font-mono text-sm text-muted-foreground">
                        {r.cod_reduzido ?? "—"}
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge
                          variant={r.tipo_conta === "A" ? "default" : r.tipo_conta === "R" ? "destructive" : "secondary"}
                          className="text-xs"
                        >
                          {r.tipo_conta === "A" ? "Ativo" : r.tipo_conta === "P" ? "Passivo" : r.tipo_conta === "R" ? "Resultado" : (r.tipo_conta ?? "—")}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant={r.conta_ativa ? "default" : "outline"} className="text-xs">
                          {r.conta_ativa ? "Sim" : "Não"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
