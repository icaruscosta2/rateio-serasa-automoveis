/**
 * compute-segmentos.ts
 *
 * Calcula a divisão do custo Serasa entre os segmentos do grupo
 * (Etapa 1 do processo de rateio).
 *
 * Regras:
 *  - Consumo Mínimo: proporcional ao nº de CNPJs (Tabela Monitoramento)
 *  - PC Fixo: proporcional ao nº de CNPJs (Tabela PC Fixo)
 *  - PC Adicional: proporcional ao volume de consultas PCV
 *  - F&I: proporcional ao volume de consultas Intranet
 *  - ADM: direto do Demonstrativo, já separado por segmento em parse-rateio.ts
 */

import type { ParseResult } from "./parse-rateio";
import { segmentoDaBandeira, type Segmento } from "./segmentos";

// ---------------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------------

export interface SegmentoValores {
  consumo_minimo: number;
  pc_fixo: number;
  pc_adicional: number;
  fi_novos: number;
  fi_seminovos: number;
  adm: number;
  total: number;
  /** Bases de cálculo para auditoria */
  intranet_novos: number;
  intranet_seminovos: number;
  intranet_total: number;
}

export interface SegmentSummary {
  /** Totais do grupo inteiro (fatura completa) */
  grupo: {
    consumo_minimo: number;
    pc_fixo: number;
    pc_adicional: number;
    fi: number;
    adm: number;
    total: number;
    intranet_total: number;
  };
  /** Parcela de cada segmento */
  segmentos: Partial<Record<Segmento, SegmentoValores>>;
  /**
   * Percentual efetivo aplicado para AUTOMÓVEIS
   * (retido para compatibilidade com registros históricos no banco)
   */
  pct_consumo_minimo: number;
  pct_pc_fixo: number;
}

// ---------------------------------------------------------------------------
// Configuração de distribuição por tabela de CNPJs
// ---------------------------------------------------------------------------

export interface SegmentConfigMaps {
  /** segmento (nome do código Segmento) → qtd de CNPJs para Consumo Mínimo */
  monitoramento: Map<string, number>;
  /** segmento (nome do código Segmento) → qtd de CNPJs para PC Fixo */
  pcFixo: Map<string, number>;
}

/** Valores padrão (usados como fallback se o banco não tiver configuração) */
export const DEFAULT_SEGMENT_CONFIG_MAPS: SegmentConfigMaps = {
  monitoramento: new Map([
    ["AUTOMOVEIS", 14],
    ["CAMINHOES",   4],
    ["MOTOS",       3],
    ["SERVICOS",    4],
  ]),
  pcFixo: new Map([
    ["AUTOMOVEIS", 14],
    ["CAMINHOES",   4],
    ["MOTOS",       3],
  ]),
};

// ---------------------------------------------------------------------------
// Empresa (subset necessário para mapear CNPJ → segmento)
// ---------------------------------------------------------------------------

type EmpresaLean = {
  cnpj_normalizado: string | null;
  bandeira: string | null;
};

// ---------------------------------------------------------------------------
// Função principal
// ---------------------------------------------------------------------------

export function computeSegmentos(
  parsed: ParseResult,
  todasEmpresas: EmpresaLean[],
  configMaps: SegmentConfigMaps = DEFAULT_SEGMENT_CONFIG_MAPS,
): SegmentSummary {

  // 1. Monta mapa CNPJ → segmento (deduplica: prioriza quem tem segmento)
  const segByCnpj = new Map<string, Segmento>();
  for (const e of todasEmpresas) {
    const cnpj = e.cnpj_normalizado;
    if (!cnpj) continue;
    const seg = segmentoDaBandeira(e.bandeira);
    if (!seg) continue;
    if (!segByCnpj.has(cnpj)) segByCnpj.set(cnpj, seg);
  }

  // 2. Agrega Intranet por segmento
  const intranetNovos  = new Map<Segmento, number>();
  const intranetSemi   = new Map<Segmento, number>();
  const intranetTotais = new Map<Segmento, number>();
  let totalIntranet = 0;

  for (const [cnpj, qTot] of parsed.intranetPorCnpj) {
    const seg = segByCnpj.get(cnpj);
    if (!seg) continue;
    const qN = parsed.intranetNovosPorCnpj.get(cnpj) ?? 0;
    const qS = parsed.intranetSeminovosPorCnpj.get(cnpj) ?? 0;
    intranetNovos.set(seg,  (intranetNovos.get(seg)  ?? 0) + qN);
    intranetSemi.set(seg,   (intranetSemi.get(seg)   ?? 0) + qS);
    intranetTotais.set(seg, (intranetTotais.get(seg) ?? 0) + qTot);
    totalIntranet += qTot;
  }

  // 3. F&I por segmento (proporcional à Intranet)
  const fiNovosPorSeg = new Map<Segmento, number>();
  const fiSemiPorSeg  = new Map<Segmento, number>();
  if (totalIntranet > 0) {
    for (const [seg] of intranetTotais) {
      const qN = intranetNovos.get(seg) ?? 0;
      const qS = intranetSemi.get(seg)  ?? 0;
      fiNovosPorSeg.set(seg, (parsed.fiGrupo * qN) / totalIntranet);
      fiSemiPorSeg.set(seg,  (parsed.fiGrupo * qS) / totalIntranet);
    }
  }

  // 4. PC Adicional por segmento
  //    AUTOMÓVEIS: usa a proporção já calculada pelo PCV (pcVariavelLinhasAuto / total)
  //    Outros segmentos: distribuição pelo volume Intranet (aproximação inicial)
  const pcvShare = parsed.pcVariavelTotalLinhas > 0
    ? parsed.pcVariavelLinhasAuto / parsed.pcVariavelTotalLinhas
    : 0;
  const pcAdicionalPorSeg = new Map<Segmento, number>();
  if (pcvShare > 0) {
    pcAdicionalPorSeg.set("AUTOMOVEIS", parsed.pcAdicionalGrupo * pcvShare);
    const pcaResto = parsed.pcAdicionalGrupo * (1 - pcvShare);
    const intranetSemAuto = totalIntranet - (intranetTotais.get("AUTOMOVEIS") ?? 0);
    if (intranetSemAuto > 0) {
      for (const [seg, qTot] of intranetTotais) {
        if (seg === "AUTOMOVEIS") continue;
        pcAdicionalPorSeg.set(seg, (pcaResto * qTot) / intranetSemAuto);
      }
    }
  } else {
    if (totalIntranet > 0) {
      for (const [seg, qTot] of intranetTotais) {
        pcAdicionalPorSeg.set(seg, (parsed.pcAdicionalGrupo * qTot) / totalIntranet);
      }
    }
  }

  // 5. Consumo Mínimo: proporcional ao nº de CNPJs (Tabela Monitoramento)
  const totalCnpjMon = Array.from(configMaps.monitoramento.values())
    .reduce((a, b) => a + b, 0);
  const consMinimoPerSeg = new Map<string, number>();
  if (totalCnpjMon > 0) {
    for (const [seg, qtd] of configMaps.monitoramento) {
      consMinimoPerSeg.set(seg, (parsed.consumoMinimoGrupo * qtd) / totalCnpjMon);
    }
  }

  // 6. PC Fixo: proporcional ao nº de CNPJs (Tabela PC Fixo)
  const totalCnpjPcf = Array.from(configMaps.pcFixo.values())
    .reduce((a, b) => a + b, 0);
  const pcFixoPerSeg = new Map<string, number>();
  if (totalCnpjPcf > 0) {
    for (const [seg, qtd] of configMaps.pcFixo) {
      pcFixoPerSeg.set(seg, (parsed.pcFixoGrupo * qtd) / totalCnpjPcf);
    }
  }

  // 7. ADM — já separado por segmento no parse
  const admPorSeg = parsed.admRateadoPorSegmento ?? {};

  // 8. Monta o conjunto de segmentos com dados
  const allSegs = new Set<string>([
    ...intranetTotais.keys(),
    ...consMinimoPerSeg.keys(),
    ...pcFixoPerSeg.keys(),
    ...Object.keys(admPorSeg),
    "AUTOMOVEIS",
  ]);

  const segmentos: Partial<Record<Segmento, SegmentoValores>> = {};
  for (const seg of allSegs) {
    const cm  = consMinimoPerSeg.get(seg) ?? 0;
    const pcf = pcFixoPerSeg.get(seg)     ?? 0;
    const pca = pcAdicionalPorSeg.get(seg as Segmento) ?? 0;
    const fiN = fiNovosPorSeg.get(seg as Segmento)     ?? 0;
    const fiS = fiSemiPorSeg.get(seg as Segmento)      ?? 0;
    const adm = (admPorSeg[seg] as number) ?? 0;
    segmentos[seg as Segmento] = {
      consumo_minimo:      cm,
      pc_fixo:             pcf,
      pc_adicional:        pca,
      fi_novos:            fiN,
      fi_seminovos:        fiS,
      adm,
      total:               cm + pcf + pca + fiN + fiS + adm,
      intranet_novos:      intranetNovos.get(seg as Segmento)  ?? 0,
      intranet_seminovos:  intranetSemi.get(seg as Segmento)   ?? 0,
      intranet_total:      intranetTotais.get(seg as Segmento) ?? 0,
    };
  }

  const admTotal = Object.values(admPorSeg as Record<string, number>)
    .reduce((a, b) => a + b, 0);

  // Percentual efetivo da AUTOMÓVEIS (para compatibilidade com histórico no banco)
  const pctConsMin = totalCnpjMon > 0
    ? ((configMaps.monitoramento.get("AUTOMOVEIS") ?? 0) / totalCnpjMon) * 100
    : 0;
  const pctPcFixo = totalCnpjPcf > 0
    ? ((configMaps.pcFixo.get("AUTOMOVEIS") ?? 0) / totalCnpjPcf) * 100
    : 0;

  return {
    grupo: {
      consumo_minimo: parsed.consumoMinimoGrupo,
      pc_fixo:        parsed.pcFixoGrupo,
      pc_adicional:   parsed.pcAdicionalGrupo,
      fi:             parsed.fiGrupo,
      adm:            admTotal,
      total:          parsed.consumoMinimoGrupo + parsed.pcFixoGrupo +
                      parsed.pcAdicionalGrupo   + parsed.fiGrupo + admTotal,
      intranet_total: totalIntranet,
    },
    segmentos,
    pct_consumo_minimo: pctConsMin,
    pct_pc_fixo:        pctPcFixo,
  };
}
