import { createFileRoute } from "@tanstack/react-router";
import { AppLayout } from "@/components/AppLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Construction } from "lucide-react";

export const Route = createFileRoute("/serasa/envio")({
  component: () => (
    <AppLayout>
      <EnvioPage />
    </AppLayout>
  ),
});

function EnvioPage() {
  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-3xl font-bold">3. Envio ao ERP</h1>
        <p className="text-muted-foreground">
          Contas a Receber / Contas a Pagar · gera os lançamentos no NBS
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Construction className="h-5 w-5" /> Em desenvolvimento
          </CardTitle>
          <CardDescription>
            Esta etapa irá gerar automaticamente os lançamentos no NBS após a
            aprovação da distribuição pelo Financeiro Auto.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground text-sm space-y-2">
            <p className="font-medium">Funcionalidades previstas:</p>
            <ul className="text-left list-disc list-inside space-y-1 max-w-sm mx-auto">
              <li>
                <strong>Contas a Receber:</strong> lançamento para a empresa pagadora
                cobrar as demais do grupo
              </li>
              <li>
                <strong>Contas a Pagar:</strong> lançamento em cada empresa com o
                valor devido à empresa pagadora
              </li>
            </ul>
            <p className="pt-2 text-xs">
              Aguardando definição do layout de importação do NBS.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
