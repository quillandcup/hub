export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  bronze: {
    Tables: {
      calendar_events: {
        Row: {
          creator_email: string | null
          creator_name: string | null
          description: string | null
          end_time: string
          google_event_id: string
          id: string
          imported_at: string | null
          location: string | null
          organizer_email: string | null
          organizer_name: string | null
          raw_data: Json
          start_time: string
          summary: string | null
        }
        Insert: {
          creator_email?: string | null
          creator_name?: string | null
          description?: string | null
          end_time: string
          google_event_id: string
          id?: string
          imported_at?: string | null
          location?: string | null
          organizer_email?: string | null
          organizer_name?: string | null
          raw_data: Json
          start_time: string
          summary?: string | null
        }
        Update: {
          creator_email?: string | null
          creator_name?: string | null
          description?: string | null
          end_time?: string
          google_event_id?: string
          id?: string
          imported_at?: string | null
          location?: string | null
          organizer_email?: string | null
          organizer_name?: string | null
          raw_data?: Json
          start_time?: string
          summary?: string | null
        }
        Relationships: []
      }
      kajabi_contacts: {
        Row: {
          created_at_kajabi: string | null
          data: Json
          email: string
          id: string
          imported_at: string
          kajabi_contact_id: string
          name: string | null
          updated_at: string
          updated_at_kajabi: string | null
        }
        Insert: {
          created_at_kajabi?: string | null
          data: Json
          email: string
          id?: string
          imported_at?: string
          kajabi_contact_id: string
          name?: string | null
          updated_at?: string
          updated_at_kajabi?: string | null
        }
        Update: {
          created_at_kajabi?: string | null
          data?: Json
          email?: string
          id?: string
          imported_at?: string
          kajabi_contact_id?: string
          name?: string | null
          updated_at?: string
          updated_at_kajabi?: string | null
        }
        Relationships: []
      }
      kajabi_course_lessons: {
        Row: {
          body_html: string | null
          content_fetched_at: string | null
          content_hash: string | null
          course_kajabi_id: string
          deleted_at: string | null
          fetched_at: string
          kajabi_id: string
          module_kajabi_id: string | null
          position: number | null
          publishing_option: string | null
          raw_payload: Json
          thumbnail_url: string | null
          title: string
          video_duration_seconds: number | null
          video_media_id: string | null
          video_source: Json | null
        }
        Insert: {
          body_html?: string | null
          content_fetched_at?: string | null
          content_hash?: string | null
          course_kajabi_id: string
          deleted_at?: string | null
          fetched_at?: string
          kajabi_id: string
          module_kajabi_id?: string | null
          position?: number | null
          publishing_option?: string | null
          raw_payload?: Json
          thumbnail_url?: string | null
          title: string
          video_duration_seconds?: number | null
          video_media_id?: string | null
          video_source?: Json | null
        }
        Update: {
          body_html?: string | null
          content_fetched_at?: string | null
          content_hash?: string | null
          course_kajabi_id?: string
          deleted_at?: string | null
          fetched_at?: string
          kajabi_id?: string
          module_kajabi_id?: string | null
          position?: number | null
          publishing_option?: string | null
          raw_payload?: Json
          thumbnail_url?: string | null
          title?: string
          video_duration_seconds?: number | null
          video_media_id?: string | null
          video_source?: Json | null
        }
        Relationships: []
      }
      kajabi_course_modules: {
        Row: {
          course_kajabi_id: string
          deleted_at: string | null
          fetched_at: string
          kajabi_id: string
          parent_kajabi_id: string | null
          position: number | null
          poster_url: string | null
          publishing_option: string | null
          raw_payload: Json
          title: string
        }
        Insert: {
          course_kajabi_id: string
          deleted_at?: string | null
          fetched_at?: string
          kajabi_id: string
          parent_kajabi_id?: string | null
          position?: number | null
          poster_url?: string | null
          publishing_option?: string | null
          raw_payload?: Json
          title: string
        }
        Update: {
          course_kajabi_id?: string
          deleted_at?: string | null
          fetched_at?: string
          kajabi_id?: string
          parent_kajabi_id?: string | null
          position?: number | null
          poster_url?: string | null
          publishing_option?: string | null
          raw_payload?: Json
          title?: string
        }
        Relationships: []
      }
      kajabi_course_offers: {
        Row: {
          course_kajabi_id: string
          deleted_at: string | null
          fetched_at: string
          offer_kajabi_id: string
          offer_title: string | null
        }
        Insert: {
          course_kajabi_id: string
          deleted_at?: string | null
          fetched_at?: string
          offer_kajabi_id: string
          offer_title?: string | null
        }
        Update: {
          course_kajabi_id?: string
          deleted_at?: string | null
          fetched_at?: string
          offer_kajabi_id?: string
          offer_title?: string | null
        }
        Relationships: []
      }
      kajabi_courses: {
        Row: {
          deleted_at: string | null
          fetched_at: string
          hero_captured_at: string | null
          hero_image_url: string | null
          kajabi_id: string
          publishing_option: string | null
          raw_payload: Json
          title: string
        }
        Insert: {
          deleted_at?: string | null
          fetched_at?: string
          hero_captured_at?: string | null
          hero_image_url?: string | null
          kajabi_id: string
          publishing_option?: string | null
          raw_payload?: Json
          title: string
        }
        Update: {
          deleted_at?: string | null
          fetched_at?: string
          hero_captured_at?: string | null
          hero_image_url?: string | null
          kajabi_id?: string
          publishing_option?: string | null
          raw_payload?: Json
          title?: string
        }
        Relationships: []
      }
      kajabi_customers: {
        Row: {
          created_at_kajabi: string | null
          data: Json
          email: string
          id: string
          imported_at: string
          kajabi_customer_id: string
          name: string | null
          updated_at: string
          updated_at_kajabi: string | null
        }
        Insert: {
          created_at_kajabi?: string | null
          data: Json
          email: string
          id?: string
          imported_at?: string
          kajabi_customer_id: string
          name?: string | null
          updated_at?: string
          updated_at_kajabi?: string | null
        }
        Update: {
          created_at_kajabi?: string | null
          data?: Json
          email?: string
          id?: string
          imported_at?: string
          kajabi_customer_id?: string
          name?: string | null
          updated_at?: string
          updated_at_kajabi?: string | null
        }
        Relationships: []
      }
      kajabi_lesson_files: {
        Row: {
          content_type: string | null
          deleted_at: string | null
          fetched_at: string
          filename: string
          kajabi_id: string
          lesson_kajabi_id: string
          raw_payload: Json
          size_bytes: number | null
          source_url: string | null
        }
        Insert: {
          content_type?: string | null
          deleted_at?: string | null
          fetched_at?: string
          filename: string
          kajabi_id: string
          lesson_kajabi_id: string
          raw_payload?: Json
          size_bytes?: number | null
          source_url?: string | null
        }
        Update: {
          content_type?: string | null
          deleted_at?: string | null
          fetched_at?: string
          filename?: string
          kajabi_id?: string
          lesson_kajabi_id?: string
          raw_payload?: Json
          size_bytes?: number | null
          source_url?: string | null
        }
        Relationships: []
      }
      kajabi_lesson_progress: {
        Row: {
          captured_at: string
          completed: boolean
          completed_at: string | null
          course_kajabi_id: string
          deleted_at: string | null
          email: string
          kajabi_contact_id: string | null
          kajabi_lesson_id: string
          kajabi_member_id: string | null
          percent: number | null
        }
        Insert: {
          captured_at?: string
          completed: boolean
          completed_at?: string | null
          course_kajabi_id: string
          deleted_at?: string | null
          email: string
          kajabi_contact_id?: string | null
          kajabi_lesson_id: string
          kajabi_member_id?: string | null
          percent?: number | null
        }
        Update: {
          captured_at?: string
          completed?: boolean
          completed_at?: string | null
          course_kajabi_id?: string
          deleted_at?: string | null
          email?: string
          kajabi_contact_id?: string | null
          kajabi_lesson_id?: string
          kajabi_member_id?: string | null
          percent?: number | null
        }
        Relationships: []
      }
      kajabi_members: {
        Row: {
          data: Json
          email: string
          id: string
          imported_at: string
        }
        Insert: {
          data: Json
          email: string
          id?: string
          imported_at?: string
        }
        Update: {
          data?: Json
          email?: string
          id?: string
          imported_at?: string
        }
        Relationships: []
      }
      kajabi_offers: {
        Row: {
          data: Json
          id: string
          imported_at: string
          kajabi_offer_id: string
          name: string | null
          status: string | null
          trial_period_days: number | null
          updated_at: string
        }
        Insert: {
          data: Json
          id?: string
          imported_at?: string
          kajabi_offer_id: string
          name?: string | null
          status?: string | null
          trial_period_days?: number | null
          updated_at?: string
        }
        Update: {
          data?: Json
          id?: string
          imported_at?: string
          kajabi_offer_id?: string
          name?: string | null
          status?: string | null
          trial_period_days?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      kajabi_product_progress: {
        Row: {
          course_kajabi_id: string
          deleted_at: string | null
          email: string
          import_batch: string
          imported_at: string
          last_activity_on: string | null
          logins: number | null
          percent: number
          source_file: string | null
          started_on: string | null
        }
        Insert: {
          course_kajabi_id: string
          deleted_at?: string | null
          email: string
          import_batch: string
          imported_at?: string
          last_activity_on?: string | null
          logins?: number | null
          percent: number
          source_file?: string | null
          started_on?: string | null
        }
        Update: {
          course_kajabi_id?: string
          deleted_at?: string | null
          email?: string
          import_batch?: string
          imported_at?: string
          last_activity_on?: string | null
          logins?: number | null
          percent?: number
          source_file?: string | null
          started_on?: string | null
        }
        Relationships: []
      }
      kajabi_purchases: {
        Row: {
          amount_in_cents: number | null
          created_at_kajabi: string | null
          currency: string | null
          data: Json
          deactivated_at: string | null
          effective_start_at: string | null
          id: string
          imported_at: string
          kajabi_customer_id: string | null
          kajabi_offer_id: string | null
          kajabi_purchase_id: string
          status: string | null
          updated_at: string
        }
        Insert: {
          amount_in_cents?: number | null
          created_at_kajabi?: string | null
          currency?: string | null
          data: Json
          deactivated_at?: string | null
          effective_start_at?: string | null
          id?: string
          imported_at?: string
          kajabi_customer_id?: string | null
          kajabi_offer_id?: string | null
          kajabi_purchase_id: string
          status?: string | null
          updated_at?: string
        }
        Update: {
          amount_in_cents?: number | null
          created_at_kajabi?: string | null
          currency?: string | null
          data?: Json
          deactivated_at?: string | null
          effective_start_at?: string | null
          id?: string
          imported_at?: string
          kajabi_customer_id?: string | null
          kajabi_offer_id?: string | null
          kajabi_purchase_id?: string
          status?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      slack_channel_member_events: {
        Row: {
          channel_id: string
          event: string
          id: string
          inviter_user_id: string | null
          occurred_at: string
          raw_payload: Json
          recorded_at: string
          slack_ts: string | null
          source: string
          user_id: string
        }
        Insert: {
          channel_id: string
          event: string
          id?: string
          inviter_user_id?: string | null
          occurred_at: string
          raw_payload?: Json
          recorded_at?: string
          slack_ts?: string | null
          source: string
          user_id: string
        }
        Update: {
          channel_id?: string
          event?: string
          id?: string
          inviter_user_id?: string | null
          occurred_at?: string
          raw_payload?: Json
          recorded_at?: string
          slack_ts?: string | null
          source?: string
          user_id?: string
        }
        Relationships: []
      }
      slack_channel_members: {
        Row: {
          channel_id: string
          first_seen_at: string
          imported_at: string
          left_at: string | null
          user_id: string
        }
        Insert: {
          channel_id: string
          first_seen_at?: string
          imported_at?: string
          left_at?: string | null
          user_id: string
        }
        Update: {
          channel_id?: string
          first_seen_at?: string
          imported_at?: string
          left_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      slack_channels: {
        Row: {
          channel_id: string
          created: string | null
          id: string
          imported_at: string
          is_archived: boolean | null
          is_mpim: boolean
          is_private: boolean | null
          member_count: number | null
          name: string
          purpose: string | null
          raw_payload: Json
          topic: string | null
        }
        Insert: {
          channel_id: string
          created?: string | null
          id?: string
          imported_at?: string
          is_archived?: boolean | null
          is_mpim?: boolean
          is_private?: boolean | null
          member_count?: number | null
          name: string
          purpose?: string | null
          raw_payload: Json
          topic?: string | null
        }
        Update: {
          channel_id?: string
          created?: string | null
          id?: string
          imported_at?: string
          is_archived?: boolean | null
          is_mpim?: boolean
          is_private?: boolean | null
          member_count?: number | null
          name?: string
          purpose?: string | null
          raw_payload?: Json
          topic?: string | null
        }
        Relationships: []
      }
      slack_custom_emoji: {
        Row: {
          alias_for: string | null
          deleted_at: string | null
          first_seen_at: string
          image_url: string | null
          imported_at: string
          name: string
        }
        Insert: {
          alias_for?: string | null
          deleted_at?: string | null
          first_seen_at?: string
          image_url?: string | null
          imported_at?: string
          name: string
        }
        Update: {
          alias_for?: string | null
          deleted_at?: string | null
          first_seen_at?: string
          image_url?: string | null
          imported_at?: string
          name?: string
        }
        Relationships: []
      }
      slack_files: {
        Row: {
          channel_id: string
          copied_at: string | null
          copy_error: string | null
          deleted_at: string | null
          file_id: string
          first_seen_at: string
          imported_at: string
          message_ts: string
          mimetype: string | null
          name: string | null
          raw_payload: Json
          size_bytes: number | null
          storage_path: string | null
        }
        Insert: {
          channel_id: string
          copied_at?: string | null
          copy_error?: string | null
          deleted_at?: string | null
          file_id: string
          first_seen_at?: string
          imported_at?: string
          message_ts: string
          mimetype?: string | null
          name?: string | null
          raw_payload: Json
          size_bytes?: number | null
          storage_path?: string | null
        }
        Update: {
          channel_id?: string
          copied_at?: string | null
          copy_error?: string | null
          deleted_at?: string | null
          file_id?: string
          first_seen_at?: string
          imported_at?: string
          message_ts?: string
          mimetype?: string | null
          name?: string | null
          raw_payload?: Json
          size_bytes?: number | null
          storage_path?: string | null
        }
        Relationships: []
      }
      slack_messages: {
        Row: {
          channel_id: string
          channel_name: string | null
          channel_type: string | null
          deleted_at: string | null
          edited_at: string | null
          files: Json | null
          has_files: boolean | null
          id: string
          imported_at: string
          message_ts: string
          message_type: string | null
          occurred_at: string
          raw_payload: Json
          reply_count: number | null
          reply_users_count: number | null
          text: string | null
          thread_ts: string | null
          user_email: string | null
          user_id: string
          user_name: string | null
        }
        Insert: {
          channel_id: string
          channel_name?: string | null
          channel_type?: string | null
          deleted_at?: string | null
          edited_at?: string | null
          files?: Json | null
          has_files?: boolean | null
          id?: string
          imported_at?: string
          message_ts: string
          message_type?: string | null
          occurred_at: string
          raw_payload: Json
          reply_count?: number | null
          reply_users_count?: number | null
          text?: string | null
          thread_ts?: string | null
          user_email?: string | null
          user_id: string
          user_name?: string | null
        }
        Update: {
          channel_id?: string
          channel_name?: string | null
          channel_type?: string | null
          deleted_at?: string | null
          edited_at?: string | null
          files?: Json | null
          has_files?: boolean | null
          id?: string
          imported_at?: string
          message_ts?: string
          message_type?: string | null
          occurred_at?: string
          raw_payload?: Json
          reply_count?: number | null
          reply_users_count?: number | null
          text?: string | null
          thread_ts?: string | null
          user_email?: string | null
          user_id?: string
          user_name?: string | null
        }
        Relationships: []
      }
      slack_reactions: {
        Row: {
          channel_id: string
          channel_name: string | null
          deleted_at: string | null
          id: string
          imported_at: string
          message_ts: string
          occurred_at: string
          raw_payload: Json
          reaction: string
          user_email: string | null
          user_id: string
          user_name: string | null
        }
        Insert: {
          channel_id: string
          channel_name?: string | null
          deleted_at?: string | null
          id?: string
          imported_at?: string
          message_ts: string
          occurred_at: string
          raw_payload: Json
          reaction: string
          user_email?: string | null
          user_id: string
          user_name?: string | null
        }
        Update: {
          channel_id?: string
          channel_name?: string | null
          deleted_at?: string | null
          id?: string
          imported_at?: string
          message_ts?: string
          occurred_at?: string
          raw_payload?: Json
          reaction?: string
          user_email?: string | null
          user_id?: string
          user_name?: string | null
        }
        Relationships: []
      }
      slack_users: {
        Row: {
          display_name: string | null
          email: string | null
          id: string
          image_url: string | null
          imported_at: string
          is_bot: boolean | null
          is_deleted: boolean | null
          name: string | null
          raw_payload: Json
          real_name: string | null
          user_id: string
        }
        Insert: {
          display_name?: string | null
          email?: string | null
          id?: string
          image_url?: string | null
          imported_at?: string
          is_bot?: boolean | null
          is_deleted?: boolean | null
          name?: string | null
          raw_payload: Json
          real_name?: string | null
          user_id: string
        }
        Update: {
          display_name?: string | null
          email?: string | null
          id?: string
          image_url?: string | null
          imported_at?: string
          is_bot?: boolean | null
          is_deleted?: boolean | null
          name?: string | null
          raw_payload?: Json
          real_name?: string | null
          user_id?: string
        }
        Relationships: []
      }
      stripe_customers: {
        Row: {
          created_at_stripe: string | null
          data: Json
          email: string | null
          id: string
          imported_at: string
          name: string | null
          stripe_customer_id: string
          updated_at: string
        }
        Insert: {
          created_at_stripe?: string | null
          data: Json
          email?: string | null
          id?: string
          imported_at?: string
          name?: string | null
          stripe_customer_id: string
          updated_at?: string
        }
        Update: {
          created_at_stripe?: string | null
          data?: Json
          email?: string | null
          id?: string
          imported_at?: string
          name?: string | null
          stripe_customer_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      stripe_products: {
        Row: {
          active: boolean | null
          data: Json
          id: string
          imported_at: string
          name: string
          stripe_product_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean | null
          data: Json
          id?: string
          imported_at?: string
          name: string
          stripe_product_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean | null
          data?: Json
          id?: string
          imported_at?: string
          name?: string
          stripe_product_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      stripe_subscriptions: {
        Row: {
          canceled_at: string | null
          created_at_stripe: string | null
          current_period_end: string | null
          current_period_start: string | null
          data: Json
          id: string
          imported_at: string
          pause_collection: Json | null
          status: string
          stripe_customer_id: string
          stripe_subscription_id: string
          updated_at: string
        }
        Insert: {
          canceled_at?: string | null
          created_at_stripe?: string | null
          current_period_end?: string | null
          current_period_start?: string | null
          data: Json
          id?: string
          imported_at?: string
          pause_collection?: Json | null
          status: string
          stripe_customer_id: string
          stripe_subscription_id: string
          updated_at?: string
        }
        Update: {
          canceled_at?: string | null
          created_at_stripe?: string | null
          current_period_end?: string | null
          current_period_start?: string | null
          data?: Json
          id?: string
          imported_at?: string
          pause_collection?: Json | null
          status?: string
          stripe_customer_id?: string
          stripe_subscription_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      subscription_history: {
        Row: {
          amount: string | null
          canceled_on: string | null
          created_at_kajabi: string | null
          currency: string | null
          customer_email: string
          customer_id: string | null
          customer_name: string | null
          data: Json | null
          id: string
          imported_at: string | null
          interval: string | null
          kajabi_subscription_id: string
          next_payment_date: string | null
          offer_id: string | null
          offer_title: string | null
          provider: string | null
          provider_id: string | null
          status: string
          trial_ends_on: string | null
        }
        Insert: {
          amount?: string | null
          canceled_on?: string | null
          created_at_kajabi?: string | null
          currency?: string | null
          customer_email: string
          customer_id?: string | null
          customer_name?: string | null
          data?: Json | null
          id?: string
          imported_at?: string | null
          interval?: string | null
          kajabi_subscription_id: string
          next_payment_date?: string | null
          offer_id?: string | null
          offer_title?: string | null
          provider?: string | null
          provider_id?: string | null
          status: string
          trial_ends_on?: string | null
        }
        Update: {
          amount?: string | null
          canceled_on?: string | null
          created_at_kajabi?: string | null
          currency?: string | null
          customer_email?: string
          customer_id?: string | null
          customer_name?: string | null
          data?: Json | null
          id?: string
          imported_at?: string | null
          interval?: string | null
          kajabi_subscription_id?: string
          next_payment_date?: string | null
          offer_id?: string | null
          offer_title?: string | null
          provider?: string | null
          provider_id?: string | null
          status?: string
          trial_ends_on?: string | null
        }
        Relationships: []
      }
      zoom_attendees: {
        Row: {
          attentiveness_score: number | null
          created_at: string | null
          duration: number
          email: string | null
          failover: boolean | null
          id: string
          join_time: string
          leave_time: string
          meeting_id: string
          meeting_uuid: string | null
          name: string
          participant_id: string | null
          raw_payload: Json | null
          registrant_id: string | null
          status: string | null
          topic: string | null
          user_id: string | null
        }
        Insert: {
          attentiveness_score?: number | null
          created_at?: string | null
          duration: number
          email?: string | null
          failover?: boolean | null
          id?: string
          join_time: string
          leave_time: string
          meeting_id: string
          meeting_uuid?: string | null
          name: string
          participant_id?: string | null
          raw_payload?: Json | null
          registrant_id?: string | null
          status?: string | null
          topic?: string | null
          user_id?: string | null
        }
        Update: {
          attentiveness_score?: number | null
          created_at?: string | null
          duration?: number
          email?: string | null
          failover?: boolean | null
          id?: string
          join_time?: string
          leave_time?: string
          meeting_id?: string
          meeting_uuid?: string | null
          name?: string
          participant_id?: string | null
          raw_payload?: Json | null
          registrant_id?: string | null
          status?: string | null
          topic?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      zoom_meetings: {
        Row: {
          data: Json
          duration_minutes: number | null
          end_time: string | null
          host_email: string | null
          host_name: string | null
          id: string
          imported_at: string | null
          meeting_id: string
          meeting_uuid: string
          participant_count: number | null
          start_time: string
          topic: string
          updated_at: string | null
        }
        Insert: {
          data: Json
          duration_minutes?: number | null
          end_time?: string | null
          host_email?: string | null
          host_name?: string | null
          id?: string
          imported_at?: string | null
          meeting_id: string
          meeting_uuid: string
          participant_count?: number | null
          start_time: string
          topic: string
          updated_at?: string | null
        }
        Update: {
          data?: Json
          duration_minutes?: number | null
          end_time?: string | null
          host_email?: string | null
          host_name?: string | null
          id?: string
          imported_at?: string | null
          meeting_id?: string
          meeting_uuid?: string
          participant_count?: number | null
          start_time?: string
          topic?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      zoom_participant_events: {
        Row: {
          event: string
          event_time: string
          host_id: string | null
          id: string
          leave_reason: string | null
          meeting_id: string | null
          meeting_uuid: string
          participant_email: string | null
          participant_key: string
          participant_name: string | null
          raw_payload: Json
          received_at: string
        }
        Insert: {
          event: string
          event_time: string
          host_id?: string | null
          id?: string
          leave_reason?: string | null
          meeting_id?: string | null
          meeting_uuid: string
          participant_email?: string | null
          participant_key: string
          participant_name?: string | null
          raw_payload: Json
          received_at?: string
        }
        Update: {
          event?: string
          event_time?: string
          host_id?: string | null
          id?: string
          leave_reason?: string | null
          meeting_id?: string | null
          meeting_uuid?: string
          participant_email?: string | null
          participant_key?: string
          participant_name?: string | null
          raw_payload?: Json
          received_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      slack_channel_membership_periods: {
        Row: {
          channel_id: string | null
          inviter_user_id: string | null
          joined_at: string | null
          joined_source: string | null
          left_at: string | null
          left_source: string | null
          user_id: string | null
        }
        Relationships: []
      }
      slack_messages_meta: {
        Row: {
          channel_id: string | null
          channel_name: string | null
          channel_type: string | null
          deleted_at: string | null
          edited_at: string | null
          has_files: boolean | null
          id: string | null
          imported_at: string | null
          message_ts: string | null
          message_type: string | null
          occurred_at: string | null
          reply_count: number | null
          reply_users_count: number | null
          thread_ts: string | null
          user_email: string | null
          user_id: string | null
          user_name: string | null
        }
        Insert: {
          channel_id?: string | null
          channel_name?: string | null
          channel_type?: string | null
          deleted_at?: string | null
          edited_at?: string | null
          has_files?: boolean | null
          id?: string | null
          imported_at?: string | null
          message_ts?: string | null
          message_type?: string | null
          occurred_at?: string | null
          reply_count?: number | null
          reply_users_count?: number | null
          thread_ts?: string | null
          user_email?: string | null
          user_id?: string | null
          user_name?: string | null
        }
        Update: {
          channel_id?: string | null
          channel_name?: string | null
          channel_type?: string | null
          deleted_at?: string | null
          edited_at?: string | null
          has_files?: boolean | null
          id?: string | null
          imported_at?: string | null
          message_ts?: string | null
          message_type?: string | null
          occurred_at?: string | null
          reply_count?: number | null
          reply_users_count?: number | null
          thread_ts?: string | null
          user_email?: string | null
          user_id?: string | null
          user_name?: string | null
        }
        Relationships: []
      }
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
  public: {
    Tables: {
      access_events: {
        Row: {
          acting_as_member_id: string | null
          city: string | null
          country: string | null
          created_at: string
          device: Json | null
          ga_client_id: string | null
          id: number
          ip_address: unknown
          is_page: boolean
          path: string
          region: string | null
          session_id: string | null
          user_agent: string | null
          user_id: string
        }
        Insert: {
          acting_as_member_id?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          device?: Json | null
          ga_client_id?: string | null
          id?: never
          ip_address?: unknown
          is_page: boolean
          path: string
          region?: string | null
          session_id?: string | null
          user_agent?: string | null
          user_id: string
        }
        Update: {
          acting_as_member_id?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          device?: Json | null
          ga_client_id?: string | null
          id?: never
          ip_address?: unknown
          is_page?: boolean
          path?: string
          region?: string | null
          session_id?: string | null
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      admin_work_queue_completions: {
        Row: {
          completed_at: string
          completed_by: string | null
          id: string
          member_id: string
          occurrence_key: string
          postponed_until: string | null
          queue_type: string
          status: string
        }
        Insert: {
          completed_at?: string
          completed_by?: string | null
          id?: string
          member_id: string
          occurrence_key: string
          postponed_until?: string | null
          queue_type: string
          status?: string
        }
        Update: {
          completed_at?: string
          completed_by?: string | null
          id?: string
          member_id?: string
          occurrence_key?: string
          postponed_until?: string | null
          queue_type?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_work_queue_completions_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      ambiguous_zoom_names: {
        Row: {
          candidate_member_ids: string[]
          created_at: string | null
          first_seen_at: string | null
          id: string
          last_seen_at: string | null
          notes: string | null
          occurrence_count: number | null
          resolved_member_id: string | null
          status: string | null
          updated_at: string | null
          zoom_email: string | null
          zoom_name: string
        }
        Insert: {
          candidate_member_ids: string[]
          created_at?: string | null
          first_seen_at?: string | null
          id?: string
          last_seen_at?: string | null
          notes?: string | null
          occurrence_count?: number | null
          resolved_member_id?: string | null
          status?: string | null
          updated_at?: string | null
          zoom_email?: string | null
          zoom_name: string
        }
        Update: {
          candidate_member_ids?: string[]
          created_at?: string | null
          first_seen_at?: string | null
          id?: string
          last_seen_at?: string | null
          notes?: string | null
          occurrence_count?: number | null
          resolved_member_id?: string | null
          status?: string | null
          updated_at?: string | null
          zoom_email?: string | null
          zoom_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "ambiguous_zoom_names_resolved_member_id_fkey"
            columns: ["resolved_member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      analytics_events: {
        Row: {
          context: Json
          event: string
          id: number
          message_id: string
          occurred_at: string
          properties: Json
          received_at: string
          session_id: string | null
          source: string
          sudo: boolean
          user_id: string
        }
        Insert: {
          context?: Json
          event: string
          id?: never
          message_id: string
          occurred_at: string
          properties?: Json
          received_at?: string
          session_id?: string | null
          source?: string
          sudo?: boolean
          user_id: string
        }
        Update: {
          context?: Json
          event?: string
          id?: never
          message_id?: string
          occurred_at?: string
          properties?: Json
          received_at?: string
          session_id?: string | null
          source?: string
          sudo?: boolean
          user_id?: string
        }
        Relationships: []
      }
      analytics_rollup_periods: {
        Row: {
          period_kind: string
          period_start: string
          rolled_up_at: string
          source_events: number
        }
        Insert: {
          period_kind: string
          period_start: string
          rolled_up_at?: string
          source_events: number
        }
        Update: {
          period_kind?: string
          period_start?: string
          rolled_up_at?: string
          source_events?: number
        }
        Relationships: []
      }
      analytics_rollups: {
        Row: {
          audience: string
          dimension: string
          event: string
          events: number
          members: number
          period_kind: string
          period_start: string
          value: string
          visits: number
        }
        Insert: {
          audience: string
          dimension: string
          event: string
          events: number
          members: number
          period_kind: string
          period_start: string
          value?: string
          visits: number
        }
        Update: {
          audience?: string
          dimension?: string
          event?: string
          events?: number
          members?: number
          period_kind?: string
          period_start?: string
          value?: string
          visits?: number
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          acting_as_member_id: string | null
          action: string
          actor_kind: string
          changed_by: string | null
          changes: Json
          comment: string | null
          entity_id: string
          entity_label: string | null
          entity_type: string
          id: number
          member_id: string | null
          occurred_at: string
          txid: number
        }
        Insert: {
          acting_as_member_id?: string | null
          action: string
          actor_kind: string
          changed_by?: string | null
          changes: Json
          comment?: string | null
          entity_id: string
          entity_label?: string | null
          entity_type: string
          id?: never
          member_id?: string | null
          occurred_at?: string
          txid?: number
        }
        Update: {
          acting_as_member_id?: string | null
          action?: string
          actor_kind?: string
          changed_by?: string | null
          changes?: Json
          comment?: string | null
          entity_id?: string
          entity_label?: string | null
          entity_type?: string
          id?: never
          member_id?: string | null
          occurred_at?: string
          txid?: number
        }
        Relationships: []
      }
      badge_levels: {
        Row: {
          badge_type_id: string
          id: string
          level: number
          name: string
          threshold: number | null
        }
        Insert: {
          badge_type_id: string
          id?: string
          level: number
          name: string
          threshold?: number | null
        }
        Update: {
          badge_type_id?: string
          id?: string
          level?: number
          name?: string
          threshold?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "badge_levels_badge_type_id_fkey"
            columns: ["badge_type_id"]
            isOneToOne: false
            referencedRelation: "badge_types"
            referencedColumns: ["id"]
          },
        ]
      }
      badge_types: {
        Row: {
          category: string
          created_at: string
          description: string | null
          event_id: string | null
          has_levels: boolean
          icon: string
          id: string
          is_automatic: boolean
          key: string
          name: string
          program_id: string | null
          updated_at: string
        }
        Insert: {
          category?: string
          created_at?: string
          description?: string | null
          event_id?: string | null
          has_levels?: boolean
          icon?: string
          id?: string
          is_automatic?: boolean
          key: string
          name: string
          program_id?: string | null
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          description?: string | null
          event_id?: string | null
          has_levels?: boolean
          icon?: string
          id?: string
          is_automatic?: boolean
          key?: string
          name?: string
          program_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "badge_types_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "badge_types_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id"]
          },
        ]
      }
      big_sister_volunteers: {
        Row: {
          created_at: string
          deleted_at: string | null
          member_id: string
          note: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          member_id: string
          note?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          member_id?: string
          note?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "big_sister_volunteers_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: true
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_feed_items: {
        Row: {
          created_at: string
          created_by: string | null
          day_of_week: number | null
          event_id: string | null
          id: string
          kind: string
          member_id: string
          prickle_id: string | null
          start_time_local: string | null
          timezone: string | null
          type_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          day_of_week?: number | null
          event_id?: string | null
          id?: string
          kind: string
          member_id: string
          prickle_id?: string | null
          start_time_local?: string | null
          timezone?: string | null
          type_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          day_of_week?: number | null
          event_id?: string | null
          id?: string
          kind?: string
          member_id?: string
          prickle_id?: string | null
          start_time_local?: string | null
          timezone?: string | null
          type_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "calendar_feed_items_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_feed_items_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_feed_items_prickle_id_fkey"
            columns: ["prickle_id"]
            isOneToOne: false
            referencedRelation: "prickles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_feed_items_type_id_fkey"
            columns: ["type_id"]
            isOneToOne: false
            referencedRelation: "prickle_types"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_feed_tokens: {
        Row: {
          created_at: string
          first_fetched_at: string | null
          member_id: string
          token: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          first_fetched_at?: string | null
          member_id: string
          token: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          first_fetched_at?: string | null
          member_id?: string
          token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendar_feed_tokens_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: true
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_sync_state: {
        Row: {
          calendar_id: string
          rerun_requested: boolean
          running_since: string | null
          synced_through: string | null
        }
        Insert: {
          calendar_id: string
          rerun_requested?: boolean
          running_since?: string | null
          synced_through?: string | null
        }
        Update: {
          calendar_id?: string
          rerun_requested?: boolean
          running_since?: string | null
          synced_through?: string | null
        }
        Relationships: []
      }
      calendar_watch_channels: {
        Row: {
          calendar_id: string
          channel_id: string
          created_at: string
          expires_at: string
          id: string
          resource_id: string
          stopped_at: string | null
        }
        Insert: {
          calendar_id: string
          channel_id: string
          created_at?: string
          expires_at: string
          id?: string
          resource_id: string
          stopped_at?: string | null
        }
        Update: {
          calendar_id?: string
          channel_id?: string
          created_at?: string
          expires_at?: string
          id?: string
          resource_id?: string
          stopped_at?: string | null
        }
        Relationships: []
      }
      chat_channel_members: {
        Row: {
          channel_id: string
          joined_at: string
          last_read_at: string | null
          left_at: string | null
          member_id: string
          muted: boolean
          source: string
        }
        Insert: {
          channel_id: string
          joined_at?: string
          last_read_at?: string | null
          left_at?: string | null
          member_id: string
          muted?: boolean
          source?: string
        }
        Update: {
          channel_id?: string
          joined_at?: string
          last_read_at?: string | null
          left_at?: string | null
          member_id?: string
          muted?: boolean
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_channel_members_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "chat_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_channel_members_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_channels: {
        Row: {
          archived_at: string | null
          bridge_disabled: boolean
          bridge_mode: string
          bridge_status: string
          created_at: string
          id: string
          kind: string
          name: string | null
          purpose: string | null
          restricted: boolean
          slack_channel_id: string | null
          topic: string | null
          visibility: string
        }
        Insert: {
          archived_at?: string | null
          bridge_disabled?: boolean
          bridge_mode?: string
          bridge_status?: string
          created_at?: string
          id?: string
          kind: string
          name?: string | null
          purpose?: string | null
          restricted?: boolean
          slack_channel_id?: string | null
          topic?: string | null
          visibility: string
        }
        Update: {
          archived_at?: string | null
          bridge_disabled?: boolean
          bridge_mode?: string
          bridge_status?: string
          created_at?: string
          id?: string
          kind?: string
          name?: string | null
          purpose?: string | null
          restricted?: boolean
          slack_channel_id?: string | null
          topic?: string | null
          visibility?: string
        }
        Relationships: []
      }
      chat_gap_fills: {
        Row: {
          error: string | null
          finished_at: string | null
          id: string
          messages_recovered: number
          messages_seen: number
          reactions_recovered: number
          scope: string
          slack_channel_id: string
          slack_ts: string | null
          source: string
          started_at: string
        }
        Insert: {
          error?: string | null
          finished_at?: string | null
          id?: string
          messages_recovered?: number
          messages_seen?: number
          reactions_recovered?: number
          scope: string
          slack_channel_id: string
          slack_ts?: string | null
          source: string
          started_at?: string
        }
        Update: {
          error?: string | null
          finished_at?: string | null
          id?: string
          messages_recovered?: number
          messages_seen?: number
          reactions_recovered?: number
          scope?: string
          slack_channel_id?: string
          slack_ts?: string | null
          source?: string
          started_at?: string
        }
        Relationships: []
      }
      chat_message_contents: {
        Row: {
          attachments: Json | null
          blocks: Json | null
          body: string
          files: Json | null
          message_id: string
          search_vector: unknown
        }
        Insert: {
          attachments?: Json | null
          blocks?: Json | null
          body?: string
          files?: Json | null
          message_id: string
          search_vector?: unknown
        }
        Update: {
          attachments?: Json | null
          blocks?: Json | null
          body?: string
          files?: Json | null
          message_id?: string
          search_vector?: unknown
        }
        Relationships: [
          {
            foreignKeyName: "chat_message_contents_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: true
            referencedRelation: "chat_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_messages: {
        Row: {
          author_member_id: string | null
          channel_id: string
          created_at: string
          deleted_at: string | null
          edited_at: string | null
          has_files: boolean
          id: string
          last_reply_at: string | null
          origin: string
          posted_via: string | null
          reply_count: number
          slack_sync_status: string | null
          slack_ts: string | null
          system_subtype: string | null
          thread_root_id: string | null
        }
        Insert: {
          author_member_id?: string | null
          channel_id: string
          created_at: string
          deleted_at?: string | null
          edited_at?: string | null
          has_files?: boolean
          id?: string
          last_reply_at?: string | null
          origin?: string
          posted_via?: string | null
          reply_count?: number
          slack_sync_status?: string | null
          slack_ts?: string | null
          system_subtype?: string | null
          thread_root_id?: string | null
        }
        Update: {
          author_member_id?: string | null
          channel_id?: string
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          has_files?: boolean
          id?: string
          last_reply_at?: string | null
          origin?: string
          posted_via?: string | null
          reply_count?: number
          slack_sync_status?: string | null
          slack_ts?: string | null
          system_subtype?: string | null
          thread_root_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_author_member_id_fkey"
            columns: ["author_member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "chat_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_thread_root_id_fkey"
            columns: ["thread_root_id"]
            isOneToOne: false
            referencedRelation: "chat_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_reactions: {
        Row: {
          channel_id: string
          created_at: string
          deleted_at: string | null
          emoji: string
          id: string
          member_id: string | null
          message_id: string
          slack_user_id: string | null
          synced_to_slack: boolean
        }
        Insert: {
          channel_id: string
          created_at: string
          deleted_at?: string | null
          emoji: string
          id?: string
          member_id?: string | null
          message_id: string
          slack_user_id?: string | null
          synced_to_slack?: boolean
        }
        Update: {
          channel_id?: string
          created_at?: string
          deleted_at?: string | null
          emoji?: string
          id?: string
          member_id?: string | null
          message_id?: string
          slack_user_id?: string | null
          synced_to_slack?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "chat_reactions_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "chat_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_reactions_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_reactions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "chat_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_slack_authors: {
        Row: {
          member_id: string
          slack_user_id: string
          updated_at: string
        }
        Insert: {
          member_id: string
          slack_user_id: string
          updated_at?: string
        }
        Update: {
          member_id?: string
          slack_user_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_slack_authors_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      course_access: {
        Row: {
          course_id: string
          ends_at: string | null
          member_id: string
          origin: string
          starts_at: string
        }
        Insert: {
          course_id: string
          ends_at?: string | null
          member_id: string
          origin: string
          starts_at: string
        }
        Update: {
          course_id?: string
          ends_at?: string | null
          member_id?: string
          origin?: string
          starts_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "course_access_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "course_access_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      course_access_grants: {
        Row: {
          course_id: string
          created_at: string
          created_by: string | null
          ends_at: string | null
          id: string
          member_id: string
          reason: string | null
          starts_at: string
        }
        Insert: {
          course_id: string
          created_at?: string
          created_by?: string | null
          ends_at?: string | null
          id?: string
          member_id: string
          reason?: string | null
          starts_at?: string
        }
        Update: {
          course_id?: string
          created_at?: string
          created_by?: string | null
          ends_at?: string | null
          id?: string
          member_id?: string
          reason?: string | null
          starts_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "course_access_grants_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "course_access_grants_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      course_lesson_files: {
        Row: {
          content_hash: string | null
          content_type: string | null
          created_at: string
          filename: string
          id: string
          lesson_id: string
          position: number
          size_bytes: number | null
          source_key: string
          storage_path: string
        }
        Insert: {
          content_hash?: string | null
          content_type?: string | null
          created_at?: string
          filename: string
          id?: string
          lesson_id: string
          position?: number
          size_bytes?: number | null
          source_key: string
          storage_path: string
        }
        Update: {
          content_hash?: string | null
          content_type?: string | null
          created_at?: string
          filename?: string
          id?: string
          lesson_id?: string
          position?: number
          size_bytes?: number | null
          source_key?: string
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "course_lesson_files_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "course_lessons"
            referencedColumns: ["id"]
          },
        ]
      }
      course_lessons: {
        Row: {
          body_html: string | null
          course_id: string
          created_at: string
          duration_seconds: number | null
          excerpt: string | null
          id: string
          module_id: string | null
          position: number
          source: string
          source_key: string | null
          state: string
          thumbnail_asset_id: string | null
          thumbnail_source: string | null
          thumbnail_url: string | null
          title: string
          updated_at: string
          video_id: string | null
        }
        Insert: {
          body_html?: string | null
          course_id: string
          created_at?: string
          duration_seconds?: number | null
          excerpt?: string | null
          id?: string
          module_id?: string | null
          position?: number
          source?: string
          source_key?: string | null
          state?: string
          thumbnail_asset_id?: string | null
          thumbnail_source?: string | null
          thumbnail_url?: string | null
          title: string
          updated_at?: string
          video_id?: string | null
        }
        Update: {
          body_html?: string | null
          course_id?: string
          created_at?: string
          duration_seconds?: number | null
          excerpt?: string | null
          id?: string
          module_id?: string | null
          position?: number
          source?: string
          source_key?: string | null
          state?: string
          thumbnail_asset_id?: string | null
          thumbnail_source?: string | null
          thumbnail_url?: string | null
          title?: string
          updated_at?: string
          video_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "course_lessons_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "course_lessons_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "course_modules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "course_lessons_thumbnail_asset_id_fkey"
            columns: ["thumbnail_asset_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "course_lessons_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: false
            referencedRelation: "videos"
            referencedColumns: ["id"]
          },
        ]
      }
      course_modules: {
        Row: {
          course_id: string
          created_at: string
          id: string
          parent_id: string | null
          position: number
          poster_asset_id: string | null
          poster_source: string | null
          poster_url: string | null
          source: string
          source_key: string | null
          state: string
          title: string
          updated_at: string
        }
        Insert: {
          course_id: string
          created_at?: string
          id?: string
          parent_id?: string | null
          position?: number
          poster_asset_id?: string | null
          poster_source?: string | null
          poster_url?: string | null
          source?: string
          source_key?: string | null
          state?: string
          title: string
          updated_at?: string
        }
        Update: {
          course_id?: string
          created_at?: string
          id?: string
          parent_id?: string | null
          position?: number
          poster_asset_id?: string | null
          poster_source?: string | null
          poster_url?: string | null
          source?: string
          source_key?: string | null
          state?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "course_modules_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "course_modules_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "course_modules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "course_modules_poster_asset_id_fkey"
            columns: ["poster_asset_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
        ]
      }
      courses: {
        Row: {
          access_duration: string | null
          created_at: string
          description: string | null
          hero_asset_id: string | null
          hero_source: string | null
          hero_url: string | null
          id: string
          kind: string
          launch_at: string | null
          program_id: string | null
          slug: string
          source: string
          source_key: string | null
          thumbnail_asset_id: string | null
          thumbnail_source: string | null
          thumbnail_url: string | null
          title: string
          updated_at: string
        }
        Insert: {
          access_duration?: string | null
          created_at?: string
          description?: string | null
          hero_asset_id?: string | null
          hero_source?: string | null
          hero_url?: string | null
          id?: string
          kind?: string
          launch_at?: string | null
          program_id?: string | null
          slug: string
          source?: string
          source_key?: string | null
          thumbnail_asset_id?: string | null
          thumbnail_source?: string | null
          thumbnail_url?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          access_duration?: string | null
          created_at?: string
          description?: string | null
          hero_asset_id?: string | null
          hero_source?: string | null
          hero_url?: string | null
          id?: string
          kind?: string
          launch_at?: string | null
          program_id?: string | null
          slug?: string
          source?: string
          source_key?: string | null
          thumbnail_asset_id?: string | null
          thumbnail_source?: string | null
          thumbnail_url?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "courses_hero_asset_id_fkey"
            columns: ["hero_asset_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courses_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courses_thumbnail_asset_id_fkey"
            columns: ["thumbnail_asset_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
        ]
      }
      dismissed_duplicate_groups: {
        Row: {
          dismissed_at: string
          group_key: string
        }
        Insert: {
          dismissed_at?: string
          group_key: string
        }
        Update: {
          dismissed_at?: string
          group_key?: string
        }
        Relationships: []
      }
      event_attendees: {
        Row: {
          created_at: string
          created_by: string | null
          event_id: string
          id: string
          member_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          event_id: string
          id?: string
          member_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          event_id?: string
          id?: string
          member_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_attendees_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_attendees_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      event_photos: {
        Row: {
          created_at: string
          event_id: string
          google_media_item_id: string
          height: number | null
          hidden_at: string | null
          id: string
          mime_type: string | null
          storage_path: string
          taken_at: string | null
          width: number | null
        }
        Insert: {
          created_at?: string
          event_id: string
          google_media_item_id: string
          height?: number | null
          hidden_at?: string | null
          id?: string
          mime_type?: string | null
          storage_path: string
          taken_at?: string | null
          width?: number | null
        }
        Update: {
          created_at?: string
          event_id?: string
          google_media_item_id?: string
          height?: number | null
          hidden_at?: string | null
          id?: string
          mime_type?: string | null
          storage_path?: string
          taken_at?: string | null
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "event_photos_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          agenda: string | null
          announced_publicly: boolean
          automatic: boolean
          calendar_event_id: string | null
          capacity: number | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          description: string | null
          end_time: string | null
          ends_at: string
          event_type: string
          focus: string | null
          google_photos_album_url: string | null
          guests_allowed: boolean
          host_name: string | null
          id: string
          image_id: string | null
          location: string | null
          overridden_fields: string[]
          registration: string
          results: string | null
          selection: string
          slug: string
          speakers: string | null
          start_time: string | null
          starts_at: string
          title: string
          updated_at: string
        }
        Insert: {
          agenda?: string | null
          announced_publicly?: boolean
          automatic?: boolean
          calendar_event_id?: string | null
          capacity?: number | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          end_time?: string | null
          ends_at: string
          event_type: string
          focus?: string | null
          google_photos_album_url?: string | null
          guests_allowed?: boolean
          host_name?: string | null
          id?: string
          image_id?: string | null
          location?: string | null
          overridden_fields?: string[]
          registration?: string
          results?: string | null
          selection?: string
          slug: string
          speakers?: string | null
          start_time?: string | null
          starts_at: string
          title: string
          updated_at?: string
        }
        Update: {
          agenda?: string | null
          announced_publicly?: boolean
          automatic?: boolean
          calendar_event_id?: string | null
          capacity?: number | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          end_time?: string | null
          ends_at?: string
          event_type?: string
          focus?: string | null
          google_photos_album_url?: string | null
          guests_allowed?: boolean
          host_name?: string | null
          id?: string
          image_id?: string | null
          location?: string | null
          overridden_fields?: string[]
          registration?: string
          results?: string | null
          selection?: string
          slug?: string
          speakers?: string | null
          start_time?: string | null
          starts_at?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "events_image_id_fkey"
            columns: ["image_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
        ]
      }
      feature_flag_segments: {
        Row: {
          created_at: string
          feature_key: string
          segment_id: string
        }
        Insert: {
          created_at?: string
          feature_key: string
          segment_id: string
        }
        Update: {
          created_at?: string
          feature_key?: string
          segment_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "feature_flag_segments_feature_key_fkey"
            columns: ["feature_key"]
            isOneToOne: false
            referencedRelation: "feature_flags"
            referencedColumns: ["feature_key"]
          },
          {
            foreignKeyName: "feature_flag_segments_segment_id_fkey"
            columns: ["segment_id"]
            isOneToOne: false
            referencedRelation: "segments"
            referencedColumns: ["id"]
          },
        ]
      }
      feature_flags: {
        Row: {
          created_at: string
          enabled_globally: boolean
          feature_key: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          enabled_globally?: boolean
          feature_key: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          enabled_globally?: boolean
          feature_key?: string
          updated_at?: string
        }
        Relationships: []
      }
      feedback: {
        Row: {
          admin_notes: string | null
          created_at: string
          feedback_type: string
          id: string
          is_sudo: boolean
          member_id: string | null
          message: string
          page_url: string
          screenshot_path: string | null
          status: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          admin_notes?: string | null
          created_at?: string
          feedback_type: string
          id?: string
          is_sudo?: boolean
          member_id?: string | null
          message: string
          page_url: string
          screenshot_path?: string | null
          status?: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          admin_notes?: string | null
          created_at?: string
          feedback_type?: string
          id?: string
          is_sudo?: boolean
          member_id?: string | null
          message?: string
          page_url?: string
          screenshot_path?: string | null
          status?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "feedback_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      ignored_slack_users: {
        Row: {
          created_at: string | null
          reason: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          reason?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          reason?: string | null
          user_id?: string
        }
        Relationships: []
      }
      ignored_zoom_appearances: {
        Row: {
          id: string
          ignored_at: string
          ignored_by: string | null
          prickle_id: string
          reason: string | null
          zoom_name: string
        }
        Insert: {
          id?: string
          ignored_at?: string
          ignored_by?: string | null
          prickle_id: string
          reason?: string | null
          zoom_name: string
        }
        Update: {
          id?: string
          ignored_at?: string
          ignored_by?: string | null
          prickle_id?: string
          reason?: string | null
          zoom_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "ignored_zoom_appearances_prickle_id_fkey"
            columns: ["prickle_id"]
            isOneToOne: false
            referencedRelation: "prickles"
            referencedColumns: ["id"]
          },
        ]
      }
      ignored_zoom_names: {
        Row: {
          created_at: string | null
          id: string
          ignored_at: string | null
          ignored_by: string | null
          reason: string | null
          zoom_name: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          ignored_at?: string | null
          ignored_by?: string | null
          reason?: string | null
          zoom_name: string
        }
        Update: {
          created_at?: string | null
          id?: string
          ignored_at?: string | null
          ignored_by?: string | null
          reason?: string | null
          zoom_name?: string
        }
        Relationships: []
      }
      in_app_notifications: {
        Row: {
          banner_until: string | null
          created_at: string
          id: string
          kind: string
          member_id: string
          read_at: string | null
          ref: string | null
          text: string
          url: string | null
        }
        Insert: {
          banner_until?: string | null
          created_at?: string
          id?: string
          kind: string
          member_id: string
          read_at?: string | null
          ref?: string | null
          text: string
          url?: string | null
        }
        Update: {
          banner_until?: string | null
          created_at?: string
          id?: string
          kind?: string
          member_id?: string
          read_at?: string | null
          ref?: string | null
          text?: string
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "in_app_notifications_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      lesson_progress: {
        Row: {
          completed_at: string | null
          created_at: string
          imported_from: string | null
          last_position_seconds: number
          lesson_id: string
          member_id: string
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          imported_from?: string | null
          last_position_seconds?: number
          lesson_id: string
          member_id: string
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          imported_from?: string | null
          last_position_seconds?: number
          lesson_id?: string
          member_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lesson_progress_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "course_lessons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lesson_progress_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      media_assets: {
        Row: {
          alt_text: string | null
          bytes: number
          created_at: string
          created_by: string | null
          deleted_at: string | null
          files_removed_at: string | null
          fits: Json
          focal_x: number | null
          focal_y: number | null
          height: number
          id: string
          is_public: boolean
          kind: string
          mime_type: string
          owner_member_id: string | null
          sha256: string
          source: string
          source_key: string | null
          storage_path: string
          tags: string[]
          title: string
          updated_at: string
          width: number
        }
        Insert: {
          alt_text?: string | null
          bytes: number
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          files_removed_at?: string | null
          fits?: Json
          focal_x?: number | null
          focal_y?: number | null
          height: number
          id?: string
          is_public?: boolean
          kind?: string
          mime_type: string
          owner_member_id?: string | null
          sha256: string
          source?: string
          source_key?: string | null
          storage_path: string
          tags?: string[]
          title: string
          updated_at?: string
          width: number
        }
        Update: {
          alt_text?: string | null
          bytes?: number
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          files_removed_at?: string | null
          fits?: Json
          focal_x?: number | null
          focal_y?: number | null
          height?: number
          id?: string
          is_public?: boolean
          kind?: string
          mime_type?: string
          owner_member_id?: string | null
          sha256?: string
          source?: string
          source_key?: string | null
          storage_path?: string
          tags?: string[]
          title?: string
          updated_at?: string
          width?: number
        }
        Relationships: [
          {
            foreignKeyName: "media_assets_owner_member_id_fkey"
            columns: ["owner_member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      member_activities: {
        Row: {
          acting_as_member_id: string | null
          activity_category: string
          activity_type: string
          actor_kind: string
          actor_user_id: string | null
          created_at: string | null
          data: Json | null
          description: string | null
          duration_minutes: number | null
          engagement_value: number | null
          id: string
          member_id: string
          occurred_at: string
          prickle_id: string | null
          related_id: string | null
          source: string
          title: string
        }
        Insert: {
          acting_as_member_id?: string | null
          activity_category: string
          activity_type: string
          actor_kind?: string
          actor_user_id?: string | null
          created_at?: string | null
          data?: Json | null
          description?: string | null
          duration_minutes?: number | null
          engagement_value?: number | null
          id?: string
          member_id: string
          occurred_at: string
          prickle_id?: string | null
          related_id?: string | null
          source: string
          title: string
        }
        Update: {
          acting_as_member_id?: string | null
          activity_category?: string
          activity_type?: string
          actor_kind?: string
          actor_user_id?: string | null
          created_at?: string | null
          data?: Json | null
          description?: string | null
          duration_minutes?: number | null
          engagement_value?: number | null
          id?: string
          member_id?: string
          occurred_at?: string
          prickle_id?: string | null
          related_id?: string | null
          source?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_activities_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_activities_prickle_id_fkey"
            columns: ["prickle_id"]
            isOneToOne: false
            referencedRelation: "prickles"
            referencedColumns: ["id"]
          },
        ]
      }
      member_ask_me_about: {
        Row: {
          created_at: string
          member_id: string
          topics: string[]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          member_id: string
          topics?: string[]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          member_id?: string
          topics?: string[]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "member_ask_me_about_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: true
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      member_awards: {
        Row: {
          award_date: string
          award_name: string
          book_id: string | null
          category: string | null
          created_at: string
          deleted_at: string | null
          id: string
          member_id: string
          notes: string | null
          project_id: string | null
          url: string | null
          work_title: string
        }
        Insert: {
          award_date: string
          award_name: string
          book_id?: string | null
          category?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          member_id: string
          notes?: string | null
          project_id?: string | null
          url?: string | null
          work_title: string
        }
        Update: {
          award_date?: string
          award_name?: string
          book_id?: string | null
          category?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          member_id?: string
          notes?: string | null
          project_id?: string | null
          url?: string | null
          work_title?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_awards_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "member_books"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_awards_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_awards_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "writing_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      member_badges: {
        Row: {
          awarded_by: string | null
          badge_type_id: string
          created_at: string
          event_id: string | null
          id: string
          member_id: string
          note: string | null
          occurred_at: string
        }
        Insert: {
          awarded_by?: string | null
          badge_type_id: string
          created_at?: string
          event_id?: string | null
          id?: string
          member_id: string
          note?: string | null
          occurred_at?: string
        }
        Update: {
          awarded_by?: string | null
          badge_type_id?: string
          created_at?: string
          event_id?: string | null
          id?: string
          member_id?: string
          note?: string | null
          occurred_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_badges_badge_type_id_fkey"
            columns: ["badge_type_id"]
            isOneToOne: false
            referencedRelation: "badge_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_badges_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_badges_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      member_books: {
        Row: {
          cover_asset_id: string | null
          cover_url: string
          created_at: string
          deleted_at: string | null
          description: string | null
          format: string
          genre: string | null
          id: string
          member_id: string
          pen_name: string | null
          price: number | null
          project_id: string | null
          published_date: string
          purchase_url: string
          title: string
          book_member: {
            bio: string | null
            display_name: string | null
            facebook_url: string | null
            first_joined_at: string | null
            id: string
            instagram_url: string | null
            joined_at: string
            most_recent_joined_at: string | null
            name: string
            photo_url: string | null
            total_active_months: number
            twitter_url: string | null
          } | null
        }
        Insert: {
          cover_asset_id?: string | null
          cover_url: string
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          format?: string
          genre?: string | null
          id?: string
          member_id: string
          pen_name?: string | null
          price?: number | null
          project_id?: string | null
          published_date: string
          purchase_url: string
          title: string
        }
        Update: {
          cover_asset_id?: string | null
          cover_url?: string
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          format?: string
          genre?: string | null
          id?: string
          member_id?: string
          pen_name?: string | null
          price?: number | null
          project_id?: string | null
          published_date?: string
          purchase_url?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_books_cover_asset_id_fkey"
            columns: ["cover_asset_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_books_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_books_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "writing_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      member_directory: {
        Row: {
          bio: string | null
          display_name: string | null
          facebook_url: string | null
          first_joined_at: string | null
          id: string
          instagram_url: string | null
          joined_at: string
          most_recent_joined_at: string | null
          name: string
          photo_url: string | null
          total_active_months: number
          twitter_url: string | null
        }
        Insert: {
          bio?: string | null
          display_name?: string | null
          facebook_url?: string | null
          first_joined_at?: string | null
          id: string
          instagram_url?: string | null
          joined_at: string
          most_recent_joined_at?: string | null
          name: string
          photo_url?: string | null
          total_active_months?: number
          twitter_url?: string | null
        }
        Update: {
          bio?: string | null
          display_name?: string | null
          facebook_url?: string | null
          first_joined_at?: string | null
          id?: string
          instagram_url?: string | null
          joined_at?: string
          most_recent_joined_at?: string | null
          name?: string
          photo_url?: string | null
          total_active_months?: number
          twitter_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "member_directory_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      member_email_aliases: {
        Row: {
          active: boolean
          alias_email: string
          canonical_email: string
          created_at: string | null
          id: string
          member_id: string
          source: string
        }
        Insert: {
          active?: boolean
          alias_email: string
          canonical_email: string
          created_at?: string | null
          id?: string
          member_id: string
          source: string
        }
        Update: {
          active?: boolean
          alias_email?: string
          canonical_email?: string
          created_at?: string | null
          id?: string
          member_id?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_email_aliases_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      member_engagement: {
        Row: {
          churn_probability: number | null
          engagement_tier: string
          member_id: string
          risk_level: string
          updated_at: string | null
        }
        Insert: {
          churn_probability?: number | null
          engagement_tier: string
          member_id: string
          risk_level: string
          updated_at?: string | null
        }
        Update: {
          churn_probability?: number | null
          engagement_tier?: string
          member_id?: string
          risk_level?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "member_engagement_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: true
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      member_hiatus_history: {
        Row: {
          created_at: string | null
          created_by: string | null
          end_date: string | null
          id: string
          member_id: string
          notes: string | null
          reason: string | null
          start_date: string
          updated_at: string
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          end_date?: string | null
          id?: string
          member_id: string
          notes?: string | null
          reason?: string | null
          start_date: string
          updated_at?: string
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          end_date?: string | null
          id?: string
          member_id?: string
          notes?: string | null
          reason?: string | null
          start_date?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_hiatus_history_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      member_interactions: {
        Row: {
          channel_id: string | null
          id: string
          kind: string
          member_a: string
          member_b: string
          message_id: string | null
          occurred_at: string
          visibility: string
        }
        Insert: {
          channel_id?: string | null
          id?: string
          kind: string
          member_a: string
          member_b: string
          message_id?: string | null
          occurred_at: string
          visibility: string
        }
        Update: {
          channel_id?: string | null
          id?: string
          kind?: string
          member_a?: string
          member_b?: string
          message_id?: string | null
          occurred_at?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_interactions_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "chat_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_interactions_member_a_fkey"
            columns: ["member_a"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_interactions_member_b_fkey"
            columns: ["member_b"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_interactions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "chat_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      member_join_date_overrides: {
        Row: {
          created_at: string
          first_joined_at: string
          member_id: string
          reason: string | null
        }
        Insert: {
          created_at?: string
          first_joined_at: string
          member_id: string
          reason?: string | null
        }
        Update: {
          created_at?: string
          first_joined_at?: string
          member_id?: string
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "member_join_date_overrides_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: true
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      member_metrics: {
        Row: {
          engagement_score: number | null
          last_attended_at: string | null
          member_id: string
          prickles_last_30_days: number | null
          prickles_last_7_days: number | null
          total_prickles: number | null
          updated_at: string | null
        }
        Insert: {
          engagement_score?: number | null
          last_attended_at?: string | null
          member_id: string
          prickles_last_30_days?: number | null
          prickles_last_7_days?: number | null
          total_prickles?: number | null
          updated_at?: string | null
        }
        Update: {
          engagement_score?: number | null
          last_attended_at?: string | null
          member_id?: string
          prickles_last_30_days?: number | null
          prickles_last_7_days?: number | null
          total_prickles?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "member_metrics_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: true
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      member_name_aliases: {
        Row: {
          active: boolean
          alias: string
          created_at: string | null
          id: string
          member_id: string
          source: string
        }
        Insert: {
          active?: boolean
          alias: string
          created_at?: string | null
          id?: string
          member_id: string
          source?: string
        }
        Update: {
          active?: boolean
          alias?: string
          created_at?: string | null
          id?: string
          member_id?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_name_aliases_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      member_notes: {
        Row: {
          author_member_id: string
          body: string
          created_at: string
          subject_member_id: string
          updated_at: string
        }
        Insert: {
          author_member_id: string
          body: string
          created_at?: string
          subject_member_id: string
          updated_at?: string
        }
        Update: {
          author_member_id?: string
          body?: string
          created_at?: string
          subject_member_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_notes_author_member_id_fkey"
            columns: ["author_member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_notes_subject_member_id_fkey"
            columns: ["subject_member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      member_onboarding: {
        Row: {
          acknowledged_steps: string[] | null
          completed_at: string | null
          created_at: string
          dismissed_at: string | null
          marked_steps: string[]
          member_id: string
          updated_at: string
        }
        Insert: {
          acknowledged_steps?: string[] | null
          completed_at?: string | null
          created_at?: string
          dismissed_at?: string | null
          marked_steps?: string[]
          member_id: string
          updated_at?: string
        }
        Update: {
          acknowledged_steps?: string[] | null
          completed_at?: string | null
          created_at?: string
          dismissed_at?: string | null
          marked_steps?: string[]
          member_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_onboarding_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: true
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      member_profile_overrides: {
        Row: {
          bio: string | null
          created_at: string
          facebook_url: string | null
          instagram_url: string | null
          member_id: string
          twitter_url: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          bio?: string | null
          created_at?: string
          facebook_url?: string | null
          instagram_url?: string | null
          member_id: string
          twitter_url?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          bio?: string | null
          created_at?: string
          facebook_url?: string | null
          instagram_url?: string | null
          member_id?: string
          twitter_url?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "member_profile_overrides_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: true
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      member_program_enrollments: {
        Row: {
          cohort_id: string
          created_at: string
          created_by: string | null
          id: string
          member_id: string
          notes: string | null
          updated_at: string
        }
        Insert: {
          cohort_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          member_id: string
          notes?: string | null
          updated_at?: string
        }
        Update: {
          cohort_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          member_id?: string
          notes?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_program_enrollments_cohort_id_fkey"
            columns: ["cohort_id"]
            isOneToOne: false
            referencedRelation: "program_cohorts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_program_enrollments_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      member_reminder_log: {
        Row: {
          id: string
          kind: string
          member_id: string
          sent_at: string
          sent_on: string
        }
        Insert: {
          id?: string
          kind: string
          member_id: string
          sent_at?: string
          sent_on?: string
        }
        Update: {
          id?: string
          kind?: string
          member_id?: string
          sent_at?: string
          sent_on?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_reminder_log_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      member_roster_opt_outs: {
        Row: {
          created_at: string
          member_id: string
        }
        Insert: {
          created_at?: string
          member_id: string
        }
        Update: {
          created_at?: string
          member_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_roster_opt_outs_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: true
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      member_slack_connections: {
        Row: {
          access_secret_id: string | null
          connected_at: string
          expires_at: string | null
          member_id: string
          read_pulled_at: string | null
          refresh_secret_id: string | null
          revoked_at: string | null
          scopes: string[]
          slack_user_id: string
          team_id: string | null
        }
        Insert: {
          access_secret_id?: string | null
          connected_at?: string
          expires_at?: string | null
          member_id: string
          read_pulled_at?: string | null
          refresh_secret_id?: string | null
          revoked_at?: string | null
          scopes?: string[]
          slack_user_id: string
          team_id?: string | null
        }
        Update: {
          access_secret_id?: string | null
          connected_at?: string
          expires_at?: string | null
          member_id?: string
          read_pulled_at?: string | null
          refresh_secret_id?: string | null
          revoked_at?: string | null
          scopes?: string[]
          slack_user_id?: string
          team_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "member_slack_connections_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: true
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      member_status_overrides: {
        Row: {
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          member_id: string | null
          notes: string | null
          override_type: string
          reason: string
          starts_at: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          member_id?: string | null
          notes?: string | null
          override_type: string
          reason: string
          starts_at?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          member_id?: string | null
          notes?: string | null
          override_type?: string
          reason?: string
          starts_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_status_overrides_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      members: {
        Row: {
          bio: string | null
          birthday_day: number | null
          birthday_month: number | null
          created_at: string | null
          display_name: string | null
          email: string
          facebook_url: string | null
          first_joined_at: string | null
          has_trialed: boolean
          id: string
          instagram_url: string | null
          is_trial: boolean
          joined_at: string
          kajabi_id: string | null
          kajabi_tags: string[]
          most_recent_joined_at: string | null
          name: string
          photo_url: string | null
          plan: string | null
          raw_payload: Json | null
          self_service_name_changed_at: string | null
          source: string
          staff_role: string | null
          status: string
          stripe_customer_id: string | null
          total_active_months: number
          twitter_url: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          bio?: string | null
          birthday_day?: number | null
          birthday_month?: number | null
          created_at?: string | null
          display_name?: string | null
          email: string
          facebook_url?: string | null
          first_joined_at?: string | null
          has_trialed?: boolean
          id?: string
          instagram_url?: string | null
          is_trial?: boolean
          joined_at: string
          kajabi_id?: string | null
          kajabi_tags?: string[]
          most_recent_joined_at?: string | null
          name: string
          photo_url?: string | null
          plan?: string | null
          raw_payload?: Json | null
          self_service_name_changed_at?: string | null
          source?: string
          staff_role?: string | null
          status: string
          stripe_customer_id?: string | null
          total_active_months?: number
          twitter_url?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          bio?: string | null
          birthday_day?: number | null
          birthday_month?: number | null
          created_at?: string | null
          display_name?: string | null
          email?: string
          facebook_url?: string | null
          first_joined_at?: string | null
          has_trialed?: boolean
          id?: string
          instagram_url?: string | null
          is_trial?: boolean
          joined_at?: string
          kajabi_id?: string | null
          kajabi_tags?: string[]
          most_recent_joined_at?: string | null
          name?: string
          photo_url?: string | null
          plan?: string | null
          raw_payload?: Json | null
          self_service_name_changed_at?: string | null
          source?: string
          staff_role?: string | null
          status?: string
          stripe_customer_id?: string | null
          total_active_months?: number
          twitter_url?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      mentorships: {
        Row: {
          created_at: string
          id: string
          kind: string
          mentor_member_id: string
          new_member_id: string
          outcome_note: string | null
          started_on: string
          status: string
          trial_ends_on: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          kind?: string
          mentor_member_id: string
          new_member_id: string
          outcome_note?: string | null
          started_on: string
          status?: string
          trial_ends_on?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          mentor_member_id?: string
          new_member_id?: string
          outcome_note?: string | null
          started_on?: string
          status?: string
          trial_ends_on?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mentorships_mentor_member_id_fkey"
            columns: ["mentor_member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mentorships_new_member_id_fkey"
            columns: ["new_member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_preferences: {
        Row: {
          channel: string
          created_at: string
          enabled: boolean
          kind: string
          member_id: string
          updated_at: string
        }
        Insert: {
          channel: string
          created_at?: string
          enabled: boolean
          kind: string
          member_id: string
          updated_at?: string
        }
        Update: {
          channel?: string
          created_at?: string
          enabled?: boolean
          kind?: string
          member_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_preferences_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      outreach_leads: {
        Row: {
          created_at: string
          member_id: string
          status: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          member_id: string
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          member_id?: string
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "outreach_leads_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: true
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      outreach_prospects: {
        Row: {
          ai_assessed_at: string | null
          ai_assessment: Json | null
          bio: string | null
          created_at: string
          created_by: string | null
          external_url: string | null
          fit_reasons: string[]
          fit_score: number
          follower_count: number | null
          handle: string
          hashtags: string[]
          id: string
          platform: string
          reject_reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          scored_at: string
          source: string
          source_note: string | null
          status: string
          updated_at: string
        }
        Insert: {
          ai_assessed_at?: string | null
          ai_assessment?: Json | null
          bio?: string | null
          created_at?: string
          created_by?: string | null
          external_url?: string | null
          fit_reasons?: string[]
          fit_score?: number
          follower_count?: number | null
          handle: string
          hashtags?: string[]
          id?: string
          platform?: string
          reject_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          scored_at?: string
          source?: string
          source_note?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          ai_assessed_at?: string | null
          ai_assessment?: Json | null
          bio?: string | null
          created_at?: string
          created_by?: string | null
          external_url?: string | null
          fit_reasons?: string[]
          fit_score?: number
          follower_count?: number | null
          handle?: string
          hashtags?: string[]
          id?: string
          platform?: string
          reject_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          scored_at?: string
          source?: string
          source_note?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      outreach_touches: {
        Row: {
          id: string
          member_id: string
          touched_at: string
          touched_by: string | null
        }
        Insert: {
          id?: string
          member_id: string
          touched_at?: string
          touched_by?: string | null
        }
        Update: {
          id?: string
          member_id?: string
          touched_at?: string
          touched_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "outreach_touches_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      prickle_attendance: {
        Row: {
          confidence_score: string
          created_at: string | null
          id: string
          join_time: string
          leave_time: string
          member_id: string
          prickle_id: string
          attendance_member: {
            bio: string | null
            display_name: string | null
            facebook_url: string | null
            first_joined_at: string | null
            id: string
            instagram_url: string | null
            joined_at: string
            most_recent_joined_at: string | null
            name: string
            photo_url: string | null
            total_active_months: number
            twitter_url: string | null
          } | null
        }
        Insert: {
          confidence_score: string
          created_at?: string | null
          id?: string
          join_time: string
          leave_time: string
          member_id: string
          prickle_id: string
        }
        Update: {
          confidence_score?: string
          created_at?: string | null
          id?: string
          join_time?: string
          leave_time?: string
          member_id?: string
          prickle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_prickle_id_fkey"
            columns: ["prickle_id"]
            isOneToOne: false
            referencedRelation: "prickles"
            referencedColumns: ["id"]
          },
        ]
      }
      prickle_checkin_dismissals: {
        Row: {
          dismissed_at: string
          id: string
          member_id: string
          prickle_id: string
        }
        Insert: {
          dismissed_at?: string
          id?: string
          member_id: string
          prickle_id: string
        }
        Update: {
          dismissed_at?: string
          id?: string
          member_id?: string
          prickle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "prickle_checkin_dismissals_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prickle_checkin_dismissals_prickle_id_fkey"
            columns: ["prickle_id"]
            isOneToOne: false
            referencedRelation: "prickles"
            referencedColumns: ["id"]
          },
        ]
      }
      prickle_checkin_dm_log: {
        Row: {
          id: string
          kind: string
          member_id: string
          prickle_id: string
          sent_at: string
        }
        Insert: {
          id?: string
          kind: string
          member_id: string
          prickle_id: string
          sent_at?: string
        }
        Update: {
          id?: string
          kind?: string
          member_id?: string
          prickle_id?: string
          sent_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "prickle_checkin_dm_log_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prickle_checkin_dm_log_prickle_id_fkey"
            columns: ["prickle_id"]
            isOneToOne: false
            referencedRelation: "prickles"
            referencedColumns: ["id"]
          },
        ]
      }
      prickle_checkins: {
        Row: {
          created_at: string
          deleted_at: string | null
          emotion_after: string | null
          emotion_before: string | null
          energy_after: number | null
          energy_before: number | null
          id: string
          intention_met: number | null
          member_id: string
          need: string | null
          pleasant_after: number | null
          pleasant_before: number | null
          prickle_id: string
          saved_via: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          emotion_after?: string | null
          emotion_before?: string | null
          energy_after?: number | null
          energy_before?: number | null
          id?: string
          intention_met?: number | null
          member_id: string
          need?: string | null
          pleasant_after?: number | null
          pleasant_before?: number | null
          prickle_id: string
          saved_via?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          emotion_after?: string | null
          emotion_before?: string | null
          energy_after?: number | null
          energy_before?: number | null
          id?: string
          intention_met?: number | null
          member_id?: string
          need?: string | null
          pleasant_after?: number | null
          pleasant_before?: number | null
          prickle_id?: string
          saved_via?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "prickle_checkins_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prickle_checkins_prickle_id_fkey"
            columns: ["prickle_id"]
            isOneToOne: false
            referencedRelation: "prickles"
            referencedColumns: ["id"]
          },
        ]
      }
      prickle_checkout_dismissals: {
        Row: {
          dismissed_at: string
          id: string
          member_id: string
          prickle_id: string
        }
        Insert: {
          dismissed_at?: string
          id?: string
          member_id: string
          prickle_id: string
        }
        Update: {
          dismissed_at?: string
          id?: string
          member_id?: string
          prickle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "writing_prompt_dismissals_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "writing_prompt_dismissals_prickle_id_fkey"
            columns: ["prickle_id"]
            isOneToOne: false
            referencedRelation: "prickles"
            referencedColumns: ["id"]
          },
        ]
      }
      prickle_commitment_slots: {
        Row: {
          commitment_id: string
          created_at: string
          day_of_week: number
          id: string
          start_time_local: string
          timezone: string
          type_id: string
        }
        Insert: {
          commitment_id: string
          created_at?: string
          day_of_week: number
          id?: string
          start_time_local: string
          timezone?: string
          type_id: string
        }
        Update: {
          commitment_id?: string
          created_at?: string
          day_of_week?: number
          id?: string
          start_time_local?: string
          timezone?: string
          type_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "prickle_commitment_slots_commitment_id_fkey"
            columns: ["commitment_id"]
            isOneToOne: false
            referencedRelation: "prickle_commitments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prickle_commitment_slots_type_id_fkey"
            columns: ["type_id"]
            isOneToOne: false
            referencedRelation: "prickle_types"
            referencedColumns: ["id"]
          },
        ]
      }
      prickle_commitments: {
        Row: {
          cancelled_at: string | null
          created_at: string
          created_by: string | null
          end_date: string | null
          id: string
          member_id: string
          start_date: string
          status: string
          updated_at: string
          weeks: number
        }
        Insert: {
          cancelled_at?: string | null
          created_at?: string
          created_by?: string | null
          end_date?: string | null
          id?: string
          member_id: string
          start_date: string
          status?: string
          updated_at?: string
          weeks?: number
        }
        Update: {
          cancelled_at?: string | null
          created_at?: string
          created_by?: string | null
          end_date?: string | null
          id?: string
          member_id?: string
          start_date?: string
          status?: string
          updated_at?: string
          weeks?: number
        }
        Relationships: [
          {
            foreignKeyName: "prickle_commitments_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      prickle_host_vibes: {
        Row: {
          host_id: string
          id: string
          notes: string | null
          type_id: string
          updated_at: string
          updated_by: string | null
          vibe: string
        }
        Insert: {
          host_id: string
          id?: string
          notes?: string | null
          type_id: string
          updated_at?: string
          updated_by?: string | null
          vibe?: string
        }
        Update: {
          host_id?: string
          id?: string
          notes?: string | null
          type_id?: string
          updated_at?: string
          updated_by?: string | null
          vibe?: string
        }
        Relationships: [
          {
            foreignKeyName: "prickle_host_vibes_host_id_fkey"
            columns: ["host_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prickle_host_vibes_type_id_fkey"
            columns: ["type_id"]
            isOneToOne: false
            referencedRelation: "prickle_types"
            referencedColumns: ["id"]
          },
        ]
      }
      prickle_join_settings: {
        Row: {
          created_at: string
          created_by: string | null
          effective_from: string
          id: string
          join_url: string
          meeting_id: string | null
          passcode: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          effective_from?: string
          id?: string
          join_url: string
          meeting_id?: string | null
          passcode?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          effective_from?: string
          id?: string
          join_url?: string
          meeting_id?: string | null
          passcode?: string | null
        }
        Relationships: []
      }
      prickle_popularity: {
        Row: {
          avg_attendance: number | null
          last_5_attendance: number[] | null
          prickle_id: string
          trend: string | null
          updated_at: string | null
        }
        Insert: {
          avg_attendance?: number | null
          last_5_attendance?: number[] | null
          prickle_id: string
          trend?: string | null
          updated_at?: string | null
        }
        Update: {
          avg_attendance?: number | null
          last_5_attendance?: number[] | null
          prickle_id?: string
          trend?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "prickle_popularity_prickle_id_fkey"
            columns: ["prickle_id"]
            isOneToOne: true
            referencedRelation: "prickles"
            referencedColumns: ["id"]
          },
        ]
      }
      prickle_schedule_locks: {
        Row: {
          locked: boolean
          locked_at: string
          locked_by: string | null
          month: string
          notes: string | null
        }
        Insert: {
          locked: boolean
          locked_at?: string
          locked_by?: string | null
          month: string
          notes?: string | null
        }
        Update: {
          locked?: boolean
          locked_at?: string
          locked_by?: string | null
          month?: string
          notes?: string | null
        }
        Relationships: []
      }
      prickle_schedules: {
        Row: {
          carried_forward_from: string | null
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          day_of_week: number | null
          deleted_at: string | null
          deleted_by: string | null
          event_date: string | null
          host_id: string
          id: string
          month: string
          notes: string | null
          recurrence_anchor_date: string | null
          recurrence_type: string
          start_time_local: string
          status: string
          timezone: string
          type_id: string
          updated_at: string
          updated_by: string | null
          week_of_month: number | null
          schedule_host: {
            bio: string | null
            display_name: string | null
            facebook_url: string | null
            first_joined_at: string | null
            id: string
            instagram_url: string | null
            joined_at: string
            most_recent_joined_at: string | null
            name: string
            photo_url: string | null
            total_active_months: number
            twitter_url: string | null
          } | null
        }
        Insert: {
          carried_forward_from?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          day_of_week?: number | null
          deleted_at?: string | null
          deleted_by?: string | null
          event_date?: string | null
          host_id: string
          id?: string
          month: string
          notes?: string | null
          recurrence_anchor_date?: string | null
          recurrence_type: string
          start_time_local: string
          status?: string
          timezone?: string
          type_id: string
          updated_at?: string
          updated_by?: string | null
          week_of_month?: number | null
        }
        Update: {
          carried_forward_from?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          day_of_week?: number | null
          deleted_at?: string | null
          deleted_by?: string | null
          event_date?: string | null
          host_id?: string
          id?: string
          month?: string
          notes?: string | null
          recurrence_anchor_date?: string | null
          recurrence_type?: string
          start_time_local?: string
          status?: string
          timezone?: string
          type_id?: string
          updated_at?: string
          updated_by?: string | null
          week_of_month?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "prickle_schedules_carried_forward_from_fkey"
            columns: ["carried_forward_from"]
            isOneToOne: false
            referencedRelation: "prickle_schedules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prickle_schedules_host_id_fkey"
            columns: ["host_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prickle_schedules_type_id_fkey"
            columns: ["type_id"]
            isOneToOne: false
            referencedRelation: "prickle_types"
            referencedColumns: ["id"]
          },
        ]
      }
      prickle_types: {
        Row: {
          announced_publicly: boolean
          created_at: string | null
          default_host_id: string | null
          description: string | null
          guests_allowed: boolean
          id: string
          listed_in_events: boolean
          name: string
          names_guest_speaker: boolean
          normalized_name: string
          purpose: string
          requires_host: boolean | null
          solo_task_friendly: boolean
          summary_aliases: string[]
        }
        Insert: {
          announced_publicly?: boolean
          created_at?: string | null
          default_host_id?: string | null
          description?: string | null
          guests_allowed?: boolean
          id?: string
          listed_in_events?: boolean
          name: string
          names_guest_speaker?: boolean
          normalized_name: string
          purpose?: string
          requires_host?: boolean | null
          solo_task_friendly?: boolean
          summary_aliases?: string[]
        }
        Update: {
          announced_publicly?: boolean
          created_at?: string | null
          default_host_id?: string | null
          description?: string | null
          guests_allowed?: boolean
          id?: string
          listed_in_events?: boolean
          name?: string
          names_guest_speaker?: boolean
          normalized_name?: string
          purpose?: string
          requires_host?: boolean | null
          solo_task_friendly?: boolean
          summary_aliases?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "prickle_types_default_host_id_fkey"
            columns: ["default_host_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      prickles: {
        Row: {
          calendar_event_id: string | null
          created_at: string | null
          description: string | null
          end_time: string
          guest_speaker: string | null
          host: string | null
          id: string
          source: string
          start_time: string
          title: string | null
          type: string | null
          type_id: string | null
          zoom_meeting_uuid: string | null
          prickle_host: {
            bio: string | null
            display_name: string | null
            facebook_url: string | null
            first_joined_at: string | null
            id: string
            instagram_url: string | null
            joined_at: string
            most_recent_joined_at: string | null
            name: string
            photo_url: string | null
            total_active_months: number
            twitter_url: string | null
          } | null
        }
        Insert: {
          calendar_event_id?: string | null
          created_at?: string | null
          description?: string | null
          end_time: string
          guest_speaker?: string | null
          host?: string | null
          id?: string
          source: string
          start_time: string
          title?: string | null
          type?: string | null
          type_id?: string | null
          zoom_meeting_uuid?: string | null
        }
        Update: {
          calendar_event_id?: string | null
          created_at?: string | null
          description?: string | null
          end_time?: string
          guest_speaker?: string | null
          host?: string | null
          id?: string
          source?: string
          start_time?: string
          title?: string | null
          type?: string | null
          type_id?: string | null
          zoom_meeting_uuid?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "prickles_host_id_fkey"
            columns: ["host"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prickles_type_id_fkey"
            columns: ["type_id"]
            isOneToOne: false
            referencedRelation: "prickle_types"
            referencedColumns: ["id"]
          },
        ]
      }
      program_cohorts: {
        Row: {
          created_at: string
          created_by: string | null
          expires_at: string
          id: string
          name: string
          notes: string | null
          program_id: string
          starts_at: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          expires_at: string
          id?: string
          name: string
          notes?: string | null
          program_id: string
          starts_at: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          expires_at?: string
          id?: string
          name?: string
          notes?: string | null
          program_id?: string
          starts_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "program_cohorts_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id"]
          },
        ]
      }
      programs: {
        Row: {
          created_at: string
          description: string | null
          id: string
          includes_membership: boolean
          kajabi_offer_names: string[]
          name: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          includes_membership?: boolean
          kajabi_offer_names?: string[]
          name: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          includes_membership?: boolean
          kajabi_offer_names?: string[]
          name?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          deleted_at: string | null
          disabled_at: string | null
          endpoint: string
          id: string
          last_sent_at: string | null
          member_id: string
          p256dh: string
          paused_at: string | null
          user_agent: string | null
        }
        Insert: {
          auth: string
          created_at?: string
          deleted_at?: string | null
          disabled_at?: string | null
          endpoint: string
          id?: string
          last_sent_at?: string | null
          member_id: string
          p256dh: string
          paused_at?: string | null
          user_agent?: string | null
        }
        Update: {
          auth?: string
          created_at?: string
          deleted_at?: string | null
          disabled_at?: string | null
          endpoint?: string
          id?: string
          last_sent_at?: string | null
          member_id?: string
          p256dh?: string
          paused_at?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_limit_counters: {
        Row: {
          bucket: string
          hits: number
          window_start: string
        }
        Insert: {
          bucket: string
          hits: number
          window_start: string
        }
        Update: {
          bucket?: string
          hits?: number
          window_start?: string
        }
        Relationships: []
      }
      restricted_slack_channels: {
        Row: {
          channel_id: string
          created_at: string
          name: string | null
          reason: string | null
          restricted_by: string | null
        }
        Insert: {
          channel_id: string
          created_at?: string
          name?: string | null
          reason?: string | null
          restricted_by?: string | null
        }
        Update: {
          channel_id?: string
          created_at?: string
          name?: string | null
          reason?: string | null
          restricted_by?: string | null
        }
        Relationships: []
      }
      segment_members: {
        Row: {
          added_at: string
          member_id: string
          segment_id: string
        }
        Insert: {
          added_at?: string
          member_id: string
          segment_id: string
        }
        Update: {
          added_at?: string
          member_id?: string
          segment_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "segment_members_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "segment_members_segment_id_fkey"
            columns: ["segment_id"]
            isOneToOne: false
            referencedRelation: "segments"
            referencedColumns: ["id"]
          },
        ]
      }
      segments: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
        }
        Relationships: []
      }
      slack_bot_token: {
        Row: {
          access_secret_id: string
          expires_at: string | null
          refresh_secret_id: string | null
          singleton: boolean
          updated_at: string
        }
        Insert: {
          access_secret_id: string
          expires_at?: string | null
          refresh_secret_id?: string | null
          singleton?: boolean
          updated_at?: string
        }
        Update: {
          access_secret_id?: string
          expires_at?: string | null
          refresh_secret_id?: string | null
          singleton?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      slack_identities: {
        Row: {
          created_at: string
          linked_via: string
          slack_user_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          linked_via: string
          slack_user_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          linked_via?: string
          slack_user_id?: string
          user_id?: string
        }
        Relationships: []
      }
      slack_sign_in_tokens: {
        Row: {
          code_hash: string
          created_at: string
          expires_at: string
          slack_user_id: string
          token_hash: string
          used_at: string | null
        }
        Insert: {
          code_hash: string
          created_at?: string
          expires_at: string
          slack_user_id: string
          token_hash: string
          used_at?: string | null
        }
        Update: {
          code_hash?: string
          created_at?: string
          expires_at?: string
          slack_user_id?: string
          token_hash?: string
          used_at?: string | null
        }
        Relationships: []
      }
      slack_token_refresh_leases: {
        Row: {
          held_until: string
          lease_key: string
        }
        Insert: {
          held_until: string
          lease_key: string
        }
        Update: {
          held_until?: string
          lease_key?: string
        }
        Relationships: []
      }
      staff: {
        Row: {
          created_at: string | null
          email: string
          hire_date: string | null
          id: string
          member_id: string | null
          name: string
          notes: string | null
          role: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          email: string
          hire_date?: string | null
          id?: string
          member_id?: string | null
          name: string
          notes?: string | null
          role: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          email?: string
          hire_date?: string | null
          id?: string
          member_id?: string | null
          name?: string
          notes?: string | null
          role?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "staff_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      unmatched_calendar_events: {
        Row: {
          calendar_event_id: string
          created_at: string | null
          id: string
          raw_summary: string
          resolved_at: string | null
          resolved_description: string | null
          resolved_guest_speaker: string | null
          resolved_host_id: string | null
          resolved_title: string | null
          resolved_type_id: string | null
          status: string
          suggested_host: string | null
          suggested_type: string | null
        }
        Insert: {
          calendar_event_id: string
          created_at?: string | null
          id?: string
          raw_summary: string
          resolved_at?: string | null
          resolved_description?: string | null
          resolved_guest_speaker?: string | null
          resolved_host_id?: string | null
          resolved_title?: string | null
          resolved_type_id?: string | null
          status?: string
          suggested_host?: string | null
          suggested_type?: string | null
        }
        Update: {
          calendar_event_id?: string
          created_at?: string | null
          id?: string
          raw_summary?: string
          resolved_at?: string | null
          resolved_description?: string | null
          resolved_guest_speaker?: string | null
          resolved_host_id?: string | null
          resolved_title?: string | null
          resolved_type_id?: string | null
          status?: string
          suggested_host?: string | null
          suggested_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "unmatched_calendar_events_resolved_host_id_fkey"
            columns: ["resolved_host_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "unmatched_calendar_events_resolved_type_id_fkey"
            columns: ["resolved_type_id"]
            isOneToOne: false
            referencedRelation: "prickle_types"
            referencedColumns: ["id"]
          },
        ]
      }
      user_feature_previews: {
        Row: {
          enabled_at: string
          feature_key: string
          user_id: string
        }
        Insert: {
          enabled_at?: string
          feature_key: string
          user_id: string
        }
        Update: {
          enabled_at?: string
          feature_key?: string
          user_id?: string
        }
        Relationships: []
      }
      user_profiles: {
        Row: {
          analytics_opt_out_at: string | null
          created_at: string | null
          email: string
          id: string
          nav_mode: string | null
          role: string
          secondary_timezone: string | null
          timezone_preference: string | null
          updated_at: string | null
        }
        Insert: {
          analytics_opt_out_at?: string | null
          created_at?: string | null
          email: string
          id: string
          nav_mode?: string | null
          role?: string
          secondary_timezone?: string | null
          timezone_preference?: string | null
          updated_at?: string | null
        }
        Update: {
          analytics_opt_out_at?: string | null
          created_at?: string | null
          email?: string
          id?: string
          nav_mode?: string | null
          role?: string
          secondary_timezone?: string | null
          timezone_preference?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      video_text_tracks: {
        Row: {
          created_at: string
          id: string
          is_default: boolean
          kind: string
          label: string
          language: string
          mux_track_id: string | null
          source: string
          storage_path: string | null
          updated_at: string
          video_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_default?: boolean
          kind: string
          label: string
          language: string
          mux_track_id?: string | null
          source: string
          storage_path?: string | null
          updated_at?: string
          video_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_default?: boolean
          kind?: string
          label?: string
          language?: string
          mux_track_id?: string | null
          source?: string
          storage_path?: string | null
          updated_at?: string
          video_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "video_text_tracks_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: false
            referencedRelation: "videos"
            referencedColumns: ["id"]
          },
        ]
      }
      video_watch_segments: {
        Row: {
          captions_language: string | null
          client_segment_id: string | null
          device: Json | null
          end_seconds: number
          id: string
          kind: string
          member_id: string
          playback_rate: number
          session_id: string
          start_seconds: number
          started_at: string
          user_agent: string | null
          video_id: string
          visible: boolean
        }
        Insert: {
          captions_language?: string | null
          client_segment_id?: string | null
          device?: Json | null
          end_seconds: number
          id?: string
          kind?: string
          member_id: string
          playback_rate?: number
          session_id: string
          start_seconds: number
          started_at?: string
          user_agent?: string | null
          video_id: string
          visible?: boolean
        }
        Update: {
          captions_language?: string | null
          client_segment_id?: string | null
          device?: Json | null
          end_seconds?: number
          id?: string
          kind?: string
          member_id?: string
          playback_rate?: number
          session_id?: string
          start_seconds?: number
          started_at?: string
          user_agent?: string | null
          video_id?: string
          visible?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "video_watch_segments_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_watch_segments_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: false
            referencedRelation: "videos"
            referencedColumns: ["id"]
          },
        ]
      }
      videos: {
        Row: {
          created_at: string
          duration_seconds: number | null
          has_burned_in_captions: boolean
          id: string
          mux_asset_id: string | null
          mux_playback_id: string | null
          quality: string
          source_fingerprint: string | null
          source_key: string
          source_kind: string
          source_sha256: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          duration_seconds?: number | null
          has_burned_in_captions?: boolean
          id?: string
          mux_asset_id?: string | null
          mux_playback_id?: string | null
          quality?: string
          source_fingerprint?: string | null
          source_key: string
          source_kind: string
          source_sha256?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          duration_seconds?: number | null
          has_burned_in_captions?: boolean
          id?: string
          mux_asset_id?: string | null
          mux_playback_id?: string | null
          quality?: string
          source_fingerprint?: string | null
          source_key?: string
          source_kind?: string
          source_sha256?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      wheel_of_wonder_matches: {
        Row: {
          confirmed_at: string | null
          confirmed_by_member_id: string | null
          created_at: string
          id: string
          matched_member_id: string
          matched_message_count: number
          matched_slack_user_id: string | null
          slack_channel_id: string
          spinner_member_id: string
          spinner_message_count: number
          spinner_slack_user_id: string | null
          status: string
        }
        Insert: {
          confirmed_at?: string | null
          confirmed_by_member_id?: string | null
          created_at?: string
          id?: string
          matched_member_id: string
          matched_message_count?: number
          matched_slack_user_id?: string | null
          slack_channel_id: string
          spinner_member_id: string
          spinner_message_count?: number
          spinner_slack_user_id?: string | null
          status?: string
        }
        Update: {
          confirmed_at?: string | null
          confirmed_by_member_id?: string | null
          created_at?: string
          id?: string
          matched_member_id?: string
          matched_message_count?: number
          matched_slack_user_id?: string | null
          slack_channel_id?: string
          spinner_member_id?: string
          spinner_message_count?: number
          spinner_slack_user_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "roulette_matches_confirmed_by_member_id_fkey"
            columns: ["confirmed_by_member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roulette_matches_matched_member_id_fkey"
            columns: ["matched_member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roulette_matches_spinner_member_id_fkey"
            columns: ["spinner_member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      writing_goals: {
        Row: {
          archived_at: string | null
          created_at: string
          deleted_at: string | null
          description: string | null
          end_date: string | null
          external_id: string | null
          goal_type: string
          habit_period: string | null
          habit_threshold: number | null
          id: string
          is_starred: boolean
          measure: string
          member_id: string
          project_id: string | null
          show_on_profile: boolean
          start_date: string | null
          target_amount: number | null
          title: string | null
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          end_date?: string | null
          external_id?: string | null
          goal_type?: string
          habit_period?: string | null
          habit_threshold?: number | null
          id?: string
          is_starred?: boolean
          measure: string
          member_id: string
          project_id?: string | null
          show_on_profile?: boolean
          start_date?: string | null
          target_amount?: number | null
          title?: string | null
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          end_date?: string | null
          external_id?: string | null
          goal_type?: string
          habit_period?: string | null
          habit_threshold?: number | null
          id?: string
          is_starred?: boolean
          measure?: string
          member_id?: string
          project_id?: string | null
          show_on_profile?: boolean
          start_date?: string | null
          target_amount?: number | null
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "writing_goals_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "writing_goals_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "writing_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      writing_progress_entries: {
        Row: {
          amount: number
          created_at: string
          deleted_at: string | null
          entry_date: string
          external_id: string | null
          id: string
          measure: string
          member_id: string
          mode: string
          note: string | null
          prickle_id: string | null
          project_id: string
          tags: string[]
        }
        Insert: {
          amount: number
          created_at?: string
          deleted_at?: string | null
          entry_date: string
          external_id?: string | null
          id?: string
          measure: string
          member_id: string
          mode: string
          note?: string | null
          prickle_id?: string | null
          project_id: string
          tags?: string[]
        }
        Update: {
          amount?: number
          created_at?: string
          deleted_at?: string | null
          entry_date?: string
          external_id?: string | null
          id?: string
          measure?: string
          member_id?: string
          mode?: string
          note?: string | null
          prickle_id?: string | null
          project_id?: string
          tags?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "writing_progress_entries_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "writing_progress_entries_prickle_id_fkey"
            columns: ["prickle_id"]
            isOneToOne: false
            referencedRelation: "prickles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "writing_progress_entries_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "writing_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      writing_project_starting_balances: {
        Row: {
          amount: number
          measure: string
          member_id: string
          project_id: string
        }
        Insert: {
          amount: number
          measure: string
          member_id: string
          project_id: string
        }
        Update: {
          amount?: number
          measure?: string
          member_id?: string
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "writing_project_starting_balances_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "writing_project_starting_balances_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "writing_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      writing_projects: {
        Row: {
          archived_at: string | null
          cover_asset_id: string | null
          cover_url: string | null
          created_at: string
          description: string | null
          external_id: string | null
          id: string
          member_id: string
          phase: string
          show_on_profile: boolean
          title: string
        }
        Insert: {
          archived_at?: string | null
          cover_asset_id?: string | null
          cover_url?: string | null
          created_at?: string
          description?: string | null
          external_id?: string | null
          id?: string
          member_id: string
          phase?: string
          show_on_profile?: boolean
          title: string
        }
        Update: {
          archived_at?: string | null
          cover_asset_id?: string | null
          cover_url?: string | null
          created_at?: string
          description?: string | null
          external_id?: string | null
          id?: string
          member_id?: string
          phase?: string
          show_on_profile?: boolean
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "writing_projects_cover_asset_id_fkey"
            columns: ["cover_asset_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "writing_projects_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      access_locations_at: {
        Args: { p_times: string[]; p_user_ids: string[]; p_window?: string }
        Returns: {
          city: string
          country: string
          idx: number
          ip_address: unknown
          region: string
        }[]
      }
      add_event_attendee: {
        Args: { p_admin_id: string; p_event_id: string; p_member_id: string }
        Returns: undefined
      }
      admin_member_engagement: {
        Args: { p_now?: string; p_search?: string }
        Returns: {
          display_name: string
          email: string
          engagement_score: number
          engagement_tier: string
          id: string
          last_attended_at: string
          name: string
          prickles_last_30_days: number
          risk_level: string
          status: string
          total_prickles: number
          user_id: string
        }[]
      }
      admin_member_filter_counts: {
        Args: { p_now?: string; p_search?: string }
        Returns: {
          active: number
          all: number
          at_risk: number
          cancelled: number
          highly_engaged: number
          lead: number
          on_hiatus: number
          unregistered: number
        }[]
      }
      admin_member_matches_filter: {
        Args: {
          p_engagement_tier: string
          p_filter: string
          p_risk_level: string
          p_status: string
          p_user_id: string
        }
        Returns: boolean
      }
      admin_members_page: {
        Args: {
          p_direction?: string
          p_filter?: string
          p_limit?: number
          p_now?: string
          p_offset?: number
          p_search?: string
          p_sort?: string
        }
        Returns: {
          display_name: string
          email: string
          engagement_score: number
          engagement_tier: string
          id: string
          last_attended_at: string
          name: string
          prickles_last_30_days: number
          risk_level: string
          status: string
          total_count: number
          total_prickles: number
          user_id: string
        }[]
      }
      analytics_action_outcomes: {
        Args: { ignore_staff?: boolean; ignore_sudo?: boolean; since: string }
        Returns: {
          action: string
          attempts: number
          failed: number
          last_seen: string
          members: number
          succeeded: number
        }[]
      }
      analytics_control_rates: {
        Args: {
          hide_admin?: boolean
          ignore_staff?: boolean
          ignore_sudo?: boolean
          route_prefix?: string
          since: string
        }
        Returns: {
          clicked_members: number
          clicked_sessions: number
          first_seen: string
          name: string
          seen_members: number
          seen_sessions: number
        }[]
      }
      analytics_counts: {
        Args: {
          event_sudo: boolean
          event_user: string
          ignore_staff: boolean
          ignore_sudo: boolean
        }
        Returns: boolean
      }
      analytics_event_summary: {
        Args: { ignore_staff?: boolean; ignore_sudo?: boolean; since: string }
        Returns: {
          event: string
          events: number
          last_seen: string
          members: number
          sessions: number
        }[]
      }
      analytics_funnel: {
        Args: {
          filters?: Json
          ignore_staff?: boolean
          ignore_sudo?: boolean
          since: string
          steps: string[]
        }
        Returns: {
          event: string
          sessions: number
          step: number
        }[]
      }
      analytics_is_staff: { Args: { uid: string }; Returns: boolean }
      analytics_notification_rates: {
        Args: { ignore_staff?: boolean; ignore_sudo?: boolean; since: string }
        Returns: {
          channel: string
          kind: string
          opened: number
          opened_members: number
          sent: number
          sent_members: number
        }[]
      }
      analytics_property_breakdown: {
        Args: {
          event_name: string
          filter?: Json
          ignore_staff?: boolean
          ignore_sudo?: boolean
          property: string
          since: string
        }
        Returns: {
          events: number
          members: number
          sessions: number
          value: string
        }[]
      }
      analytics_prune_usage_events: {
        Args: { p_cutoff: string; p_limit?: number; p_tz: string }
        Returns: number
      }
      analytics_rollup_period: {
        Args: { p_kind: string; p_start: string; p_tz: string }
        Returns: number
      }
      analytics_scrub_labels: { Args: never; Returns: number }
      analytics_top_clicks: {
        Args: {
          hide_admin?: boolean
          ignore_staff?: boolean
          ignore_sudo?: boolean
          route_prefix?: string
          since: string
        }
        Returns: {
          element: string
          events: number
          label: string
          members: number
          routes: number
          sessions: number
        }[]
      }
      analytics_unrolled_periods: {
        Args: { p_now?: string; p_tz: string }
        Returns: {
          period_kind: string
          period_start: string
        }[]
      }
      attendance_member: {
        Args: { "": Database["public"]["Tables"]["prickle_attendance"]["Row"] }
        Returns: {
          bio: string | null
          display_name: string | null
          facebook_url: string | null
          first_joined_at: string | null
          id: string
          instagram_url: string | null
          joined_at: string
          most_recent_joined_at: string | null
          name: string
          photo_url: string | null
          total_active_months: number
          twitter_url: string | null
        }
        SetofOptions: {
          from: "prickle_attendance"
          to: "member_directory"
          isOneToOne: true
          isSetofReturn: true
        }
      }
      audit_entity_label: {
        Args: { entity: string; subject: Json }
        Returns: string
      }
      book_member: {
        Args: { "": Database["public"]["Tables"]["member_books"]["Row"] }
        Returns: {
          bio: string | null
          display_name: string | null
          facebook_url: string | null
          first_joined_at: string | null
          id: string
          instagram_url: string | null
          joined_at: string
          most_recent_joined_at: string | null
          name: string
          photo_url: string | null
          total_active_months: number
          twitter_url: string | null
        }
        SetofOptions: {
          from: "member_books"
          to: "member_directory"
          isOneToOne: true
          isSetofReturn: true
        }
      }
      chat_apply_slack_read: {
        Args: { p_channel_id: string; p_member: string; p_slack_ts: string }
        Returns: undefined
      }
      chat_can_read_content: {
        Args: { p_channel_id: string }
        Returns: boolean
      }
      chat_can_see_channel: { Args: { p_channel_id: string }; Returns: boolean }
      chat_claim_slack_read_pull: {
        Args: { p_member: string; p_min_seconds: number }
        Returns: boolean
      }
      chat_delete_file: {
        Args: { p_file_id: string; p_message_id: string }
        Returns: undefined
      }
      chat_delete_message: {
        Args: { p_message_id: string }
        Returns: undefined
      }
      chat_edit_message: {
        Args: { p_body: string; p_message_id: string }
        Returns: undefined
      }
      chat_is_channel_member: {
        Args: { p_channel_id: string }
        Returns: boolean
      }
      chat_mark_message_failed: {
        Args: { p_message_id: string }
        Returns: undefined
      }
      chat_mark_message_sent: {
        Args: { p_message_id: string; p_slack_ts: string }
        Returns: undefined
      }
      chat_mark_read: {
        Args: { p_channel_id: string; p_through?: string }
        Returns: undefined
      }
      chat_post_message:
        | {
            Args: {
              p_body: string
              p_channel_id: string
              p_thread_root_id?: string
            }
            Returns: string
          }
        | {
            Args: {
              p_body: string
              p_channel_id: string
              p_files: Json
              p_thread_root_id: string
            }
            Returns: string
          }
      chat_slack_files_summary: { Args: { p_files: Json }; Returns: Json }
      chat_toggle_reaction: {
        Args: { p_emoji: string; p_message_id: string }
        Returns: boolean
      }
      chat_unread_channel_ids: {
        Args: { p_member: string }
        Returns: {
          channel_id: string
          newest_at: string
        }[]
      }
      chat_unread_counts: {
        Args: never
        Returns: {
          channel_id: string
          unread: number
        }[]
      }
      chat_visible_channel_ids: { Args: never; Returns: string[] }
      check_prickle_commitment_slot_overlap: {
        Args: { p_commitment_id: string }
        Returns: undefined
      }
      claim_chat_gap_fill: {
        Args: {
          p_channel: string
          p_min_interval: string
          p_scope: string
          p_source: string
          p_ts: string
        }
        Returns: string
      }
      count_activity_feed: {
        Args: {
          p_actor_user_id?: string
          p_audit_only?: boolean
          p_entity_types?: string[]
          p_from?: string
          p_hide_slack?: boolean
          p_hide_system?: boolean
          p_kinds?: string[]
          p_member_id?: string
          p_session_gap_minutes?: number
          p_sudo_only?: boolean
          p_to?: string
        }
        Returns: number
      }
      create_prickle_commitment: {
        Args: {
          p_created_by?: string
          p_member_id: string
          p_slots: Json
          p_start_date: string
          p_weeks: number
        }
        Returns: string
      }
      current_acting_as_member_id: { Args: never; Returns: string }
      current_member_id: { Args: never; Returns: string }
      custom_access_token_hook: { Args: { event: Json }; Returns: Json }
      delete_stale_calendar_events: {
        Args: {
          p_current_google_ids: string[]
          p_time_max: string
          p_time_min: string
        }
        Returns: number
      }
      find_pending_invite: {
        Args: { p_email: string }
        Returns: {
          invited_at: string
          user_id: string
        }[]
      }
      get_access_sessions: {
        Args: {
          event_limit?: number
          session_gap_minutes?: number
          target_user_id: string
        }
        Returns: {
          auth_session_created_at: string
          auth_session_id: string
          device: Json
          event_count: number
          pages: Json
          session_active: boolean
          session_end: string
          session_start: string
          user_agent: string
        }[]
      }
      get_activity_feed: {
        Args: {
          p_actor_user_id?: string
          p_audit_only?: boolean
          p_entity_types?: string[]
          p_from?: string
          p_hide_slack?: boolean
          p_hide_system?: boolean
          p_kinds?: string[]
          p_limit?: number
          p_member_id?: string
          p_offset?: number
          p_session_gap_minutes?: number
          p_sudo_only?: boolean
          p_to?: string
        }
        Returns: {
          acting_as_member_id: string
          acting_as_member_name: string
          actor_kind: string
          actor_label: string
          actor_user_id: string
          data: Json
          description: string
          entity_id: string
          entity_type: string
          event_id: string
          event_type: string
          is_audit: boolean
          kind: string
          member_id: string
          member_name: string
          occurred_at: string
          source: string
          title: string
        }[]
      }
      get_hosted_prickle_attendance: {
        Args: { p_host_id: string; p_started_before?: string }
        Returns: {
          attendee_count: number
          end_time: string
          host_earliest_join: string
          prickle_id: string
          start_time: string
          type_name: string
        }[]
      }
      get_member_directory: {
        Args: never
        Returns: {
          bio: string
          display_name: string
          first_joined_at: string
          id: string
          name: string
          photo_url: string
          projects: string[]
          topics: string[]
        }[]
      }
      get_my_sessions: {
        Args: never
        Returns: {
          created_at: string
          id: string
          ip: string
          is_current: boolean
          not_after: string
          refreshed_at: string
          updated_at: string
          user_agent: string
        }[]
      }
      get_profile_writing: { Args: { p_member_id: string }; Returns: Json }
      get_recent_login_sessions: {
        Args: { from_date: string; to_date: string }
        Returns: {
          created_at: string
          email: string
          session_id: string
          user_id: string
        }[]
      }
      get_record_history: {
        Args: {
          p_entity_id?: string
          p_entity_types: string[]
          p_limit?: number
          p_member_rows?: boolean
          p_parent_column?: string
        }
        Returns: {
          acting_as_member_id: string
          acting_as_member_name: string
          actor_kind: string
          actor_label: string
          actor_user_id: string
          data: Json
          description: string
          entity_id: string
          entity_type: string
          event_id: string
          event_type: string
          is_audit: boolean
          kind: string
          member_id: string
          member_name: string
          occurred_at: string
          source: string
          title: string
        }[]
      }
      has_course_access: { Args: { p_course_id: string }; Returns: boolean }
      is_admin: { Args: never; Returns: boolean }
      is_prickle_schedule_month_locked: {
        Args: { target_month: string }
        Returns: boolean
      }
      match_member_by_name: {
        Args: { zoom_email?: string; zoom_name: string }
        Returns: {
          confidence: string
          match_type: string
          member_id: string
        }[]
      }
      member_interaction_pairs: {
        Args: { p_include_private: boolean; p_since: string }
        Returns: {
          kind: string
          member_x: string
          member_y: string
          n: number
          visibility: string
        }[]
      }
      member_slack_channels: {
        Args: { p_member_id: string }
        Returns: {
          channel_name: string
          n: number
        }[]
      }
      member_slack_summary: {
        Args: { p_member_id: string; p_since: string }
        Returns: {
          channels: number
          last_30_days: number
          messages: number
          reactions: number
          total: number
        }[]
      }
      mentorship_counts: {
        Args: never
        Returns: {
          first_started_on: string
          last_started_on: string
          member_id: string
          mentored_count: number
        }[]
      }
      my_mentorships: {
        Args: { p_member_id: string }
        Returns: {
          kind: string
          mentorship_id: string
          other_display_name: string
          other_first_joined_at: string
          other_member_id: string
          other_most_recent_joined_at: string
          other_name: string
          other_photo_url: string
          other_status: string
          outcome_note: string
          started_on: string
          trial_ends_on: string
          viewer_role: string
        }[]
      }
      name_alias_conflict: {
        Args: { p_alias: string; p_member_id: string }
        Returns: {
          kind: string
          other_member_id: string
          other_member_name: string
        }[]
      }
      name_alias_key: { Args: { p_name: string }; Returns: string }
      new_id: { Args: { prefix: string }; Returns: string }
      prickle_host: {
        Args: { "": Database["public"]["Tables"]["prickles"]["Row"] }
        Returns: {
          bio: string | null
          display_name: string | null
          facebook_url: string | null
          first_joined_at: string | null
          id: string
          instagram_url: string | null
          joined_at: string
          most_recent_joined_at: string | null
          name: string
          photo_url: string | null
          total_active_months: number
          twitter_url: string | null
        }
        SetofOptions: {
          from: "prickles"
          to: "member_directory"
          isOneToOne: true
          isSetofReturn: true
        }
      }
      project_slack_chat_channels: {
        Args: { user_member_map: Json }
        Returns: Json
      }
      project_slack_chat_message: {
        Args: { p_channel_id: string; p_message_ts: string }
        Returns: Json
      }
      project_slack_chat_messages: {
        Args: { from_date: string; to_date: string; user_member_map: Json }
        Returns: Json
      }
      rate_limit_hit: {
        Args: { p_bucket: string; p_max_hits: number; p_window_seconds: number }
        Returns: boolean
      }
      remove_event_attendee: {
        Args: { p_event_id: string; p_member_id: string }
        Returns: undefined
      }
      reprocess_member_interactions_atomic: {
        Args: { from_date: string; to_date: string }
        Returns: Json
      }
      reprocess_members_atomic: { Args: { new_data: Json }; Returns: undefined }
      reprocess_prickle_attendance_atomic: {
        Args: {
          from_date: string
          new_attendance_data: Json
          new_pup_data: Json
          to_date: string
        }
        Returns: undefined
      }
      reprocess_prickles_atomic: {
        Args: { from_date: string; new_data: Json; to_date: string }
        Returns: undefined
      }
      reprocess_slack_activities_atomic: {
        Args: {
          from_date: string
          skip_empty_check?: boolean
          to_date: string
          user_member_map: Json
        }
        Returns: Json
      }
      retention_pending_user_agents: {
        Args: { p_limit?: number; p_source: string }
        Returns: string[]
      }
      retention_remove_raw_network: {
        Args: { p_cutoff: string; p_limit?: number }
        Returns: {
          removed: number
          source: string
        }[]
      }
      retention_set_device: {
        Args: {
          p_device: Json
          p_limit?: number
          p_source: string
          p_user_agent: string
        }
        Returns: number
      }
      revoke_my_session: {
        Args: { target_session_id: string }
        Returns: boolean
      }
      revoke_user_sessions: {
        Args: { target_user_id: string }
        Returns: undefined
      }
      schedule_host: {
        Args: { "": Database["public"]["Tables"]["prickle_schedules"]["Row"] }
        Returns: {
          bio: string | null
          display_name: string | null
          facebook_url: string | null
          first_joined_at: string | null
          id: string
          instagram_url: string | null
          joined_at: string
          most_recent_joined_at: string | null
          name: string
          photo_url: string | null
          total_active_months: number
          twitter_url: string | null
        }
        SetofOptions: {
          from: "prickle_schedules"
          to: "member_directory"
          isOneToOne: true
          isSetofReturn: true
        }
      }
      search_chat_messages: {
        Args: {
          p_author_member_ids?: string[]
          p_channel_ids: string[]
          p_from?: string
          p_has_files?: boolean
          p_has_link?: boolean
          p_has_reaction?: boolean
          p_in_thread?: boolean
          p_limit?: number
          p_offset?: number
          p_query: string
          p_to?: string
        }
        Returns: {
          message_id: string
          rank: number
        }[]
      }
      search_member_aliases: {
        Args: { p_term: string }
        Returns: {
          alias: string
          member_id: string
        }[]
      }
      set_mentorship_note: {
        Args: { p_mentorship_id: string; p_note: string }
        Returns: boolean
      }
      slack_activity_project_message: {
        Args: { p_channel_id: string; p_message_ts: string }
        Returns: Json
      }
      slack_bot_token_get: {
        Args: never
        Returns: {
          access_token: string
          expires_at: string
          refresh_token: string
        }[]
      }
      slack_bot_token_save: {
        Args: {
          p_access_token: string
          p_expires_at: string
          p_refresh_token: string
        }
        Returns: undefined
      }
      slack_connection_delete_secrets: {
        Args: { p_member: string }
        Returns: undefined
      }
      slack_connection_revoke: {
        Args: { p_member: string }
        Returns: undefined
      }
      slack_connection_save: {
        Args: {
          p_access_token: string
          p_expires_at: string
          p_member: string
          p_refresh_token: string
          p_scopes: string[]
          p_slack_user_id: string
          p_team_id: string
        }
        Returns: undefined
      }
      slack_connection_tokens: {
        Args: { p_member: string }
        Returns: {
          access_token: string
          expires_at: string
          refresh_token: string
          slack_user_id: string
        }[]
      }
      slack_connection_update_tokens: {
        Args: {
          p_access_token: string
          p_expires_at: string
          p_member: string
          p_refresh_token: string
        }
        Returns: undefined
      }
      slack_is_system_message_type: {
        Args: { p_type: string }
        Returns: boolean
      }
      slack_token_refresh_claim: {
        Args: { p_key: string; p_seconds: number }
        Returns: boolean
      }
      slack_token_refresh_release: {
        Args: { p_key: string }
        Returns: undefined
      }
      sync_event_badge_awards: {
        Args: { p_event_id: string }
        Returns: undefined
      }
      upsert_ambiguous_zoom_name: {
        Args: {
          p_candidate_member_ids: string[]
          p_occurrence_increment?: number
          p_zoom_email: string
          p_zoom_name: string
        }
        Returns: string
      }
      valid_ask_me_about_topics: {
        Args: { topics: string[] }
        Returns: boolean
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
  bronze: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const

