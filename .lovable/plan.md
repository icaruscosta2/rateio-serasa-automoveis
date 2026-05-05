## Objetivo

Incorporar a aba `UNICOAUTO ` (presente nas planilhas mensais) como base oficial para ratear o **PC Adicional** entre as lojas de automóveis, mantendo a Intranet como base do F&I, ADM Rateado e do split Novos/Seminovos.

## Constatações da planilha real

- A aba se chama `UNICOAUTO ` (com espaço no final). Cada linha = 1 processo de análise de crédito.
- Cabeçalho na linha 1; CNPJ do estabelecimento na coluna **H** (`CNPJ`); nome em `Estabelecimento`.
- Não há indicação de Novos/Seminovos nesta aba — ela é usada apenas para rateio entre lojas auto.

## Alterações

### 1. `src/lib/parse-rateio.ts`
- Acrescentar campo `unicoAutoPorCnpj: Map<string, number>` no `ParseResult`.
- Localizar a aba via `findSheet(wb, ["UNICOAUTO", "Unico Auto", "Único Auto"])` (a função já faz match tolerante a acentos/espaços).
- Ler cabeçalho (`sheetToRowsByHeader` exigindo `CNPJ` + `Estabelecimento`) e contar 1 linha por CNPJ normalizado.
- Se a aba não existir, registrar em `warnings` (não bloquear) e o cálculo cai em fallback (Intranet).

### 2. `src/lib/compute-rateio.ts`
- Calcular `totalUnicoAuto` e `qUnicoAuto` por CNPJ.
- **PC Adicional** passa a usar Único Auto: `pcAdicional = totalUnicoAuto > 0 ? (fatia.pcAdicional * qUnicoAuto) / totalUnicoAuto : (fallback Intranet)`.
- F&I, ADM e split Novos/Seminovos continuam baseados na Intranet (regra atual).
- Adicionar `qtdUnicoAuto` em `RateioRow` para diagnóstico.

### 3. `src/routes/rateios.novo.tsx`
- Atualizar descrição do upload: "abas Demonstrativo, Intranet e UNICOAUTO".
- Mostrar no resumo extraído: `Único Auto: N CNPJs (total X processos)`.
- Salvar `qtd_unico_auto_novos` na coluna existente `qtd_unico_auto_novos` (mantendo nome do schema) com o valor de Único Auto por CNPJ; deixar `qtd_unico_auto_seminovos` com 0 (até termos uma fonte real). Nota: o schema atual já tem essas colunas, então não precisa de migration.

### 4. Sem mudanças de schema
Tudo cabe nas colunas existentes (`qtd_unico_auto_novos`, etc.). Nenhuma migration necessária.

## Validação esperada

Com a planilha de 03/2026:
- Consumo Mínimo grupo: R$ 975,00
- PC Fixo grupo: R$ 6.343,49
- PC Adicional grupo: R$ 5.597,17 (rateado entre as 14 lojas auto pela proporção de processos UNICOAUTO)
- F&I grupo: R$ 12.477,81 (rateado pela Intranet)
- ADM Rateado: R$ 95,23 (Rejane, rateado pela Intranet)
