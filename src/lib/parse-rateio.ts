import * as XLSX from "xlsx";
import { normalizeCnpj } from "@/lib/cnpj";

export interface ParseResult {
  // Valores agregados do grupo (R$) — vindos do Demonstrativo
  consumoMinimoGrupo: number;
  pcFixoGrupo: number;
  pcAdicionalGrupo: number; // logon "PC CREDITO" menos F&I PEFIN PF/PJ
  fiGrupo: number; // PEFIN PF + PJ (somente logon PC CREDITO)
  admRateadoGrupo: number; // total de todos os gestores (todos os segmentos)
  admRateadoPorSegmento: Record<string, number>; // separado por segmento do gestor
  // Diagnóstico do Demonstrativo
  demoTotalLogonPcCredito: number;
  demoFiPefinPf: number;
  demoFiPefinPj: number;
  // Consultas avulsas de outros usuários (não somadas no fiGrupo — apenas registradas)
  demoOutrosUsuariosNaoSomado: number;
  // Diagnóstico: detalhamento por logon das linhas que entraram em PEFIN PF/PJ
  demoFiPefinPfPorLogon: Array<{ logon: string; count: number; soma: number }>;
  demoFiPefinPjPorLogon: Array<{ logon: string; count: number; soma: number }>;
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
  // Usuários de "Consulta PF" encontrados na planilha que NÃO estão no cadastro
  pcvUsuariosDesconhecidos: string[];
  // Logons do Demonstrativo (não PC CREDITO) que NÃO estão no cadastro de Gestores
  admLogonsDesconhecidos: string[];
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
const MARCIA_GOMES = "MARCIA GOMES";

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
 *  Tenta IGUALDADE primeiro (mais seguro); só usa inclusão se nenhuma chave
 *  bater exatamente — assim "produto" não casa com "subproduto2". */
function getLoose(row: Record<string, unknown>, ...candidates: string[]): unknown {
  const strip = (s: string) => norm(s).replace(/[^A-Z0-9]/g, "");
  const targets = candidates.map(strip).filter(Boolean);
  const keys = Object.keys(row);
  for (const k of keys) {
    const ks = strip(k);
    if (ks && targets.some((t) => ks === t)) return row[k];
  }
  for (const k of keys) {
    const ks = strip(k);
    if (ks && targets.some((t) => ks.includes(t) || t.includes(ks))) return row[k];
  }
  return null;
}

export interface EmpresaParaMatch {
  nome: string;
  apelido: string | null;
  cnpj_normalizado: string | null;
}

export function parseRateioWorkbook(
  buffer: ArrayBuffer,
  pcvUsuariosPf?: Map<string, string>,
  empresas?: EmpresaParaMatch[],
  gestoresLogon?: Map<string, string>, // logon normalizado → segmento
): ParseResult {
  const wb = XLSX.read(buffer);
  const result: ParseResult = {
    consumoMinimoGrupo: 0,
    pcFixoGrupo: 0,
    pcAdicionalGrupo: 0,
    fiGrupo: 0,
    admRateadoGrupo: 0,
    admRateadoPorSegmento: {},
    demoTotalLogonPcCredito: 0,
    demoFiPefinPf: 0,
    demoFiPefinPj: 0,
    demoOutrosUsuariosNaoSomado: 0,
    demoFiPefinPfPorLogon: [],
    demoFiPefinPjPorLogon: [],
    intranetPorCnpj: new Map(),
    intranetNovosPorCnpj: new Map(),
    intranetSeminovosPorCnpj: new Map(),
    unicoAutoPorCnpj: new Map(),
    pcVariavelPorCnpj: new Map(),
    pcVariavelTotalLinhas: 0,
    pcVariavelLinhasAuto: 0,
    pcvUsuariosDesconhecidos: [],
    admLogonsDesconhecidos: [],
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
    const pefinPfPorLogon = new Map<string, { count: number; soma: number }>();
    const pefinPjPorLogon = new Map<string, { count: number; soma: number }>();
    const admDesconhecidosSet = new Set<string>();
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
      // ADM: se gestoresLogon fornecido, usa o mapa; senão fallback para Rejane/Márcia.
      const isAdm = gestoresLogon
        ? gestoresLogon.has(nomeLogon)
        : (nomeLogon.includes(REJANE) || nomeLogon.includes(MARCIA_GOMES));
      const isLogonPcCredito = nomeLogon === LOGON_PC_CREDITO;

      // Consultas ADM Avulsas: tudo dos gestores cadastrados, separado por segmento.
      if (isAdm) {
        result.admRateadoGrupo += valor;
        // Segmento do gestor: usa o mapa se disponível, senão fallback AUTOMOVEIS.
        const admSeg = gestoresLogon?.get(nomeLogon) ?? "AUTOMOVEIS";
        result.admRateadoPorSegmento[admSeg] =
          (result.admRateadoPorSegmento[admSeg] ?? 0) + valor;
        continue;
      }

      // F&I PEFIN PF / PJ — somente quando logon for "PC CREDITO".
      // Linhas PEFIN PF/PJ de outros logons caem no bloco "outros usuários" abaixo.
      if (isFiProduto && isLogonPcCredito) {
        result.fiGrupo += valor;
        const isPf = produto === norm(FI_PRODUTOS[0]);
        const bucket = isPf ? pefinPfPorLogon : pefinPjPorLogon;
        const logonKey = nomeLogon || "(sem logon)";
        const cur = bucket.get(logonKey) ?? { count: 0, soma: 0 };
        cur.count += 1;
        cur.soma += valor;
        bucket.set(logonKey, cur);
        if (isPf) result.demoFiPefinPf += valor;
        else result.demoFiPefinPj += valor;
        result.demoTotalLogonPcCredito += valor;
        continue;
      }

      // Logon "PC CREDITO" (não-F&I) → PC Adicional
      if (isLogonPcCredito) {
        result.pcAdicionalGrupo += valor;
        result.demoTotalLogonPcCredito += valor;
        continue;
      }

      // Outros logons (não gestor, não PC CREDITO) → registrar mas NÃO somar no rateio.
      // Se gestoresLogon foi passado, coleta logons desconhecidos para o popup.
      result.demoOutrosUsuariosNaoSomado += valor;
      outrosFi += valor;
      if (gestoresLogon && nomeLogon && !gestoresLogon.has(nomeLogon)) {
        admDesconhecidosSet.add(nomeLogon);
      }
    }
    result.demoFiPefinPfPorLogon = Array.from(pefinPfPorLogon.entries())
      .map(([logon, v]) => ({ logon, count: v.count, soma: v.soma }))
      .sort((a, b) => b.soma - a.soma);
    result.demoFiPefinPjPorLogon = Array.from(pefinPjPorLogon.entries())
      .map(([logon, v]) => ({ logon, count: v.count, soma: v.soma }))
      .sort((a, b) => b.soma - a.soma);
    result.admLogonsDesconhecidos = Array.from(admDesconhecidosSet);
    if (outrosFi > 0) {
      const descLabel = admDesconhecidosSet.size > 0
        ? ` Logons não classificados: ${Array.from(admDesconhecidosSet).join(", ")}.`
        : "";
      result.warnings.push(
        `Consultas ADM Avulsas de logons não classificados: R$ ${outrosFi.toFixed(2)}.${descLabel}`,
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
      "Aba UNICOAUTO não encontrada — PC Adicional não poderá ser distribuído por empresa.",
    );
  } else {
    const rows = sheetToRowsByHeader(wb.Sheets[unicoSheet], ["Estabelecimento"]);
    if (rows.length === 0) {
      result.warnings.push("UNICOAUTO: coluna 'Estabelecimento' não localizada.");
    } else {
      // Monta lookup: nome normalizado → cnpj_normalizado, a partir do cadastro de empresas.
      const nomeParaCnpj = new Map<string, string>();
      for (const e of empresas ?? []) {
        if (!e.cnpj_normalizado) continue;
        nomeParaCnpj.set(norm(e.nome), e.cnpj_normalizado);
        if (e.apelido) nomeParaCnpj.set(norm(e.apelido), e.cnpj_normalizado);
      }

      const naoEncontrados = new Set<string>();
      for (const r of rows) {
        const nomeRaw = String(getLoose(r, "Estabelecimento", "ESTABELECIMENTO") ?? "").trim();
        if (!nomeRaw) continue;
        const nomeNorm = norm(nomeRaw);

        // Apenas match exato (nome ou apelido) — match parcial causa falsos positivos.
        const cnpj = nomeParaCnpj.get(nomeNorm);

        if (cnpj) {
          result.unicoAutoPorCnpj.set(cnpj, (result.unicoAutoPorCnpj.get(cnpj) ?? 0) + 1);
        } else {
          naoEncontrados.add(nomeRaw);
        }
      }

      if (naoEncontrados.size > 0) {
        result.warnings.push(
          `UNICOAUTO: ${naoEncontrados.size} estabelecimento(s) não encontrado(s) no cadastro: ${[...naoEncontrados].slice(0, 5).join(", ")}${naoEncontrados.size > 5 ? ` (e mais ${naoEncontrados.size - 5})` : ""}.`,
        );
      }
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
    // Cabeçalho real da PCV: subproduto2, user_id, tipo_doc, doc, ...
    // (NÃO existe coluna "CNPJ" nesta aba — o documento vem em "doc",
    // e o tipo é indicado em "tipo_doc".)
    let rows = sheetToRowsByHeader(wb.Sheets[pcvSheet], ["subproduto2", "user_id"]);
    if (rows.length === 0) {
      rows = sheetToRowsByHeader(wb.Sheets[pcvSheet], ["subproduto2"]);
    }
    if (rows.length === 0) {
      result.warnings.push(
        "Power Curve Variável: cabeçalho 'subproduto2' não localizado.",
      );
    }
    // Filtro: subproduto2 = "Automóveis" OU
    //        (subproduto2 = "Consulta PF" E user_id mapeado a um segmento no cadastro)
    // O mapa vem do banco (tabela pcv_usuarios): user_id → segmento.
    // Se não for passado, nenhuma "Consulta PF" será contabilizada.
    const pcvUserSegmento = new Map<string, string>();
    if (pcvUsuariosPf) {
      for (const [uid, seg] of pcvUsuariosPf) {
        pcvUserSegmento.set(uid.toLowerCase(), seg.toUpperCase());
      }
    }
    let pcvAuto = 0;
    let pcvPfAuto = 0;    // Consulta PF mapeada para AUTOMOVEIS
    let pcvPfOutros = 0;  // Consulta PF mapeada para outros segmentos
    let pcvDescartadas = 0;
    let pcvTotal = 0;
    const sub2Counts = new Map<string, number>();
    let userPreenchido = 0;
    const desconhecidosSet = new Set<string>();
    for (const r of rows) {
      pcvTotal++;
      const sub2Raw = String(getLoose(r, "subproduto2", "sub produto 2", "subproduto 2") ?? "");
      const sub2 = norm(sub2Raw);
      const user = String(getLoose(r, "user_id", "userid", "usuario") ?? "")
        .trim()
        .toLowerCase();
      if (sub2Raw.trim()) sub2Counts.set(sub2Raw.trim(), (sub2Counts.get(sub2Raw.trim()) ?? 0) + 1);
      if (user) userPreenchido++;
      const isAuto = sub2 === norm("Automóveis") || sub2 === norm("Automoveis");
      const isConsultaPf = sub2 === norm("Consulta PF") || sub2.includes("CONSULTA PF");
      if (isConsultaPf && user && !pcvUserSegmento.has(user)) {
        // Usuário de Consulta PF não cadastrado — registra para o popup
        desconhecidosSet.add(user);
      }
      const segmentoPf = isConsultaPf ? pcvUserSegmento.get(user) : undefined;
      const isPfPermitido = isConsultaPf && segmentoPf !== undefined;
      if (!isAuto && !isPfPermitido) {
        pcvDescartadas++;
        continue;
      }
      // Conta como Automóveis se subproduto2="Automóveis" OU se o usuário de
      // "Consulta PF" está mapeado para AUTOMOVEIS.
      // Usuários mapeados para outros segmentos (PESADOS, MOTOCICLETAS) NÃO
      // entram na fatia de Automóveis — são contados separadamente.
      if (isAuto) pcvAuto++;
      else if (segmentoPf === "AUTOMOVEIS") pcvPfAuto++;
      else pcvPfOutros++;
    }
    result.pcvUsuariosDesconhecidos = Array.from(desconhecidosSet);
    result.pcVariavelTotalLinhas = pcvTotal;
    result.pcVariavelLinhasAuto = pcvAuto + pcvPfAuto;
    const pctAuto = pcvTotal > 0 ? ((pcvAuto + pcvPfAuto) / pcvTotal) * 100 : 0;
    result.warnings.push(
      `Power Curve Variável: ${pcvAuto + pcvPfAuto}/${pcvTotal} linhas para Automóveis (${pctAuto.toFixed(2)}%) — ${pcvAuto} Automóveis + ${pcvPfAuto} Consulta PF Auto; ${pcvPfOutros} Consulta PF outros segmentos; ${pcvDescartadas} descartadas.`,
    );
    if (desconhecidosSet.size > 0) {
      result.warnings.push(
        `Power Curve Variável: ${desconhecidosSet.size} usuário(s) de "Consulta PF" não cadastrado(s): ${Array.from(desconhecidosSet).join(", ")} — não contabilizados até classificação.`,
      );
    }
    if (pcvTotal > 0 && pcvAuto + pcvPfAuto === 0) {
      const colsDetectadas = rows[0] ? Object.keys(rows[0]).join(" | ") : "(nenhuma)";
      const topSub2 = Array.from(sub2Counts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([v, c]) => `"${v}" (${c})`)
        .join(", ") || "(coluna subproduto2 vazia em todas as linhas)";
      result.warnings.push(
        `Power Curve Variável — diagnóstico: colunas detectadas: ${colsDetectadas}. Top valores de subproduto2: ${topSub2}. Linhas com user_id preenchido: ${userPreenchido}.`,
      );
    }
  }

  return result;
}
