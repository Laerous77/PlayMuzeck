import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY! // pakai service_role, BUKAN anon key, karena ini kode server
);

const BUCKET = 'audio-products';

export async function uploadToSupabase(buffer: Buffer, originalName: string, mimetype: string) {
  const ext = originalName.substring(originalName.lastIndexOf('.'));
  const filename = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;

  const { error } = await supabase.storage.from(BUCKET).upload(filename, buffer, {
    contentType: mimetype,
    upsert: false,
  });
  if (error) throw error;

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(filename);
  return data.publicUrl; 
}