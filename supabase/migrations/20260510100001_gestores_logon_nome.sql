-- Adiciona coluna nome ao cadastro de gestores (equivalente à aba Base Logon)
ALTER TABLE public.gestores_logon
  ADD COLUMN IF NOT EXISTS nome text;
