import type { ParseResult } from "./parse-rateio";
import { segmentoDaBandeira, type Segmento } from "./segmentos";

export interface RateioInput {
  parsed: ParseResult;
  empresas: Array<{
    cod_empresa: number;
    nome: string;
    cnpj_normalizado: string | null;
    bandeira: string | null;
    incluida: boolean;
    is_matriz: boolean;
  }>;
  pct: {
    consumoMinimo: number;
    pcFixo: number;
    pcAdicional: number;
    fi: number;
    adm: number;
  };
}

export interface RateioRow {
  cod_empresa: number;
  nome: string;
  cnpj: string;
  segmento: Segmento | "EXCLUIDA";
  qtdNovos: number;
  qtdSeminovos: number;
  qtdIntranet: number;
  qtdPcSegmento: number;
  qtdUnicoAuto: number;
  consumoMinimo: number;
  pcFixo: number;
  pcAdicional: number;
  fiNovos: number;
  fiSeminovos: number;
  admRateado: number;
  total: number;
}

export interface RateioOutput {
  rows: RateioRow[];
  totals: Omit<RateioRow, "cod_empresa" | "nome" | "cnpj" | "segmento">;
  fatiaAuto: {
    consumoMinimo: number;
    pcFixo: number;
    pcAdicional: number;
    fi: number;
    adm: number;
  };
}

export function computeRateio({ parsed, empresas, pct }: RateioInput): RateioOutput {
  const incluidas = empresas.filter((e) => e.incluida);
  const matrizes = incluidas.filter((e) => e.is_matriz);

  // Fatias Auto (R$). Para F&I, NÃO há percentual fixo: a fatia de cada
  // segmento é a própria proporção de linhas Intranet (ver abaixo).
  const fatia = {
    consumoMinimo: parsed.consumoMinimoGrupo * pct.consumoMinimo,
    pcFixo: parsed.pcFixoGrupo * pct.pcFixo,
    pcAdicional: parsed.pcAdicionalGrupo * pct.pcAdicional,
    fi: parsed.fiGrupo, // total do grupo; será dividido por proporção de Intranet
    // ADM Rateado (Rejane) vai 100% para Automóveis
    adm: parsed.admRateadoGrupo,
  };

  // Segmento de cada empresa pela BANDEIRA (null = excluída/desconhecida).
  const segPorEmpresa = new Map<number, Segmento | null>();
  for (const e of incluidas) {
    segPorEmpresa.set(e.cod_empresa, segmentoDaBandeira(e.bandeira));
  }

  // ---- Dedupe de CNPJ: quando vários códigos compartilham o mesmo CNPJ,
  // só UMA empresa "consome" as linhas Intranet/UnicoAuto/PCV daquele CNPJ.
  // Regra: prioriza empresa cuja bandeira tenha segmento (não excluída).
  // (No futuro, quando o filtro for por tipo_negocio, a regra de desempate
  // muda — mas hoje a UI já oculta excluídas, então isto só serve de garantia.)
  const ownerByCnpj = new Map<string, number>();
  for (const e of incluidas) {
    const c = e.cnpj_normalizado;
    if (!c) continue;
    const seg = segPorEmpresa.get(e.cod_empresa);
    const cur = ownerByCnpj.get(c);
    if (cur === undefined) {
      ownerByCnpj.set(c, e.cod_empresa);
    } else {
      const curSeg = segPorEmpresa.get(cur);
      // se a atual é excluída e a nova não, troca
      if (curSeg == null && seg != null) ownerByCnpj.set(c, e.cod_empresa);
    }
  }

  function qtd(map: Map<string, number>, e: { cod_empresa: number; cnpj_normalizado: string | null }): number {
    const c = e.cnpj_normalizado;
    if (!c) return 0;
    if (ownerByCnpj.get(c) !== e.cod_empresa) return 0;
    return map.get(c) ?? 0;
  }

  // ===== F&I em N segmentos =====
  // 1) Soma de linhas Intranet por segmento (ignora empresas excluídas).
  const intranetPorSeg = new Map<Segmento, number>();
  const novosPorSeg = new Map<Segmento, number>();
  const semiPorSeg = new Map<Segmento, number>();
  let intranetTotalSegmentado = 0;
  for (const e of incluidas) {
    const seg = segPorEmpresa.get(e.cod_empresa);
    if (!seg) continue;
    const qI = qtd(parsed.intranetPorCnpj, e);
    const qN = qtd(parsed.intranetNovosPorCnpj, e);
    const qS = qtd(parsed.intranetSeminovosPorCnpj, e);
    intranetPorSeg.set(seg, (intranetPorSeg.get(seg) ?? 0) + qI);
    novosPorSeg.set(seg, (novosPorSeg.get(seg) ?? 0) + qN);
    semiPorSeg.set(seg, (semiPorSeg.get(seg) ?? 0) + qS);
    intranetTotalSegmentado += qI;
  }

  // 2) Fatia F&I por segmento, proporcional às linhas Intranet daquele segmento.
  const fiFatiaPorSeg = new Map<Segmento, number>();
  for (const [seg, q] of intranetPorSeg) {
    fiFatiaPorSeg.set(
      seg,
      intranetTotalSegmentado > 0 ? (fatia.fi * q) / intranetTotalSegmentado : 0,
    );
  }

  // ===== Bases globais para PC Adicional / ADM =====
  // (somam só os "donos" de CNPJ — já dedupado — e ignoram excluídas)
  let totalIntranetAuto = 0; // para ADM (100% Auto)
  let totalUnicoAuto = 0;
  let totalPcVar = 0;
  for (const e of incluidas) {
    const seg = segPorEmpresa.get(e.cod_empresa);
    if (!seg) continue;
    if (seg === "AUTOMOVEIS") totalIntranetAuto += qtd(parsed.intranetPorCnpj, e);
    totalUnicoAuto += qtd(parsed.unicoAutoPorCnpj, e);
    totalPcVar += qtd(parsed.pcVariavelPorCnpj, e);
  }

  // PC Adicional só vai pra empresas AUTOMOVEIS (mantém comportamento atual via fallback).
  // Se há PCV → usa PCV; senão Único Auto; senão Intranet.
  // Aplicamos sobre AUTOMOVEIS apenas.
  let totalPcAdicionalBase = 0;
  let pcAdicionalSource: "pcv" | "unico" | "intranet" = "intranet";
  if (totalPcVar > 0) {
    totalPcAdicionalBase = totalPcVar;
    pcAdicionalSource = "pcv";
  } else if (totalUnicoAuto > 0) {
    totalPcAdicionalBase = totalUnicoAuto;
    pcAdicionalSource = "unico";
  } else {
    // só Auto contribui
    let s = 0;
    for (const e of incluidas) {
      if (segPorEmpresa.get(e.cod_empresa) === "AUTOMOVEIS") s += qtd(parsed.intranetPorCnpj, e);
    }
    totalPcAdicionalBase = s;
    pcAdicionalSource = "intranet";
  }

  const rows: RateioRow[] = incluidas.map((e) => {
    const seg = segPorEmpresa.get(e.cod_empresa) ?? null;
    const qNovos = qtd(parsed.intranetNovosPorCnpj, e);
    const qSemi = qtd(parsed.intranetSeminovosPorCnpj, e);
    const qIntra = qtd(parsed.intranetPorCnpj, e);
    const qUnico = qtd(parsed.unicoAutoPorCnpj, e);
    const qPcv = qtd(parsed.pcVariavelPorCnpj, e);

    const consumoMinimo =
      seg && e.is_matriz && matrizes.length > 0 ? fatia.consumoMinimo / matrizes.length : 0;
    const pcFixo = seg && incluidas.length > 0 ? fatia.pcFixo / incluidas.length : 0;

    // PC Adicional: só Automóveis recebe.
    let pcAdicional = 0;
    if (seg === "AUTOMOVEIS" && totalPcAdicionalBase > 0) {
      const q =
        pcAdicionalSource === "pcv" ? qPcv : pcAdicionalSource === "unico" ? qUnico : qIntra;
      pcAdicional = (fatia.pcAdicional * q) / totalPcAdicionalBase;
    }

    // F&I: divide a fatia do segmento entre suas empresas pelas contagens (Novos/Semi).
    let fiNovos = 0;
    let fiSeminovos = 0;
    if (seg) {
      const fatiaFi = fiFatiaPorSeg.get(seg) ?? 0;
      const totalSeg = (novosPorSeg.get(seg) ?? 0) + (semiPorSeg.get(seg) ?? 0);
      if (totalSeg > 0) {
        fiNovos = (fatiaFi * qNovos) / totalSeg;
        fiSeminovos = (fatiaFi * qSemi) / totalSeg;
      }
    }

    // ADM: 100% Automóveis, distribuído pela Intranet do segmento Auto.
    let admRateado = 0;
    if (seg === "AUTOMOVEIS" && totalIntranetAuto > 0) {
      admRateado = (fatia.adm * qIntra) / totalIntranetAuto;
    }

    const total = consumoMinimo + pcFixo + pcAdicional + fiNovos + fiSeminovos + admRateado;
    return {
      cod_empresa: e.cod_empresa,
      nome: e.nome,
      cnpj: e.cnpj_normalizado ?? "",
      segmento: (seg ?? "EXCLUIDA") as Segmento | "EXCLUIDA",
      qtdNovos: qNovos,
      qtdSeminovos: qSemi,
      qtdIntranet: qIntra,
      qtdPcSegmento: qPcv,
      qtdUnicoAuto: qUnico,
      consumoMinimo,
      pcFixo,
      pcAdicional,
      fiNovos,
      fiSeminovos,
      admRateado,
      total,
    };
  });

  const totals = rows.reduce(
    (acc, r) => ({
      qtdNovos: acc.qtdNovos + r.qtdNovos,
      qtdSeminovos: acc.qtdSeminovos + r.qtdSeminovos,
      qtdIntranet: acc.qtdIntranet + r.qtdIntranet,
      qtdPcSegmento: acc.qtdPcSegmento + r.qtdPcSegmento,
      qtdUnicoAuto: acc.qtdUnicoAuto + r.qtdUnicoAuto,
      consumoMinimo: acc.consumoMinimo + r.consumoMinimo,
      pcFixo: acc.pcFixo + r.pcFixo,
      pcAdicional: acc.pcAdicional + r.pcAdicional,
      fiNovos: acc.fiNovos + r.fiNovos,
      fiSeminovos: acc.fiSeminovos + r.fiSeminovos,
      admRateado: acc.admRateado + r.admRateado,
      total: acc.total + r.total,
    }),
    {
      qtdNovos: 0, qtdSeminovos: 0, qtdIntranet: 0, qtdPcSegmento: 0, qtdUnicoAuto: 0,
      consumoMinimo: 0, pcFixo: 0, pcAdicional: 0, fiNovos: 0, fiSeminovos: 0,
      admRateado: 0, total: 0,
    },
  );

  return { rows, totals, fatiaAuto: fatia };
}

// Backwards-compat (alguma view antiga pode importar)
export function classificarSegmento(_nome: string): "AUTOMOVEIS" | "PESADOS" {
  return "AUTOMOVEIS";
}
