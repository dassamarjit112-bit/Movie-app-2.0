/* ============================================================
   CineStream — Authentication Module
   Handles: Email/Password, Google OAuth, Session, Password Reset, OTP, Password Management
   ============================================================ */

const Auth = (() => {
  // ── Sign In with Email/Password ──
  async function signInWithEmail(email, password) {
    const { data, error } = await window.sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  }

  // ── Sign Up with Email/Password (OTP-based) ──
  async function signUpWithEmail(email, password, fullName, country = 'india') {
    const { data, error } = await window.sb.auth.signUp({
      email,
      password,
      options: {
        data: { 
          full_name: fullName, 
          avatar_url: '',
          country: country
        },
        emailRedirectTo: window.location.origin + window.location.pathname
      }
    });
    if (error) throw error;

    // The profile record is automatically created on the backend via the Postgres trigger
    // (on_auth_user_created) defined in 01_init.sql. We do not need to manually upsert it here!
    return data;
  }

  // ── Sign Up with OTP (Email-based OTP verification) ──
  async function signUpWithOTP(email, fullName, country = 'india') {
    const { data, error } = await window.sb.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: true,
        data: { full_name: fullName, avatar_url: '', country: country },
        emailRedirectTo: window.location.origin + window.location.pathname
      }
    });
    if (error) throw error;
    return data;
  }

  // ── Verify OTP ──
  async function verifyOTP(email, token) {
    const { data, error } = await window.sb.auth.verifyOtp({
      email,
      token,
      type: 'email'
    });
    if (error) throw error;
    return data;
  }

  // ── Set Password (for OAuth users or first-time password setup) ──
  async function setPassword(password) {
    const { data, error } = await window.sb.auth.updateUser({ password });
    if (error) throw error;
    return data;
  }

  // ── Update Password ──
  async function updatePassword(newPassword) {
    const { data, error } = await window.sb.auth.updateUser({ password: newPassword });
    if (error) throw error;
    return data;
  }

  // ── Check if user has password set ──
  async function hasPassword() {
    try {
      const { data: { user }, error } = await window.sb.auth.getUser();
      if (error || !user) return false;
      // Check if user was created via OAuth (no password) vs email signup (has password)
      return !!(user.user_metadata?.provider_type === 'email' || user.identities?.some(i => i.provider === 'email'));
    } catch (e) {
      return false;
    }
  }

  // ── Google OAuth ──
  async function signInWithGoogle() {
    // Check if running inside the Median native app wrapper
    const isNativeApp = typeof window.median !== 'undefined' || 
                        (typeof window.gonative !== 'undefined') ||
                        navigator.userAgent.includes('gonative') ||
                        navigator.userAgent.includes('median');

    // Use web production URL for standard browsers, or custom scheme for the app wrapper
    const redirectUrl = isNativeApp 
      ? "com.sdcinestream://login-callback/" 
      : "https://sdcinestream.qzz.io";

    // Allow legitimate external redirect for OAuth
    if (typeof window.allowLegitNavigation === 'function') {
      window.allowLegitNavigation();
    }

    const { data, error } = await window.sb.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: redirectUrl,
        data: { country: 'india' } // Default country for Google OAuth users
      },
    });

    if (error) {
      console.error("Login Error:", error.message);
      throw error;
    }
    return data;
  }

  // ── Sign Out ──
  async function signOut() {
    const { error } = await window.sb.auth.signOut();
    if (error) throw error;
    window.Router.navigate('login');
  }

  // ── Get Current Session ──
  async function getSession() {
    try {
      const { data, error } = await window.sb.auth.getSession();
      if (error) {
        console.warn('Auth.getSession returned error:', error);
        return null;
      }
      return data ? data.session : null;
    } catch (e) {
      console.warn('Auth.getSession crashed:', e);
      return null;
    }
  }

  // ── Get Current User ──
  async function getUser() {
    const { data: { user } } = await window.sb.auth.getUser();
    return user;
  }

  // ── Get User Profile ──
  async function getProfile(userId) {
    const { data, error } = await window.sb
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();
    if (error) return null;
    return data;
  }

  // ── Update Profile ──
  async function updateProfile(userId, updates) {
    const { data, error } = await window.sb
      .from('profiles')
      .upsert({ id: userId, ...updates, updated_at: new Date().toISOString() });
    if (error) throw error;
    return data;
  }

  // ── Reset Password ──
  async function sendPasswordReset(email) {
    const { error } = await window.sb.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + '/#/reset-password'
    });
    if (error) throw error;
  }

  // ── Auth State Change Listener ──
  function onAuthChange(callback) {
    return window.sb.auth.onAuthStateChange((_event, session) => {
      callback(session);
    });
  }

  // ── Auth Guard ── (call on protected pages)
  async function requireAuth() {
    const session = await getSession();
    if (!session) {
      window.Router.navigate('login');
      return null;
    }
    return session;
  }

  // ── Check if user is Admin ──
  async function isAdmin(userId) {
    try {
      const targetId = userId || (await getSession())?.user?.id;
      if (!targetId) return false;

      // Check profile in Supabase table
      const profile = await getProfile(targetId);
      if (profile) {
        if (profile.admin === true || profile.is_admin === true || String(profile.admin).toLowerCase() === 'true' || String(profile.is_admin).toLowerCase() === 'true' || profile.role === 'admin') {
          return true;
        }
      }

      // Check user metadata as fallback
      const user = await getUser().catch(() => null);
      if (user && user.user_metadata) {
        if (user.user_metadata.admin === true || user.user_metadata.is_admin === true || user.user_metadata.role === 'admin') {
          return true;
        }
      }
      return false;
    } catch (e) {
      console.warn('Auth.isAdmin check error:', e);
      return false;
    }
  }

  return {
    signInWithEmail,
    signUpWithEmail,
    signUpWithOTP,
    verifyOTP,
    setPassword,
    updatePassword,
    hasPassword,
    signInWithGoogle,
    signOut,
    getSession,
    getUser,
    getProfile,
    updateProfile,
    isAdmin,
    sendPasswordReset,
    onAuthChange,
    requireAuth
  };
})();

window.Auth = Auth;
