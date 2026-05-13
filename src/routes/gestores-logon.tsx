import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/gestores-logon")({
  component: () => (
    <AppLayout>
      <GestoresLogonPage />
    </AppLayout>
  ),
});

const SEGMENTOS = ["AUTOMOVEIS", "PESADOS", "MOTOCICLETAS", "SERVICOS"];

interface GestorLogon {
  id: string;
  logon: string;
  segmento: string;
  ativo: boolean;
}

function GestoresLogonPage() {
  const [rows, setRows] = useState<GestorLogon[]>([]);
  const [loading, setLoading] = useState(true);
  const [logon, setLogon] = useState("");
  const [segmento, setSegmento] = useState("AUTOMOVEIS");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("gestores_logon")
      .select("*")
      .order("segmento")
      .order("logon");
    if (error) toast.error(error.message);
    else setRows((data ?? []) as GestorLogon[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const handleAdd = async () => {
    const logonNorm = logon.trim().toUpperCase();
    if (!logonNorm) {
      toast.error("Informe o logon.");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("gestores_logon").insert({
      logon: logonNorm,
      segmento,
      ativo: true,
    });
    if (error) {
      toast.error(error.message.includes("unique") ? "Este logon já está cadastrado." : error.message);
    } else {
      toast.success("Gestor adicionado.");
      setLogon("");
      load();
    }
    setSaving(false);
  };

  const toggleAtivo = async (id: string, value: boolean) => {
    const { error } = await supabase
      .from("gestores_logon")
      .update({ ativo: value })
      .eq("id", id);
    if (error) toast.error(error.message);
    else setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ativo: value } : r)));
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from("gestores_logon").delete().eq("id", id);
    if (error) toast.error(error.message);
    else {
      toast.success("Gestor removido.");
      setRows((prev) => prev.filter((r) => r.id !== id));
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Gestores — Consultas ADM Avulsas</h1>
        <p className="text-muted-foreground">
          Mapeamento de logons do Demonstrativo para segmentos. Logons cadastrados aqui
          são classificados como <strong>Consultas ADM Avulsas</strong> e distribuídos
          no rateio do segmento indicado.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Adicionar gestor</CardTitle>
          <CardDescription>
            Informe o logon exatamente como aparece na coluna <code>Nome do Logon</code> do
            Demonstrativo (maiúsculas, sem acento). Ex.: <code>REJANE</code>, <code>MARCIA GOMES</code>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-3 flex-wrap">
            <div className="space-y-1">
              <Label htmlFor="logon">Logon</Label>
              <Input
                id="logon"
                placeholder="NOME LOGON"
                value={logon}
                onChange={(e) => setLogon(e.target.value)}
                className="w-60"
                onKeyDown={(e) => e.key === "Enter" && handleAdd()}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="segmento">Segmento</Label>
              <select
                id="segmento"
                className="h-9 rounded-md border bg-background px-3 text-sm"
                value={segmento}
                onChange={(e) => setSegmento(e.target.value)}
              >
                {SEGMENTOS.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <Button onClick={handleAdd} disabled={saving}>
              <Plus className="h-4 w-4" /> Adicionar
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Lista</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Carregando…</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Logon</TableHead>
                  <TableHead>Segmento</TableHead>
                  <TableHead className="text-center">Ativo</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-sm">{r.logon}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{r.segmento}</Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      <Checkbox
                        checked={r.ativo}
                        onCheckedChange={(v) => toggleAtivo(r.id, !!v)}
                      />
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => handleDelete(r.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {!rows.length && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                      Nenhum gestor cadastrado.
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
