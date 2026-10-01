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
    PostgrestVersion: "14"
  }
  public: {
    Tables: {
      access_links: {
        Row: {
          created_at: string
          created_by: string | null
          expires_at: string
          id: string
          purpose: string
          revoked_at: string | null
          token_hash: string
          used_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          expires_at: string
          id?: string
          purpose: string
          revoked_at?: string | null
          token_hash: string
          used_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          expires_at?: string
          id?: string
          purpose?: string
          revoked_at?: string | null
          token_hash?: string
          used_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "access_links_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "access_links_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_email: string | null
          actor_id: string | null
          actor_role: string | null
          company_id: string | null
          created_at: string
          entity: string
          entity_id: string | null
          id: number
          new_data: Json | null
          occurred_at: string
          old_data: Json | null
          on_behalf: boolean
          summary: string | null
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_id?: string | null
          actor_role?: string | null
          company_id?: string | null
          created_at?: string
          entity: string
          entity_id?: string | null
          id?: never
          new_data?: Json | null
          occurred_at?: string
          old_data?: Json | null
          on_behalf?: boolean
          summary?: string | null
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_id?: string | null
          actor_role?: string | null
          company_id?: string | null
          created_at?: string
          entity?: string
          entity_id?: string | null
          id?: never
          new_data?: Json | null
          occurred_at?: string
          old_data?: Json | null
          on_behalf?: boolean
          summary?: string | null
        }
        Relationships: []
      }
      comments: {
        Row: {
          author_id: string
          body: string
          created_at: string
          id: string
          parent_id: string | null
          resolved_at: string | null
          resolved_by: string | null
          submission_id: string
          target: string
          visibility: Database["public"]["Enums"]["comment_visibility"]
        }
        Insert: {
          author_id?: string
          body: string
          created_at?: string
          id?: string
          parent_id?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          submission_id: string
          target?: string
          visibility?: Database["public"]["Enums"]["comment_visibility"]
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          id?: string
          parent_id?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          submission_id?: string
          target?: string
          visibility?: Database["public"]["Enums"]["comment_visibility"]
        }
        Relationships: [
          {
            foreignKeyName: "comments_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "submissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "v_submission_financials"
            referencedColumns: ["submission_id"]
          },
          {
            foreignKeyName: "comments_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "v_submission_overview"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          country: string | null
          created_at: string
          description: string | null
          id: string
          legal_name: string | null
          name: string
          registration_no: string | null
          reporting_currency: string
          reporting_start_month: string | null
          sector: string | null
          status: Database["public"]["Enums"]["company_status"]
          status_changed_at: string | null
          status_reason: string | null
          updated_at: string
          website: string | null
        }
        Insert: {
          country?: string | null
          created_at?: string
          description?: string | null
          id?: string
          legal_name?: string | null
          name: string
          registration_no?: string | null
          reporting_currency?: string
          reporting_start_month?: string | null
          sector?: string | null
          status?: Database["public"]["Enums"]["company_status"]
          status_changed_at?: string | null
          status_reason?: string | null
          updated_at?: string
          website?: string | null
        }
        Update: {
          country?: string | null
          created_at?: string
          description?: string | null
          id?: string
          legal_name?: string | null
          name?: string
          registration_no?: string | null
          reporting_currency?: string
          reporting_start_month?: string | null
          sector?: string | null
          status?: Database["public"]["Enums"]["company_status"]
          status_changed_at?: string | null
          status_reason?: string | null
          updated_at?: string
          website?: string | null
        }
        Relationships: []
      }
      company_internal: {
        Row: {
          company_id: string
          created_at: string
          exit_strategy_notes: string | null
          exit_strategy_status: string | null
          internal_rating: Database["public"]["Enums"]["internal_rating"] | null
          notes: string | null
          partner_in_charge_id: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          exit_strategy_notes?: string | null
          exit_strategy_status?: string | null
          internal_rating?:
            | Database["public"]["Enums"]["internal_rating"]
            | null
          notes?: string | null
          partner_in_charge_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          exit_strategy_notes?: string | null
          exit_strategy_status?: string | null
          internal_rating?:
            | Database["public"]["Enums"]["internal_rating"]
            | null
          notes?: string | null
          partner_in_charge_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "company_internal_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_internal_partner_in_charge_id_fkey"
            columns: ["partner_in_charge_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      company_kpis: {
        Row: {
          company_id: string
          created_at: string
          description: string | null
          dimension_id: string | null
          frequency: Database["public"]["Enums"]["kpi_frequency"]
          id: string
          is_active: boolean
          is_required: boolean
          name: string
          sort_order: number
          unit: string | null
          updated_at: string
          value_type: Database["public"]["Enums"]["kpi_value_type"]
        }
        Insert: {
          company_id: string
          created_at?: string
          description?: string | null
          dimension_id?: string | null
          frequency?: Database["public"]["Enums"]["kpi_frequency"]
          id?: string
          is_active?: boolean
          is_required?: boolean
          name: string
          sort_order?: number
          unit?: string | null
          updated_at?: string
          value_type?: Database["public"]["Enums"]["kpi_value_type"]
        }
        Update: {
          company_id?: string
          created_at?: string
          description?: string | null
          dimension_id?: string | null
          frequency?: Database["public"]["Enums"]["kpi_frequency"]
          id?: string
          is_active?: boolean
          is_required?: boolean
          name?: string
          sort_order?: number
          unit?: string | null
          updated_at?: string
          value_type?: Database["public"]["Enums"]["kpi_value_type"]
        }
        Relationships: [
          {
            foreignKeyName: "company_kpis_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_kpis_dimension_id_fkey"
            columns: ["dimension_id"]
            isOneToOne: false
            referencedRelation: "kpi_dimensions"
            referencedColumns: ["id"]
          },
        ]
      }
      company_members: {
        Row: {
          company_id: string
          created_at: string
          invited_by: string | null
          is_active: boolean
          role: Database["public"]["Enums"]["company_role"]
          updated_at: string
          user_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          invited_by?: string | null
          is_active?: boolean
          role: Database["public"]["Enums"]["company_role"]
          updated_at?: string
          user_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          invited_by?: string | null
          is_active?: boolean
          role?: Database["public"]["Enums"]["company_role"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_members_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_members_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          company_id: string
          created_at: string
          doc_type: Database["public"]["Enums"]["document_type"]
          file_name: string
          id: string
          mime_type: string | null
          period_close_id: string | null
          size_bytes: number | null
          storage_path: string
          uploaded_at: string
          uploaded_by: string | null
          version: number
        }
        Insert: {
          company_id: string
          created_at?: string
          doc_type?: Database["public"]["Enums"]["document_type"]
          file_name: string
          id?: string
          mime_type?: string | null
          period_close_id?: string | null
          size_bytes?: number | null
          storage_path: string
          uploaded_at?: string
          uploaded_by?: string | null
          version?: number
        }
        Update: {
          company_id?: string
          created_at?: string
          doc_type?: Database["public"]["Enums"]["document_type"]
          file_name?: string
          id?: string
          mime_type?: string | null
          period_close_id?: string | null
          size_bytes?: number | null
          storage_path?: string
          uploaded_at?: string
          uploaded_by?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "documents_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_period_close_id_fkey"
            columns: ["period_close_id"]
            isOneToOne: false
            referencedRelation: "period_closes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      fund_investments: {
        Row: {
          company_id: string
          created_at: string
          fund_id: string
          id: string
          instrument: string | null
          investment_date: string | null
          notes: string | null
          ownership_pct: number | null
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          fund_id: string
          id?: string
          instrument?: string | null
          investment_date?: string | null
          notes?: string | null
          ownership_pct?: number | null
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          fund_id?: string
          id?: string
          instrument?: string | null
          investment_date?: string | null
          notes?: string | null
          ownership_pct?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fund_investments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fund_investments_fund_id_fkey"
            columns: ["fund_id"]
            isOneToOne: false
            referencedRelation: "funds"
            referencedColumns: ["id"]
          },
        ]
      }
      funds: {
        Row: {
          code: string
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          legal_name: string | null
          name: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          legal_name?: string | null
          name: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          legal_name?: string | null
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      fx_rates: {
        Row: {
          created_at: string
          currency: string
          month: string
          rate_to_myr: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          currency: string
          month: string
          rate_to_myr: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          currency?: string
          month?: string
          rate_to_myr?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      kpi_dimension_members: {
        Row: {
          created_at: string
          dimension_id: string
          id: string
          is_active: boolean
          name: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          dimension_id: string
          id?: string
          is_active?: boolean
          name: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          dimension_id?: string
          id?: string
          is_active?: boolean
          name?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "kpi_dimension_members_dimension_id_fkey"
            columns: ["dimension_id"]
            isOneToOne: false
            referencedRelation: "kpi_dimensions"
            referencedColumns: ["id"]
          },
        ]
      }
      kpi_dimensions: {
        Row: {
          company_id: string
          created_at: string
          id: string
          name: string
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "kpi_dimensions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      period_closes: {
        Row: {
          company_id: string
          computed_totals: Json | null
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          id: string
          label: string
          period_end: string
          period_start: string
          period_type: Database["public"]["Enums"]["close_period_type"]
          restated_totals: Json | null
          restatement_reason: string | null
          status: Database["public"]["Enums"]["period_close_status"]
          updated_at: string
        }
        Insert: {
          company_id: string
          computed_totals?: Json | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          id?: string
          label: string
          period_end: string
          period_start: string
          period_type: Database["public"]["Enums"]["close_period_type"]
          restated_totals?: Json | null
          restatement_reason?: string | null
          status?: Database["public"]["Enums"]["period_close_status"]
          updated_at?: string
        }
        Update: {
          company_id?: string
          computed_totals?: Json | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          id?: string
          label?: string
          period_end?: string
          period_start?: string
          period_type?: Database["public"]["Enums"]["close_period_type"]
          restated_totals?: Json | null
          restatement_reason?: string | null
          status?: Database["public"]["Enums"]["period_close_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "period_closes_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "period_closes_confirmed_by_fkey"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_settings: {
        Row: {
          backfill_grace_days: number
          created_at: string
          declaration_text: string
          default_reporting_start: string
          due_day: number
          escalation_days: number
          id: number
          min_runway_months: number
          owner_contributor_limit: number
          require_mfa: boolean
          revenue_swing_pct: number
          terms_version: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          backfill_grace_days?: number
          created_at?: string
          declaration_text?: string
          default_reporting_start?: string
          due_day?: number
          escalation_days?: number
          id?: number
          min_runway_months?: number
          owner_contributor_limit?: number
          require_mfa?: boolean
          revenue_swing_pct?: number
          terms_version?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          backfill_grace_days?: number
          created_at?: string
          declaration_text?: string
          default_reporting_start?: string
          due_day?: number
          escalation_days?: number
          id?: number
          min_runway_months?: number
          owner_contributor_limit?: number
          require_mfa?: boolean
          revenue_swing_pct?: number
          terms_version?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          full_name: string | null
          id: string
          is_active: boolean
          job_title: string | null
          scaleup_role: Database["public"]["Enums"]["scaleup_role"] | null
          terms_accepted_at: string | null
          terms_version: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          full_name?: string | null
          id: string
          is_active?: boolean
          job_title?: string | null
          scaleup_role?: Database["public"]["Enums"]["scaleup_role"] | null
          terms_accepted_at?: string | null
          terms_version?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          full_name?: string | null
          id?: string
          is_active?: boolean
          job_title?: string | null
          scaleup_role?: Database["public"]["Enums"]["scaleup_role"] | null
          terms_accepted_at?: string | null
          terms_version?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      reporting_periods: {
        Row: {
          created_at: string
          due_date: string
          id: string
          month: string
          opened_at: string
          opened_by: string | null
          template_version_id: string
        }
        Insert: {
          created_at?: string
          due_date: string
          id?: string
          month: string
          opened_at?: string
          opened_by?: string | null
          template_version_id: string
        }
        Update: {
          created_at?: string
          due_date?: string
          id?: string
          month?: string
          opened_at?: string
          opened_by?: string | null
          template_version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reporting_periods_template_version_id_fkey"
            columns: ["template_version_id"]
            isOneToOne: false
            referencedRelation: "template_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      revenue_segments: {
        Row: {
          company_id: string
          created_at: string
          id: string
          is_active: boolean
          kind: string
          name: string
          retired_at: string | null
          sort_order: number
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          kind?: string
          name: string
          retired_at?: string | null
          sort_order?: number
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          kind?: string
          name?: string
          retired_at?: string | null
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "revenue_segments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      submission_events: {
        Row: {
          actor_id: string | null
          created_at: string
          event: string
          id: number
          message: string | null
          submission_id: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          event: string
          id?: never
          message?: string | null
          submission_id: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          event?: string
          id?: never
          message?: string | null
          submission_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "submission_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submission_events_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "submissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submission_events_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "v_submission_financials"
            referencedColumns: ["submission_id"]
          },
          {
            foreignKeyName: "submission_events_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "v_submission_overview"
            referencedColumns: ["id"]
          },
        ]
      }
      submission_kpi_values: {
        Row: {
          created_at: string
          dimension_member_id: string | null
          id: string
          kpi_id: string
          submission_id: string
          updated_at: string
          updated_by: string | null
          value_bool: boolean | null
          value_number: number | null
          value_text: string | null
        }
        Insert: {
          created_at?: string
          dimension_member_id?: string | null
          id?: string
          kpi_id: string
          submission_id: string
          updated_at?: string
          updated_by?: string | null
          value_bool?: boolean | null
          value_number?: number | null
          value_text?: string | null
        }
        Update: {
          created_at?: string
          dimension_member_id?: string | null
          id?: string
          kpi_id?: string
          submission_id?: string
          updated_at?: string
          updated_by?: string | null
          value_bool?: boolean | null
          value_number?: number | null
          value_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "submission_kpi_values_dimension_member_id_fkey"
            columns: ["dimension_member_id"]
            isOneToOne: false
            referencedRelation: "kpi_dimension_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submission_kpi_values_kpi_id_fkey"
            columns: ["kpi_id"]
            isOneToOne: false
            referencedRelation: "company_kpis"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submission_kpi_values_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "submissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submission_kpi_values_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "v_submission_financials"
            referencedColumns: ["submission_id"]
          },
          {
            foreignKeyName: "submission_kpi_values_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "v_submission_overview"
            referencedColumns: ["id"]
          },
        ]
      }
      submission_segment_values: {
        Row: {
          amount: number | null
          created_at: string
          segment_id: string
          submission_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          amount?: number | null
          created_at?: string
          segment_id: string
          submission_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          amount?: number | null
          created_at?: string
          segment_id?: string
          submission_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "submission_segment_values_segment_id_fkey"
            columns: ["segment_id"]
            isOneToOne: false
            referencedRelation: "revenue_segments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submission_segment_values_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "submissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submission_segment_values_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "v_submission_financials"
            referencedColumns: ["submission_id"]
          },
          {
            foreignKeyName: "submission_segment_values_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "v_submission_overview"
            referencedColumns: ["id"]
          },
        ]
      }
      submission_values: {
        Row: {
          created_at: string
          field_key: string
          submission_id: string
          updated_at: string
          updated_by: string | null
          value_json: Json | null
          value_number: number | null
          value_text: string | null
        }
        Insert: {
          created_at?: string
          field_key: string
          submission_id: string
          updated_at?: string
          updated_by?: string | null
          value_json?: Json | null
          value_number?: number | null
          value_text?: string | null
        }
        Update: {
          created_at?: string
          field_key?: string
          submission_id?: string
          updated_at?: string
          updated_by?: string | null
          value_json?: Json | null
          value_number?: number | null
          value_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "submission_values_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "submissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submission_values_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "v_submission_financials"
            referencedColumns: ["submission_id"]
          },
          {
            foreignKeyName: "submission_values_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "v_submission_overview"
            referencedColumns: ["id"]
          },
        ]
      }
      submissions: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          company_id: string
          created_at: string
          declaration_text: string | null
          due_date: string
          extension_reason: string | null
          id: string
          last_saved_at: string | null
          last_saved_by: string | null
          month: string
          original_due_date: string | null
          period_id: string
          revision: number
          status: Database["public"]["Enums"]["submission_status"]
          submitted_at: string | null
          submitted_by: string | null
          template_version_id: string
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          company_id: string
          created_at?: string
          declaration_text?: string | null
          due_date: string
          extension_reason?: string | null
          id?: string
          last_saved_at?: string | null
          last_saved_by?: string | null
          month: string
          original_due_date?: string | null
          period_id: string
          revision?: number
          status?: Database["public"]["Enums"]["submission_status"]
          submitted_at?: string | null
          submitted_by?: string | null
          template_version_id: string
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          company_id?: string
          created_at?: string
          declaration_text?: string | null
          due_date?: string
          extension_reason?: string | null
          id?: string
          last_saved_at?: string | null
          last_saved_by?: string | null
          month?: string
          original_due_date?: string | null
          period_id?: string
          revision?: number
          status?: Database["public"]["Enums"]["submission_status"]
          submitted_at?: string | null
          submitted_by?: string | null
          template_version_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "submissions_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submissions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submissions_last_saved_by_fkey"
            columns: ["last_saved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submissions_period_id_fkey"
            columns: ["period_id"]
            isOneToOne: false
            referencedRelation: "reporting_periods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submissions_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submissions_template_version_id_fkey"
            columns: ["template_version_id"]
            isOneToOne: false
            referencedRelation: "template_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      template_fields: {
        Row: {
          created_at: string
          field_type: Database["public"]["Enums"]["field_type"]
          help_text: string | null
          id: string
          is_required: boolean
          is_system: boolean
          key: string
          label: string
          options: Json | null
          section_id: string
          sort_order: number
          template_version_id: string
          validation: Json | null
        }
        Insert: {
          created_at?: string
          field_type: Database["public"]["Enums"]["field_type"]
          help_text?: string | null
          id?: string
          is_required?: boolean
          is_system?: boolean
          key: string
          label: string
          options?: Json | null
          section_id: string
          sort_order?: number
          template_version_id: string
          validation?: Json | null
        }
        Update: {
          created_at?: string
          field_type?: Database["public"]["Enums"]["field_type"]
          help_text?: string | null
          id?: string
          is_required?: boolean
          is_system?: boolean
          key?: string
          label?: string
          options?: Json | null
          section_id?: string
          sort_order?: number
          template_version_id?: string
          validation?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "template_fields_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "template_sections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "template_fields_template_version_id_fkey"
            columns: ["template_version_id"]
            isOneToOne: false
            referencedRelation: "template_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      template_sections: {
        Row: {
          created_at: string
          description: string | null
          id: string
          key: string
          kind: Database["public"]["Enums"]["section_kind"]
          sort_order: number
          template_version_id: string
          title: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          key: string
          kind: Database["public"]["Enums"]["section_kind"]
          sort_order?: number
          template_version_id: string
          title: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          key?: string
          kind?: Database["public"]["Enums"]["section_kind"]
          sort_order?: number
          template_version_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "template_sections_template_version_id_fkey"
            columns: ["template_version_id"]
            isOneToOne: false
            referencedRelation: "template_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      template_versions: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          notes: string | null
          published_at: string | null
          published_by: string | null
          status: Database["public"]["Enums"]["template_status"]
          template_id: string
          version_no: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          published_at?: string | null
          published_by?: string | null
          status?: Database["public"]["Enums"]["template_status"]
          template_id: string
          version_no: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          published_at?: string | null
          published_by?: string | null
          status?: Database["public"]["Enums"]["template_status"]
          template_id?: string
          version_no?: number
        }
        Relationships: [
          {
            foreignKeyName: "template_versions_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "templates"
            referencedColumns: ["id"]
          },
        ]
      }
      templates: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_default: boolean
          name: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_default?: boolean
          name: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_default?: boolean
          name?: string
        }
        Relationships: []
      }
    }
    Views: {
      v_submission_financials: {
        Row: {
          approved_at: string | null
          burn_rate: number | null
          cash_in_bank: number | null
          company_id: string | null
          currency: string | null
          due_date: string | null
          fx_rate_to_myr: number | null
          gross_profit: number | null
          headcount_ft: number | null
          headcount_pt: number | null
          month: string | null
          net_profit: number | null
          revenue_total: number | null
          status: Database["public"]["Enums"]["submission_status"] | null
          submission_id: string | null
          submitted_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "submissions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      v_submission_overview: {
        Row: {
          approved_at: string | null
          company_id: string | null
          days_overdue: number | null
          due_date: string | null
          has_narrative: boolean | null
          id: string | null
          is_overdue: boolean | null
          last_saved_at: string | null
          month: string | null
          open_threads: number | null
          original_due_date: string | null
          revision: number | null
          status: Database["public"]["Enums"]["submission_status"] | null
          submitted_at: string | null
        }
        Insert: {
          approved_at?: string | null
          company_id?: string | null
          days_overdue?: never
          due_date?: string | null
          has_narrative?: never
          id?: string | null
          is_overdue?: never
          last_saved_at?: string | null
          month?: string | null
          open_threads?: never
          original_due_date?: string | null
          revision?: number | null
          status?: Database["public"]["Enums"]["submission_status"] | null
          submitted_at?: string | null
        }
        Update: {
          approved_at?: string | null
          company_id?: string | null
          days_overdue?: never
          due_date?: string | null
          has_narrative?: never
          id?: string | null
          is_overdue?: never
          last_saved_at?: string | null
          month?: string | null
          open_threads?: never
          original_due_date?: string | null
          revision?: number | null
          status?: Database["public"]["Enums"]["submission_status"] | null
          submitted_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "submissions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      accept_terms: {
        Args: { p_version: string }
        Returns: undefined
      }
      admin_update_profile: {
        Args: {
          p_full_name: string
          p_is_active?: boolean
          p_job_title: string
          p_scaleup_role?: Database["public"]["Enums"]["scaleup_role"]
          p_user_id: string
        }
        Returns: undefined
      }
      approve_submission: {
        Args: { p_message?: string; p_submission_id: string }
        Returns: undefined
      }
      claim_access_link: {
        Args: { p_token_hash: string }
        Returns: {
          user_id: string
          purpose: string
          email: string
        }[]
      }
      confirm_period_close: {
        Args: {
          p_close_id: string
          p_reason?: string
          p_restated_totals?: Json
        }
        Returns: undefined
      }
      create_template_draft: {
        Args: { p_template_id: string }
        Returns: string
      }
      delete_company: {
        Args: { p_company_id: string; p_reason: string }
        Returns: undefined
      }
      extend_due_date: {
        Args: {
          p_new_due_date: string
          p_reason?: string
          p_submission_id: string
        }
        Returns: undefined
      }
      get_client_settings: {
        Args: never
        Returns: {
          require_mfa: boolean
          terms_version: string
          declaration_text: string
          due_day: number
          owner_contributor_limit: number
        }[]
      }
      get_submission_validation: {
        Args: { p_submission_id: string }
        Returns: Json
      }
      log_audit_event: {
        Args: {
          p_action: string
          p_company_id?: string
          p_data?: Json
          p_entity: string
          p_entity_id?: string
          p_summary?: string
        }
        Returns: undefined
      }
      open_due_periods: {
        Args: never
        Returns: number
      }
      open_period: {
        Args: { p_month: string }
        Returns: string
      }
      publish_template_version: {
        Args: { p_version_id: string }
        Returns: undefined
      }
      reopen_period_close: {
        Args: { p_close_id: string; p_reason: string }
        Returns: undefined
      }
      reopen_submission: {
        Args: { p_reason: string; p_submission_id: string }
        Returns: undefined
      }
      request_amendment: {
        Args: { p_reason: string; p_submission_id: string }
        Returns: undefined
      }
      request_changes: {
        Args: { p_message: string; p_submission_id: string }
        Returns: undefined
      }
      resolve_comment: {
        Args: { p_comment_id: string; p_resolved: boolean }
        Returns: undefined
      }
      save_submission_values: {
        Args: {
          p_kpis?: Json
          p_segments?: Json
          p_submission_id: string
          p_values?: Json
        }
        Returns: string
      }
      set_company_revenue_segments: {
        Args: { p_company_id: string; p_segments: Json }
        Returns: Database["public"]["Tables"]["revenue_segments"]["Row"][]
      }
      set_company_status: {
        Args: {
          p_company_id: string
          p_reason?: string
          p_status: Database["public"]["Enums"]["company_status"]
        }
        Returns: undefined
      }
      staff_display_names: {
        Args: { p_ids: string[] }
        Returns: {
          id: string
          display_name: string
        }[]
      }
      submit_submission: {
        Args: { p_declaration_accepted: boolean; p_submission_id: string }
        Returns: undefined
      }
      update_my_profile: {
        Args: { p_full_name: string; p_job_title?: string }
        Returns: undefined
      }
    }
    Enums: {
      close_period_type: "quarter" | "half"
      comment_visibility: "shared" | "internal"
      company_role: "owner" | "contributor"
      company_status: "active" | "exited" | "written_off"
      document_type: "management_accounts" | "supporting"
      field_type:
        | "currency"
        | "number"
        | "integer"
        | "percent"
        | "text"
        | "long_text"
        | "rating"
        | "picklist"
        | "tags"
        | "boolean"
      internal_rating: "on_track" | "watch" | "at_risk"
      kpi_frequency: "monthly" | "half_yearly"
      kpi_value_type:
        | "number"
        | "integer"
        | "currency"
        | "percent"
        | "boolean"
        | "text"
      period_close_status: "open" | "confirmed"
      scaleup_role: "super_admin" | "fund_admin" | "partner" | "viewer"
      section_kind:
        | "financials"
        | "headcount"
        | "kpis"
        | "custom_numbers"
        | "narrative"
        | "pulse"
      submission_status:
        | "draft"
        | "submitted"
        | "changes_requested"
        | "approved"
      template_status: "draft" | "published" | "archived"
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
    Enums: {
      close_period_type: ["quarter", "half"],
      comment_visibility: ["shared", "internal"],
      company_role: ["owner", "contributor"],
      company_status: ["active", "exited", "written_off"],
      document_type: ["management_accounts", "supporting"],
      field_type: [
        "currency",
        "number",
        "integer",
        "percent",
        "text",
        "long_text",
        "rating",
        "picklist",
        "tags",
        "boolean",
      ],
      internal_rating: ["on_track", "watch", "at_risk"],
      kpi_frequency: ["monthly", "half_yearly"],
      kpi_value_type: [
        "number",
        "integer",
        "currency",
        "percent",
        "boolean",
        "text",
      ],
      period_close_status: ["open", "confirmed"],
      scaleup_role: ["super_admin", "fund_admin", "partner", "viewer"],
      section_kind: [
        "financials",
        "headcount",
        "kpis",
        "custom_numbers",
        "narrative",
        "pulse",
      ],
      submission_status: [
        "draft",
        "submitted",
        "changes_requested",
        "approved",
      ],
      template_status: ["draft", "published", "archived"],
    },
  },
} as const
