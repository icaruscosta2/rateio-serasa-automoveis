## Ajustes finais no rateio

### 1) PC Fixo — mais casas decimais (1/3 ↔ 2/3)

O input do percentual de PC Fixo está limitado a 3 casas (`step="0.001"`) e o valor padrão é `0.667`, o que arredonda e cria diferença de centavos contra o valor exato de 2/3.

**Mudanças em `src/routes/rateios.novo.tsx`:**
- Default de `pct.pcFixo`: `0.667` → `2/3` (≈ 0.6666666666666666).
- Input de "Power Curve Fixo": `step="0.001"` → `step="0.00000001"` (e mostrar 6 casas no rótulo de % abaixo do input).
- Aplicar o mesmo `step` aos demais campos para que o usuário possa digitar `0.56` ou frações exatas sem perda.
- Exibir o % com mais precisão: `{(pct[k] * 100).toFixed(4)}%` no helper text (mantém leitura clara, sem cortar dígitos).

Resultado: ao deixar o default ou ao digitar `0.66666667`, a fatia bate exatamente com o valor da planilha.

### 2) F&I PEFIN PF — diferença de R$ 9,78

O sistema mostra **R$ 8.899,80** e a planilha **R$ 8.890,02** (diferença = R$ 9,78). A regra atual soma TODA linha cujo `Descrição de Produto NF` seja exatamente `CREDNET SERASA PEFIN PF TOP`, independentemente do logon (exceto Rejane, que é tratada antes).

Diferença de R$ 9,78 é compatível com **1 ou 2 linhas extras** sendo somadas no PEFIN PF. Hipóteses prováveis:

- (a) Existe alguma linha `PEFIN PF TOP` com logon que **não deveria** entrar no F&I PF (ex.: outro logon específico que a planilha exclui manualmente).
- (b) Existe variação na descrição (ex.: `CREDNET SERASA PEFIN PF` sem "TOP", ou com sufixo) que a planilha trata diferente.

Como não consigo abrir a planilha daqui para confirmar a origem dos R$ 9,78, vou **adicionar diagnóstico** que torna isso visível na própria UI:

**Mudanças em `src/lib/parse-rateio.ts`:**
- Manter um detalhamento por logon das linhas que entraram em PEFIN PF (`Map<logon, { count, soma }>`).
- Expor em `ParseResult` como `demoFiPefinPfPorLogon` (apenas para diagnóstico).

**Mudanças em `src/routes/rateios.novo.tsx`:**
- Logo abaixo da linha "Demonstrativo — F&I PEFIN PF: …", listar (em texto pequeno) cada logon que somou ao PEFIN PF com count e total, ordenado por valor desc. Ex.:
  ```
  PEFIN PF por logon: PC CREDITO (215, R$ 8.890,02) · FULANO (2, R$ 9,78)
  ```

Com isso você consegue identificar imediatamente qual logon está somando os R$ 9,78 a mais e me diz a regra de exclusão (ex.: "ignorar logon X" ou "só somar logon PC CREDITO no PEFIN PF"). Aí faço o ajuste definitivo da regra de filtragem.

### Arquivos alterados
- `src/routes/rateios.novo.tsx` — defaults/step/precision dos inputs e exibição do detalhamento PEFIN PF por logon.
- `src/lib/parse-rateio.ts` — coleta e expõe `demoFiPefinPfPorLogon` no `ParseResult`.