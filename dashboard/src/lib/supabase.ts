import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://tzqyoxfnaejoolsrynvv.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR6cXlveGZuYWVqb29sc3J5bnZ2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMzMDA5NDAsImV4cCI6MjA5ODg3Njk0MH0.cHbCtn2pfS5o-7mjh08OvldOZzkIG6V8LNcX4OhoPSk';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
});
