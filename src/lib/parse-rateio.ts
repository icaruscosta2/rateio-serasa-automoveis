import * as XLSX from "xlsx";
import { normalizeCnpj } from "@/lib/cnpj";

export interface ParseResult {
  // Valores agregados do grupo (R$) — vindos do Demonstrativo
  consumoMinimoGrupo: number;
  pcFixoGrupo: number;
  pcAdicionalGrupo: number; // logon "PC CREDITO" menos F&I PEFIN PF/PJ
  fiGrupo: number; // PEFIN PF + PJ + linhas de outros usuários (exceto Rejane e PC CREDITO)
  admRateadoGrupo: number; // linhas da REJANE
  // Diagnóstico do Demonstrativo
  demoTotalLogonPcCredito: number;
  demoFiPefinPf: number;
  demoFiPefinPj: number;
  // Contagens por CNPJ normalizado (a partir da Intranet)
  intranetPorCnpj: Map<string, number>;
  intranetNovosPorCnpj: Map<string, number>;
  intranetSeminovosPorCnpj: Map<string, number>;
  // Único Auto — referência (mantida para diagnóstico)
  unicoAutoPorCnpj: Map<string, number>;
  // Power Curve Variável — base oficial para rateio do PC Adicional (consultas por CNPJ)
  // Numeradores: contagem por CNPJ APENAS das linhas que casam o filtro
  // (Automóveis + Consulta PF dos usuários permitidos).
  pcVariavelPorCnpj: Map<string, number>;
  // Denominador: TOTAL de linhas da aba Power Curve Variável (todas, sem filtro).
  // É essa proporção que define quanto do PC Adicional vai para Automóveis.
  pcVariavelTotalLinhas: number;
  pcVariavelLinhasAuto: number; // = soma dos numeradores filtrados
  // Diagnóstico
  abasEncontradas: string[];
  abasFaltando: string[];
  warnings: string[];
}

const PRODUTO_CONSUMO_MINIMO = "CONSUMO MINIMO";
const PRODUTO_PC_FIXO = "POWERCURVE CREDITO CONSUMO MINIMO";
const LOGON_PC_CREDITO = "PC CREDITO";
const FI_PRODUTOS = ["CREDNET SERASA PEFIN PF TOP", "CREDNET SERASA PEFIN PJ TOP"];
const REJANE = "REJANE";

function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

function findSheet(wb: XLSX.WorkBook, candidates: string[]): string | null {
  const map = new Map(wb.SheetNames.map((n) => [norm(n), n]));
  for (const c of candidates) {
    const hit = map.get(norm(c));
    if (hit) return hit;
  }
  for (const c of candidates) {
    const target = norm(c);
    for (const [k, v] of map) {
      if (k.includes(target)) return v;
    }
  }
  return null;
}

function toNumber(v: unknown): number {
  if (typeof v === "number") return v;
  if (v === null || v === undefined || v === "") return 0;
  const s = String(v).trim().replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Lê uma planilha como matriz e localiza a linha de cabeçalho que contém
 * todas as colunas obrigatórias (busca tolerante a acentos/caixa). Retorna
 * objetos { coluna -> valor } usando os nomes originais do cabeçalho.
 */
function sheetToRowsByHeader(
  ws: XLSX.WorkSheet,
  required: string[],
): Record<string, unknown>[] {
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    defval: null,
    blankrows: false,
  });
  const reqNorm = required.map(norm);
  let headerIdx = -1;
  let headers: string[] = [];
  for (let i = 0; i < Math.min(matrix.length, 30); i++) {
    const row = matrix[i] ?? [];
    const cells = row.map((c) => (c == null ? "" : String(c)));
    const cellsNorm = cells.map(norm);
    const allFound = reqNorm.every((r) => cellsNorm.some((c) => c === r));
    if (allFound) {
      headerIdx = i;
      headers = cells;
      break;
    }
  }
  if (headerIdx === -1) return [];
  const rows: Record<string, unknown>[] = [];
  for (let i = headerIdx + 1; i < matrix.length; i++) {
    const row = matrix[i] ?? [];
    const obj: Record<string, unknown> = {};
    let any = false;
    for (let j = 0; j < headers.length; j++) {
      const h = headers[j];
      if (!h) continue;
      const v = row[j] ?? null;
      obj[h] = v;
      if (v !== null && v !== "") any = true;
    }
    if (any) rows.push(obj);
  }
  return rows;
}

function get(row: Record<string, unknown>, name: string): unknown {
  const target = norm(name);
  for (const k of Object.keys(row)) {
    if (norm(k) === target) return row[k];
  }
  return null;
}

/** Match tolerante: ignora espaços, underscores, hífens e pontuação.
 *  Aceita igualdade ou inclusão. Use para colunas com nomes voláteis. */
function getLoose(row: Record<string, unknown>, ...candidates: string[]): unknown {
  const strip = (s: string) => norm(s).replace(/[^A-Z0-9]/g, "");
  const targets = candidates.map(strip).filter(Boolean);
  for (const k of Object.keys(row)) {
    const ks = strip(k);
    if (!ks) continue;
    if (targets.some((t) => ks === t || ks.includes(t) || t.includes(ks))) return row[k];
  }
  return null;
}

export function parseRateioWorkbook(buffer: ArrayBuffer): ParseResult {
  const wb = XLSX.read(buffer);
  const result: ParseResult = {
    consumoMinimoGrupo: 0,
    pcFixoGrupo: 0,
    pcAdicionalGrupo: 0,
    fiGrupo: 0,
    admRateadoGrupo: 0,
    demoTotalLogonPcCredito: 0,
    demoFiPefinPf: 0,
    demoFiPefinPj: 0,
    intranetPorCnpj: new Map(),
    intranetNovosPorCnpj: new Map(),
    intranetSeminovosPorCnpj: new Map(),
    unicoAutoPorCnpj: new Map(),
    pcVariavelPorCnpj: new Map(),
    pcVariavelTotalLinhas: 0,
    pcVariavelLinhasAuto: 0,
    abasEncontradas: wb.SheetNames,
    abasFaltando: [],
    warnings: [],
  };

  // ============= Demonstrativo =============
  const demoSheet = findSheet(wb, ["Demonstrativo"]);
  if (!demoSheet) {
    result.abasFaltando.push("Demonstrativo");
  } else {
    const rows = sheetToRowsByHeader(wb.Sheets[demoSheet], [
      "Descrição de Produto NF",
      "Nome do Logon",
      "ValorTotalLogon",
    ]);
    if (rows.length === 0) {
      result.warnings.push(
        "Demonstrativo: cabeçalho 'Descrição de Produto NF / Nome do Logon / ValorTotalLogon' não localizado.",
      );
    }
    let outrosFi = 0;
    for (const r of rows) {
      const produto = norm(String(get(r, "Descrição de Produto NF") ?? ""));
      const nomeLogon = norm(String(get(r, "Nome do Logon") ?? ""));
      const valor = toNumber(get(r, "ValorTotalLogon"));
      if (!produto) continue;

      // CONSUMO MINIMO (item dedicado, sem logon)
      if (produto === PRODUTO_CONSUMO_MINIMO) {
        result.consumoMinimoGrupo += valor;
        continue;
      }
      // POWER CURVE FIXO
      if (produto === PRODUTO_PC_FIXO) {
        result.pcFixoGrupo += valor;
        continue;
      }

      const isFiProduto = FI_PRODUTOS.some((p) => produto === norm(p));
      const isRejane = nomeLogon.includes(REJANE);
      const isLogonPcCredito = nomeLogon === LOGON_PC_CREDITO;

      // ADM Rateado: tudo da Rejane
      if (isRejane) {
        result.admRateadoGrupo += valor;
        continue;
      }

      // F&I PEFIN PF / PJ (tanto sob "PC CREDITO" quanto outros usuários)
      if (isFiProduto) {
        result.fiGrupo += valor;
        if (produto === norm(FI_PRODUTOS[0])) result.demoFiPefinPf += valor;
        else result.demoFiPefinPj += valor;
        if (isLogonPcCredito) result.demoTotalLogonPcCredito += valor;
        continue;
      }

      // Logon "PC CREDITO" (não-F&I) → PC Adicional
      if (isLogonPcCredito) {
        result.pcAdicionalGrupo += valor;
        result.demoTotalLogonPcCredito += valor;
        continue;
      }

      // Outros usuários (não Rejane, não PC CREDITO) → F&I
      result.fiGrupo += valor;
      outrosFi += valor;
    }
    if (outrosFi > 0) {
      result.warnings.push(
        `F&I: somados R$ ${outrosFi.toFixed(2)} de consultas avulsas de outros usuários (não Rejane).`,
      );
    }
  }

  // ============= Intranet =============
  const intranetSheet = findSheet(wb, ["Intranet", "Logon Intranet"]);
  if (!intranetSheet) {
    result.abasFaltando.push("Intranet");
  } else {
    const rows = sheetToRowsByHeader(wb.Sheets[intranetSheet], [
      "EMPRESA",
      "CNPJ",
    ]);
    if (rows.length === 0) {
      result.warnings.push("Intranet: cabeçalho 'EMPRESA / CNPJ' não localizado.");
    }
    for (const r of rows) {
      const cnpj = normalizeCnpj(get(r, "CNPJ"));
      if (!cnpj) continue;
      const depto = norm(String(get(r, "DEPARTAMENTO") ?? ""));
      result.intranetPorCnpj.set(
        cnpj,
        (result.intranetPorCnpj.get(cnpj) ?? 0) + 1,
      );
      if (depto.includes("SEMINOV")) {
        result.intranetSeminovosPorCnpj.set(
          cnpj,
          (result.intranetSeminovosPorCnpj.get(cnpj) ?? 0) + 1,
        );
      } else {
        // Conforme regra: departamento vazio ou não-SEMINOV → Novos
        result.intranetNovosPorCnpj.set(
          cnpj,
          (result.intranetNovosPorCnpj.get(cnpj) ?? 0) + 1,
        );
      }
    }
  }

  // ============= Único Auto (UNICOAUTO) =============
  const unicoSheet = findSheet(wb, ["UNICOAUTO", "Unico Auto", "Único Auto"]);
  if (!unicoSheet) {
    result.warnings.push(
      "Aba UNICOAUTO não encontrada — PC Adicional será rateado pela Intranet (fallback).",
    );
  } else {
    const rows = sheetToRowsByHeader(wb.Sheets[unicoSheet], ["CNPJ", "Estabelecimento"]);
    if (rows.length === 0) {
      result.warnings.push("UNICOAUTO: cabeçalho 'CNPJ / Estabelecimento' não localizado.");
    }
    for (const r of rows) {
      const cnpj = normalizeCnpj(get(r, "CNPJ"));
      if (!cnpj) continue;
      result.unicoAutoPorCnpj.set(cnpj, (result.unicoAutoPorCnpj.get(cnpj) ?? 0) + 1);
    }
  }

  // ============= Power Curve Variável =============
  // Conta consultas por CNPJ. Cada linha = 1 consulta (usuário fez na PC Variável).
  const pcvSheet = findSheet(wb, [
    "Power Curve Variavel",
    "Power Curve Variável",
    "PowerCurve Variavel",
    "PC Variavel",
    "Variavel",
  ]);
  if (!pcvSheet) {
    result.warnings.push(
      "Aba 'Power Curve Variável' não encontrada — PC Adicional cairá em fallback (Único Auto / Intranet).",
    );
  } else {
    // Aceita cabeçalhos com "CNPJ" + "subproduto2" + "user_id".
    let rows = sheetToRowsByHeader(wb.Sheets[pcvSheet], ["CNPJ", "subproduto2", "user_id"]);
    if (rows.length === 0) {
      rows = sheetToRowsByHeader(wb.Sheets[pcvSheet], ["CNPJ", "subproduto2"]);
    }
    if (rows.length === 0) {
      rows = sheetToRowsByHeader(wb.Sheets[pcvSheet], ["CNPJ"]);
    }
    if (rows.length === 0) {
      result.warnings.push("Power Curve Variável: cabeçalho 'CNPJ' não localizado.");
    }
    // Filtro: subproduto2 = "Automóveis" OU
    //        (subproduto2 = "Consulta PF" E user_id ∈ allowlist)
    const PCV_USERS_PF = new Set([
      "aleff.cordeiro@revemar.com.br",
      "ana.vitoria@revemar.com.br",
    ].map((s) => s.toLowerCase()));
    let pcvAuto = 0;
    let pcvPf = 0;
    let pcvDescartadas = 0;
    let pcvTotal = 0;
    const sub2Counts = new Map<string, number>();
    let userPreenchido = 0;
    for (const r of rows) {
      pcvTotal++;
      const cnpj = normalizeCnpj(get(r, "CNPJ"));
      const sub2Raw = String(getLoose(r, "subproduto2", "sub produto 2", "subproduto 2") ?? "");
      const sub2 = norm(sub2Raw);
      const user = String(getLoose(r, "user_id", "userid", "usuario", "user") ?? "")
        .trim()
        .toLowerCase();
      if (sub2Raw.trim()) sub2Counts.set(sub2Raw.trim(), (sub2Counts.get(sub2Raw.trim()) ?? 0) + 1);
      if (user) userPreenchido++;
      const isAuto = sub2 === norm("Automóveis") || sub2 === norm("Automoveis");
      const isPfPermitido =
        (sub2 === norm("Consulta PF") || sub2.includes("CONSULTA PF")) &&
        PCV_USERS_PF.has(user);
      if (!isAuto && !isPfPermitido) {
        pcvDescartadas++;
        continue;
      }
      if (isAuto) pcvAuto++;
      else pcvPf++;
      // Não indexamos por CNPJ: o CNPJ desta aba é do CLIENTE da consulta,
      // não da concessionária. A distribuição entre lojas é feita por Único
      // Auto (ou fallback Intranet), não pela PCV.
      void cnpj;
    }
    result.pcVariavelTotalLinhas = pcvTotal;
    result.pcVariavelLinhasAuto = pcvAuto + pcvPf;
    const pctAuto = pcvTotal > 0 ? ((pcvAuto + pcvPf) / pcvTotal) * 100 : 0;
    result.warnings.push(
      `Power Curve Variável: ${pcvAuto + pcvPf}/${pcvTotal} linhas para Automóveis (${pctAuto.toFixed(2)}%) — ${pcvAuto} Automóveis + ${pcvPf} Consulta PF (Aleff/Ana); ${pcvDescartadas} descartadas.`,
    );
    // Diagnóstico extra quando o filtro descarta tudo (ou quase tudo)
    if (pcvTotal > 0 && pcvAuto + pcvPf === 0) {
      const colsDetectadas = rows[0] ? Object.keys(rows[0]).join(" | ") : "(nenhuma)";
      const topSub2 = Array.from(sub2Counts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([v, c]) => `"${v}" (${c})`)
        .join(", ") || "(coluna subproduto2 vazia em todas as linhas)";
      result.warnings.push(
        `Power Curve Variável — diagnóstico: colunas detectadas: ${colsDetectadas}. Top valores de subproduto2: ${topSub2}. Linhas com user_id preenchido: ${userPreenchido}.`,
      );
    }
  }

  return result;
}
