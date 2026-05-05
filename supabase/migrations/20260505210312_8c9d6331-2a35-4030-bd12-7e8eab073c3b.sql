ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS tipo_negocio text;
CREATE INDEX IF NOT EXISTS idx_companies_tipo_negocio ON public.companies(tipo_negocio);