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
      active_subscriptions: {
        Row: {
          applications_used: number
          auto_renew: boolean
          created_at: string
          end_date: string | null
          id: string
          legacy_id: string | null
          service_id: string
          stacked_applications: number
          start_date: string
          status: string
          student_id: string
        }
        Insert: {
          applications_used?: number
          auto_renew?: boolean
          created_at?: string
          end_date?: string | null
          id?: string
          legacy_id?: string | null
          service_id: string
          stacked_applications?: number
          start_date?: string
          status?: string
          student_id: string
        }
        Update: {
          applications_used?: number
          auto_renew?: boolean
          created_at?: string
          end_date?: string | null
          id?: string
          legacy_id?: string | null
          service_id?: string
          stacked_applications?: number
          start_date?: string
          status?: string
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "active_subscriptions_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "available_services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "active_subscriptions_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      addons: {
        Row: {
          created_at: string
          id: string
          job_credit_count: number | null
          legacy_id: string | null
          name: string
          price_inr: number | null
          price_usd: number | null
          type: string
          unlock_all_zones: boolean
          zone_count: number | null
        }
        Insert: {
          created_at?: string
          id?: string
          job_credit_count?: number | null
          legacy_id?: string | null
          name: string
          price_inr?: number | null
          price_usd?: number | null
          type: string
          unlock_all_zones?: boolean
          zone_count?: number | null
        }
        Update: {
          created_at?: string
          id?: string
          job_credit_count?: number | null
          legacy_id?: string | null
          name?: string
          price_inr?: number | null
          price_usd?: number | null
          type?: string
          unlock_all_zones?: boolean
          zone_count?: number | null
        }
        Relationships: []
      }
      applications: {
        Row: {
          created_at: string
          id: string
          interview_date: string | null
          interview_notes: string | null
          job_posting_id: string
          legacy_id: string | null
          offer_details: string | null
          rejection_reason: string | null
          rejection_source: string | null
          reviewed_at: string | null
          status: string
          student_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          interview_date?: string | null
          interview_notes?: string | null
          job_posting_id: string
          legacy_id?: string | null
          offer_details?: string | null
          rejection_reason?: string | null
          rejection_source?: string | null
          reviewed_at?: string | null
          status?: string
          student_id: string
        }
        Update: {
          created_at?: string
          id?: string
          interview_date?: string | null
          interview_notes?: string | null
          job_posting_id?: string
          legacy_id?: string | null
          offer_details?: string | null
          rejection_reason?: string | null
          rejection_source?: string | null
          reviewed_at?: string | null
          status?: string
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "applications_job_posting_id_fkey"
            columns: ["job_posting_id"]
            isOneToOne: false
            referencedRelation: "job_postings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      available_services: {
        Row: {
          all_zones_included: boolean
          application_highlight: boolean
          badge: string | null
          billing_cycle: string
          created_at: string
          currency: string
          description: string
          discount: number
          display_order: number
          features: string[]
          id: string
          is_active: boolean
          legacy_id: string | null
          max_applications: number | null
          name: string
          price: number
          price_inr: number
          price_usd: number
          priority_support: boolean
          profile_boost: boolean
          resume_downloads: number | null
          tier: string
          updated_at: string
          video_views: number | null
        }
        Insert: {
          all_zones_included?: boolean
          application_highlight?: boolean
          badge?: string | null
          billing_cycle?: string
          created_at?: string
          currency?: string
          description: string
          discount?: number
          display_order?: number
          features?: string[]
          id?: string
          is_active?: boolean
          legacy_id?: string | null
          max_applications?: number | null
          name: string
          price: number
          price_inr: number
          price_usd?: number
          priority_support?: boolean
          profile_boost?: boolean
          resume_downloads?: number | null
          tier?: string
          updated_at?: string
          video_views?: number | null
        }
        Update: {
          all_zones_included?: boolean
          application_highlight?: boolean
          badge?: string | null
          billing_cycle?: string
          created_at?: string
          currency?: string
          description?: string
          discount?: number
          display_order?: number
          features?: string[]
          id?: string
          is_active?: boolean
          legacy_id?: string | null
          max_applications?: number | null
          name?: string
          price?: number
          price_inr?: number
          price_usd?: number
          priority_support?: boolean
          profile_boost?: boolean
          resume_downloads?: number | null
          tier?: string
          updated_at?: string
          video_views?: number | null
        }
        Relationships: []
      }
      companies: {
        Row: {
          approved_at: string | null
          created_at: string
          description: string | null
          email: string
          founded_year: number | null
          id: string
          industry: string | null
          legacy_id: string | null
          logo: string | null
          name: string
          rejection_reason: string | null
          size: string | null
          social_linkedin: string | null
          social_twitter: string | null
          status: string
          user_id: string
          website: string | null
        }
        Insert: {
          approved_at?: string | null
          created_at?: string
          description?: string | null
          email: string
          founded_year?: number | null
          id?: string
          industry?: string | null
          legacy_id?: string | null
          logo?: string | null
          name: string
          rejection_reason?: string | null
          size?: string | null
          social_linkedin?: string | null
          social_twitter?: string | null
          status?: string
          user_id: string
          website?: string | null
        }
        Update: {
          approved_at?: string | null
          created_at?: string
          description?: string | null
          email?: string
          founded_year?: number | null
          id?: string
          industry?: string | null
          legacy_id?: string | null
          logo?: string | null
          name?: string
          rejection_reason?: string | null
          size?: string | null
          social_linkedin?: string | null
          social_twitter?: string | null
          status?: string
          user_id?: string
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "companies_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      job_postings: {
        Row: {
          approved_at: string | null
          company_id: string
          country_id: string | null
          created_at: string
          deadline: string | null
          description: string | null
          id: string
          job_type: string | null
          legacy_id: string | null
          location: string | null
          rejection_reason: string | null
          requirements: string | null
          salary_range: string | null
          search_vector: unknown
          status: string
          title: string | null
        }
        Insert: {
          approved_at?: string | null
          company_id: string
          country_id?: string | null
          created_at?: string
          deadline?: string | null
          description?: string | null
          id?: string
          job_type?: string | null
          legacy_id?: string | null
          location?: string | null
          rejection_reason?: string | null
          requirements?: string | null
          salary_range?: string | null
          search_vector?: unknown
          status?: string
          title?: string | null
        }
        Update: {
          approved_at?: string | null
          company_id?: string
          country_id?: string | null
          created_at?: string
          deadline?: string | null
          description?: string | null
          id?: string
          job_type?: string | null
          legacy_id?: string | null
          location?: string | null
          rejection_reason?: string | null
          requirements?: string | null
          salary_range?: string | null
          search_vector?: unknown
          status?: string
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "job_postings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_postings_country_id_fkey"
            columns: ["country_id"]
            isOneToOne: false
            referencedRelation: "zone_countries"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_preferences: {
        Row: {
          channel: string
          created_at: string
          email_type: string
          id: string
          legacy_id: string | null
          metadata: Json | null
          opted_out: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          channel?: string
          created_at?: string
          email_type: string
          id?: string
          legacy_id?: string | null
          metadata?: Json | null
          opted_out?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          channel?: string
          created_at?: string
          email_type?: string
          id?: string
          legacy_id?: string | null
          metadata?: Json | null
          opted_out?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          created_at: string
          id: string
          is_read: boolean
          legacy_id: string | null
          link: string | null
          message: string
          recipient_id: string
          recipient_type: string
          title: string
          type: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_read?: boolean
          legacy_id?: string | null
          link?: string | null
          message: string
          recipient_id: string
          recipient_type: string
          title: string
          type: string
        }
        Update: {
          created_at?: string
          id?: string
          is_read?: boolean
          legacy_id?: string | null
          link?: string | null
          message?: string
          recipient_id?: string
          recipient_type?: string
          title?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      password_reset_tokens: {
        Row: {
          created_at: string
          email: string
          expires_at: string
          id: string
          legacy_id: string | null
          token: string
          used_at: string | null
          user_id: string
          user_type: string
        }
        Insert: {
          created_at?: string
          email: string
          expires_at: string
          id?: string
          legacy_id?: string | null
          token: string
          used_at?: string | null
          user_id: string
          user_type: string
        }
        Update: {
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          legacy_id?: string | null
          token?: string
          used_at?: string | null
          user_id?: string
          user_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "password_reset_tokens_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      pay_per_job_purchases: {
        Row: {
          amount: number
          completed_at: string | null
          created_at: string
          currency: string
          id: string
          job_posting_id: string
          legacy_id: string | null
          payment_record_id: string | null
          razorpay_order_id: string | null
          status: string
          student_id: string
        }
        Insert: {
          amount: number
          completed_at?: string | null
          created_at?: string
          currency: string
          id?: string
          job_posting_id: string
          legacy_id?: string | null
          payment_record_id?: string | null
          razorpay_order_id?: string | null
          status?: string
          student_id: string
        }
        Update: {
          amount?: number
          completed_at?: string | null
          created_at?: string
          currency?: string
          id?: string
          job_posting_id?: string
          legacy_id?: string | null
          payment_record_id?: string | null
          razorpay_order_id?: string | null
          status?: string
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pay_per_job_purchases_job_posting_id_fkey"
            columns: ["job_posting_id"]
            isOneToOne: false
            referencedRelation: "job_postings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pay_per_job_purchases_payment_record_id_fkey"
            columns: ["payment_record_id"]
            isOneToOne: false
            referencedRelation: "payment_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pay_per_job_purchases_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_records: {
        Row: {
          amount: number
          created_at: string
          currency: string
          gateway_response: Json | null
          id: string
          legacy_id: string | null
          payment_date: string
          payment_gateway: string
          payment_method: string | null
          razorpay_order_id: string | null
          razorpay_payment_id: string | null
          service_id: string | null
          status: string
          student_id: string
          subscription_id: string | null
          transaction_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          currency?: string
          gateway_response?: Json | null
          id?: string
          legacy_id?: string | null
          payment_date?: string
          payment_gateway?: string
          payment_method?: string | null
          razorpay_order_id?: string | null
          razorpay_payment_id?: string | null
          service_id?: string | null
          status?: string
          student_id: string
          subscription_id?: string | null
          transaction_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string
          gateway_response?: Json | null
          id?: string
          legacy_id?: string | null
          payment_date?: string
          payment_gateway?: string
          payment_method?: string | null
          razorpay_order_id?: string | null
          razorpay_payment_id?: string | null
          service_id?: string | null
          status?: string
          student_id?: string
          subscription_id?: string | null
          transaction_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_records_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "available_services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_records_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_records_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "active_subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      plan_zones: {
        Row: {
          id: string
          legacy_id: string | null
          plan_id: string
          zone_id: string
        }
        Insert: {
          id?: string
          legacy_id?: string | null
          plan_id: string
          zone_id: string
        }
        Update: {
          id?: string
          legacy_id?: string | null
          plan_id?: string
          zone_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "plan_zones_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "available_services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_zones_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "zones"
            referencedColumns: ["id"]
          },
        ]
      }
      students: {
        Row: {
          available_from: string | null
          bio: string | null
          created_at: string
          current_subscription_id: string | null
          education: Json
          email: string
          experience: Json
          full_name: string
          id: string
          intro_video_url: string | null
          is_dg_shipping: string
          is_hired: boolean
          legacy_id: string | null
          location: string | null
          profile_link: string | null
          resume_url: string | null
          skills: string[]
          student_id: string
          subscription_tier: string
          user_id: string
        }
        Insert: {
          available_from?: string | null
          bio?: string | null
          created_at?: string
          current_subscription_id?: string | null
          education?: Json
          email: string
          experience?: Json
          full_name: string
          id?: string
          intro_video_url?: string | null
          is_dg_shipping?: string
          is_hired?: boolean
          legacy_id?: string | null
          location?: string | null
          profile_link?: string | null
          resume_url?: string | null
          skills?: string[]
          student_id: string
          subscription_tier?: string
          user_id: string
        }
        Update: {
          available_from?: string | null
          bio?: string | null
          created_at?: string
          current_subscription_id?: string | null
          education?: Json
          email?: string
          experience?: Json
          full_name?: string
          id?: string
          intro_video_url?: string | null
          is_dg_shipping?: string
          is_hired?: boolean
          legacy_id?: string | null
          location?: string | null
          profile_link?: string | null
          resume_url?: string | null
          skills?: string[]
          student_id?: string
          subscription_tier?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "students_current_subscription_id_fkey"
            columns: ["current_subscription_id"]
            isOneToOne: false
            referencedRelation: "active_subscriptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "students_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_addons: {
        Row: {
          addon_id: string
          created_at: string
          id: string
          legacy_id: string | null
          payment_record_id: string | null
          quantity: number
          subscription_id: string
        }
        Insert: {
          addon_id: string
          created_at?: string
          id?: string
          legacy_id?: string | null
          payment_record_id?: string | null
          quantity?: number
          subscription_id: string
        }
        Update: {
          addon_id?: string
          created_at?: string
          id?: string
          legacy_id?: string | null
          payment_record_id?: string | null
          quantity?: number
          subscription_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscription_addons_addon_id_fkey"
            columns: ["addon_id"]
            isOneToOne: false
            referencedRelation: "addons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_addons_payment_record_id_fkey"
            columns: ["payment_record_id"]
            isOneToOne: false
            referencedRelation: "payment_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_addons_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "active_subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_zones: {
        Row: {
          created_at: string
          id: string
          legacy_id: string | null
          source: string
          subscription_id: string
          zone_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          legacy_id?: string | null
          source?: string
          subscription_id: string
          zone_id: string
        }
        Update: {
          created_at?: string
          id?: string
          legacy_id?: string | null
          source?: string
          subscription_id?: string
          zone_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscription_zones_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "active_subscriptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_zones_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "zones"
            referencedColumns: ["id"]
          },
        ]
      }
      system_config: {
        Row: {
          description: string | null
          id: string
          key: string
          legacy_id: string | null
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          description?: string | null
          id?: string
          key: string
          legacy_id?: string | null
          updated_at?: string
          updated_by?: string | null
          value: Json
        }
        Update: {
          description?: string | null
          id?: string
          key?: string
          legacy_id?: string | null
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "system_config_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          legacy_id: string | null
          password_hash: string
          user_type: string
          username: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          legacy_id?: string | null
          password_hash: string
          user_type: string
          username: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          legacy_id?: string | null
          password_hash?: string
          user_type?: string
          username?: string
        }
        Relationships: []
      }
      zone_countries: {
        Row: {
          country_name: string
          id: string
          legacy_id: string | null
          zone_id: string
        }
        Insert: {
          country_name: string
          id?: string
          legacy_id?: string | null
          zone_id: string
        }
        Update: {
          country_name?: string
          id?: string
          legacy_id?: string | null
          zone_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "zone_countries_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "zones"
            referencedColumns: ["id"]
          },
        ]
      }
      zones: {
        Row: {
          created_at: string
          description: string
          id: string
          legacy_id: string | null
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description: string
          id?: string
          legacy_id?: string | null
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          legacy_id?: string | null
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      decrement_applications_used: {
        Args: { p_subscription_id: string }
        Returns: {
          applications_used: number
          auto_renew: boolean
          created_at: string
          end_date: string | null
          id: string
          legacy_id: string | null
          service_id: string
          stacked_applications: number
          start_date: string
          status: string
          student_id: string
        }
        SetofOptions: {
          from: "*"
          to: "active_subscriptions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      increment_applications_used: {
        Args: { p_subscription_id: string }
        Returns: {
          applications_used: number
          auto_renew: boolean
          created_at: string
          end_date: string | null
          id: string
          legacy_id: string | null
          service_id: string
          stacked_applications: number
          start_date: string
          status: string
          student_id: string
        }
        SetofOptions: {
          from: "*"
          to: "active_subscriptions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
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
  public: {
    Enums: {},
  },
} as const
