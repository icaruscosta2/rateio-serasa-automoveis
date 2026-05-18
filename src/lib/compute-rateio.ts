import type { ParseResult } from "./parse-rateio";
import { segmentoDaBandeira, type Segmento } from "./segmentos";

/** Como o Consumo Mínimo é distribuído entre as empresas incluídas */
export type ConsumoMinimoMethod = "matrizes" | "todas";

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
  /** Método de distribuição do Consumo Mínimo. Default: "matrizes" */
  consumoMinimoMethod?: ConsumoMinimoMethod;
  /** Valor da NF Negativações destinado ao segmento Automóveis (já calculado na Etapa 1). */
  negatValorAuto?: number;
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
  qtdNegativacoes: number;
  consumoMinimo: number;
  pcFixo: number;
  pcAdicional: number;
  fiNovos: number;
  fiSeminovos: number;
  admRateado: number;
  negatRateado: number;
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
    negat: number;
  };
  // Diagnóstico: fatia F&I por segmento e a proporção Intranet usada.
  fiPorSegmento: Record<string, number>;
  intranetUniversoPorSegmento: Record<string, number>;
  intranetUniversoTotal: number;
  pcvShareAuto: number; // ex.: 250/476
}

export function computeRateio({ parsed, empresas, pct, consumoMinimoMethod = "matrizes", negatValorAuto = 0 }: RateioInput): RateioOutput {
  const incluidas = empresas.filter((e) => e.incluida);
  const matrizes = incluidas.filter((e) => e.is_matriz);

  // Fatias Auto (R$).
  // PC Adicional: a parcela que vai para Automóveis é proporção das linhas
  // filtradas (Automóveis + Consulta PF allowlist) sobre o TOTAL de linhas
  // da aba Power Curve Variável. Ex.: 250/476 = 52,52%.
  const pcvShareAuto =
    parsed.pcVariavelTotalLinhas > 0
      ? parsed.pcVariavelLinhasAuto / parsed.pcVariavelTotalLinhas
      : 0;
  const fatia = {
    consumoMinimo: parsed.consumoMinimoGrupo * pct.consumoMinimo,
    pcFixo: parsed.pcFixoGrupo * pct.pcFixo,
    pcAdicional:
      parsed.pcVariavelTotalLinhas > 0
        ? parsed.pcAdicionalGrupo * pcvShareAuto
        : parsed.pcAdicionalGrupo, // sem PCV → fallback: tudo para Auto
    fi: parsed.fiGrupo, // 100% do grupo, dividido pela proporção de Intranet por segmento
    // Consultas ADM Avulsas (Rejane + Márcia) vai 100% para Automóveis.
    // Usa apenas a fatia do segmento AUTOMOVEIS para não incluir gestores de outros segmentos.
    adm: parsed.admRateadoPorSegmento?.["AUTOMOVEIS"] ?? parsed.admRateadoGrupo,
    // NF Negativações — valor já calculado para o segmento Automóveis na Etapa 1.
    negat: negatValorAuto,
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
  // Numerador: linhas Intranet por segmento, somando APENAS empresas incluídas.
  // Denominador: linhas Intranet de TODAS as empresas com bandeira mapeada
  // (incluídas ou não). Assim, desmarcar um segmento NÃO faz suas linhas
  // migrarem para os outros — a fatia daquele segmento simplesmente "se perde".
  const intranetPorSeg = new Map<Segmento, number>();
  const novosPorSeg = new Map<Segmento, number>();
  const semiPorSeg = new Map<Segmento, number>();
  for (const e of incluidas) {
    const seg = segPorEmpresa.get(e.cod_empresa);
    if (!seg) continue;
    const qI = qtd(parsed.intranetPorCnpj, e);
    const qN = qtd(parsed.intranetNovosPorCnpj, e);
    const qS = qtd(parsed.intranetSeminovosPorCnpj, e);
    intranetPorSeg.set(seg, (intranetPorSeg.get(seg) ?? 0) + qI);
    novosPorSeg.set(seg, (novosPorSeg.get(seg) ?? 0) + qN);
    semiPorSeg.set(seg, (semiPorSeg.get(seg) ?? 0) + qS);
  }

  // Denominador "universo": Intranet de todas as empresas com bandeira mapeada
  // (independe de estar incluída no rateio). Dedupa por CNPJ.
  const ownerByCnpjAll = new Map<string, number>();
  for (const e of empresas) {
    const c = e.cnpj_normalizado;
    if (!c) continue;
    const seg = segmentoDaBandeira(e.bandeira);
    const cur = ownerByCnpjAll.get(c);
    if (cur === undefined) {
      ownerByCnpjAll.set(c, e.cod_empresa);
    } else {
      const curEmp = empresas.find((x) => x.cod_empresa === cur);
      const curSeg = curEmp ? segmentoDaBandeira(curEmp.bandeira) : null;
      if (curSeg == null && seg != null) ownerByCnpjAll.set(c, e.cod_empresa);
    }
  }
  let intranetUniverso = 0;
  const intranetUniversoPorSegMap = new Map<Segmento, number>();
  for (const e of empresas) {
    const seg = segmentoDaBandeira(e.bandeira);
    if (!seg) continue;
    const c = e.cnpj_normalizado;
    if (!c || ownerByCnpjAll.get(c) !== e.cod_empresa) continue;
    const q = parsed.intranetPorCnpj.get(c) ?? 0;
    intranetUniverso += q;
    intranetUniversoPorSegMap.set(seg, (intranetUniversoPorSegMap.get(seg) ?? 0) + q);
  }

  // Fatia F&I por segmento (usa universo como base — desmarcar uma loja
  // não migra valor entre segmentos; e a fatia "Auto" para a prévia é
  // proporcional à Intranet do segmento Auto sobre o universo).
  const fiFatiaPorSeg = new Map<Segmento, number>();
  for (const [seg, qUniv] of intranetUniversoPorSegMap) {
    fiFatiaPorSeg.set(
      seg,
      intranetUniverso > 0 ? (fatia.fi * qUniv) / intranetUniverso : 0,
    );
  }

  // ===== Bases globais (UNIVERSO) para PC Adicional / ADM =====
  // Regra: o denominador é SEMPRE o universo de empresas AUTOMOVEIS com
  // bandeira mapeada (incluídas ou não). Assim, desmarcar uma loja faz a
  // parte dela "se perder" em vez de redistribuir entre as restantes.
  // IMPORTANTE: a aba Power Curve Variável NÃO é usada como base de
  // distribuição (o CNPJ daquela aba é do cliente, não da concessionária).
  let totalIntranetAutoUniverso = 0;
  let totalUnicoAutoUniverso = 0;
  for (const e of empresas) {
    const seg = segmentoDaBandeira(e.bandeira);
    if (seg !== "AUTOMOVEIS") continue;
    const c = e.cnpj_normalizado;
    if (!c || ownerByCnpjAll.get(c) !== e.cod_empresa) continue;
    totalIntranetAutoUniverso += parsed.intranetPorCnpj.get(c) ?? 0;
    totalUnicoAutoUniverso += parsed.unicoAutoPorCnpj.get(c) ?? 0;
  }

  // PC Adicional só vai pra empresas AUTOMOVEIS.
  // A PCV determina qual % do PC Adicional vai para Automóveis (pcvShareAuto).
  // O Único Auto determina a distribuição entre as empresas dentro de Automóveis.
  // Não há fallback para Intranet — se Único Auto estiver zerado, nenhuma empresa recebe.
  const totalPcAdicionalBase = totalUnicoAutoUniverso;

  // NF Negativações: distribuição proporcional ao nº de negativações por CNPJ (DOCUMENTO CREDOR).
  // Universo: todas as empresas AUTOMOVEIS com bandeira mapeada.
  let totalNegatUniverso = 0;
  for (const e of empresas) {
    const seg = segmentoDaBandeira(e.bandeira);
    if (seg !== "AUTOMOVEIS") continue;
    const c = e.cnpj_normalizado;
    if (!c || ownerByCnpjAll.get(c) !== e.cod_empresa) continue;
    totalNegatUniverso += parsed.negativacoesPorCnpj?.get(c) ?? 0;
  }

  // Consultas ADM Avulsas: distribuição igual entre todas as empresas AUTOMOVEIS incluídas
  // (mesma regra do PC Fixo, mas restrita ao segmento Automóveis).
  const autoIncluidas = incluidas.filter(
    (e) => segPorEmpresa.get(e.cod_empresa) === "AUTOMOVEIS",
  );

  const rows: RateioRow[] = incluidas.map((e) => {
    const seg = segPorEmpresa.get(e.cod_empresa) ?? null;
    const qNovos = qtd(parsed.intranetNovosPorCnpj, e);
    const qSemi = qtd(parsed.intranetSeminovosPorCnpj, e);
    const qIntra = qtd(parsed.intranetPorCnpj, e);
    const qUnico = qtd(parsed.unicoAutoPorCnpj, e);
    const qNegat = (() => {
      const c = e.cnpj_normalizado;
      if (!c) return 0;
      if (ownerByCnpj.get(c) !== e.cod_empresa) return 0;
      return parsed.negativacoesPorCnpj?.get(c) ?? 0;
    })();
    // qPcv: PCV não é base de distribuição (CNPJ é do cliente). Sempre 0.

    const consumoMinimo = (() => {
      if (!seg) return 0;
      if (consumoMinimoMethod === "todas") {
        return incluidas.length > 0 ? fatia.consumoMinimo / incluidas.length : 0;
      }
      // "matrizes" (padrão): apenas matrizes recebem
      return e.is_matriz && matrizes.length > 0 ? fatia.consumoMinimo / matrizes.length : 0;
    })();
    const pcFixo = seg && incluidas.length > 0 ? fatia.pcFixo / incluidas.length : 0;

    // PC Adicional: só Automóveis recebe, distribuído pelo Único Auto.
    let pcAdicional = 0;
    if (seg === "AUTOMOVEIS" && totalPcAdicionalBase > 0) {
      pcAdicional = (fatia.pcAdicional * qUnico) / totalPcAdicionalBase;
    }

    // F&I: distribuído diretamente pelo total Intranet universo (todos os segmentos).
    // Denominador = total de linhas Intranet de todas as empresas com bandeira mapeada.
    let fiNovos = 0;
    let fiSeminovos = 0;
    if (seg && intranetUniverso > 0) {
      fiNovos = (fatia.fi * qNovos) / intranetUniverso;
      fiSeminovos = (fatia.fi * qSemi) / intranetUniverso;
    }

    // Consultas ADM Avulsas: 100% Automóveis, dividido igualmente entre as lojas incluídas.
    let admRateado = 0;
    if (seg === "AUTOMOVEIS" && autoIncluidas.length > 0) {
      admRateado = fatia.adm / autoIncluidas.length;
    }

    // NF Negativações: proporcional ao nº de negativações por CNPJ (DOCUMENTO CREDOR).
    // Só Automóveis recebe; se não há registros de negat, nenhuma empresa recebe.
    let negatRateado = 0;
    if (seg === "AUTOMOVEIS" && totalNegatUniverso > 0 && fatia.negat > 0) {
      negatRateado = (fatia.negat * qNegat) / totalNegatUniverso;
    }

    const total = consumoMinimo + pcFixo + pcAdicional + fiNovos + fiSeminovos + admRateado + negatRateado;
    return {
      cod_empresa: e.cod_empresa,
      nome: e.nome,
      cnpj: e.cnpj_normalizado ?? "",
      segmento: (seg ?? "EXCLUIDA") as Segmento | "EXCLUIDA",
      qtdNovos: qNovos,
      qtdSeminovos: qSemi,
      qtdIntranet: qIntra,
      qtdPcSegmento: 0,
      qtdUnicoAuto: qUnico,
      qtdNegativacoes: qNegat,
      consumoMinimo,
      pcFixo,
      pcAdicional,
      fiNovos,
      fiSeminovos,
      admRateado,
      negatRateado,
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
      qtdNegativacoes: acc.qtdNegativacoes + r.qtdNegativacoes,
      consumoMinimo: acc.consumoMinimo + r.consumoMinimo,
      pcFixo: acc.pcFixo + r.pcFixo,
      pcAdicional: acc.pcAdicional + r.pcAdicional,
      fiNovos: acc.fiNovos + r.fiNovos,
      fiSeminovos: acc.fiSeminovos + r.fiSeminovos,
      admRateado: acc.admRateado + r.admRateado,
      negatRateado: acc.negatRateado + r.negatRateado,
      total: acc.total + r.total,
    }),
    {
      qtdNovos: 0, qtdSeminovos: 0, qtdIntranet: 0, qtdPcSegmento: 0, qtdUnicoAuto: 0,
      qtdNegativacoes: 0,
      consumoMinimo: 0, pcFixo: 0, pcAdicional: 0, fiNovos: 0, fiSeminovos: 0,
      admRateado: 0, negatRateado: 0, total: 0,
    },
  );

  const fiPorSegmento: Record<string, number> = {};
  for (const [seg, v] of fiFatiaPorSeg) fiPorSegmento[seg] = v;
  const intranetUniversoPorSegmento: Record<string, number> = {};
  for (const [seg, v] of intranetUniversoPorSegMap) intranetUniversoPorSegmento[seg] = v;

  return {
    rows,
    totals,
    fatiaAuto: { ...fatia },
    fiPorSegmento,
    intranetUniversoPorSegmento,
    intranetUniversoTotal: intranetUniverso,
    pcvShareAuto,
  };
}

// Backwards-compat (alguma view antiga pode importar)
export function classificarSegmento(_nome: string): "AUTOMOVEIS" | "PESADOS" {
  return "AUTOMOVEIS";
}
