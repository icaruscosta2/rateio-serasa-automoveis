import type { ParseResult } from "./parse-rateio";

export interface RateioInput {
  parsed: ParseResult;
  empresas: Array<{
    cod_empresa: number;
    nome: string;
    cnpj_normalizado: string | null;
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
  totals: Omit<RateioRow, "cod_empresa" | "nome" | "cnpj">;
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

  // Fatias Auto (R$)
  const fatia = {
    consumoMinimo: parsed.consumoMinimoGrupo * pct.consumoMinimo,
    pcFixo: parsed.pcFixoGrupo * pct.pcFixo,
    pcAdicional: parsed.pcAdicionalGrupo * pct.pcAdicional,
    fi: parsed.fiGrupo * pct.fi,
    adm: parsed.admRateadoGrupo * pct.adm,
  };

  // Pré-cálculos a partir da Intranet (linhas contadas por CNPJ)
  const totalIntranet = incluidas.reduce(
    (s, e) => s + (e.cnpj_normalizado ? parsed.intranetPorCnpj.get(e.cnpj_normalizado) ?? 0 : 0),
    0,
  );
  const totalNovos = incluidas.reduce(
    (s, e) => s + (e.cnpj_normalizado ? parsed.intranetNovosPorCnpj.get(e.cnpj_normalizado) ?? 0 : 0),
    0,
  );
  const totalSeminovos = incluidas.reduce(
    (s, e) =>
      s + (e.cnpj_normalizado ? parsed.intranetSeminovosPorCnpj.get(e.cnpj_normalizado) ?? 0 : 0),
    0,
  );

  const totalUnicoAuto = incluidas.reduce(
    (s, e) => s + (e.cnpj_normalizado ? parsed.unicoAutoPorCnpj.get(e.cnpj_normalizado) ?? 0 : 0),
    0,
  );
  const totalPcVar = incluidas.reduce(
    (s, e) => s + (e.cnpj_normalizado ? parsed.pcVariavelPorCnpj.get(e.cnpj_normalizado) ?? 0 : 0),
    0,
  );

  const rows: RateioRow[] = incluidas.map((e) => {
    const c = e.cnpj_normalizado ?? "";
    const qNovos = parsed.intranetNovosPorCnpj.get(c) ?? 0;
    const qSemi = parsed.intranetSeminovosPorCnpj.get(c) ?? 0;
    const qIntra = parsed.intranetPorCnpj.get(c) ?? 0;
    const qUnico = parsed.unicoAutoPorCnpj.get(c) ?? 0;
    const qPcv = parsed.pcVariavelPorCnpj.get(c) ?? 0;
    const qPc = qPcv; // base oficial: Power Curve Variável

    const consumoMinimo = e.is_matriz && matrizes.length > 0 ? fatia.consumoMinimo / matrizes.length : 0;
    const pcFixo = incluidas.length > 0 ? fatia.pcFixo / incluidas.length : 0;
    // PC Adicional: rateado por Power Curve Variável (fallback Único Auto → Intranet)
    const pcAdicional =
      totalPcVar > 0
        ? (fatia.pcAdicional * qPcv) / totalPcVar
        : totalUnicoAuto > 0
          ? (fatia.pcAdicional * qUnico) / totalUnicoAuto
          : totalIntranet > 0
            ? (fatia.pcAdicional * qIntra) / totalIntranet
            : 0;
    // F&I por CNPJ, separado em Novos e Seminovos pelas próprias contagens
    const fiNovos = totalIntranet > 0 ? (fatia.fi * qNovos) / totalIntranet : 0;
    const fiSeminovos = totalIntranet > 0 ? (fatia.fi * qSemi) / totalIntranet : 0;
    const admRateado = totalIntranet > 0 ? (fatia.adm * qIntra) / totalIntranet : 0;
    const total = consumoMinimo + pcFixo + pcAdicional + fiNovos + fiSeminovos + admRateado;
    return {
      cod_empresa: e.cod_empresa,
      nome: e.nome,
      cnpj: e.cnpj_normalizado ?? "",
      qtdNovos: qNovos,
      qtdSeminovos: qSemi,
      qtdIntranet: qIntra,
      qtdPcSegmento: qPc,
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
