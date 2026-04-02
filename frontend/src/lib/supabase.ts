import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
const BUCKET = process.env.NEXT_PUBLIC_SUPABASE_BUCKET ?? 'soccer-videos'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

export async function uploadVideoToSupabase(
  matchId: number,
  file: File,
  onProgress?: (pct: number) => void,
): Promise<string> {
  const path = `matches/${matchId}/${Date.now()}_${file.name}`

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, {
      cacheControl: '3600',
      upsert: true,
    })

  if (error) throw new Error(`업로드 실패: ${error.message}`)

  const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(path)
  return urlData.publicUrl
}
