/**
 * Mapeamento bandeira → segmento de rateio.
 * Atualizar aqui quando novas bandeiras entrarem.
 */
export type Segmento = "AUTOMOVEIS" | "CAMINHOES" | "MAQUINAS" | "TRATORES" | "MOTOCICLETAS" | "SERVICOS";

const MAP: Record<string, Segmento> = {
  // Automóveis
  RENAULT: "AUTOMOVEIS",
  FCA: "AUTOMOVEIS",
  FORD: "AUTOMOVEIS",
  GEELY: "AUTOMOVEIS",
  GWM: "AUTOMOVEIS",
  CHERY: "AUTOMOVEIS",
  "HONDA CARRO": "AUTOMOVEIS",
  HYUNDAI: "AUTOMOVEIS",
  JEEP: "AUTOMOVEIS",
  NISSAN: "AUTOMOVEIS",
  PSA: "AUTOMOVEIS",
  "VW AUTOS": "AUTOMOVEIS",
  // Caminhões
  "VW CAMINHOES": "CAMINHOES",
  // Máquinas
  JCB: "MAQUINAS",
  // Tratores
  MASSEY: "TRATORES",
  // Motocicletas
  "HONDA MOTOS": "MOTOCICLETAS",
  // Serviços
  LOCADORA: "SERVICOS",
  CORRETORA: "SERVICOS",
  RGN: "SERVICOS",
};

/** Bandeiras que NUNCA entram em rateio (somente fazenda/holding pura). */
const EXCLUIDAS = new Set(["FAZENDA"]);

function norm(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Retorna o segmento da bandeira, ou null se a bandeira deve ser excluída
 * do rateio (administrativa) ou desconhecida.
 */
export function segmentoDaBandeira(bandeira: string | null | undefined): Segmento | null {
  const b = norm(bandeira);
  if (!b) return null;
  if (EXCLUIDAS.has(b)) return null;
  return MAP[b] ?? null;
}

export function isBandeiraExcluida(bandeira: string | null | undefined): boolean {
  return EXCLUIDAS.has(norm(bandeira));
}
