export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      companies: {
        Row: {
          apelido: string | null
          ativo: boolean
          bandeira: string | null
          cidade: string | null
          cnpj: string | null
          cnpj_normalizado: string | null
          cod_empresa: number
          cod_empresa_principal: number | null
          cod_matriz: number | null
          created_at: string
          estado: string | null
          grupo_empresa: string | null
          is_matriz: boolean
          nome: string
          segmento: string | null
          updated_at: string
        }
        Insert: {
          apelido?: string | null
          ativo?: boolean
          bandeira?: string | null
          cidade?: string | null
          cnpj?: string | null
          cnpj_normalizado?: string | null
          cod_empresa: number
          cod_empresa_principal?: number | null
          cod_matriz?: number | null
          created_at?: string
          estado?: string | null
          grupo_empresa?: string | null
          is_matriz?: boolean
          nome: string
          segmento?: string | null
          updated_at?: string
        }
        Update: {
          apelido?: string | null
          ativo?: boolean
          bandeira?: string | null
          cidade?: string | null
          cnpj?: string | null
          cnpj_normalizado?: string | null
          cod_empresa?: number
          cod_empresa_principal?: number | null
          cod_matriz?: number | null
          created_at?: string
          estado?: string | null
          grupo_empresa?: string | null
          is_matriz?: boolean
          nome?: string
          segmento?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      rateio_consultas: {
        Row: {
          cod_empresa: number
          qtd_intranet: number
          qtd_pc_segmento: number
          qtd_unico_auto_novos: number
          qtd_unico_auto_seminovos: number
          rateio_id: string
        }
        Insert: {
          cod_empresa: number
          qtd_intranet?: number
          qtd_pc_segmento?: number
          qtd_unico_auto_novos?: number
          qtd_unico_auto_seminovos?: number
          rateio_id: string
        }
        Update: {
          cod_empresa?: number
          qtd_intranet?: number
          qtd_pc_segmento?: number
          qtd_unico_auto_novos?: number
          qtd_unico_auto_seminovos?: number
          rateio_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rateio_consultas_cod_empresa_fkey"
            columns: ["cod_empresa"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["cod_empresa"]
          },
          {
            foreignKeyName: "rateio_consultas_rateio_id_fkey"
            columns: ["rateio_id"]
            isOneToOne: false
            referencedRelation: "rateios"
            referencedColumns: ["id"]
          },
        ]
      }
      rateio_empresas: {
        Row: {
          cod_empresa: number
          incluida: boolean
          is_matriz_override: boolean
          rateio_id: string
        }
        Insert: {
          cod_empresa: number
          incluida?: boolean
          is_matriz_override?: boolean
          rateio_id: string
        }
        Update: {
          cod_empresa?: number
          incluida?: boolean
          is_matriz_override?: boolean
          rateio_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rateio_empresas_cod_empresa_fkey"
            columns: ["cod_empresa"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["cod_empresa"]
          },
          {
            foreignKeyName: "rateio_empresas_rateio_id_fkey"
            columns: ["rateio_id"]
            isOneToOne: false
            referencedRelation: "rateios"
            referencedColumns: ["id"]
          },
        ]
      }
      rateio_resultados: {
        Row: {
          adm_rateado: number
          cod_empresa: number
          consumo_minimo: number
          fi_novos: number
          fi_seminovos: number
          pc_adicional: number
          pc_fixo: number
          rateio_id: string
          total: number
        }
        Insert: {
          adm_rateado?: number
          cod_empresa: number
          consumo_minimo?: number
          fi_novos?: number
          fi_seminovos?: number
          pc_adicional?: number
          pc_fixo?: number
          rateio_id: string
          total?: number
        }
        Update: {
          adm_rateado?: number
          cod_empresa?: number
          consumo_minimo?: number
          fi_novos?: number
          fi_seminovos?: number
          pc_adicional?: number
          pc_fixo?: number
          rateio_id?: string
          total?: number
        }
        Relationships: [
          {
            foreignKeyName: "rateio_resultados_cod_empresa_fkey"
            columns: ["cod_empresa"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["cod_empresa"]
          },
          {
            foreignKeyName: "rateio_resultados_rateio_id_fkey"
            columns: ["rateio_id"]
            isOneToOne: false
            referencedRelation: "rateios"
            referencedColumns: ["id"]
          },
        ]
      }
      rateios: {
        Row: {
          adm_rateado_grupo: number | null
          arquivo_storage_path: string | null
          consumo_minimo_grupo: number | null
          created_at: string
          fi_intranet_grupo: number | null
          id: string
          mes_referencia: string
          parse_summary: Json | null
          pc_adicional_grupo: number | null
          pc_fixo_grupo: number | null
          pct_auto_adm: number | null
          pct_auto_consumo_minimo: number | null
          pct_auto_fi: number | null
          pct_auto_pc_adicional: number | null
          pct_auto_pc_fixo: number | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          adm_rateado_grupo?: number | null
          arquivo_storage_path?: string | null
          consumo_minimo_grupo?: number | null
          created_at?: string
          fi_intranet_grupo?: number | null
          id?: string
          mes_referencia: string
          parse_summary?: Json | null
          pc_adicional_grupo?: number | null
          pc_fixo_grupo?: number | null
          pct_auto_adm?: number | null
          pct_auto_consumo_minimo?: number | null
          pct_auto_fi?: number | null
          pct_auto_pc_adicional?: number | null
          pct_auto_pc_fixo?: number | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          adm_rateado_grupo?: number | null
          arquivo_storage_path?: string | null
          consumo_minimo_grupo?: number | null
          created_at?: string
          fi_intranet_grupo?: number | null
          id?: string
          mes_referencia?: string
          parse_summary?: Json | null
          pc_adicional_grupo?: number | null
          pc_fixo_grupo?: number | null
          pct_auto_adm?: number | null
          pct_auto_consumo_minimo?: number | null
          pct_auto_fi?: number | null
          pct_auto_pc_adicional?: number | null
          pct_auto_pc_fixo?: number | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
