import { supabase } from "@/integrations/supabase/client";

export async function deleteRateio(id: string): Promise<void> {
  const { data: r } = await supabase
    .from("rateios")
    .select("arquivo_storage_path")
    .eq("id", id)
    .maybeSingle();

  const tables = ["rateio_resultados", "rateio_consultas", "rateio_empresas"] as const;
  for (const t of tables) {
    const { error } = await supabase.from(t).delete().eq("rateio_id", id);
    if (error) throw error;
  }

  const { error } = await supabase.from("rateios").delete().eq("id", id);
  if (error) throw error;

  const path = r?.arquivo_storage_path;
  if (path) {
    const { error: stErr } = await supabase.storage.from("rateio-uploads").remove([path]);
    if (stErr) console.warn("Falha ao remover arquivo do storage:", stErr.message);
  }
}
