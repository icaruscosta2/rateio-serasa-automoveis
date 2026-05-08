-- Tabela de gestores de logon para Consultas ADM Avulsas
CREATE TABLE public.gestores_logon (
  id         uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  logon      text        NOT NULL,
  segmento   text        NOT NULL DEFAULT 'AUTOMOVEIS',
  ativo      boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gestores_logon_logon_key UNIQUE (logon)
);

ALTER TABLE public.gestores_logon ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated users full access"
  ON public.gestores_logon
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE TRIGGER set_gestores_logon_updated_at
  BEFORE UPDATE ON public.gestores_logon
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Seed: Rejane e Márcia Gomes (Automóveis)
INSERT INTO public.gestores_logon (logon, segmento) VALUES
  ('REJANE',       'AUTOMOVEIS'),
  ('MARCIA GOMES', 'AUTOMOVEIS');
