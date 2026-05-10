/**
 * compute-segmentos.ts
 *
 * Calcula a divisão do custo Serasa entre os segmentos do grupo
 * (Etapa 1 do processo de rateio).
 *
 * Regras:
 *  - F&I e PC Adicional: proporção pelo volume de transações (Intranet / PCV)
 *  - Consumo Mínimo e PC Fixo: percentuais fixos configurados pelo usuário
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
  /** Percentuais efetivamente aplicados para Consumo Mínimo e PC Fixo */
  pct_consumo_minimo: number; // % → AUTOMOVEIS
  pct_pc_fixo: number;        // % → AUTOMOVEIS
}

// ---------------------------------------------------------------------------
// Entrada de configuração
// ---------------------------------------------------------------------------

export interface SegmentConfig {
  /** % do Consumo Mínimo que vai para AUTOMÓVEIS (padrão 56%) */
  pctConsMin: number;
  /** % do PC Fixo que vai para AUTOMÓVEIS (padrão 66,7%) */
  pctPcFixo: number;
}

export const DEFAULT_SEGMENT_CONFIG: SegmentConfig = {
  pctConsMin: 56,
  pctPcFixo: 66.7,
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
  config: SegmentConfig = DEFAULT_SEGMENT_CONFIG,
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
    for (const [seg, qTot] of intranetTotais) {
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
    // AUTOMÓVEIS: valor exato via PCV
    pcAdicionalPorSeg.set("AUTOMOVEIS", parsed.pcAdicionalGrupo * pcvShare);
    // Restante dividido proporcionalmente pela Intranet dos outros segmentos
    const pcaResto = parsed.pcAdicionalGrupo * (1 - pcvShare);
    const intranetSemAuto = totalIntranet - (intranetTotais.get("AUTOMOVEIS") ?? 0);
    if (intranetSemAuto > 0) {
      for (const [seg, qTot] of intranetTotais) {
        if (seg === "AUTOMOVEIS") continue;
        pcAdicionalPorSeg.set(seg, (pcaResto * qTot) / intranetSemAuto);
      }
    }
  } else {
    // Sem PCV → distribui tudo pelo Intranet
    if (totalIntranet > 0) {
      for (const [seg, qTot] of intranetTotais) {
        pcAdicionalPorSeg.set(seg, (parsed.pcAdicionalGrupo * qTot) / totalIntranet);
      }
    }
  }

  // 5. Consumo Mínimo e PC Fixo (percentuais fixos → só AUTOMÓVEIS por enquanto)
  const consMinAuto = parsed.consumoMinimoGrupo * (config.pctConsMin / 100);
  const pcFixoAuto  = parsed.pcFixoGrupo        * (config.pctPcFixo  / 100);

  // 6. ADM — já separado por segmento no parse
  const admPorSeg = parsed.admRateadoPorSegmento ?? {};

  // 7. Monta o conjunto de segmentos com dados
  const allSegs = new Set<Segmento>([
    ...intranetTotais.keys(),
    ...Object.keys(admPorSeg) as Segmento[],
    "AUTOMOVEIS", // garante que AUTOMÓVEIS sempre aparece
  ]);

  const segmentos: Partial<Record<Segmento, SegmentoValores>> = {};
  for (const seg of allSegs) {
    const cm  = seg === "AUTOMOVEIS" ? consMinAuto : 0; // outros segmentos: a definir
    const pcf = seg === "AUTOMOVEIS" ? pcFixoAuto  : 0;
    const pca = pcAdicionalPorSeg.get(seg) ?? 0;
    const fiN = fiNovosPorSeg.get(seg)     ?? 0;
    const fiS = fiSemiPorSeg.get(seg)      ?? 0;
    const adm = (admPorSeg[seg] as number) ?? 0;
    segmentos[seg] = {
      consumo_minimo:    cm,
      pc_fixo:           pcf,
      pc_adicional:      pca,
      fi_novos:          fiN,
      fi_seminovos:      fiS,
      adm,
      total:             cm + pcf + pca + fiN + fiS + adm,
      intranet_novos:    intranetNovos.get(seg)  ?? 0,
      intranet_seminovos:intranetSemi.get(seg)   ?? 0,
      intranet_total:    intranetTotais.get(seg) ?? 0,
    };
  }

  const admTotal = Object.values(admPorSeg as Record<string, number>)
    .reduce((a, b) => a + b, 0);

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
    pct_consumo_minimo: config.pctConsMin,
    pct_pc_fixo:        config.pctPcFixo,
  };
}
