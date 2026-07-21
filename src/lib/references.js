import { supabase } from './supabase'

// Ask the database for the next reference of a given kind. Numbering happens
// under a lock there, so two people raising something at once cannot collide.
export async function nextReference(kind, fallbackPrefix = 'REF-') {
  const { data, error } = await supabase.rpc('next_reference', { p_kind: kind })
  if (error || !data) {
    // Never block someone from saving because numbering hiccuped.
    return `${fallbackPrefix}${Date.now().toString(36).toUpperCase()}`
  }
  return data
}
