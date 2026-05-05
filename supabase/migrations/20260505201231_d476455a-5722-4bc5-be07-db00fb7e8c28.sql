
DROP POLICY IF EXISTS "Authenticated insert companies" ON public.companies;
DROP POLICY IF EXISTS "Authenticated update companies" ON public.companies;
DROP POLICY IF EXISTS "Authenticated delete companies" ON public.companies;

CREATE POLICY "Authenticated insert companies" ON public.companies FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated update companies" ON public.companies FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated delete companies" ON public.companies FOR DELETE TO authenticated
  USING (auth.uid() IS NOT NULL);

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
