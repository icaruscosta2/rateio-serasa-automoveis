import { createFileRoute, useNavigate } from "@tanstack/react-router";
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
import { Upload, ChevronRight, ChevronLeft, Check } from "lucide-react";
import { toast } from "sonner";
import { parseRateioWorkbook, type ParseResult } from "@/lib/parse-rateio";
import { brl, intBR } from "@/lib/format";
import { computeRateio } from "@/lib/compute-rateio";
import { isBandeiraExcluida } from "@/lib/segmentos";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/rateios/novo")({
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

  const [pct, setPct] = useState({
    consumoMinimo: 0.56, pcFixo: 0.667, pcAdicional: 0.56, fi: 0.56, adm: 0.56,
  });
  const [saving, setSaving] = useState(false);

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
          // Default: desmarca MASSEY (tratores), JCB (máquinas) e VW CAMINHOES.
          const b = (r.bandeira ?? "")
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toUpperCase()
            .trim();
          const offByDefault = b === "MASSEY" || b === "JCB" || b === "VW CAMINHOES";
          init[r.cod_empresa] = { incluida: !offByDefault, matriz: r.is_matriz };
        });
        setSel(init);
      });
  }, []);

  const doParse = async (f: File) => {
    setParsing(true);
    try {
      const buf = await f.arrayBuffer();
      const result = parseRateioWorkbook(buf);
      if (result.abasFaltando.length) {
        toast.warning(
          `Abas não encontradas: ${result.abasFaltando.join(", ")}. Encontradas: ${result.abasEncontradas.join(", ")}`,
        );
      }
      setParsed(result);
      setFile(f);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Falha ao ler planilha");
    } finally {
      setParsing(false);
    }
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
    });
  }, [parsed, companies, sel, pct]);

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
            <CardTitle>1. Mês e Upload</CardTitle>
            <CardDescription>
              Envie a planilha mensal contendo as abas <strong>Demonstrativo</strong>, <strong>Intranet</strong> e <strong>Power Curve Variável</strong>.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="max-w-xs">
              <Label htmlFor="mes">Mês de referência</Label>
              <Input id="mes" type="month" value={mes} onChange={(e) => setMes(e.target.value)} />
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) doParse(f);
                e.target.value = "";
              }}
            />
            <Button onClick={() => fileRef.current?.click()} disabled={parsing}>
              <Upload className="h-4 w-4" /> {parsing ? "Lendo…" : file ? "Trocar arquivo" : "Enviar planilha"}
            </Button>
            {file && <p className="text-sm text-muted-foreground">{file.name}</p>}

            {parsed && (
              <div className="border rounded-md p-4 space-y-3 bg-muted/30">
                <h3 className="font-medium">Resumo extraído (grupo todo)</h3>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>Consumo Mínimo: <strong>{brl(parsed.consumoMinimoGrupo)}</strong></div>
                  <div>Power Curve Fixo: <strong>{brl(parsed.pcFixoGrupo)}</strong></div>
                  <div>PC Adicional (logon PC CREDITO): <strong>{brl(parsed.pcAdicionalGrupo)}</strong></div>
                  <div>F&I / Cadastros: <strong>{brl(parsed.fiGrupo)}</strong></div>
                  <div>ADM Rateado (Rejane): <strong>{brl(parsed.admRateadoGrupo)}</strong></div>
                  <div className="text-muted-foreground">Total grupo: <strong>{brl(parsed.consumoMinimoGrupo + parsed.pcFixoGrupo + parsed.pcAdicionalGrupo + parsed.fiGrupo + parsed.admRateadoGrupo)}</strong></div>
                </div>
                <div className="text-xs text-muted-foreground">
                  Demonstrativo — F&I PEFIN PF: {brl(parsed.demoFiPefinPf)} · F&I PEFIN PJ: {brl(parsed.demoFiPefinPj)} · Logon "PC CREDITO" total: {brl(parsed.demoTotalLogonPcCredito)}
                </div>
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
              <Button onClick={() => setStep(2)} disabled={!parsed}>
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

      {step === 3 && parsed && preview && (
        <Card>
          <CardHeader>
            <CardTitle>3. Percentuais e confirmação</CardTitle>
            <CardDescription>
              Ajuste os % do grupo Automóveis para Consumo Mínimo (Monitoramento) e Power Curve Fixo. As demais rubricas são rateadas por contagem de consultas.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-2 gap-4 max-w-md">
              {(
                [
                  ["consumoMinimo", "Consumo Mínimo (Monitoramento)"],
                  ["pcFixo", "Power Curve Fixo"],
                ] as const
              ).map(([k, label]) => (
                <div key={k}>
                  <Label className="text-xs">{label}</Label>
                  <Input
                    type="number"
                    step="0.001"
                    min="0"
                    max="1"
                    value={pct[k]}
                    onChange={(e) => setPct({ ...pct, [k]: Number(e.target.value) })}
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">
                    {(pct[k] * 100).toFixed(1)}%
                  </p>
                </div>
              ))}
            </div>

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
                      <Badge variant="outline">ADM: {brl(preview.fatiaAuto.adm)}</Badge>
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
              <Button onClick={handleSave} disabled={saving}>
                <Check className="h-4 w-4" /> {saving ? "Gerando…" : "Gerar RESUMO RATEIO"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
