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

export const Route = createFileRoute("/centro-custo")({
  component: () => (
    <AppLayout>
      <CentroCustoPage />
    </AppLayout>
  ),
});

interface CentroCusto {
  cod_centro_custo: number;
  descricao: string;
  apelido: string | null;
  conta: string | null;
  tipo_conta: string | null;
  ccusto_ativo: boolean;
}

function CentroCustoPage() {
  const [rows, setRows] = useState<CentroCusto[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("centro_custo")
      .select("*")
      .order("cod_centro_custo");
    if (error) toast.error(error.message);
    else setRows((data ?? []) as CentroCusto[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    if (!q) return rows;
    const ql = q.toLowerCase();
    return rows.filter(
      (r) =>
        r.descricao.toLowerCase().includes(ql) ||
        String(r.cod_centro_custo).includes(q) ||
        (r.apelido ?? "").toLowerCase().includes(ql) ||
        (r.conta ?? "").includes(q),
    );
  }, [rows, q]);

  const handleUpload = async (file: File) => {
    try {
      const buf = await file.arrayBuffer();
      const isCsv = file.name.toLowerCase().endsWith(".csv");
      let wb: XLSX.WorkBook;
      if (isCsv) {
        // CSVs exportados de sistemas brasileiros usam ; como separador e encoding Latin-1
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
          const cod = Number(get(row, "COD_CENTRO_CUSTO"));
          if (!Number.isFinite(cod) || cod === 0) return null;
          const ativoRaw = String(get(row, "CCUSTO_ATIVO") ?? "").toUpperCase();
          return {
            cod_centro_custo: cod,
            descricao: String(get(row, "DESCRICAO") ?? "").trim(),
            apelido: get(row, "APELIDO") ? String(get(row, "APELIDO")).trim() : null,
            conta: get(row, "CONTA") ? String(get(row, "CONTA")).trim() : null,
            tipo_conta: get(row, "TIPO_CONTA") ? String(get(row, "TIPO_CONTA")).trim().toUpperCase() : null,
            ccusto_ativo: ativoRaw === "S" || ativoRaw === "1" || ativoRaw === "TRUE",
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);

      if (!records.length) throw new Error("Nenhuma linha válida (COD_CENTRO_CUSTO ausente)");

      const chunkSize = 200;
      for (let i = 0; i < records.length; i += chunkSize) {
        const { error } = await supabase
          .from("centro_custo")
          .upsert(records.slice(i, i + chunkSize), { onConflict: "cod_centro_custo" });
        if (error) throw error;
      }
      toast.success(`${records.length} centros de custo importados`);
      load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Falha no upload");
    }
  };

  const ativos   = rows.filter((r) => r.ccusto_ativo).length;
  const analiticos = rows.filter((r) => r.tipo_conta === "A").length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Centro de Custo</h1>
        <p className="text-muted-foreground">Cadastro utilizado na geração de lançamentos para o ERP</p>
      </div>

      {/* Stats */}
      {!loading && rows.length > 0 && (
        <div className="flex gap-3 flex-wrap">
          <Badge variant="secondary">{rows.length} total</Badge>
          <Badge variant="default">{ativos} ativos</Badge>
          <Badge variant="outline">{analiticos} analíticos</Badge>
        </div>
      )}

      {/* Upload */}
      <Card>
        <CardHeader>
          <CardTitle>Importar planilha</CardTitle>
          <CardDescription>CSV ou XLSX exportado do sistema. Colunas esperadas: COD_CENTRO_CUSTO, DESCRICAO, APELIDO, CONTA, TIPO_CONTA, CCUSTO_ATIVO</CardDescription>
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
              placeholder="Buscar por código, descrição ou apelido…"
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
                  <TableHead className="w-20">Código</TableHead>
                  <TableHead>Descrição</TableHead>
                  <TableHead className="w-20">Apelido</TableHead>
                  <TableHead className="w-20">Conta</TableHead>
                  <TableHead className="w-20 text-center">Tipo</TableHead>
                  <TableHead className="w-20 text-center">Ativo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                      {rows.length === 0 ? "Nenhum registro. Importe uma planilha." : "Nenhum resultado."}
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((r) => (
                    <TableRow key={r.cod_centro_custo}>
                      <TableCell className="font-mono text-sm">{r.cod_centro_custo}</TableCell>
                      <TableCell className="text-sm">{r.descricao}</TableCell>
                      <TableCell className="font-mono text-sm">{r.apelido ?? "—"}</TableCell>
                      <TableCell className="font-mono text-sm">{r.conta ?? "—"}</TableCell>
                      <TableCell className="text-center">
                        <Badge variant={r.tipo_conta === "A" ? "default" : "secondary"} className="text-xs">
                          {r.tipo_conta === "A" ? "Analítico" : r.tipo_conta === "S" ? "Sintético" : (r.tipo_conta ?? "—")}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant={r.ccusto_ativo ? "default" : "outline"} className="text-xs">
                          {r.ccusto_ativo ? "Sim" : "Não"}
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
