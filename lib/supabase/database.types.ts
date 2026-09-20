export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      channel_identities: {
        Row: {
          channel: string
          channel_account_id: string
          created_at: string
          customer_id: string | null
          display_name_snapshot: string | null
          id: string
          sender_external_id: string
          updated_at: string
          verification_status: string
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          channel: string
          channel_account_id: string
          created_at?: string
          customer_id?: string | null
          display_name_snapshot?: string | null
          id?: string
          sender_external_id: string
          updated_at?: string
          verification_status?: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          channel?: string
          channel_account_id?: string
          created_at?: string
          customer_id?: string | null
          display_name_snapshot?: string | null
          id?: string
          sender_external_id?: string
          updated_at?: string
          verification_status?: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "channel_identities_customer_fk"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          created_at: string
          customer_code: string
          display_name: string
          id: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          customer_code: string
          display_name: string
          id?: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          customer_code?: string
          display_name?: string
          id?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      mock_network_scenarios: {
        Row: {
          created_at: string
          description: string
          id: string
          onu_failure: string
          upstream_failure: string
        }
        Insert: {
          created_at?: string
          description: string
          id: string
          onu_failure?: string
          upstream_failure?: string
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          onu_failure?: string
          upstream_failure?: string
        }
        Relationships: []
      }
      mock_onu_status: {
        Row: {
          event_id: string | null
          observed_at: string | null
          scenario_id: string
          service_id: string
          source: string
          status: string
        }
        Insert: {
          event_id?: string | null
          observed_at?: string | null
          scenario_id: string
          service_id: string
          source?: string
          status: string
        }
        Update: {
          event_id?: string | null
          observed_at?: string | null
          scenario_id?: string
          service_id?: string
          source?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "mock_onu_status_scenario_id_fkey"
            columns: ["scenario_id"]
            isOneToOne: false
            referencedRelation: "mock_network_scenarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mock_onu_status_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      mock_upstream_impacts: {
        Row: {
          link_id: string
          mapping_version: number
          scenario_id: string
          service_id: string
        }
        Insert: {
          link_id: string
          mapping_version: number
          scenario_id: string
          service_id: string
        }
        Update: {
          link_id?: string
          mapping_version?: number
          scenario_id?: string
          service_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mock_upstream_impacts_scenario_id_link_id_fkey"
            columns: ["scenario_id", "link_id"]
            isOneToOne: false
            referencedRelation: "mock_upstream_status"
            referencedColumns: ["scenario_id", "link_id"]
          },
          {
            foreignKeyName: "mock_upstream_impacts_service_id_mapping_version_fkey"
            columns: ["service_id", "mapping_version"]
            isOneToOne: false
            referencedRelation: "service_topology"
            referencedColumns: ["service_id", "mapping_version"]
          },
        ]
      }
      mock_upstream_status: {
        Row: {
          event_id: string | null
          link_id: string
          observed_at: string | null
          scenario_id: string
          source: string
          status: string
        }
        Insert: {
          event_id?: string | null
          link_id: string
          observed_at?: string | null
          scenario_id: string
          source?: string
          status: string
        }
        Update: {
          event_id?: string | null
          link_id?: string
          observed_at?: string | null
          scenario_id?: string
          source?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "mock_upstream_status_scenario_id_fkey"
            columns: ["scenario_id"]
            isOneToOne: false
            referencedRelation: "mock_network_scenarios"
            referencedColumns: ["id"]
          },
        ]
      }
      odcs: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
          odc_code: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id?: string
          odc_code: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
          odc_code?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      odps: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
          odc_id: string
          odp_code: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id?: string
          odc_id: string
          odp_code: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
          odc_id?: string
          odp_code?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "odps_odc_fk"
            columns: ["odc_id"]
            isOneToOne: false
            referencedRelation: "odcs"
            referencedColumns: ["id"]
          },
        ]
      }
      service_topology: {
        Row: {
          created_at: string
          id: string
          mapping_version: number
          odp_id: string
          service_id: string
          source: string
          valid_from: string
          valid_to: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          mapping_version: number
          odp_id: string
          service_id: string
          source?: string
          valid_from?: string
          valid_to?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          mapping_version?: number
          odp_id?: string
          service_id?: string
          source?: string
          valid_from?: string
          valid_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "service_topology_odp_fk"
            columns: ["odp_id"]
            isOneToOne: false
            referencedRelation: "odps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_topology_service_fk"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      services: {
        Row: {
          created_at: string
          customer_id: string
          display_name: string | null
          id: string
          service_code: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          customer_id: string
          display_name?: string | null
          id?: string
          service_code: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          customer_id?: string
          display_name?: string | null
          id?: string
          service_code?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "services_customer_fk"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const

