-- Tabela mestre: um processo por mês, controla as etapas do rateio Serasa
CREATE TABLE public.processos_serasa (
  id                    uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  mes_referencia        date        NOT NULL,
  CONSTRAINT processos_serasa_mes_key UNIQUE (mes_referencia),

  -- Etapa 1: Divisão por Segmentos (Área de Processos)
  etapa1_status         text        NOT NULL DEFAULT 'pendente',
    -- 'pendente' | 'concluida'
  etapa1_resultado      jsonb,          -- SegmentSummary (ver compute-segmentos.ts)
  etapa1_pcv_inicio     date,           -- Período analisado no Power Curve Variável
  etapa1_pcv_fim        date,
  etapa1_pct_cons_min   numeric(6,3) NOT NULL DEFAULT 56.0,   -- % Consumo Mínimo → Auto
  etapa1_pct_pc_fixo    numeric(6,3) NOT NULL DEFAULT 66.7,   -- % PC Fixo → Auto
  etapa1_concluida_em   timestamptz,

  -- Etapa 2: Financeiro Auto
  rateio_id             uuid        REFERENCES public.rateios(id) ON DELETE SET NULL,

  -- Etapa 3: Envio ao ERP (futuro)

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.processos_serasa ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated users full access"
  ON public.processos_serasa
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);
