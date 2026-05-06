## Diagnóstico

Na aba **Power Curve Variável**:
- O parser leu as 476 linhas (Y=476 ✓), mas o filtro descartou todas (X=0).
- Como você confirmou antes que dava 250/476, e a única mudança é que "a tabela começa em uma coluna mais à frente", o problema mais provável é que o cabeçalho da coluna `subproduto2` (ou `user_id`) tem variação de nome que o matching exato (`norm()`) não está reconhecendo. Exemplos plausíveis: `Sub Produto 2`, `SUBPRODUTO 2`, `subproduto_2`, `sub_produto2`.

Quando isso acontece:
- `sheetToRowsByHeader(["CNPJ"])` (terceiro fallback) ainda lê 476 linhas.
- `get(r, "subproduto2")` retorna `null` em todas porque procura match exato.
- Todas viram "descartadas" → 0/476 = 0,00%.

## Correção

### 1) `src/lib/parse-rateio.ts` — leitura tolerante das colunas da PCV

Adicionar uma função auxiliar `getLoose(row, ...candidates)` que compara nomes de coluna **ignorando espaços, underscores, hífens e pontuação** (só letras/números). E aceitar variações conhecidas.

Trocar nas linhas que leem PCV:
- `get(r, "subproduto2")` → `getLoose(r, "subproduto2", "sub produto 2", "subproduto 2")`
- `get(r, "user_id")` → `getLoose(r, "user_id", "userid", "usuario", "user")`
- `get(r, "CNPJ")` → manter como está (CNPJ é estável).

E na detecção do cabeçalho da PCV (`sheetToRowsByHeader`), passar a usar a mesma comparação tolerante para localizar a linha de header — assim, mesmo se o nome estiver com pontuação/underscore, o cabeçalho é reconhecido e usamos os fallbacks na ordem correta (`["CNPJ","subproduto2","user_id"]` primeiro).

### 2) Diagnóstico mais útil (warning)

Hoje o warning só diz `0/476 (0,00%)`. Vou enriquecer:
- Listar os **nomes reais de coluna detectados** na aba PCV (cabeçalho original, sem normalizar).
- Mostrar os **3 valores distintos mais comuns** de `subproduto2`, com contagem.
- Mostrar quantas linhas têm `user_id` preenchido.

Assim, se ainda assim falhar, a próxima tentativa já mostra exatamente qual nome esperar.

### 3) Sem mudança de UI

A prévia do Passo 3 já lê `pcvShareAuto` corretamente. Após o fix do parse, a porcentagem volta a mostrar ~52,52%.

## Arquivo proposto para edição

- `src/lib/parse-rateio.ts`

Nenhuma mudança em `compute-rateio.ts`, na UI ou no schema.

## Como você verifica depois

1. Reenvie a mesma planilha no Passo 1.
2. No "Resumo extraído", a linha "Power Curve Variável" deve voltar a `250/476 linhas para Automóveis (52,52%)`.
3. No Passo 3, a prévia mostrará "PC Adicional Auto = PC Adicional grupo × 52,52%".
4. Se ainda der 0, o novo warning amarelo dirá quais nomes de coluna a planilha realmente tem — me mande esse texto e eu adiciono o caso.