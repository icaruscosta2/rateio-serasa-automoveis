## Descoberta importante

As "90 linhas órfãs" eram falso-positivo do meu script de validação (ele não fez `padStart(14)` no CNPJ). O app real (`normalizeCnpj`) já bate corretamente: `8893457000699` → `08893457000699` = `DU NORT - MARABA` (RENAULT). **Nenhum cadastro novo é necessário.**

Contagem real da Intranet (planilha 03/2026):

| Segmento | Linhas |
|---|---|
| Auto (RENAULT 944, NISSAN 817, FCA 288, PSA 195, VW AUTOS 171, FORD 132, HYUNDAI 105, CHERY 81, GWM 66, JEEP 46, HONDA CARRO 16) | **2.861** |
| CAMINHOES (VW CAMINHOES) | 716 |
| **Total universo** | **3.577** |

## Bug atual no F&I

Em `src/lib/compute-rateio.ts` (linhas 116-127), o denominador `intranetTotalSegmentado` soma só empresas **incluídas**. Resultado: quando o usuário desmarca CAMINHOES, o F&I dele "migra" para Auto — Auto recebe 100% dos R$ 12.477,81. Errado.

## Correção

Trocar o denominador do F&I por um "universo": soma da Intranet de **todas** as empresas com bandeira mapeada (incluídas ou não), dedupadas por CNPJ. Numerador continua sendo só as incluídas.

Efeito:
- Tudo incluído → Auto recebe 12.477,81 × 2.861/3.577 = **R$ 9.980,67**, CAMINHOES recebe R$ 2.497,14.
- CAMINHOES desmarcado → Auto continua recebendo **R$ 9.980,67**, CAMINHOES recebe R$ 0 (a fatia "se perde", como você descreveu).

## Mudanças

### `src/lib/compute-rateio.ts`

Substituir o bloco F&I (linhas 111-136) por:

1. Manter cálculo de `intranetPorSeg/novosPorSeg/semiPorSeg` somente para empresas incluídas (numeradores).
2. Construir `ownerByCnpjAll` percorrendo `empresas` (todas, não só incluídas), dedupando por CNPJ e priorizando empresa com bandeira mapeada.
3. Calcular `intranetUniverso = Σ intranetPorCnpj[c]` para cada CNPJ "owner" cuja bandeira mapeie para um segmento (Auto/Caminhões/Máquinas/Tratores/Motos).
4. `fiFatiaPorSeg[seg] = fatia.fi × intranetPorSeg[seg] / intranetUniverso`.

Nada mais muda — PC Adicional, ADM, Consumo Mínimo, PC Fixo continuam como estão.

## Cadastro DU NORT MARABA

**Não precisa fazer nada.** Já existe no banco (cod_empresa 194, RENAULT, CNPJ 08.893.457/0006-99) e o `normalizeCnpj` do app já faz padStart corretamente.
