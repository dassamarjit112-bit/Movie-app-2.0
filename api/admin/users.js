// api/admin/users.js
// Vercel/Netlify-style serverless function to list users (profiles) for admins.
// Requires environment variables: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

module.exports = async (req, res) => {
  try {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!SUPABASE_URL || !SERVICE_KEY) {
      res.status(500).json({ error: 'Server misconfigured: missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' });
      return;
    }

    const authHeader = req.headers.authorization || '';
    const token = authHeader.split(' ')[1];
    if (!token) {
      res.status(401).json({ error: 'Missing Authorization bearer token' });
      return;
    }

    // 1) Get the user associated with the access token
    const userResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!userResp.ok) {
      res.status(401).json({ error: 'Invalid or expired token' });
      return;
    }
    const user = await userResp.json();
    const userId = user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unable to determine user id from token' });
      return;
    }

    // 2) Verify requesting user is admin by checking profiles table
    const profileCheck = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=admin`, {
      headers: {
        'apikey': SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Accept': 'application/json'
      }
    });

    if (!profileCheck.ok) {
      res.status(500).json({ error: 'Failed to check profile' });
      return;
    }
    const profileRows = await profileCheck.json();
    const isAdmin = Array.isArray(profileRows) && profileRows[0] && profileRows[0].admin === true;
    if (!isAdmin) {
      res.status(403).json({ error: 'Forbidden: admin only' });
      return;
    }

    // 3) Fetch all profiles (sensitive - only for admins)
    const profilesResp = await fetch(`${SUPABASE_URL}/rest/v1/profiles?select=*`, {
      headers: {
        'apikey': SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Accept': 'application/json'
      }
    });

    if (!profilesResp.ok) {
      const text = await profilesResp.text();
      res.status(500).json({ error: 'Failed to fetch profiles', detail: text });
      return;
    }

    const profiles = await profilesResp.json();
    res.status(200).json({ users: profiles });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error', detail: String(err) });
  }
};
