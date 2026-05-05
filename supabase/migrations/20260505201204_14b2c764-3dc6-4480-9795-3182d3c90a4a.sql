
-- COMPANIES (base compartilhada entre usuários autenticados)
CREATE TABLE public.companies (
  cod_empresa INTEGER PRIMARY KEY,
  nome TEXT NOT NULL,
  apelido TEXT,
  cnpj TEXT,
  cnpj_normalizado TEXT,
  estado TEXT,
  cidade TEXT,
  cod_empresa_principal INTEGER,
  cod_matriz INTEGER,
  segmento TEXT,
  bandeira TEXT,
  grupo_empresa TEXT,
  is_matriz BOOLEAN NOT NULL DEFAULT false,
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_companies_cnpj_norm ON public.companies(cnpj_normalizado);
CREATE INDEX idx_companies_segmento ON public.companies(segmento);

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read companies" ON public.companies FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert companies" ON public.companies FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update companies" ON public.companies FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated delete companies" ON public.companies FOR DELETE TO authenticated USING (true);

-- RATEIOS
CREATE TABLE public.rateios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  mes_referencia DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'rascunho',
  consumo_minimo_grupo NUMERIC(14,2) DEFAULT 0,
  pc_fixo_grupo NUMERIC(14,2) DEFAULT 0,
  pc_adicional_grupo NUMERIC(14,2) DEFAULT 0,
  fi_intranet_grupo NUMERIC(14,2) DEFAULT 0,
  adm_rateado_grupo NUMERIC(14,2) DEFAULT 0,
  pct_auto_consumo_minimo NUMERIC(6,4) DEFAULT 0.56,
  pct_auto_pc_fixo NUMERIC(6,4) DEFAULT 0.56,
  pct_auto_pc_adicional NUMERIC(6,4) DEFAULT 0.56,
  pct_auto_fi NUMERIC(6,4) DEFAULT 0.56,
  pct_auto_adm NUMERIC(6,4) DEFAULT 0.56,
  arquivo_storage_path TEXT,
  parse_summary JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.rateios ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners manage rateios" ON public.rateios FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- RATEIO_EMPRESAS
CREATE TABLE public.rateio_empresas (
  rateio_id UUID NOT NULL REFERENCES public.rateios(id) ON DELETE CASCADE,
  cod_empresa INTEGER NOT NULL REFERENCES public.companies(cod_empresa) ON DELETE CASCADE,
  incluida BOOLEAN NOT NULL DEFAULT true,
  is_matriz_override BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (rateio_id, cod_empresa)
);

ALTER TABLE public.rateio_empresas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners manage rateio_empresas" ON public.rateio_empresas FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.rateios r WHERE r.id = rateio_id AND r.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.rateios r WHERE r.id = rateio_id AND r.user_id = auth.uid()));

-- RATEIO_CONSULTAS
CREATE TABLE public.rateio_consultas (
  rateio_id UUID NOT NULL REFERENCES public.rateios(id) ON DELETE CASCADE,
  cod_empresa INTEGER NOT NULL REFERENCES public.companies(cod_empresa) ON DELETE CASCADE,
  qtd_unico_auto_novos INTEGER NOT NULL DEFAULT 0,
  qtd_unico_auto_seminovos INTEGER NOT NULL DEFAULT 0,
  qtd_intranet INTEGER NOT NULL DEFAULT 0,
  qtd_pc_segmento INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (rateio_id, cod_empresa)
);

ALTER TABLE public.rateio_consultas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners manage rateio_consultas" ON public.rateio_consultas FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.rateios r WHERE r.id = rateio_id AND r.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.rateios r WHERE r.id = rateio_id AND r.user_id = auth.uid()));

-- RATEIO_RESULTADOS
CREATE TABLE public.rateio_resultados (
  rateio_id UUID NOT NULL REFERENCES public.rateios(id) ON DELETE CASCADE,
  cod_empresa INTEGER NOT NULL REFERENCES public.companies(cod_empresa) ON DELETE CASCADE,
  consumo_minimo NUMERIC(14,2) NOT NULL DEFAULT 0,
  pc_fixo NUMERIC(14,2) NOT NULL DEFAULT 0,
  pc_adicional NUMERIC(14,2) NOT NULL DEFAULT 0,
  fi_novos NUMERIC(14,2) NOT NULL DEFAULT 0,
  fi_seminovos NUMERIC(14,2) NOT NULL DEFAULT 0,
  adm_rateado NUMERIC(14,2) NOT NULL DEFAULT 0,
  total NUMERIC(14,2) NOT NULL DEFAULT 0,
  PRIMARY KEY (rateio_id, cod_empresa)
);

ALTER TABLE public.rateio_resultados ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners manage rateio_resultados" ON public.rateio_resultados FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.rateios r WHERE r.id = rateio_id AND r.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.rateios r WHERE r.id = rateio_id AND r.user_id = auth.uid()));

-- updated_at trigger function
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE TRIGGER trg_companies_updated BEFORE UPDATE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_rateios_updated BEFORE UPDATE ON public.rateios
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- STORAGE BUCKET
INSERT INTO storage.buckets (id, name, public) VALUES ('rateio-uploads', 'rateio-uploads', false)
  ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Users read own uploads" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'rateio-uploads' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users upload own files" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'rateio-uploads' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users delete own uploads" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'rateio-uploads' AND auth.uid()::text = (storage.foldername(name))[1]);
