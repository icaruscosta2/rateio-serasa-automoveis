import * as XLSX from "xlsx";
import { normalizeCnpj } from "@/lib/cnpj";

export interface DemonstrativoRow {
  produto: string;
  usuario: string | null;
  valor: number;
  qtd: number;
}

export interface ParseResult {
  // Valores agregados do grupo (R$)
  consumoMinimoGrupo: number;
  pcFixoGrupo: number;
  pcCreditoTotalGrupo: number; // soma de tudo PC CRÉDITO
  fiPefinPfPjGrupo: number; // CREDNET SERASA PEFIN PF/PJ TOP
  pcAdicionalGrupo: number; // PC CRÉDITO total - F&I
  admRateadoGrupo: number; // todas as linhas da REJANE
  // Contagens por CNPJ normalizado
  intranetPorCnpj: Map<string, number>;
  unicoAutoNovosPorCnpj: Map<string, number>;
  unicoAutoSeminovosPorCnpj: Map<string, number>;
  // Power Curve por segmento (para aplicar % no PC Adicional)
  pcSegmentoTotais: { auto: number; pesados: number; motos: number; outros: number };
  pcAutoPorCnpj: Map<string, number>;
  // diagnostico
  abasEncontradas: string[];
  abasFaltando: string[];
}

const FI_KEYWORDS = ["CREDNET SERASA PEFIN PF TOP", "CREDNET SERASA PEFIN PJ TOP"];
const REJANE = "REJANE";

function findSheet(wb: XLSX.WorkBook, candidates: string[]): string | null {
  const normalize = (s: string) =>
    s
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  const map = new Map(wb.SheetNames.map((n) => [normalize(n), n]));
  for (const c of candidates) {
    const hit = map.get(normalize(c));
    if (hit) return hit;
  }
  // contains-match
  for (const c of candidates) {
    const target = normalize(c);
    for (const [k, v] of map) {
      if (k.includes(target)) return v;
    }
  }
  return null;
}

function toNumber(v: unknown): number {
  if (typeof v === "number") return v;
  if (v === null || v === undefined) return 0;
  const s = String(v).trim().replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function getCol(row: Record<string, unknown>, ...names: string[]): unknown {
  const keys = Object.keys(row);
  for (const n of names) {
    const target = n.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
    const found = keys.find((k) => {
      const nk = k.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
      return nk === target || nk.includes(target);
    });
    if (found && row[found] !== null && row[found] !== "") return row[found];
  }
  return null;
}

function isAuto(seg: string): boolean {
  const s = seg.toUpperCase();
  return s.includes("AUTOMOV") || s.includes("AUTO");
}
function isPesados(seg: string): boolean {
  return seg.toUpperCase().includes("PESAD");
}
function isMotos(seg: string): boolean {
  const s = seg.toUpperCase();
  return s.includes("MOTO");
}

export function parseRateioWorkbook(buffer: ArrayBuffer): ParseResult {
  const wb = XLSX.read(buffer);
  const result: ParseResult = {
    consumoMinimoGrupo: 0,
    pcFixoGrupo: 0,
    pcCreditoTotalGrupo: 0,
    fiPefinPfPjGrupo: 0,
    pcAdicionalGrupo: 0,
    admRateadoGrupo: 0,
    intranetPorCnpj: new Map(),
    unicoAutoNovosPorCnpj: new Map(),
    unicoAutoSeminovosPorCnpj: new Map(),
    pcSegmentoTotais: { auto: 0, pesados: 0, motos: 0, outros: 0 },
    pcAutoPorCnpj: new Map(),
    abasEncontradas: wb.SheetNames,
    abasFaltando: [],
  };

  // ---- Demonstrativo ----
  const demoSheet = findSheet(wb, ["Demonstrativo"]);
  if (!demoSheet) result.abasFaltando.push("Demonstrativo");
  else {
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[demoSheet], {
      defval: null,
    });
    for (const r of rows) {
      const produto = String(getCol(r, "Produto", "Descrição", "Descricao", "Item") ?? "").trim();
      const usuario = String(
        getCol(r, "Nome do Logon", "Usuário", "Usuario", "Login") ?? "",
      ).trim();
      const valor = toNumber(getCol(r, "Valor Total", "Valor", "Total"));
      const grupo = String(getCol(r, "Grupo", "Categoria") ?? "").toUpperCase();
      const prodU = produto.toUpperCase();

      if (prodU.includes("CONSUMO MINIMO") || prodU.includes("CONSUMO MÍNIMO")) {
        result.consumoMinimoGrupo += valor;
        continue;
      }
      if (prodU.includes("POWER CURVE") && prodU.includes("FIXO")) {
        result.pcFixoGrupo += valor;
        continue;
      }
      // PC CRÉDITO group
      const inPcCredito =
        grupo.includes("PC CREDITO") ||
        grupo.includes("PC CRÉDITO") ||
        grupo.includes("LOGON PC CREDITO");
      if (inPcCredito) {
        result.pcCreditoTotalGrupo += valor;
        if (FI_KEYWORDS.some((k) => prodU.includes(k))) {
          result.fiPefinPfPjGrupo += valor;
        }
      }
      // ADM Rateado: linhas da Rejane
      if (usuario.toUpperCase().includes(REJANE)) {
        result.admRateadoGrupo += valor;
      }
    }
    result.pcAdicionalGrupo = result.pcCreditoTotalGrupo - result.fiPefinPfPjGrupo;
  }

  // ---- Logon Intranet ----
  const intranetSheet = findSheet(wb, ["Logon Intranet", "Intranet"]);
  if (!intranetSheet) result.abasFaltando.push("Logon Intranet");
  else {
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[intranetSheet], {
      defval: null,
    });
    for (const r of rows) {
      const cnpj = normalizeCnpj(getCol(r, "CNPJ", "CGC"));
      if (!cnpj) continue;
      const qtd = toNumber(getCol(r, "Qtd", "Quantidade", "Consultas", "Total"));
      result.intranetPorCnpj.set(cnpj, (result.intranetPorCnpj.get(cnpj) ?? 0) + (qtd || 1));
    }
  }

  // ---- Único Auto ----
  const unicoSheet = findSheet(wb, ["Único Auto", "Unico Auto", "UnicoAuto"]);
  if (!unicoSheet) result.abasFaltando.push("Único Auto");
  else {
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[unicoSheet], {
      defval: null,
    });
    for (const r of rows) {
      const cnpj = normalizeCnpj(getCol(r, "CNPJ", "CGC"));
      if (!cnpj) continue;
      const depto = String(getCol(r, "Departamento", "Depto") ?? "").toUpperCase();
      const qtd = toNumber(getCol(r, "Qtd", "Quantidade", "Consultas", "Total")) || 1;
      if (depto.includes("SEMINOV")) {
        result.unicoAutoSeminovosPorCnpj.set(
          cnpj,
          (result.unicoAutoSeminovosPorCnpj.get(cnpj) ?? 0) + qtd,
        );
      } else {
        result.unicoAutoNovosPorCnpj.set(
          cnpj,
          (result.unicoAutoNovosPorCnpj.get(cnpj) ?? 0) + qtd,
        );
      }
    }
  }

  // ---- Power Curve por Segmento ----
  const pcSegSheet = findSheet(wb, [
    "Tab Dinamica PC Variável",
    "Tab Dinamica PC Variavel",
    "Tab Dinâmica PC Variável",
    "Logon Power Curve",
    "Power Curve",
  ]);
  if (!pcSegSheet) result.abasFaltando.push("Tab Dinâmica PC Variável (ou Logon Power Curve)");
  else {
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[pcSegSheet], {
      defval: null,
    });
    for (const r of rows) {
      const seg = String(getCol(r, "Segmento", "Segmentação") ?? "");
      const cnpj = normalizeCnpj(getCol(r, "CNPJ", "CGC"));
      const qtd = toNumber(getCol(r, "Qtd", "Quantidade", "Consultas", "Total")) || 1;
      if (isAuto(seg)) {
        result.pcSegmentoTotais.auto += qtd;
        if (cnpj) result.pcAutoPorCnpj.set(cnpj, (result.pcAutoPorCnpj.get(cnpj) ?? 0) + qtd);
      } else if (isPesados(seg)) result.pcSegmentoTotais.pesados += qtd;
      else if (isMotos(seg)) result.pcSegmentoTotais.motos += qtd;
      else result.pcSegmentoTotais.outros += qtd;
    }
  }

  return result;
}
