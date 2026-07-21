import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [org, setOrg] = useState(null)
  const [loading, setLoading] = useState(true)
  const [profileLoading, setProfileLoading] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  const loadProfile = useCallback(async (userId) => {
    setProfileLoading(true)
    const { data: p } = await supabase
      .from('profiles')
      .select('id, org_id, full_name, email, role, is_active')
      .eq('id', userId)
      .maybeSingle()

    setProfile(p ?? null)

    if (p?.org_id) {
      const { data: o } = await supabase
        .from('organisations')
        .select('id, name, plan, subscription_status, trial_ends_at')
        .eq('id', p.org_id)
        .maybeSingle()
      setOrg(o ?? null)
    } else {
      setOrg(null)
    }
    setProfileLoading(false)
  }, [])

  useEffect(() => {
    if (!session?.user) {
      setProfile(null)
      setOrg(null)
      return
    }
    loadProfile(session.user.id)
  }, [session, loadProfile])

  const refresh = useCallback(() => {
    if (session?.user) return loadProfile(session.user.id)
  }, [session, loadProfile])

  const signInWithEmail = (email) =>
    supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    })

  const signOut = async () => {
    await supabase.auth.signOut()
    setProfile(null)
    setOrg(null)
  }

  const isAdmin = profile?.role === 'owner' || profile?.role === 'admin'

  const value = {
    session,
    user: session?.user ?? null,
    profile,
    org,
    loading,
    profileLoading,
    isAdmin,
    refresh,
    signInWithEmail,
    signOut,
  }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = () => useContext(AuthContext)
