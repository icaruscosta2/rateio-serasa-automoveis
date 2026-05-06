## Objetivo

Permitir que o usuário apague rateios existentes diretamente pela interface, com confirmação antes da exclusão e remoção das linhas relacionadas.

## Mudanças

### 1) Card da lista (`src/routes/rateios.index.tsx`)
- Adicionar um botão de lixeira (ícone `Trash2`) no canto superior direito de cada card de rateio.
- O botão fica sobreposto ao card mas **não dispara a navegação** (usa `e.preventDefault()` + `e.stopPropagation()`).
- Ao clicar, abre um diálogo de confirmação (`AlertDialog` do shadcn) com o texto:
  > "Excluir o rateio de [mês/ano]? Esta ação não pode ser desfeita."
- Ao confirmar, executa a exclusão e remove o card da lista localmente. Mostra toast de sucesso/erro.

### 2) Tela de detalhe (`src/routes/rateios.$id.tsx`)
- Adicionar botão "Excluir rateio" (variante `destructive`, ícone `Trash2`) no cabeçalho, ao lado do botão de download.
- Mesmo fluxo de confirmação via `AlertDialog`.
- Após excluir com sucesso, navega de volta para `/rateios` e mostra toast.

### 3) Lógica de exclusão
Como as tabelas filhas (`rateio_empresas`, `rateio_consultas`, `rateio_resultados`) não têm cascade definido no banco, a exclusão será feita em ordem dentro de uma função utilitária compartilhada `deleteRateio(id)`:

```text
1. delete from rateio_resultados where rateio_id = id
2. delete from rateio_consultas  where rateio_id = id
3. delete from rateio_empresas   where rateio_id = id
4. delete from rateios           where id = id
```

Tudo a partir do client Supabase do usuário — as políticas de RLS já garantem que cada usuário só consegue apagar os próprios rateios e suas linhas filhas.

A função fica em `src/lib/delete-rateio.ts` e é usada pelos dois lugares.

### 4) Arquivo de storage (opcional, sem bloquear)
Se `arquivo_storage_path` estiver preenchido no rateio, também removemos o arquivo do bucket `rateio-uploads` (`supabase.storage.from("rateio-uploads").remove([path])`). Falha silenciosa: se der erro de storage, a exclusão do rateio em si já foi feita e mostramos só um warning no console.

## Detalhes técnicos

- **Componentes novos usados**: `AlertDialog`, `AlertDialogAction`, `AlertDialogCancel`, `AlertDialogContent`, `AlertDialogDescription`, `AlertDialogFooter`, `AlertDialogHeader`, `AlertDialogTitle`, `AlertDialogTrigger` (já existem em `src/components/ui/alert-dialog.tsx`).
- **Sem migrations**: nenhuma alteração de schema. Não vamos adicionar `ON DELETE CASCADE` agora para manter o escopo pequeno — a deleção em ordem cobre todos os casos via RLS do dono.
- **Estado da lista**: depois de excluir, atualizamos `rows` com `setRows(rows.filter(r => r.id !== deletedId))` em vez de refazer o fetch.
- **Loading state**: enquanto a exclusão estiver em andamento, o botão de confirmar fica desabilitado para evitar duplo-clique.

## Fora do escopo

- Excluir múltiplos rateios em lote (seleção).
- "Lixeira" / soft delete — a exclusão é permanente.
- Adicionar `ON DELETE CASCADE` no schema (pode ser feito depois se preferir centralizar no banco).
