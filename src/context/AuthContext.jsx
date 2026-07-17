import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  // Load the profile row (role) once signed in. The profiles table may not exist
  // until the migration is applied — fail soft so the shell still renders.
  useEffect(() => {
    if (!session?.user) { setProfile(null); return }
    let active = true
    supabase
      .from('profiles')
      .select('id, full_name, role, is_active')
      .eq('id', session.user.id)
      .maybeSingle()
      .then(({ data }) => { if (active) setProfile(data) })
      .catch(() => { if (active) setProfile(null) })
    return () => { active = false }
  }, [session])

  const signInWithEmail = (email) =>
    supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    })

  const signOut = () => supabase.auth.signOut()

  const value = { session, user: session?.user ?? null, profile, loading, signInWithEmail, signOut }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = () => useContext(AuthContext)
