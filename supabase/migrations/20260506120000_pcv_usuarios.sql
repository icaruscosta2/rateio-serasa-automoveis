-- PCV_USUARIOS: usuários de "Consulta PF" mapeados a um segmento na Power Curve Variável
CREATE TABLE public.pcv_usuarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL UNIQUE,
  segmento TEXT NOT NULL DEFAULT 'AUTOMOVEIS',
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_pcv_usuarios_user_id ON public.pcv_usuarios(user_id);

ALTER TABLE public.pcv_usuarios ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read pcv_usuarios" ON public.pcv_usuarios FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert pcv_usuarios" ON public.pcv_usuarios FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update pcv_usuarios" ON public.pcv_usuarios FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated delete pcv_usuarios" ON public.pcv_usuarios FOR DELETE TO authenticated USING (true);

CREATE TRIGGER trg_pcv_usuarios_updated BEFORE UPDATE ON public.pcv_usuarios
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Seed: usuários que já estavam hardcodados (segmento Automóveis)
INSERT INTO public.pcv_usuarios (user_id, segmento) VALUES
  ('aleff.cordeiro@revemar.com.br', 'AUTOMOVEIS'),
  ('ana.vitoria@revemar.com.br', 'AUTOMOVEIS');
