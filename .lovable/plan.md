## Problema

Na etapa 3 do Novo Rateio, o **PC Adicional** zera para todas as lojas do segmento Automóveis.

**Causa**: a aba `Power Curve Variável` contém CNPJs de **clientes finais** (quem fez a consulta), não CNPJs das concessionárias. Hoje o `compute-rateio.ts` calcula corretamente a fração (ex.: 250/476 = 52,52%), mas tenta distribuir essa fatia entre lojas usando `pcVariavelPorCnpj[cnpjDaLoja]`, que é praticamente sempre 0 → `pcAdicional ≈ 0` para todas.

## Regra correta (confirmada)

- **Power Curve Variável**: usada **somente** para calcular a fração do segmento Automóveis, via `subproduto2` + `user_id` allowlist. **Nunca** indexar por CNPJ.
- **Distribuição entre lojas do segmento Automóveis**: feita pela aba **Único Auto** (`unicoAutoPorCnpj`), que tem CNPJ de concessionária. Fallback: `intranetPorCnpj` das lojas do segmento Automóveis.
- A fração 250/476 é calculada no parse e **não muda** quando o usuário desmarca lojas na seleção. Sempre prossegue com 100% da amostra (476 no denominador).

## Passo a passo final na aba Power Curve Variável (parse)

1. Localizar a aba (busca tolerante: `Power Curve Variavel`, `Power Curve Variável`, etc.).
2. Localizar o cabeçalho nas primeiras 30 linhas: `CNPJ` + `subproduto2` + `user_id` (com fallbacks).
3. Para cada linha de dados:
   - `pcvTotal++` (conta TODAS as linhas, sem filtro).
   - Lê `subproduto2` (normalizado) e `user_id` (lowercase). **Não lê CNPJ.**
   - `isAuto` = `subproduto2 == "Automóveis"`.
   - `isPfPermitido` = `subproduto2 == "Consulta PF"` E `user_id ∈ { aleff.cordeiro@revemar.com.br, ana.vitoria@revemar.com.br }`.
   - Se nenhum: `pcvDescartadas++` e pula. Senão: incrementa `pcvAuto` ou `pcvPf`.
   - **REMOVER**: a escrita em `pcVariavelPorCnpj` (linhas 323-325 atuais).
4. Ao fim do loop, o `ParseResult` carrega dois números desta aba:
   - `pcVariavelTotalLinhas = pcvTotal` (ex.: 476)
   - `pcVariavelLinhasAuto = pcvAuto + pcvPf` (ex.: 250)
5. Emite warning informativo na UI: `"Power Curve Variável: 250/476 linhas para Automóveis (52,52%) — ..."`.

## Mudanças

### `src/lib/parse-rateio.ts`
- Remover a escrita em `pcVariavelPorCnpj` dentro do loop da PCV (linhas 323-325).
- Manter o campo `pcVariavelPorCnpj` no `ParseResult` por compatibilidade de tipos (sempre vazio). Se nenhum outro arquivo o lê após o fix, remover do tipo também.

### `src/lib/compute-rateio.ts`
- Manter `pcvShareAuto` (linhas 62-65) e `fatia.pcAdicional = pcAdicionalGrupo × pcvShareAuto` (linhas 69-72) intactos — esta parte já está correta.
- Remover o ramo `pcAdicionalSource === "pcv"` (linhas 181-184) e a variável `totalPcVar` (linha 168, 174, 182).
- Nova regra de base do PC Adicional:
  - Se `totalUnicoAuto > 0` → fonte = `unico` (distribui por `unicoAutoPorCnpj`).
  - Senão → fonte = `intranet` (distribui pela Intranet das lojas do segmento Automóveis).
- Remover `qPcv` do cálculo de `q` na linha 213-214.
- Avaliar a coluna `qtdPcSegmento` em `RateioRow`: vai ficar sempre 0. Se a UI mostra essa coluna, remover ou ocultar.

## Verificação após o fix

Rodar "Novo Rateio" com a planilha atual e conferir:
- Soma da coluna `pcAdicional` na etapa 3 = `pcAdicionalGrupo × 52,52%` (não mais 0).
- Distribuição entre lojas do segmento Automóveis bate com a proporção de Único Auto por CNPJ.
- Desmarcar lojas no início NÃO altera a fração 52,52%.

## Nomenclatura (regra do projeto)

Salvo em `mem://index.md`. Resumo: nunca usar "AUTOS" / "Auto" como abreviação de "Automóveis" em UI/warnings/mensagens — "AUTOS" é categoria contábil da planilha Empresas. No código, identificadores internos (`AUTOMOVEIS`, `shareAuto`, etc.) podem ser mantidos.
