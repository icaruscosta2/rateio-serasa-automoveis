# Sistema de Rateio de Consultas de Crédito — Plano (v2)

## Visão geral

Sistema web (TanStack Start + Lovable Cloud) que automatiza o RESUMO RATEIO mensal das consultas de crédito do grupo Revemar.

A base de **Empresas** é cadastrada **uma única vez** (e atualizada apenas quando o grupo mudar). A cada mês, o usuário faz **um único upload** — uma planilha XLSX com várias abas — escolhe quais empresas entram no rateio e o sistema gera a tabela final por CNPJ de Automóveis.

Escopo desta entrega: **somente segmento AUTOMÓVEIS**. Outros segmentos podem aparecer nos uploads mas são ignorados no relatório final.

---

## Modelo de dados (Lovable Cloud / Postgres)

### Tabelas mestres

**companies** — base de empresas (cadastrada uma vez, editável)
- `cod_empresa` (int, PK)
- `nome`, `apelido`, `cnpj`, `cnpj_normalizado` (só dígitos, sem zeros à esquerda removidos), `estado`, `cidade`
- `cod_empresa_principal` (int) — referência à matriz
- `segmento` (AUTOMOVEIS / PESADOS / MOTOS), `bandeira`, `grupo_empresa`
- `is_matriz` (bool, derivado: `cod_empresa = cod_empresa_principal`, editável)
- `ativo` (bool, default true)

**rateios** — uma linha por mês processado
- `id`, `mes_referencia`, `created_at`, `created_by`
- `consumo_minimo_grupo`, `pc_fixo_grupo`, `pc_adicional_grupo`, `fi_intranet_grupo`, `adm_rateado_grupo`
- `pct_auto_consumo_minimo`, `pct_auto_pc_fixo`, `pct_auto_pc_adicional`, `pct_auto_fi`, `pct_auto_adm`
- `arquivo_storage_path`

**rateio_empresas** — empresas selecionadas para um rateio específico
- (`rateio_id`, `cod_empresa`) PK
- `incluida` (bool), `is_matriz_override` (bool)

**rateio_consultas** — contagens por CNPJ
- `rateio_id`, `cod_empresa`
- `qtd_unico_auto_novos`, `qtd_unico_auto_seminovos`, `qtd_intranet`, `qtd_pc_segmento`

### Storage
- Bucket `rateio-uploads/{rateio_id}.xlsx` para auditoria do arquivo único enviado.

---

## Telas

### 1. `/empresas` — Cadastro da base (uso ocasional)
- Upload **inicial** da planilha "Empresas - Revemar" (.xlsx) — popula a tabela
- Tabela com busca, filtro por segmento, edição inline de `ativo` e `is_matriz`
- Botão "Reimportar planilha" (faz merge/upsert por `cod_empresa`) — usado apenas quando o grupo mudar
- Indicadores: total Automóveis ativas / total matrizes (esperado ~14)

### 2. `/rateios` — Lista de rateios mensais
- Cards por mês com status; botão "Novo Rateio"

### 3. `/rateios/novo` — Wizard (3 passos)

**Passo 1 — Upload único**
- Um único campo de upload (.xlsx) com a planilha mensal
- O arquivo deve conter as abas:
  - **Demonstrativo** — CONSUMO MÍNIMO, PC FIXO, PC CRÉDITO (split em 2 grupos), linhas da Rejane Assunção (ADM Rateado)
  - **Logon Power Curve** — base do PC Adicional por segmento
  - **Logon Intranet** — base de proporção F&I e ADM por CNPJ
  - **Único Auto** — contagem por CNPJ separada em NOVOS e SEMINOVOS
  - **Tab Dinâmica PC Variável** (Power Curve por segmento) — split Auto/Pesados/Moto do PC Adicional
- Após o parse, mostra preview com totais extraídos de cada aba para o usuário validar antes de seguir
- Nomes de aba reconhecidos com matching tolerante (case-insensitive, normalizando acentos); se faltar alguma aba esperada, mostra erro listando o que foi encontrado vs. esperado

**Passo 2 — Seleção de empresas**
- Lista de empresas Automóveis ativas com **duas colunas de checkbox**:
  - `Incluir no rateio` (todas pré-marcadas)
  - `Matriz` (as identificadas como matriz pré-marcadas, editável só para este rateio)
- Contador no topo: "X selecionadas / Y matrizes"

**Passo 3 — Confirmação e geração**
- Mostra os percentuais Auto aplicados (defaults do MONITORAMENTO, editáveis): consumo mínimo 56%, etc.
- Botão "Gerar RESUMO RATEIO"

### 4. `/rateios/:id` — Tabela final RESUMO RATEIO

```text
| CNPJ | Empresa | Consumo Mín | PC Fixo | PC Adicional | F&I                              | Total |
|      |         |             |         |              | Novos | Seminovos | ADM Rateado |       |
```

Linha de totais no rodapé. Botões: **Exportar XLSX**, Editar, Duplicar para próximo mês.

---

## Lógica de rateio

| Coluna | Origem (grupo) | Fatia Auto | Distribuição entre CNPJs |
|---|---|---|---|
| Consumo Mínimo | Linha "CONSUMO MÍNIMO" do Demonstrativo | % MONITORAMENTO (default 56%) | Igualitário entre **matrizes** selecionadas |
| PC Fixo | Linha "POWER CURVE FIXO" | % MONITORAMENTO | Igualitário entre **todas** as empresas selecionadas |
| PC Adicional | Soma PC CRÉDITO menos as 2 linhas CREDNET PEFIN PF/PJ TOP | % via Logon PC por segmento | Entre Autos: proporção da base **Único Auto** (Novos+Seminovos) |
| F&I Novos + Seminovos | 2 linhas "CREDNET SERASA PEFIN PF/PJ TOP" | % via Logon Intranet | Proporção Intranet por CNPJ; split Novos/Seminovos pela proporção Único Auto |
| ADM Rateado | Linhas do usuário "REJANE ASSUNÇÃO" no Demonstrativo | mesma regra do F&I | Proporção Intranet por CNPJ |

### Matching de CNPJ entre abas
- Normalização: remover tudo que não for dígito; padronizar para 14 dígitos com **zero-pad à esquerda** (corrige casos onde o zero inicial foi removido)
- Comparação sempre por CNPJ normalizado, nunca por nome

---

## Stack técnico

- **Frontend**: TanStack Start, rotas `/empresas`, `/rateios`, `/rateios/novo`, `/rateios/$id`
- **Server functions** (`src/server/*.functions.ts`): `importCompanies`, `createRateio`, `parseRateioWorkbook` (lê todas as abas de um único XLSX), `generateRateio`, `exportRateioXlsx`
- **Backend**: Lovable Cloud — Postgres com RLS, Storage para o arquivo bruto
- **Auth**: Lovable Cloud (email/senha)
- **Parsing XLSX**: `xlsx` (SheetJS) no server function

---

## Entrega faseada

**Fase 1 (este plano):**
1. Auth + cadastro de empresas (upload inicial e edição)
2. Wizard com upload único do XLSX mensal multi-aba
3. Seleção de empresas/matrizes por rateio
4. Geração do RESUMO RATEIO + exportação XLSX

**Fora do escopo agora:** Pesados/Motos no relatório, comparativos entre meses, edição manual de células geradas, permissões granulares.

Após sua aprovação, começo pela fundação: auth + cadastro de empresas + upload da base, para validar antes do wizard.
