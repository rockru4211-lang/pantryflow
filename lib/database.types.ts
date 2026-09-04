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
      audit_logs: {
        Row: {
          action: string
          created_at: string
          entity_id: string
          entity_type: string
          id: number
          new_value: Json | null
          old_value: Json | null
          organization_id: string
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          entity_id: string
          entity_type: string
          id?: never
          new_value?: Json | null
          old_value?: Json | null
          organization_id: string
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: never
          new_value?: Json | null
          old_value?: Json | null
          organization_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_logs_user_profile_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      count_drafts: {
        Row: {
          entered_at: string
          entered_by: string
          id: string
          observation_state: string
          organization_id: string
          product_id: string
          quantity: number | null
          session_id: string
          unit: string
          updated_at: string
          zone_id: string
        }
        Insert: {
          entered_at?: string
          entered_by: string
          id?: string
          observation_state?: string
          organization_id: string
          product_id: string
          quantity?: number | null
          session_id: string
          unit: string
          updated_at?: string
          zone_id: string
        }
        Update: {
          entered_at?: string
          entered_by?: string
          id?: string
          observation_state?: string
          organization_id?: string
          product_id?: string
          quantity?: number | null
          session_id?: string
          unit?: string
          updated_at?: string
          zone_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "count_drafts_entered_by_fkey"
            columns: ["entered_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "count_drafts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "count_drafts_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "count_drafts_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "inventory_count_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "count_drafts_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "count_zones"
            referencedColumns: ["id"]
          },
        ]
      }
      count_entries: {
        Row: {
          conversion_snapshot: Json
          created_at: string
          entered_at: string
          entered_by: string
          entry_type: Database["public"]["Enums"]["count_entry_type"]
          id: string
          observation_state: string
          organization_id: string
          parent_entry_id: string | null
          product_id: string
          quantity: number | null
          session_id: string
          unit: string
          zone_id: string
        }
        Insert: {
          conversion_snapshot?: Json
          created_at?: string
          entered_at?: string
          entered_by: string
          entry_type?: Database["public"]["Enums"]["count_entry_type"]
          id?: string
          observation_state?: string
          organization_id: string
          parent_entry_id?: string | null
          product_id: string
          quantity?: number | null
          session_id: string
          unit: string
          zone_id: string
        }
        Update: {
          conversion_snapshot?: Json
          created_at?: string
          entered_at?: string
          entered_by?: string
          entry_type?: Database["public"]["Enums"]["count_entry_type"]
          id?: string
          observation_state?: string
          organization_id?: string
          parent_entry_id?: string | null
          product_id?: string
          quantity?: number | null
          session_id?: string
          unit?: string
          zone_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "count_entries_entered_by_profile_fkey"
            columns: ["entered_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "count_entries_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "count_entries_parent_entry_id_fkey"
            columns: ["parent_entry_id"]
            isOneToOne: false
            referencedRelation: "count_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "count_entries_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "count_entries_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "inventory_count_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "count_entries_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "count_zones"
            referencedColumns: ["id"]
          },
        ]
      }
      count_zone_progress: {
        Row: {
          completed_at: string | null
          completed_by: string | null
          created_at: string
          id: string
          organization_id: string
          session_id: string
          status: string
          updated_at: string
          zone_id: string
        }
        Insert: {
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          id?: string
          organization_id: string
          session_id: string
          status?: string
          updated_at?: string
          zone_id: string
        }
        Update: {
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          id?: string
          organization_id?: string
          session_id?: string
          status?: string
          updated_at?: string
          zone_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "count_zone_progress_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "count_zone_progress_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "count_zone_progress_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "inventory_count_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "count_zone_progress_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "count_zones"
            referencedColumns: ["id"]
          },
        ]
      }
      count_zones: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          organization_id: string
          sort_order: number
          store_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          sort_order?: number
          store_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          sort_order?: number
          store_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "count_zones_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "count_zones_store_organization_fkey"
            columns: ["store_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      discrepancy_reviews: {
        Row: {
          created_at: string
          created_by: string
          id: string
          note: string | null
          organization_id: string
          product_id: string
          reason_code: string | null
          resolved_at: string | null
          session_id: string
          status: string
          zone_id: string | null
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          note?: string | null
          organization_id: string
          product_id: string
          reason_code?: string | null
          resolved_at?: string | null
          session_id: string
          status?: string
          zone_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          note?: string | null
          organization_id?: string
          product_id?: string
          reason_code?: string | null
          resolved_at?: string | null
          session_id?: string
          status?: string
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "discrepancy_reviews_created_by_profile_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discrepancy_reviews_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discrepancy_reviews_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discrepancy_reviews_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "inventory_count_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discrepancy_reviews_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "count_zones"
            referencedColumns: ["id"]
          },
        ]
      }
      goods_receipts: {
        Row: {
          created_at: string
          document_number: string | null
          id: string
          organization_id: string
          receipt_date: string
          reviewed_at: string | null
          reviewed_by: string | null
          source_batch_id: string | null
          store_id: string | null
          subtotal_ex_tax: number | null
          supplier_id: string | null
          tax: number | null
          total_inc_tax: number | null
        }
        Insert: {
          created_at?: string
          document_number?: string | null
          id?: string
          organization_id: string
          receipt_date?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          source_batch_id?: string | null
          store_id?: string | null
          subtotal_ex_tax?: number | null
          supplier_id?: string | null
          tax?: number | null
          total_inc_tax?: number | null
        }
        Update: {
          created_at?: string
          document_number?: string | null
          id?: string
          organization_id?: string
          receipt_date?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          source_batch_id?: string | null
          store_id?: string | null
          subtotal_ex_tax?: number | null
          supplier_id?: string | null
          tax?: number | null
          total_inc_tax?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "goods_receipts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_receipts_reviewed_by_profile_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_receipts_source_batch_id_fkey"
            columns: ["source_batch_id"]
            isOneToOne: false
            referencedRelation: "receipt_upload_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_receipts_store_organization_fkey"
            columns: ["store_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "goods_receipts_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_count_discrepancies: {
        Row: {
          answered_at: string | null
          answered_by: string | null
          created_at: string
          difference: number | null
          estimated_quantity: number | null
          final_entry_id: string | null
          id: string
          initial_entry_id: string
          organization_id: string
          previous_confirmed_at: string | null
          previous_quantity: number | null
          product_id: string
          reason: string | null
          session_id: string
          status: string
          updated_at: string
          zone_id: string
        }
        Insert: {
          answered_at?: string | null
          answered_by?: string | null
          created_at?: string
          difference?: number | null
          estimated_quantity?: number | null
          final_entry_id?: string | null
          id?: string
          initial_entry_id: string
          organization_id: string
          previous_confirmed_at?: string | null
          previous_quantity?: number | null
          product_id: string
          reason?: string | null
          session_id: string
          status?: string
          updated_at?: string
          zone_id: string
        }
        Update: {
          answered_at?: string | null
          answered_by?: string | null
          created_at?: string
          difference?: number | null
          estimated_quantity?: number | null
          final_entry_id?: string | null
          id?: string
          initial_entry_id?: string
          organization_id?: string
          previous_confirmed_at?: string | null
          previous_quantity?: number | null
          product_id?: string
          reason?: string | null
          session_id?: string
          status?: string
          updated_at?: string
          zone_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_count_discrepancies_answered_by_fkey"
            columns: ["answered_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_count_discrepancies_final_entry_id_fkey"
            columns: ["final_entry_id"]
            isOneToOne: false
            referencedRelation: "count_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_count_discrepancies_initial_entry_id_fkey"
            columns: ["initial_entry_id"]
            isOneToOne: false
            referencedRelation: "count_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_count_discrepancies_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_count_discrepancies_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_count_discrepancies_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "inventory_count_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_count_discrepancies_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "count_zones"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_count_resolution_events: {
        Row: {
          action: string
          created_at: string
          created_by: string
          discrepancy_id: string
          id: string
          organization_id: string
          original_entry_id: string
          reason: string
          resulting_entry_id: string
          store_id: string
        }
        Insert: {
          action: string
          created_at?: string
          created_by: string
          discrepancy_id: string
          id?: string
          organization_id: string
          original_entry_id: string
          reason: string
          resulting_entry_id: string
          store_id: string
        }
        Update: {
          action?: string
          created_at?: string
          created_by?: string
          discrepancy_id?: string
          id?: string
          organization_id?: string
          original_entry_id?: string
          reason?: string
          resulting_entry_id?: string
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_count_resolution_events_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_count_resolution_events_discrepancy_id_fkey"
            columns: ["discrepancy_id"]
            isOneToOne: false
            referencedRelation: "inventory_count_discrepancies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_count_resolution_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_count_resolution_events_original_entry_id_fkey"
            columns: ["original_entry_id"]
            isOneToOne: false
            referencedRelation: "count_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_count_resolution_events_resulting_entry_id_fkey"
            columns: ["resulting_entry_id"]
            isOneToOne: false
            referencedRelation: "count_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_count_resolution_events_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_count_sessions: {
        Row: {
          completed_at: string | null
          created_at: string
          id: string
          organization_id: string
          snapshot: Json
          started_at: string
          started_by: string
          status: Database["public"]["Enums"]["count_session_status"]
          store_id: string | null
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          id?: string
          organization_id: string
          snapshot?: Json
          started_at?: string
          started_by: string
          status?: Database["public"]["Enums"]["count_session_status"]
          store_id?: string | null
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          id?: string
          organization_id?: string
          snapshot?: Json
          started_at?: string
          started_by?: string
          status?: Database["public"]["Enums"]["count_session_status"]
          store_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "count_sessions_store_organization_fkey"
            columns: ["store_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "inventory_count_sessions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_count_sessions_started_by_profile_fkey"
            columns: ["started_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_lot_events: {
        Row: {
          event_type: string
          id: string
          lot_id: string
          note: string | null
          occurred_on: string
          organization_id: string
          preservation_state: string
          quantity: number | null
          recorded_at: string
          recorded_by: string
          source_id: string | null
          source_type: string
          unit: string | null
        }
        Insert: {
          event_type: string
          id?: string
          lot_id: string
          note?: string | null
          occurred_on: string
          organization_id: string
          preservation_state: string
          quantity?: number | null
          recorded_at?: string
          recorded_by: string
          source_id?: string | null
          source_type: string
          unit?: string | null
        }
        Update: {
          event_type?: string
          id?: string
          lot_id?: string
          note?: string | null
          occurred_on?: string
          organization_id?: string
          preservation_state?: string
          quantity?: number | null
          recorded_at?: string
          recorded_by?: string
          source_id?: string | null
          source_type?: string
          unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_lot_events_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "inventory_lots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_lot_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_lot_events_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_lots: {
        Row: {
          created_at: string
          created_by: string
          id: string
          lot_code: string | null
          organization_id: string
          original_expiry_date: string | null
          parent_lot_id: string | null
          product_id: string
          source_id: string | null
          source_type: string
          store_id: string | null
          store_name: string
          zone_id: string | null
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          lot_code?: string | null
          organization_id: string
          original_expiry_date?: string | null
          parent_lot_id?: string | null
          product_id: string
          source_id?: string | null
          source_type: string
          store_id?: string | null
          store_name: string
          zone_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          lot_code?: string | null
          organization_id?: string
          original_expiry_date?: string | null
          parent_lot_id?: string | null
          product_id?: string
          source_id?: string | null
          source_type?: string
          store_id?: string | null
          store_name?: string
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_lots_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_lots_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_lots_parent_lot_id_fkey"
            columns: ["parent_lot_id"]
            isOneToOne: false
            referencedRelation: "inventory_lots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_lots_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_lots_store_organization_fkey"
            columns: ["store_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "inventory_lots_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "count_zones"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_members: {
        Row: {
          created_at: string
          is_active: boolean
          is_owner: boolean
          organization_id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          is_active?: boolean
          is_owner?: boolean
          organization_id: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          is_active?: boolean
          is_owner?: boolean
          organization_id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          business_type: string | null
          created_at: string
          has_erp: boolean
          id: string
          name: string
          owner_user_id: string | null
          store_mode: string
          updated_at: string
        }
        Insert: {
          business_type?: string | null
          created_at?: string
          has_erp?: boolean
          id?: string
          name: string
          owner_user_id?: string | null
          store_mode?: string
          updated_at?: string
        }
        Update: {
          business_type?: string | null
          created_at?: string
          has_erp?: boolean
          id?: string
          name?: string
          owner_user_id?: string | null
          store_mode?: string
          updated_at?: string
        }
        Relationships: []
      }
      product_supplier_history: {
        Row: {
          created_at: string
          created_by: string | null
          effective_from: string
          effective_to: string | null
          id: string
          is_current: boolean
          organization_id: string
          product_id: string
          supplier_id: string
          valid_from: string
          valid_to: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          effective_from?: string
          effective_to?: string | null
          id?: string
          is_current?: boolean
          organization_id: string
          product_id: string
          supplier_id: string
          valid_from?: string
          valid_to?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          effective_from?: string
          effective_to?: string | null
          id?: string
          is_current?: boolean
          organization_id?: string
          product_id?: string
          supplier_id?: string
          valid_from?: string
          valid_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_supplier_history_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_supplier_history_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_supplier_history_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_supplier_history_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          base_unit: string | null
          category: string | null
          count_unit: string | null
          created_at: string
          current_supplier_id: string | null
          id: string
          is_active: boolean
          name: string
          organization_id: string
          product_code: string | null
          specification: string | null
          updated_at: string
        }
        Insert: {
          base_unit?: string | null
          category?: string | null
          count_unit?: string | null
          created_at?: string
          current_supplier_id?: string | null
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          product_code?: string | null
          specification?: string | null
          updated_at?: string
        }
        Update: {
          base_unit?: string | null
          category?: string | null
          count_unit?: string | null
          created_at?: string
          current_supplier_id?: string | null
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          product_code?: string | null
          specification?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_current_supplier_id_fkey"
            columns: ["current_supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
          organization_id: string | null
          role: string | null
          store: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id: string
          organization_id?: string | null
          role?: string | null
          store?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
          organization_id?: string | null
          role?: string | null
          store?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      receipt_adjustments: {
        Row: {
          created_at: string
          created_by: string
          id: string
          new_value: Json | null
          old_value: Json | null
          organization_id: string
          reason: string
          receipt_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          new_value?: Json | null
          old_value?: Json | null
          organization_id: string
          reason: string
          receipt_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          new_value?: Json | null
          old_value?: Json | null
          organization_id?: string
          reason?: string
          receipt_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "receipt_adjustments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_adjustments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_adjustments_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "goods_receipts"
            referencedColumns: ["id"]
          },
        ]
      }
      receipt_documents: {
        Row: {
          batch_id: string
          created_at: string
          id: string
          mime_type: string
          ocr_confidence: Json | null
          ocr_normalized: Json | null
          ocr_raw: Json | null
          organization_id: string
          original_filename: string | null
          page_order: number
          storage_path: string
          uploaded_by: string | null
        }
        Insert: {
          batch_id: string
          created_at?: string
          id?: string
          mime_type?: string
          ocr_confidence?: Json | null
          ocr_normalized?: Json | null
          ocr_raw?: Json | null
          organization_id: string
          original_filename?: string | null
          page_order?: number
          storage_path: string
          uploaded_by?: string | null
        }
        Update: {
          batch_id?: string
          created_at?: string
          id?: string
          mime_type?: string
          ocr_confidence?: Json | null
          ocr_normalized?: Json | null
          ocr_raw?: Json | null
          organization_id?: string
          original_filename?: string | null
          page_order?: number
          storage_path?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "receipt_documents_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "receipt_upload_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_documents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_documents_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      receipt_lines: {
        Row: {
          ai_original: Json | null
          batch_or_expiry: string | null
          created_at: string
          human_correction: Json | null
          id: string
          line_subtotal_ex_tax: number | null
          line_total_inc_tax: number | null
          modified_at: string | null
          modified_by: string | null
          organization_id: string
          product_id: string | null
          quantity: number | null
          receipt_id: string
          specification: string
          storage_location: string | null
          supplier_id: string | null
          tax: number | null
          tax_rate: number | null
          unit: string | null
          unit_price_ex_tax: number | null
        }
        Insert: {
          ai_original?: Json | null
          batch_or_expiry?: string | null
          created_at?: string
          human_correction?: Json | null
          id?: string
          line_subtotal_ex_tax?: number | null
          line_total_inc_tax?: number | null
          modified_at?: string | null
          modified_by?: string | null
          organization_id: string
          product_id?: string | null
          quantity?: number | null
          receipt_id: string
          specification?: string
          storage_location?: string | null
          supplier_id?: string | null
          tax?: number | null
          tax_rate?: number | null
          unit?: string | null
          unit_price_ex_tax?: number | null
        }
        Update: {
          ai_original?: Json | null
          batch_or_expiry?: string | null
          created_at?: string
          human_correction?: Json | null
          id?: string
          line_subtotal_ex_tax?: number | null
          line_total_inc_tax?: number | null
          modified_at?: string | null
          modified_by?: string | null
          organization_id?: string
          product_id?: string | null
          quantity?: number | null
          receipt_id?: string
          specification?: string
          storage_location?: string | null
          supplier_id?: string | null
          tax?: number | null
          tax_rate?: number | null
          unit?: string | null
          unit_price_ex_tax?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "receipt_lines_modified_by_profile_fkey"
            columns: ["modified_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_lines_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_lines_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "goods_receipts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_lines_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      receipt_ocr_fields: {
        Row: {
          batch_id: string
          confidence: number | null
          created_at: string
          document_id: string | null
          field_name: string
          id: string
          normalized_value: Json | null
          ocr_run_id: string | null
          organization_id: string
          raw_value: Json | null
          review_status: string | null
          row_key: string
          source_region: Json | null
          validation_notes: Json
        }
        Insert: {
          batch_id: string
          confidence?: number | null
          created_at?: string
          document_id?: string | null
          field_name: string
          id?: string
          normalized_value?: Json | null
          ocr_run_id?: string | null
          organization_id: string
          raw_value?: Json | null
          review_status?: string | null
          row_key: string
          source_region?: Json | null
          validation_notes?: Json
        }
        Update: {
          batch_id?: string
          confidence?: number | null
          created_at?: string
          document_id?: string | null
          field_name?: string
          id?: string
          normalized_value?: Json | null
          ocr_run_id?: string | null
          organization_id?: string
          raw_value?: Json | null
          review_status?: string | null
          row_key?: string
          source_region?: Json | null
          validation_notes?: Json
        }
        Relationships: [
          {
            foreignKeyName: "receipt_ocr_fields_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "receipt_upload_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_ocr_fields_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "receipt_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_ocr_fields_ocr_run_id_fkey"
            columns: ["ocr_run_id"]
            isOneToOne: false
            referencedRelation: "receipt_ocr_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_ocr_fields_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      receipt_ocr_jobs: {
        Row: {
          attempt_count: number
          available_at: string
          batch_id: string
          completed_at: string | null
          created_at: string
          id: string
          last_error: string | null
          lease_token: string | null
          locked_at: string | null
          max_attempts: number
          ocr_run_id: string | null
          organization_id: string
          requested_by: string
          started_at: string | null
          status: string
        }
        Insert: {
          attempt_count?: number
          available_at?: string
          batch_id: string
          completed_at?: string | null
          created_at?: string
          id?: string
          last_error?: string | null
          lease_token?: string | null
          locked_at?: string | null
          max_attempts?: number
          ocr_run_id?: string | null
          organization_id: string
          requested_by: string
          started_at?: string | null
          status?: string
        }
        Update: {
          attempt_count?: number
          available_at?: string
          batch_id?: string
          completed_at?: string | null
          created_at?: string
          id?: string
          last_error?: string | null
          lease_token?: string | null
          locked_at?: string | null
          max_attempts?: number
          ocr_run_id?: string | null
          organization_id?: string
          requested_by?: string
          started_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "receipt_ocr_jobs_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "receipt_upload_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_ocr_jobs_ocr_run_id_fkey"
            columns: ["ocr_run_id"]
            isOneToOne: false
            referencedRelation: "receipt_ocr_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_ocr_jobs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_ocr_jobs_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      receipt_ocr_runs: {
        Row: {
          batch_id: string
          completed_at: string | null
          created_at: string
          error_code: string | null
          error_message: string | null
          id: string
          model: string
          organization_id: string
          prompt_version: string
          provider: string
          raw_response: Json | null
          started_at: string
          started_by: string
          status: string
          version: number
        }
        Insert: {
          batch_id: string
          completed_at?: string | null
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          id?: string
          model: string
          organization_id: string
          prompt_version: string
          provider: string
          raw_response?: Json | null
          started_at?: string
          started_by: string
          status: string
          version: number
        }
        Update: {
          batch_id?: string
          completed_at?: string | null
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          id?: string
          model?: string
          organization_id?: string
          prompt_version?: string
          provider?: string
          raw_response?: Json | null
          started_at?: string
          started_by?: string
          status?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "receipt_ocr_runs_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "receipt_upload_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_ocr_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_ocr_runs_started_by_fkey"
            columns: ["started_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      receipt_product_mappings: {
        Row: {
          batch_id: string
          id: string
          organization_id: string
          product_id: string
          row_key: string
          selected_at: string
          selected_by: string
        }
        Insert: {
          batch_id: string
          id?: string
          organization_id: string
          product_id: string
          row_key: string
          selected_at?: string
          selected_by: string
        }
        Update: {
          batch_id?: string
          id?: string
          organization_id?: string
          product_id?: string
          row_key?: string
          selected_at?: string
          selected_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "receipt_product_mappings_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "receipt_upload_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_product_mappings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_product_mappings_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_product_mappings_selected_by_fkey"
            columns: ["selected_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      receipt_review_corrections: {
        Row: {
          batch_id: string
          id: string
          modified_at: string
          modified_by: string
          new_value: Json
          ocr_field_id: string
          old_value: Json | null
          organization_id: string
        }
        Insert: {
          batch_id: string
          id?: string
          modified_at?: string
          modified_by: string
          new_value: Json
          ocr_field_id: string
          old_value?: Json | null
          organization_id: string
        }
        Update: {
          batch_id?: string
          id?: string
          modified_at?: string
          modified_by?: string
          new_value?: Json
          ocr_field_id?: string
          old_value?: Json | null
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "receipt_review_corrections_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "receipt_upload_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_review_corrections_modified_by_fkey"
            columns: ["modified_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_review_corrections_ocr_field_id_fkey"
            columns: ["ocr_field_id"]
            isOneToOne: false
            referencedRelation: "receipt_ocr_fields"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_review_corrections_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      receipt_upload_batches: {
        Row: {
          batch_number: string | null
          created_at: string
          id: string
          organization_id: string
          status: Database["public"]["Enums"]["receipt_batch_status"]
          store_id: string | null
          store_name: string
          updated_at: string
          uploaded_at: string
          uploaded_by: string
          work_date: string
        }
        Insert: {
          batch_number?: string | null
          created_at?: string
          id?: string
          organization_id: string
          status?: Database["public"]["Enums"]["receipt_batch_status"]
          store_id?: string | null
          store_name: string
          updated_at?: string
          uploaded_at?: string
          uploaded_by: string
          work_date: string
        }
        Update: {
          batch_number?: string | null
          created_at?: string
          id?: string
          organization_id?: string
          status?: Database["public"]["Enums"]["receipt_batch_status"]
          store_id?: string | null
          store_name?: string
          updated_at?: string
          uploaded_at?: string
          uploaded_by?: string
          work_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "receipt_batches_store_organization_fkey"
            columns: ["store_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "receipt_upload_batches_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_upload_batches_uploaded_by_profile_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_identities: {
        Row: {
          created_at: string
          created_by: string
          disabled_at: string | null
          disabled_by: string | null
          display_name: string
          employee_number: string | null
          is_active: boolean
          job_title: string | null
          nickname: string | null
          organization_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          disabled_at?: string | null
          disabled_by?: string | null
          display_name: string
          employee_number?: string | null
          is_active?: boolean
          job_title?: string | null
          nickname?: string | null
          organization_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          disabled_at?: string | null
          disabled_by?: string | null
          display_name?: string
          employee_number?: string | null
          is_active?: boolean
          job_title?: string | null
          nickname?: string | null
          organization_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_identities_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_identities_disabled_by_fkey"
            columns: ["disabled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_identities_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_identities_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      store_memberships: {
        Row: {
          assigned_by: string
          created_at: string
          is_active: boolean
          login_identifier: string
          organization_id: string
          role: Database["public"]["Enums"]["app_role"]
          store_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          assigned_by: string
          created_at?: string
          is_active?: boolean
          login_identifier: string
          organization_id: string
          role?: Database["public"]["Enums"]["app_role"]
          store_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          assigned_by?: string
          created_at?: string
          is_active?: boolean
          login_identifier?: string
          organization_id?: string
          role?: Database["public"]["Enums"]["app_role"]
          store_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "store_memberships_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_memberships_organization_id_user_id_fkey"
            columns: ["organization_id", "user_id"]
            isOneToOne: false
            referencedRelation: "organization_members"
            referencedColumns: ["organization_id", "user_id"]
          },
          {
            foreignKeyName: "store_memberships_store_id_organization_id_fkey"
            columns: ["store_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "store_memberships_user_id_organization_id_fkey"
            columns: ["user_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "staff_identities"
            referencedColumns: ["user_id", "organization_id"]
          },
        ]
      }
      store_product_opening_balances: {
        Row: {
          created_at: string
          created_by: string
          id: string
          organization_id: string
          product_id: string
          quantity: number
          source: string
          store_id: string
          unit: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          organization_id: string
          product_id: string
          quantity: number
          source?: string
          store_id: string
          unit: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          organization_id?: string
          product_id?: string
          quantity?: number
          source?: string
          store_id?: string
          unit?: string
        }
        Relationships: [
          {
            foreignKeyName: "store_product_opening_balances_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_product_opening_balances_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_product_opening_balances_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_product_opening_balances_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      stores: {
        Row: {
          created_at: string
          created_by: string
          id: string
          is_active: boolean
          is_pilot_store: boolean
          name: string
          organization_id: string
          staff_login_mode: string
          store_code: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          is_active?: boolean
          is_pilot_store?: boolean
          name: string
          organization_id: string
          staff_login_mode?: string
          store_code: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          is_active?: boolean
          is_pilot_store?: boolean
          name?: string
          organization_id?: string
          staff_login_mode?: string
          store_code?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stores_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stores_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          organization_id: string
          supplier_code: string | null
          tax_mode: Database["public"]["Enums"]["tax_mode"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          supplier_code?: string | null
          tax_mode?: Database["public"]["Enums"]["tax_mode"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          supplier_code?: string | null
          tax_mode?: Database["public"]["Enums"]["tax_mode"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "suppliers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      zone_products: {
        Row: {
          count_unit: string | null
          created_at: string
          product_id: string
          sort_order: number
          zone_id: string
        }
        Insert: {
          count_unit?: string | null
          created_at?: string
          product_id: string
          sort_order?: number
          zone_id: string
        }
        Update: {
          count_unit?: string | null
          created_at?: string
          product_id?: string
          sort_order?: number
          zone_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "zone_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "zone_products_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "count_zones"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      assign_pilot_product_to_zone: {
        Args: { p_product_id: string; p_zone_id: string }
        Returns: undefined
      }
      can_supervise: { Args: never; Returns: boolean }
      claim_receipt_ocr_jobs: {
        Args: { p_limit?: number }
        Returns: {
          attempt_count: number
          available_at: string
          batch_id: string
          completed_at: string | null
          created_at: string
          id: string
          last_error: string | null
          lease_token: string | null
          locked_at: string | null
          max_attempts: number
          ocr_run_id: string | null
          organization_id: string
          requested_by: string
          started_at: string | null
          status: string
        }[]
        SetofOptions: {
          from: "*"
          to: "receipt_ocr_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      complete_pilot_count_zone: {
        Args: { p_session_id: string; p_zone_id: string }
        Returns: undefined
      }
      complete_receipt_ocr_job: {
        Args: { p_job_id: string; p_lease_token: string; p_ocr_run_id: string }
        Returns: undefined
      }
      create_my_organization: { Args: { p_name: string }; Returns: string }
      create_owner_business: {
        Args: {
          p_business_type: string
          p_organization_name: string
          p_staff_login_mode: string
          p_store_code: string
          p_store_name: string
        }
        Returns: Json
      }
      create_owner_business_v2: {
        Args: {
          p_has_erp: boolean
          p_organization_name: string
          p_staff_login_mode: string
          p_store_code: string
          p_store_mode: string
          p_store_name: string
        }
        Returns: Json
      }
      create_pilot_count_session: {
        Args: { p_store_id: string }
        Returns: string
      }
      create_pilot_product: {
        Args: {
          p_count_unit: string
          p_name: string
          p_opening_quantity: number
          p_product_code: string
          p_purchase_unit: string
          p_store_id: string
        }
        Returns: string
      }
      create_pilot_zone: {
        Args: { p_name: string; p_store_id: string }
        Returns: string
      }
      create_receipt_ocr_run: {
        Args: {
          p_batch_id: string
          p_model: string
          p_organization_id: string
          p_prompt_version: string
          p_provider: string
          p_started_by: string
        }
        Returns: {
          id: string
          version: number
        }[]
      }
      current_organization_id: { Args: never; Returns: string }
      current_role: { Args: never; Returns: string }
      delete_staff_pin_for_provisioning: {
        Args: { p_user_id: string }
        Returns: undefined
      }
      enqueue_receipt_ocr: {
        Args: { p_batch_id: string }
        Returns: {
          attempt_count: number
          available_at: string
          batch_id: string
          completed_at: string | null
          created_at: string
          id: string
          last_error: string | null
          lease_token: string | null
          locked_at: string | null
          max_attempts: number
          ocr_run_id: string | null
          organization_id: string
          requested_by: string
          started_at: string | null
          status: string
        }
        SetofOptions: {
          from: "*"
          to: "receipt_ocr_jobs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      fail_receipt_ocr_job: {
        Args: { p_error: string; p_job_id: string; p_lease_token: string }
        Returns: {
          attempt_count: number
          available_at: string
          batch_id: string
          completed_at: string | null
          created_at: string
          id: string
          last_error: string | null
          lease_token: string | null
          locked_at: string | null
          max_attempts: number
          ocr_run_id: string | null
          organization_id: string
          requested_by: string
          started_at: string | null
          status: string
        }
        SetofOptions: {
          from: "*"
          to: "receipt_ocr_jobs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      finalize_goods_receipt: {
        Args: {
          p_batch_id: string
          p_document_number: string
          p_lines: Json
          p_receipt_date: string
          p_subtotal_ex_tax: number
          p_supplier_id: string
          p_tax: number
          p_total_inc_tax: number
        }
        Returns: string
      }
      get_app_schema_version: { Args: never; Returns: string }
      has_org_role: {
        Args: {
          org_id: string
          roles: Database["public"]["Enums"]["app_role"][]
        }
        Returns: boolean
      }
      import_catalog_products: { Args: { p_rows: Json }; Returns: Json }
      is_admin: { Args: never; Returns: boolean }
      is_org_member: { Args: { org_id: string }; Returns: boolean }
      resolve_pilot_count_discrepancy: {
        Args: {
          p_action: string
          p_discrepancy_id: string
          p_quantity: number
          p_reason: string
        }
        Returns: string
      }
      set_staff_pin: {
        Args: { p_pin: string; p_user_id: string }
        Returns: undefined
      }
      verify_staff_pin: {
        Args: { p_identifier: string; p_pin: string; p_store_code: string }
        Returns: {
          auth_email: string
          locked_until: string
          organization_id: string
          outcome: string
          role: Database["public"]["Enums"]["app_role"]
          store_id: string
          user_id: string
        }[]
      }
    }
    Enums: {
      app_role: "ADMIN" | "SUPERVISOR" | "STAFF"
      count_entry_type: "INITIAL_COUNT" | "RECOUNT" | "CORRECTION"
      count_session_status:
        | "DRAFT"
        | "IN_PROGRESS"
        | "COMPLETED"
        | "REVIEWING"
        | "CLOSED"
      receipt_batch_status:
        | "UPLOADED"
        | "PROCESSING"
        | "READY_FOR_REVIEW"
        | "REVIEWING"
        | "COMPLETED"
      tax_mode:
        | "NO_PRICE"
        | "EXCLUSIVE_TAX"
        | "INCLUSIVE_TAX"
        | "DETECT_FROM_DOCUMENT"
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
  public: {
    Enums: {
      app_role: ["ADMIN", "SUPERVISOR", "STAFF"],
      count_entry_type: ["INITIAL_COUNT", "RECOUNT", "CORRECTION"],
      count_session_status: [
        "DRAFT",
        "IN_PROGRESS",
        "COMPLETED",
        "REVIEWING",
        "CLOSED",
      ],
      receipt_batch_status: [
        "UPLOADED",
        "PROCESSING",
        "READY_FOR_REVIEW",
        "REVIEWING",
        "COMPLETED",
      ],
      tax_mode: [
        "NO_PRICE",
        "EXCLUSIVE_TAX",
        "INCLUSIVE_TAX",
        "DETECT_FROM_DOCUMENT",
      ],
    },
  },
} as const
