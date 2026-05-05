/** Normaliza CNPJ: remove tudo que não for dígito e padroniza para 14 dígitos com zero-pad à esquerda. */
export function normalizeCnpj(input: unknown): string {
  if (input === null || input === undefined) return "";
  let s = String(input).trim();
  // Lidar com notação científica vinda do Excel (ex: 8.89346E+12)
  if (/e\+?\d+$/i.test(s)) {
    const n = Number(s);
    if (Number.isFinite(n)) s = Math.round(n).toString();
  }
  const digits = s.replace(/\D/g, "");
  if (!digits) return "";
  return digits.padStart(14, "0");
}

export function formatCnpj(cnpj: string): string {
  const d = normalizeCnpj(cnpj);
  if (d.length !== 14) return cnpj;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}
