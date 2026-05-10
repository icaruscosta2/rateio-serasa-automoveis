import { createFileRoute } from "@tanstack/react-router";
import { AppLayout } from "@/components/AppLayout";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Construction, CheckCircle2, Circle } from "lucide-react";

export const Route = createFileRoute("/serasa/processos")({
  component: () => (
    <AppLayout>
      <ProcessosPage />
    </AppLayout>
  ),
});

const ETAPAS = [
  {
    num: 1,
    titulo: "Divisão por Segmentos",
    responsavel: "Área de Processos",
    descricao:
      "Recebe os dados brutos da fatura Serasa e calcula a divisão entre os segmentos (Automóveis, Caminhões, Motos, Máquinas, Serviços).",
    status: "em_breve" as const,
  },
  {
    num: 2,
    titulo: "Distribuição — Financeiro Auto",
    responsavel: "Financeiro Automóveis",
    descricao:
      "Distribui o valor do segmento Automóveis entre as lojas, usando as regras de Consumo Mínimo, PC Fixo, PC Adicional, F&I e Consultas ADM Avulsas.",
    status: "disponivel" as const,
  },
  {
    num: 3,
    titulo: "Gerar Rateio (ERP)",
    responsavel: "Contas a Receber / Contas a Pagar",
    descricao:
      "Envia os lançamentos ao NBS para que a empresa pagadora cobre as demais do grupo.",
    status: "em_breve" as const,
  },
];

function ProcessosPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Rateio Serasa</h1>
        <p className="text-muted-foreground">
          Visão geral das etapas do processo
        </p>
      </div>

      <div className="space-y-3">
        {ETAPAS.map((etapa) => (
          <Card
            key={etapa.num}
            className={
              etapa.status === "disponivel"
                ? "border-primary/40 bg-primary/5"
                : ""
            }
          >
            <CardHeader className="pb-2">
              <div className="flex items-start gap-3">
                <div className="mt-0.5">
                  {etapa.status === "disponivel" ? (
                    <CheckCircle2 className="h-5 w-5 text-primary" />
                  ) : (
                    <Circle className="h-5 w-5 text-muted-foreground/40" />
                  )}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <CardTitle className="text-base">
                      Etapa {etapa.num} — {etapa.titulo}
                    </CardTitle>
                    {etapa.status === "em_breve" && (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                        <Construction className="h-3 w-3" /> Em construção
                      </span>
                    )}
                    {etapa.status === "disponivel" && (
                      <span className="inline-flex items-center gap-1 text-xs text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                        Disponível
                      </span>
                    )}
                  </div>
                  <CardDescription className="mt-0.5 text-xs font-medium">
                    {etapa.responsavel}
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pl-11 pt-0">
              <p className="text-sm text-muted-foreground">{etapa.descricao}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
