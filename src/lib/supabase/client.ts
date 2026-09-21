import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

let client: SupabaseClient<Database> | null = null;

/**
 * Server-side Supabase client using the service-role key.
 * This bypasses Row Level Security (RLS) by design - the Express backend is
 * the trusted boundary, same role Mongoose played talking directly to Mongo.
 * Never import this module from anything that ships to the browser.
 */
export const getSupabaseClient = (): SupabaseClient<Database> => {
  if (client) {
    return client;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) {
    throw new Error('SUPABASE_URL is not configured');
  }

  if (!serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured');
  }

  client = createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });

  return client;
};

export type { Database } from './database.types';
