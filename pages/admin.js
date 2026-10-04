/* CineStream — Admin Control Center Controller (Next-Gen UI/UX) */

const AdminPage = (() => {
  let catalogShows = [];
  let filteredShows = [];
  let userProfiles = [];
  let userSubscriptions = [];
  let activeGiftCodes = [];
  let tableRowCounts = {};

  async function init() {
    // Render Layout Nav
    document.getElementById('navbar-mount').innerHTML = UI.renderNavbar('admin');
    document.getElementById('footer-mount').innerHTML = UI.renderFooter();
    document.getElementById('mobile-nav-mount').innerHTML = UI.renderMobileNav('account');
    UI.updateNavbarUser();
    UI.initRipples();

    // 1. Guard check: Verify current user is Admin as per Supabase table
    const session = await window.Auth.getSession();
    if (!session) {
      UI.toast('Please sign in to access admin panel.', 'warning');
      Router.navigate('login');
      return;
    }

    const isAdmin = await window.Auth.isAdmin(session.user.id);
    if (!isAdmin) {
      UI.toast('Access restricted: Administrator privileges required.', 'error');
      Router.navigate('account');
      return;
    }

    // Bind Refresh button
    const refreshBtn = document.getElementById('admin-refresh-btn');
    if (refreshBtn) {
      refreshBtn.onclick = () => {
        UI.toast('Refreshing all database & catalog records...', 'info');
        loadAllData();
      };
    }

    // Setup Navigation Tabs
    setupAdminTabs();

    // Bind Table Selector for Inspector Tab
    const tableSelect = document.getElementById('admin-table-select');
    if (tableSelect) {
      tableSelect.onchange = () => loadTableDataInspector(tableSelect.value);
    }

    // Load initial dataset
    await loadAllData();
  }

  function setupAdminTabs() {
    const tabs = document.querySelectorAll('.admin-tab-btn');
    tabs.forEach(tab => {
      tab.onclick = () => {
        const target = tab.dataset.tab;
        tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === target));
        document.querySelectorAll('.admin-tab-content').forEach(content => {
          content.style.display = content.id === `admin-tab-${target}` ? 'block' : 'none';
        });

        if (target === 'tables') {
          const selectedTable = document.getElementById('admin-table-select')?.value || 'profiles';
          loadTableDataInspector(selectedTable);
        }
      };
    });
  }

  async function loadAllData() {
    await Promise.all([
      loadShowsCatalog(),
      loadUsersList(),
      loadSubscriptionHolders(),
      loadGiftCodes(),
      loadTableCounts(),
      loadMetrics()
    ]);
  }

  async function loadMetrics() {
    try {
      const showsCountEl = document.getElementById('metric-total-shows');
      const usersCountEl = document.getElementById('metric-total-users');
      const subsCountEl = document.getElementById('metric-active-subs');

      if (showsCountEl) showsCountEl.textContent = catalogShows.length;
      if (usersCountEl) usersCountEl.textContent = userProfiles.length;

      const activeSubs = userSubscriptions.filter(s => s.status === 'active' && new Date(s.end_date) > new Date());
      if (subsCountEl) subsCountEl.textContent = activeSubs.length || userSubscriptions.length;
    } catch (e) {
      console.warn('Metrics load error:', e);
    }
  }

  // ── DATABASE TABLES SCHEMA & ROW COUNTS ──
  async function loadTableCounts() {
    const tableNames = ['profiles', 'subscriptions', 'gift_codes', 'watch_history', 'watchlist', 'content'];
    if (!window.sb) return;

    await Promise.all(tableNames.map(async (name) => {
      try {
        const { count } = await window.sb
          .from(name)
          .select('*', { count: 'exact', head: true });
        
        tableRowCounts[name] = count || 0;
        const countEl = document.getElementById(`table-count-${name}`);
        if (countEl) countEl.textContent = `${count || 0} records`;
      } catch (e) {
        tableRowCounts[name] = 0;
      }
    }));
  }

  // ── INTERACTIVE DATABASE DATA INSPECTOR FOR ALL TABLES ──
  async function loadTableDataInspector(tableName = 'profiles') {
    const titleEl = document.getElementById('selected-table-name');
    const countEl = document.getElementById('selected-table-row-count');
    const headEl = document.getElementById('admin-table-inspector-head');
    const bodyEl = document.getElementById('admin-table-inspector-body');

    if (!headEl || !bodyEl) return;

    if (titleEl) titleEl.textContent = `public.${tableName} Table Records`;

    headEl.innerHTML = `<tr><th style="padding:22px; text-align:center; color:rgba(229,226,225,0.5);">Loading database records from Supabase...</th></tr>`;
    bodyEl.innerHTML = '';

    try {
      if (window.sb) {
        const { data, error } = await window.sb.from(tableName).select('*').limit(100);
        
        if (error || !data || data.length === 0) {
          if (countEl) countEl.textContent = '0 Records';
          headEl.innerHTML = `<tr style="color:rgba(229,226,225,0.4);"><th style="padding:22px; text-align:center;">No data records stored in ${tableName} table</th></tr>`;
          return;
        }

        if (countEl) countEl.textContent = `${data.length} Records Loaded`;

        const columns = Object.keys(data[0]);

        // Render table headers
        headEl.innerHTML = `
          <tr style="background:rgba(255,255,255,0.06); border-bottom:1px solid rgba(255,255,255,0.15); color:#af4cff; font-size:12.5px; text-transform:uppercase; font-family:monospace; font-weight:800;">
            ${columns.map(col => `<th style="padding:16px 20px;">${col}</th>`).join('')}
          </tr>
        `;

        // Render table rows
        bodyEl.innerHTML = data.map(row => `
          <tr style="border-bottom:1px solid rgba(255,255,255,0.06); font-family:monospace; font-size:13px; transition:background 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.04)'" onmouseout="this.style.background='transparent'">
            ${columns.map(col => {
              let val = row[col];
              if (val === null || val === undefined) {
                val = '<span style="opacity:0.35; color:rgba(229,226,225,0.4); font-style:italic;">null</span>';
              } else if (typeof val === 'boolean') {
                val = val 
                  ? '<span style="color:#32dc78; font-weight:900; background:rgba(50,220,120,0.18); padding:3px 10px; border-radius:6px; border:1px solid rgba(50,220,120,0.35);">TRUE</span>' 
                  : '<span style="color:#ff6b6b; font-weight:900; background:rgba(255,107,107,0.18); padding:3px 10px; border-radius:6px; border:1px solid rgba(255,107,107,0.35);">FALSE</span>';
              } else if (typeof val === 'object') {
                const str = JSON.stringify(val);
                val = `<span style="font-size:11.5px; background:rgba(175,76,255,0.15); border:1px solid rgba(175,76,255,0.3); padding:4px 8px; border-radius:6px; color:#e5b8ff;" title="${str.replace(/"/g, '&quot;')}">${str.length > 25 ? str.substring(0, 25) + '...' : str}</span>`;
              } else if (String(val).startsWith('http')) {
                val = `<a href="${val}" target="_blank" class="copy-pill" style="color:#14d1ff; text-decoration:none;"><span class="material-symbols-outlined" style="font-size:14px;">open_in_new</span> Link</a>`;
              } else if (String(val).includes('T') && String(val).includes('Z') && !isNaN(Date.parse(val))) {
                val = `<span style="color:rgba(229,226,225,0.85); font-weight:600;">${UI.formatDate(val)}</span>`;
              } else if (col === 'id' || col === 'user_id' || String(val).length > 20) {
                const fullStr = String(val);
                val = `<span class="copy-pill" onclick="AdminPage.copyGiftCode('${fullStr}')" title="Click to Copy ID">${fullStr.substring(0, 14)}... <span class="material-symbols-outlined" style="font-size:13px;">content_copy</span></span>`;
              }
              return `<td style="padding:14px 20px; max-width:260px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${val}</td>`;
            }).join('')}
          </tr>
        `).join('');
      }
    } catch (err) {
      console.error('Table inspect error:', err);
    }
  }

  // ── USER ACCOUNTS DIRECTORY (`public.profiles`) ──
  async function loadUsersList() {
    const tableBody = document.getElementById('admin-users-table-body');
    const searchInput = document.getElementById('admin-users-search');
    const badgeCount = document.getElementById('admin-users-badge-count');
    const tabBadge = document.getElementById('tab-badge-users');

    if (!tableBody) return;

    try {
      if (window.sb) {
        const { data, error } = await window.sb.from('profiles').select('*').order('created_at', { ascending: false });
        if (!error && data) {
          userProfiles = data;
        }
      }
    } catch (e) {
      console.warn('Failed to load users from profiles table:', e);
    }

    if (badgeCount) badgeCount.textContent = `${userProfiles.length} Registered Users`;
    if (tabBadge) tabBadge.textContent = userProfiles.length;

    const renderUsers = () => {
      const q = (searchInput?.value || '').toLowerCase().trim();
      const filtered = userProfiles.filter(u => 
        !q || 
        (u.full_name || '').toLowerCase().includes(q) || 
        (u.email || '').toLowerCase().includes(q) || 
        (u.id || '').toLowerCase().includes(q) ||
        (u.country || '').toLowerCase().includes(q)
      );

      if (filtered.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="6" style="padding:40px; text-align:center; color:rgba(229,226,225,0.45); font-size:15px;">No user profiles found in database</td></tr>`;
        return;
      }

      tableBody.innerHTML = filtered.map(user => {
        const isAdmin = user.is_admin === true || user.admin === true || user.role === 'admin';
        const name = user.full_name || 'CineStream Member';
        const email = user.email || (user.full_name ? user.full_name.toLowerCase().replace(/\s+/g, '') + '@cinestream.app' : 'user@cinestream.app');
        const avatarUrl = user.avatar_url || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(name)}&backgroundColor=e50914&textColor=ffffff`;
        const joinedDate = user.created_at ? UI.formatDate(user.created_at) : 'Active Member';
        
        const subRecord = userSubscriptions.find(s => s.user_id === user.id && s.status === 'active' && new Date(s.end_date) > new Date());
        const hasActiveSub = !!subRecord;
        const planTier = subRecord ? (subRecord.plan_id || 'standard').toUpperCase() : null;

        const countryFlags = { india: '🇮🇳 India', usa: '🇺🇸 USA', uk: '🇬🇧 UK', canada: '🇨🇦 Canada', australia: '🇦🇺 Australia' };
        const countryLabel = countryFlags[user.country] || (user.country ? '🌏 ' + user.country : '🌏 Global');

        return `
          <tr style="border-bottom:1px solid rgba(255,255,255,0.06); transition:background 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.04)'" onmouseout="this.style.background='transparent'">
            
            <!-- User Profile Column -->
            <td style="padding:18px 24px;">
              <div style="display:flex; align-items:center; gap:16px;">
                <div style="width:48px; height:48px; border-radius:50%; overflow:hidden; border:2.5px solid ${isAdmin ? '#14d1ff' : (hasActiveSub ? '#ffc832' : 'rgba(255,255,255,0.2)')}; flex-shrink:0; box-shadow:0 6px 16px rgba(0,0,0,0.4);">
                  <img src="${avatarUrl}" style="width:100%; height:100%; object-fit:cover;">
                </div>
                <div>
                  <div style="font-weight:900; color:#fff; font-size:15px; display:flex; align-items:center; gap:8px;">
                    ${name}
                    ${isAdmin ? '<span style="font-size:9.5px; background:rgba(20,209,255,0.22); color:#14d1ff; padding:2px 8px; border-radius:4px; font-weight:900; border:1px solid rgba(20,209,255,0.4);">👑 ADMIN</span>' : ''}
                    ${hasActiveSub ? `<span style="font-size:9.5px; background:rgba(255,200,50,0.22); color:#ffc832; padding:2px 8px; border-radius:4px; font-weight:900; border:1px solid rgba(255,200,50,0.4);">VIP ${planTier}</span>` : ''}
                  </div>
                  <div style="font-size:13px; color:rgba(229,226,225,0.6); margin-top:3px;">${email}</div>
                  <div style="font-size:11.5px; color:rgba(229,226,225,0.4); margin-top:2px;">Joined: ${joinedDate}</div>
                </div>
              </div>
            </td>

            <!-- User ID (Copyable) -->
            <td style="padding:18px 24px;">
              <span class="copy-pill" onclick="AdminPage.copyGiftCode('${user.id}')" title="Click to Copy Supabase User ID">
                <span>${(user.id || '').substring(0, 14)}...</span>
                <span class="material-symbols-outlined" style="font-size:14px; color:#14d1ff;">content_copy</span>
              </span>
            </td>

            <!-- Country -->
            <td style="padding:18px 24px; font-size:14px; color:rgba(229,226,225,0.9); font-weight:600;">
              ${countryLabel}
            </td>

            <!-- Member Status -->
            <td style="padding:18px 24px;">
              <span style="font-size:12px; font-weight:800; padding:6px 14px; border-radius:100px; ${hasActiveSub ? 'background:rgba(50,220,120,0.2); color:#32dc78; border:1px solid rgba(50,220,120,0.4);' : 'background:rgba(255,255,255,0.08); color:rgba(229,226,225,0.55); border:1px solid rgba(255,255,255,0.12);'}">
                ${hasActiveSub ? 'ACTIVE VIP SUBSCRIBER' : 'FREE MEMBER'}
              </span>
            </td>

            <!-- Role Badge -->
            <td style="padding:18px 24px;">
              <span style="font-size:12px; font-weight:800; padding:6px 14px; border-radius:100px; ${isAdmin ? 'background:rgba(20,209,255,0.2); color:#14d1ff; border:1px solid rgba(20,209,255,0.4);' : 'background:rgba(255,255,255,0.08); color:rgba(229,226,225,0.65);'}">
                ${isAdmin ? 'ADMINISTRATOR' : 'MEMBER USER'}
              </span>
            </td>

            <!-- Action Buttons -->
            <td style="padding:18px 24px; text-align:right;">
              <div style="display:flex; gap:10px; justify-content:flex-end;">
                
                <button onclick="AdminPage.openUserDetailsModal('${user.id}')" class="btn btn-ghost btn-sm" style="border-radius:10px; font-size:13px; padding:8px 14px; border:1px solid rgba(255,255,255,0.18); font-weight:700;" title="Inspect Profile Details">
                  Inspect
                </button>

                <button onclick="AdminPage.toggleUserAdmin('${user.id}', ${!isAdmin})" class="btn ${isAdmin ? 'btn-ghost' : 'btn-secondary-outline'} btn-sm" style="border-radius:10px; font-size:13px; padding:8px 14px; font-weight:800;">
                  ${isAdmin ? 'Demote' : 'Make Admin'}
                </button>

                <button onclick="AdminPage.grantUserSubscription('${user.id}')" class="btn btn-ghost btn-sm" style="border-radius:10px; font-size:13px; color:#32dc78; padding:8px 14px; border-color:rgba(50,220,120,0.4); font-weight:800; background:rgba(50,220,120,0.08);">
                  + 30D Plan
                </button>

              </div>
            </td>

          </tr>
        `;
      }).join('');
    };

    if (searchInput) searchInput.oninput = renderUsers;
    renderUsers();
  }

  // ── SUBSCRIPTION HOLDERS VIEW (`public.subscriptions`) ──
  async function loadSubscriptionHolders() {
    const tableBody = document.getElementById('admin-subs-table-body');
    const searchInput = document.getElementById('admin-subs-search');
    const badgeCount = document.getElementById('admin-subs-badge-count');
    const tabBadge = document.getElementById('tab-badge-subs');

    if (!tableBody) return;

    try {
      if (window.sb) {
        const { data, error } = await window.sb.from('subscriptions').select('*').order('created_at', { ascending: false });
        if (!error && data) {
          userSubscriptions = data;
        }
      }
    } catch (e) {
      console.warn('Failed to load subscriptions:', e);
    }

    const activeCount = userSubscriptions.filter(s => s.status === 'active' && new Date(s.end_date) > new Date()).length;
    if (badgeCount) badgeCount.textContent = `${activeCount} Active Plans`;
    if (tabBadge) tabBadge.textContent = activeCount;

    const renderSubs = () => {
      const q = (searchInput?.value || '').toLowerCase().trim();
      
      const filtered = userSubscriptions.filter(sub => {
        const profile = userProfiles.find(u => u.id === sub.user_id);
        const name = (profile?.full_name || '').toLowerCase();
        const email = (profile?.email || '').toLowerCase();
        const plan = (sub.plan_id || '').toLowerCase();
        return !q || name.includes(q) || email.includes(q) || plan.includes(q) || sub.user_id.includes(q);
      });

      if (filtered.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="7" style="padding:40px; text-align:center; color:rgba(229,226,225,0.45); font-size:15px;">No subscription records found in database</td></tr>`;
        return;
      }

      tableBody.innerHTML = filtered.map(sub => {
        const user = userProfiles.find(u => u.id === sub.user_id) || { full_name: 'CineStream Subscriber', email: 'user@cinestream.app' };
        const endDateObj = new Date(sub.end_date);
        const isCurrentActive = sub.status === 'active' && endDateObj > new Date();
        const planName = (sub.plan_id || 'standard').toUpperCase();
        const startDate = sub.start_date ? UI.formatDate(sub.start_date) : 'N/A';
        const endDate = sub.end_date ? UI.formatDate(sub.end_date) : 'N/A';
        
        // Calculate remaining days
        const diffMs = endDateObj - new Date();
        const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
        const daysLabel = isCurrentActive ? `${diffDays} Days Left` : 'Expired';

        const source = sub.source || (sub.gift_code_used ? '🎁 Gift Code (' + sub.gift_code_used + ')' : '💳 Payment');

        return `
          <tr style="border-bottom:1px solid rgba(255,255,255,0.06); transition:background 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.04)'" onmouseout="this.style.background='transparent'">
            
            <td style="padding:18px 24px;">
              <div style="font-weight:900; color:#fff; font-size:15px;">${user.full_name || 'Subscriber'}</div>
              <div style="font-size:13px; color:rgba(229,226,225,0.6); margin-top:2px;">${user.email || sub.user_id.substring(0, 16) + '...'}</div>
            </td>

            <td style="padding:18px 24px;">
              <span style="font-size:12px; font-weight:900; padding:6px 14px; border-radius:10px; background:rgba(20,209,255,0.2); color:#14d1ff; border:1px solid rgba(20,209,255,0.4);">
                ⭐ ${planName} PLAN
              </span>
            </td>

            <td style="padding:18px 24px;">
              <span style="font-size:12px; font-weight:800; padding:6px 14px; border-radius:100px; ${isCurrentActive ? 'background:rgba(50,220,120,0.2); color:#32dc78; border:1px solid rgba(50,220,120,0.4);' : 'background:rgba(255,107,107,0.2); color:#ff6b6b; border:1px solid rgba(255,107,107,0.4);'}">
                ${isCurrentActive ? 'ACTIVE' : 'EXPIRED'}
              </span>
            </td>

            <td style="padding:18px 24px; font-size:13.5px; color:rgba(229,226,225,0.7);">
              ${startDate}
            </td>

            <td style="padding:18px 24px;">
              <div style="font-size:14px; font-weight:800; color:${isCurrentActive ? '#fff' : 'rgba(229,226,225,0.4)'};">${endDate}</div>
              <div style="font-size:12px; font-weight:700; color:${isCurrentActive ? '#32dc78' : '#ff6b6b'}; margin-top:2px;">${daysLabel}</div>
            </td>

            <td style="padding:18px 24px; font-size:13.5px; color:rgba(229,226,225,0.75);">
              ${source}
            </td>

            <td style="padding:18px 24px; text-align:right;">
              <button onclick="AdminPage.grantUserSubscription('${sub.user_id}')" class="btn btn-primary btn-sm" style="border-radius:12px; font-size:13px; padding:8px 16px; font-weight:800; box-shadow:0 4px 14px rgba(229,9,20,0.3);">
                Extend 30 Days
              </button>
            </td>

          </tr>
        `;
      }).join('');
    };

    if (searchInput) searchInput.oninput = renderSubs;
    renderSubs();
  }

  // ── ADD USER FUNCTION MODAL ──
  function openAddUserModal() {
    const modal = document.getElementById('admin-show-modal');
    const modalBody = document.getElementById('admin-modal-body');
    const closeBtn = document.getElementById('admin-modal-close');

    if (!modal || !modalBody) return;

    modal.style.display = 'flex';
    if (closeBtn) closeBtn.onclick = () => modal.style.display = 'none';

    modalBody.innerHTML = `
      <div style="margin-bottom:24px;">
        <div style="display:flex; align-items:center; gap:10px; margin-bottom:6px;">
          <span class="material-symbols-outlined" style="color:#32dc78; font-size:22px;">person_add</span>
          <span style="font-size:12px; font-weight:800; background:rgba(50,220,120,0.18); color:#32dc78; padding:3px 12px; border-radius:100px;">USER REGISTRATION</span>
        </div>
        <h3 style="font-size:24px; font-weight:900; color:#fff;">Register New User Profile</h3>
      </div>

      <div style="display:flex; flex-direction:column; gap:18px;">
        <div>
          <label class="input-label" style="font-size:12px; font-weight:800; text-transform:uppercase; display:block; margin-bottom:8px;">Full Name</label>
          <input type="text" id="add-user-name" class="input-field" placeholder="John Doe" style="border-radius:12px; font-size:15px; padding:14px 16px; height:50px;">
        </div>

        <div>
          <label class="input-label" style="font-size:12px; font-weight:800; text-transform:uppercase; display:block; margin-bottom:8px;">Email Address</label>
          <input type="email" id="add-user-email" class="input-field" placeholder="user@example.com" style="border-radius:12px; font-size:15px; padding:14px 16px; height:50px;">
        </div>

        <div>
          <label class="input-label" style="font-size:12px; font-weight:800; text-transform:uppercase; display:block; margin-bottom:8px;">Password</label>
          <input type="password" id="add-user-password" class="input-field" placeholder="Set initial password (min 6 chars)" style="border-radius:12px; font-size:15px; padding:14px 16px; height:50px;">
        </div>

        <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px;">
          <div>
            <label class="input-label" style="font-size:12px; font-weight:800; text-transform:uppercase; display:block; margin-bottom:8px;">Role</label>
            <select id="add-user-role" class="input-field" style="border-radius:12px; font-size:14px; padding:14px 16px; background:rgba(255,255,255,0.04); color:#fff; border:1px solid rgba(255,255,255,0.1); width:100%; height:50px; font-weight:600;">
              <option value="user" style="background:#1a1a2e">Member (Standard User)</option>
              <option value="admin" style="background:#1a1a2e">Administrator (Full Access)</option>
            </select>
          </div>

          <div>
            <label class="input-label" style="font-size:12px; font-weight:800; text-transform:uppercase; display:block; margin-bottom:8px;">Initial Plan</label>
            <select id="add-user-plan" class="input-field" style="border-radius:12px; font-size:14px; padding:14px 16px; background:rgba(255,255,255,0.04); color:#fff; border:1px solid rgba(255,255,255,0.1); width:100%; height:50px; font-weight:600;">
              <option value="none" style="background:#1a1a2e">None (Free Access)</option>
              <option value="premium" style="background:#1a1a2e">Premium 4K (30 Days)</option>
              <option value="standard" style="background:#1a1a2e">Standard HD (30 Days)</option>
            </select>
          </div>
        </div>

        <button id="submit-add-user-btn" class="btn btn-primary" style="border-radius:14px; padding:16px; font-size:15px; font-weight:900; margin-top:10px; background:linear-gradient(135deg, #32dc78 0%, #20ab55 100%); color:#000; box-shadow:0 8px 24px rgba(50,220,120,0.3);">
          CREATE USER PROFILE
        </button>
      </div>
    `;

    document.getElementById('submit-add-user-btn').onclick = async () => {
      const name = document.getElementById('add-user-name').value.trim();
      const email = document.getElementById('add-user-email').value.trim();
      const password = document.getElementById('add-user-password').value.trim();
      const role = document.getElementById('add-user-role').value;
      const plan = document.getElementById('add-user-plan').value;

      if (!name || !email || !password || password.length < 6) {
        UI.toast('Please provide valid name, email, and password (min 6 characters).', 'warning');
        return;
      }

      const btn = document.getElementById('submit-add-user-btn');
      UI.setLoading(btn, true);

      try {
        if (window.sb) {
          const { data, error } = await window.sb.auth.signUp({
            email,
            password,
            options: { data: { full_name: name } }
          });

          if (error) throw error;

          const createdUserId = data?.user?.id;
          if (createdUserId) {
            const isAdmin = role === 'admin';
            
            await window.sb.from('profiles').upsert({
              id: createdUserId,
              full_name: name,
              email: email,
              is_admin: isAdmin,
              admin: isAdmin,
              role: role,
              created_at: new Date().toISOString()
            });

            if (plan !== 'none') {
              const endDate = new Date();
              endDate.setDate(endDate.getDate() + 30);
              await window.sb.from('subscriptions').insert({
                user_id: createdUserId,
                plan_id: plan,
                status: 'active',
                start_date: new Date().toISOString(),
                end_date: endDate.toISOString(),
                source: 'admin_creation'
              });
            }
          }

          UI.toast(`User profile created for ${email}!`, 'success');
          modal.style.display = 'none';
          await loadUsersList();
          await loadSubscriptionHolders();
          await loadMetrics();
        }
      } catch (err) {
        UI.toast(err.message || 'Failed to create user profile.', 'error');
      } finally {
        UI.setLoading(btn, false);
      }
    };
  }

  // ── INSPECT USER DETAILS MEGA MODAL (FULL SCREEN DASHBOARD) ──
  async function openUserDetailsModal(userId) {
    const modal = document.getElementById('admin-show-modal');
    const modalBody = document.getElementById('admin-modal-body');
    const closeBtn = document.getElementById('admin-modal-close');

    if (!modal || !modalBody) return;

    modal.style.display = 'flex';
    if (closeBtn) closeBtn.onclick = () => modal.style.display = 'none';

    modalBody.innerHTML = `
      <div style="text-align:center; padding:60px 0;">
        <div style="width:52px; height:52px; border:4px solid rgba(20,209,255,0.2); border-top-color:#14d1ff; border-radius:50%; animation:spin 0.9s linear infinite; margin:0 auto 18px;"></div>
        <p style="color:rgba(229,226,225,0.7); font-size:16px;">Fetching user profile, watch history, and bookmarks...</p>
      </div>
    `;

    const user = userProfiles.find(u => u.id === userId) || await window.Auth.getProfile(userId);
    const sub = userSubscriptions.find(s => s.user_id === userId) || await Subscriptions.getUserSubscription(userId);
    const watchHistory = await Subscriptions.getWatchHistory(userId, 50);
    const watchlist = await Subscriptions.getWatchlist(userId);

    const isAdmin = user?.is_admin === true || user?.admin === true || user?.role === 'admin';
    const avatarUrl = user?.avatar_url || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(user?.full_name || 'User')}&backgroundColor=e50914&textColor=ffffff`;
    const email = user?.email || (user?.full_name ? user.full_name.toLowerCase().replace(/\s+/g, '') + '@cinestream.app' : 'user@cinestream.app');
    
    // Days remaining calculation
    let remainingDays = 0;
    if (sub && sub.end_date) {
      const diffMs = new Date(sub.end_date) - new Date();
      remainingDays = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
    }

    modalBody.innerHTML = `
      <!-- User Hero Header -->
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:24px; margin-bottom:32px; padding-bottom:28px; border-bottom:1px solid rgba(255,255,255,0.12);">
        <div style="display:flex; align-items:center; gap:24px;">
          <div style="width:84px; height:84px; border-radius:50%; overflow:hidden; border:3px solid ${isAdmin ? '#14d1ff' : (sub ? '#ffc832' : 'rgba(255,255,255,0.2)')}; flex-shrink:0; box-shadow:0 8px 24px rgba(0,0,0,0.5);" class="animate-float">
            <img src="${avatarUrl}" style="width:100%; height:100%; object-fit:cover;">
          </div>
          <div>
            <div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap;">
              <h2 style="font-size:32px; font-weight:900; color:#fff;">${user?.full_name || 'CineStream Member'}</h2>
              <span style="font-size:12px; font-weight:900; padding:5px 14px; border-radius:100px; ${isAdmin ? 'background:rgba(20,209,255,0.2); color:#14d1ff; border:1px solid rgba(20,209,255,0.4);' : 'background:rgba(255,255,255,0.08); color:rgba(229,226,225,0.7);'}">${isAdmin ? '👑 ADMINISTRATOR' : '👤 MEMBER'}</span>
              ${sub ? `<span style="font-size:12px; font-weight:900; padding:5px 14px; border-radius:100px; background:rgba(255,200,50,0.2); color:#ffc832; border:1px solid rgba(255,200,50,0.4);">⭐ VIP ${sub.plan_id.toUpperCase()}</span>` : ''}
            </div>
            <p style="font-size:16px; color:rgba(229,226,225,0.75); margin-top:6px; font-weight:500;">${email}</p>
            <div style="margin-top:8px;">
              <span class="copy-pill" onclick="AdminPage.copyGiftCode('${userId}')" title="Click to Copy Supabase UUID">
                <span>Supabase ID: ${userId}</span>
                <span class="material-symbols-outlined" style="font-size:14px; color:#14d1ff;">content_copy</span>
              </span>
            </div>
          </div>
        </div>

        <div style="display:flex; gap:14px; align-items:center; flex-wrap:wrap;">
          <button onclick="AdminPage.grantUserSubscription('${userId}')" class="btn btn-secondary-outline btn-shimmer" style="border-radius:14px; padding:12px 24px; font-size:14px; font-weight:800; color:#32dc78; border-color:rgba(50,220,120,0.4); background:rgba(50,220,120,0.08);">
            <span class="material-symbols-outlined" style="font-size:20px;">workspace_premium</span>
            <span>+ 30-Day VIP Grant</span>
          </button>
          
          <button onclick="AdminPage.toggleUserAdmin('${userId}', ${!isAdmin})" class="btn btn-primary" style="border-radius:14px; padding:12px 24px; font-size:14px; font-weight:800;">
            <span class="material-symbols-outlined" style="font-size:20px;">admin_panel_settings</span>
            <span>${isAdmin ? 'Demote User' : 'Make Administrator'}</span>
          </button>
        </div>
      </div>

      <!-- Quick User Metrics Row -->
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:20px; margin-bottom:32px;">
        <div style="background:rgba(255,255,255,0.04); padding:20px 24px; border-radius:18px; border:1px solid rgba(255,255,255,0.1);">
          <span style="font-size:12px; font-weight:800; color:rgba(229,226,225,0.55); text-transform:uppercase; letter-spacing:0.08em; display:block; margin-bottom:6px;">Subscription Status</span>
          <span style="font-size:18px; font-weight:900; color:${sub ? '#32dc78' : '#ff6b6b'}; display:flex; align-items:center; gap:6px;">
            ${sub ? '● ACTIVE (' + remainingDays + ' Days Left)' : '○ INACTIVE MEMBER'}
          </span>
        </div>

        <div style="background:rgba(255,255,255,0.04); padding:20px 24px; border-radius:18px; border:1px solid rgba(255,255,255,0.1);">
          <span style="font-size:12px; font-weight:800; color:rgba(229,226,225,0.55); text-transform:uppercase; letter-spacing:0.08em; display:block; margin-bottom:6px;">Watch History</span>
          <span style="font-size:18px; font-weight:900; color:#fff; display:flex; align-items:center; gap:6px;">
            <span class="material-symbols-outlined" style="font-size:20px; color:#14d1ff;">history</span>
            <span>${watchHistory.length} Titles Viewed</span>
          </span>
        </div>

        <div style="background:rgba(255,255,255,0.04); padding:20px 24px; border-radius:18px; border:1px solid rgba(255,255,255,0.1);">
          <span style="font-size:12px; font-weight:800; color:rgba(229,226,225,0.55); text-transform:uppercase; letter-spacing:0.08em; display:block; margin-bottom:6px;">Watchlist Bookmarks</span>
          <span style="font-size:18px; font-weight:900; color:#fff; display:flex; align-items:center; gap:6px;">
            <span class="material-symbols-outlined" style="font-size:20px; color:#ffc832;">bookmark</span>
            <span>${watchlist.length} Bookmarked</span>
          </span>
        </div>

        <div style="background:rgba(255,255,255,0.04); padding:20px 24px; border-radius:18px; border:1px solid rgba(255,255,255,0.1);">
          <span style="font-size:12px; font-weight:800; color:rgba(229,226,225,0.55); text-transform:uppercase; letter-spacing:0.08em; display:block; margin-bottom:6px;">Country Region</span>
          <span style="font-size:18px; font-weight:900; color:#fff; display:flex; align-items:center; gap:6px;">
            <span>${user?.country ? user.country.toUpperCase() : 'GLOBAL'}</span>
          </span>
        </div>
      </div>

      <!-- 2-Column Split User Inspection Content -->
      <div style="display:grid; grid-template-columns:1fr 2fr; gap:32px;" class="admin-gift-layout">
        
        <!-- Left Column: Raw Supabase Metadata & Profile Json -->
        <div style="background:rgba(255,255,255,0.02); padding:28px; border-radius:22px; border:1px solid rgba(255,255,255,0.08);">
          <h4 style="font-size:18px; font-weight:900; color:#14d1ff; margin-bottom:16px;">Supabase Profile Metadata</h4>
          
          <div style="display:flex; flex-direction:column; gap:12px; font-size:14px;">
            <div style="display:flex; justify-content:space-between; border-bottom:1px solid rgba(255,255,255,0.06); padding-bottom:8px;">
              <span style="color:rgba(229,226,225,0.5); font-weight:600;">Full Name</span>
              <span style="color:#fff; font-weight:800;">${user?.full_name || 'N/A'}</span>
            </div>

            <div style="display:flex; justify-content:space-between; border-bottom:1px solid rgba(255,255,255,0.06); padding-bottom:8px;">
              <span style="color:rgba(229,226,225,0.5); font-weight:600;">Email</span>
              <span style="color:#fff; font-weight:800;">${email}</span>
            </div>

            <div style="display:flex; justify-content:space-between; border-bottom:1px solid rgba(255,255,255,0.06); padding-bottom:8px;">
              <span style="color:rgba(229,226,225,0.5); font-weight:600;">Role System</span>
              <span style="color:#14d1ff; font-weight:900;">${user?.role || (isAdmin ? 'admin' : 'user')}</span>
            </div>

            <div style="display:flex; justify-content:space-between; border-bottom:1px solid rgba(255,255,255,0.06); padding-bottom:8px;">
              <span style="color:rgba(229,226,225,0.5); font-weight:600;">Created At</span>
              <span style="color:rgba(229,226,225,0.85); font-weight:600;">${user?.created_at ? UI.formatDate(user.created_at) : 'N/A'}</span>
            </div>
          </div>

          <div style="margin-top:24px;">
            <span style="font-size:12px; font-weight:800; color:rgba(229,226,225,0.5); text-transform:uppercase; display:block; margin-bottom:8px;">Raw User Profile JSON Record</span>
            <pre style="font-size:12px; font-family:monospace; background:rgba(0,0,0,0.6); padding:16px; border-radius:14px; border:1px solid rgba(255,255,255,0.08); color:#32dc78; overflow-x:auto; max-height:220px;">${JSON.stringify(user || {}, null, 2)}</pre>
          </div>
        </div>

        <!-- Right Column: User Watch History & Bookmarks -->
        <div style="display:flex; flex-direction:column; gap:24px;">
          
          <!-- Watch History -->
          <div style="background:rgba(255,255,255,0.02); padding:28px; border-radius:22px; border:1px solid rgba(255,255,255,0.08);">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
              <h4 style="font-size:18px; font-weight:900; color:#fff;">Viewing History (${watchHistory.length})</h4>
            </div>

            ${watchHistory.length === 0 ? `
              <p style="font-size:14px; color:rgba(229,226,225,0.45); text-align:center; padding:24px 0;">No titles in watch history yet.</p>
            ` : `
              <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(140px, 1fr)); gap:14px; max-height:260px; overflow-y:auto; padding-right:8px;">
                ${watchHistory.map(item => `
                  <div style="background:rgba(255,255,255,0.04); border-radius:12px; padding:10px; border:1px solid rgba(255,255,255,0.08);">
                    <div style="font-weight:800; font-size:13px; color:#fff; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${item.title}">${item.title || 'Movie / Show'}</div>
                    <div style="font-size:11px; color:rgba(229,226,225,0.5); margin-top:4px;">ID: ${item.content_id}</div>
                  </div>
                `).join('')}
              </div>
            `}
          </div>

          <!-- Watchlist Bookmarks -->
          <div style="background:rgba(255,255,255,0.02); padding:28px; border-radius:22px; border:1px solid rgba(255,255,255,0.08);">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
              <h4 style="font-size:18px; font-weight:900; color:#fff;">Watchlist Bookmarks (${watchlist.length})</h4>
            </div>

            ${watchlist.length === 0 ? `
              <p style="font-size:14px; color:rgba(229,226,225,0.45); text-align:center; padding:24px 0;">No titles saved in watchlist.</p>
            ` : `
              <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(140px, 1fr)); gap:14px; max-height:220px; overflow-y:auto; padding-right:8px;">
                ${watchlist.map(item => `
                  <div style="background:rgba(255,255,255,0.04); border-radius:12px; padding:10px; border:1px solid rgba(255,255,255,0.08);">
                    <div style="font-weight:800; font-size:13px; color:#fff; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${item.title}">${item.title || 'Saved Item'}</div>
                    <div style="font-size:11px; color:#ffc832; margin-top:4px;">Bookmarked</div>
                  </div>
                `).join('')}
              </div>
            `}
          </div>

        </div>

      </div>
    `;
  }

  async function toggleUserAdmin(userId, makeAdmin) {
    try {
      if (window.sb) {
        await window.sb
          .from('profiles')
          .update({ is_admin: makeAdmin, admin: makeAdmin, role: makeAdmin ? 'admin' : 'user' })
          .eq('id', userId);
        
        UI.toast(`User admin status updated!`, 'success');
        await loadUsersList();
      }
    } catch (err) {
      UI.toast('Failed to update admin role.', 'error');
    }
  }

  async function grantUserSubscription(userId) {
    try {
      if (window.sb) {
        const endDate = new Date();
        endDate.setDate(endDate.getDate() + 30);

        await window.sb.from('subscriptions').upsert({
          user_id: userId,
          plan_id: 'premium',
          status: 'active',
          start_date: new Date().toISOString(),
          end_date: endDate.toISOString(),
          source: 'admin_grant'
        });

        UI.toast('Granted 30-Day Premium Subscription!', 'success');
        await loadSubscriptionHolders();
        await loadUsersList();
        await loadMetrics();
      }
    } catch (err) {
      UI.toast('Failed to grant subscription.', 'error');
    }
  }

  // ── GIFT CODES MANAGEMENT (Adding & Editing Options) ──
  async function loadGiftCodes() {
    const tableBody = document.getElementById('admin-giftcodes-table-body');
    const saveBtn = document.getElementById('save-code-btn');
    const genRandomBtn = document.getElementById('gen-random-code-btn');
    const codeInput = document.getElementById('new-code-input');

    if (!tableBody) return;

    try {
      if (window.sb) {
        const { data } = await window.sb.from('gift_codes').select('*').order('created_at', { ascending: false });
        if (data) activeGiftCodes = data;
      }
    } catch (e) {
      console.warn('Failed to load gift codes:', e);
    }

    const renderCodes = () => {
      const searchQ = (document.getElementById('admin-gift-search')?.value || '').toLowerCase().trim();
      const filtered = activeGiftCodes.filter(c => !searchQ || c.code.toLowerCase().includes(searchQ));

      if (filtered.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="5" style="padding:36px; text-align:center; color:rgba(229,226,225,0.45); font-size:15px;">No voucher codes found</td></tr>`;
        return;
      }

      tableBody.innerHTML = filtered.map(code => {
        const used = code.usage_count || 0;
        const max = code.max_uses || 100;
        const percent = Math.min(100, Math.round((used / max) * 100));
        const planTier = (code.plan_id || 'premium').toUpperCase();

        return `
          <tr style="border-bottom:1px solid rgba(255,255,255,0.06); transition:background 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.04)'" onmouseout="this.style.background='transparent'">
            
            <td style="padding:18px 22px;">
              <span class="copy-pill" style="border-color:rgba(255,200,50,0.4); background:rgba(255,200,50,0.1); color:#ffc832; font-weight:900; font-size:15px;" onclick="AdminPage.copyGiftCode('${code.code}')" title="Click to Copy Voucher Code">
                <span>${code.code}</span>
                <span class="material-symbols-outlined" style="font-size:16px;">content_copy</span>
              </span>
            </td>

            <td style="padding:18px 22px;">
              <span style="font-size:12px; font-weight:900; padding:5px 12px; border-radius:8px; background:rgba(20,209,255,0.18); color:#14d1ff; border:1px solid rgba(20,209,255,0.35);">
                ${planTier}
              </span>
            </td>

            <td style="padding:18px 22px; font-size:14px; color:rgba(229,226,225,0.9); font-weight:700;">
              ${code.duration_days} Days Access
            </td>

            <td style="padding:18px 22px; min-width:180px;">
              <div style="display:flex; justify-content:space-between; font-size:12.5px; font-weight:800; margin-bottom:6px;">
                <span style="color:${used >= max ? '#ff6b6b' : '#32dc78'};">${used} / ${max} Used</span>
                <span style="color:rgba(229,226,225,0.5);">${percent}%</span>
              </div>
              <div style="height:6px; background:rgba(255,255,255,0.1); border-radius:100px; overflow:hidden;">
                <div style="height:100%; width:${percent}%; background:${used >= max ? '#ff6b6b' : 'linear-gradient(90deg, #32dc78, #14d1ff)'}; border-radius:100px;"></div>
              </div>
            </td>

            <td style="padding:18px 22px; text-align:right;">
              <div style="display:flex; gap:10px; justify-content:flex-end;">
                
                <button onclick="AdminPage.editGiftCode('${code.id}')" class="btn btn-ghost btn-sm" style="font-size:13px; padding:7px 14px; border:1px solid rgba(255,255,255,0.18); border-radius:10px; font-weight:800;">
                  Edit
                </button>

                <button onclick="AdminPage.deleteGiftCode('${code.id}')" class="btn btn-ghost btn-sm" style="color:#ff6b6b; font-size:13px; padding:7px 14px; border-radius:10px; border-color:rgba(255,107,107,0.35); font-weight:800; background:rgba(255,107,107,0.06);">
                  Delete
                </button>

              </div>
            </td>
          </tr>
        `;
      }).join('');
    };

    renderCodes();

    const searchInput = document.getElementById('admin-gift-search');
    if (searchInput) searchInput.oninput = renderCodes;

    if (genRandomBtn && codeInput) {
      genRandomBtn.onclick = () => {
        codeInput.value = 'CINE' + Math.random().toString(36).substring(2, 8).toUpperCase();
      };
    }

    if (saveBtn) {
      saveBtn.onclick = () => saveGiftCode();
    }
  }

  // ── SAVE / EDIT GIFT CODE ──
  async function saveGiftCode() {
    const editId = document.getElementById('edit-code-id')?.value;
    const code = (document.getElementById('new-code-input')?.value || '').trim().toUpperCase();
    const plan = document.getElementById('new-code-plan')?.value || 'premium';
    const days = parseInt(document.getElementById('new-code-days')?.value || '30');
    const uses = parseInt(document.getElementById('new-code-uses')?.value || '100');

    if (!code) {
      UI.toast('Please enter a voucher code.', 'warning');
      return;
    }

    try {
      if (window.sb) {
        if (editId) {
          await window.sb.from('gift_codes').update({
            code: code,
            plan_id: plan,
            duration_days: days,
            max_uses: uses
          }).eq('id', editId);
          UI.toast(`Voucher code ${code} updated successfully!`, 'success');
        } else {
          await window.sb.from('gift_codes').insert({
            code: code,
            plan_id: plan,
            duration_days: days,
            max_uses: uses,
            usage_count: 0
          });
          UI.toast(`Gift code ${code} created successfully!`, 'success');
        }

        resetGiftCodeForm();
        await loadGiftCodes();
      }
    } catch (err) {
      UI.toast('Failed to save voucher code.', 'error');
    }
  }

  function editGiftCode(id) {
    const codeObj = activeGiftCodes.find(c => c.id === id);
    if (!codeObj) return;

    document.getElementById('edit-code-id').value = codeObj.id;
    document.getElementById('new-code-input').value = codeObj.code;
    document.getElementById('new-code-plan').value = codeObj.plan_id || 'premium';
    document.getElementById('new-code-days').value = codeObj.duration_days || 30;
    document.getElementById('new-code-uses').value = codeObj.max_uses || 100;

    const titleEl = document.getElementById('gift-form-title');
    const btnText = document.getElementById('save-code-btn-text');
    const cancelBtn = document.getElementById('cancel-edit-code-btn');

    if (titleEl) titleEl.textContent = 'Edit Gift Voucher';
    if (btnText) btnText.textContent = 'UPDATE VOUCHER CODE';
    if (cancelBtn) cancelBtn.style.display = 'inline-block';

    document.getElementById('gift-code-form-card')?.scrollIntoView({ behavior: 'smooth' });
  }

  function resetGiftCodeForm() {
    document.getElementById('edit-code-id').value = '';
    document.getElementById('new-code-input').value = '';
    document.getElementById('new-code-days').value = '30';
    document.getElementById('new-code-uses').value = '100';

    const titleEl = document.getElementById('gift-form-title');
    const btnText = document.getElementById('save-code-btn-text');
    const cancelBtn = document.getElementById('cancel-edit-code-btn');

    if (titleEl) titleEl.textContent = 'Create New Gift Voucher';
    if (btnText) btnText.textContent = 'CREATE VOUCHER CODE';
    if (cancelBtn) cancelBtn.style.display = 'none';
  }

  function copyGiftCode(codeStr) {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(codeStr);
      UI.toast(`Voucher code "${codeStr}" copied to clipboard!`, 'success');
    }
  }

  async function deleteGiftCode(id) {
    UI.showModal({
      title: 'Delete Gift Code',
      content: 'Are you sure you want to delete this promotional gift voucher code?',
      confirmText: 'Delete Code',
      cancelText: 'Cancel',
      dangerous: true,
      onConfirm: async () => {
        try {
          if (window.sb) {
            await window.sb.from('gift_codes').delete().eq('id', id);
            UI.toast('Gift code removed.', 'info');
            await loadGiftCodes();
          }
        } catch (e) {
          UI.toast('Failed to delete gift code.', 'error');
        }
      }
    });
  }

  // ── SHOWS CATALOG MANAGER ──
  async function loadShowsCatalog() {
    const loadingEl = document.getElementById('admin-shows-loading');
    const gridEl = document.getElementById('admin-shows-grid');
    const emptyEl = document.getElementById('admin-shows-empty');

    if (loadingEl) loadingEl.style.display = 'block';
    if (gridEl) gridEl.style.display = 'none';
    if (emptyEl) emptyEl.style.display = 'none';

    try {
      let tmdbMovies = [];
      let tmdbTV = [];

      if (window.TMDB) {
        tmdbMovies = await TMDB.getPopular('movie').catch(() => []);
        tmdbTV = await TMDB.getPopular('tv').catch(() => []);
      }

      let customContent = [];
      if (window.sb) {
        const { data } = await window.sb.from('content').select('*');
        if (data) customContent = data;
      }

      const combined = [
        ...customContent,
        ...(window.DEMO_CONTENT || []),
        ...tmdbMovies,
        ...tmdbTV
      ];

      const seen = new Set();
      catalogShows = [];
      combined.forEach(item => {
        if (item && item.id && !seen.has(String(item.id))) {
          seen.add(String(item.id));
          catalogShows.push({
            id: item.id,
            title: item.title || item.name || 'Untitled Show',
            poster: item.poster || item.poster_url || item.thumbnail || '',
            type: item.type || (item.first_air_date ? 'tv' : 'movie'),
            year: item.year || (item.release_date || item.first_air_date || '').substring(0, 4) || '2025',
            imdb: item.imdb || (item.vote_average ? String(item.vote_average).substring(0, 3) : '8.5'),
            genre: item.genre || 'Action / Drama',
            description: item.description || item.overview || 'No synopsis available.',
            isCustom: !!customContent.find(c => c.id == item.id)
          });
        }
      });

      filteredShows = [...catalogShows];
      renderShowsCatalog();
      setupShowsFilters();
    } catch (err) {
      console.error('Error loading shows catalog:', err);
    } finally {
      if (loadingEl) loadingEl.style.display = 'none';
    }
  }

  function setupShowsFilters() {
    const searchInput = document.getElementById('admin-shows-search');
    const typeSelect = document.getElementById('admin-shows-type');
    const sortSelect = document.getElementById('admin-shows-sort');
    const addShowBtn = document.getElementById('admin-add-show-btn');

    const applyFilters = () => {
      const q = (searchInput?.value || '').toLowerCase().trim();
      const type = typeSelect?.value || 'all';
      const sort = sortSelect?.value || 'popular';

      filteredShows = catalogShows.filter(show => {
        const matchesQuery = !q || show.title.toLowerCase().includes(q) || String(show.id).includes(q) || show.genre.toLowerCase().includes(q);
        const matchesType = type === 'all' || show.type === type;
        return matchesQuery && matchesType;
      });

      if (sort === 'rating') {
        filteredShows.sort((a, b) => parseFloat(b.imdb || 0) - parseFloat(a.imdb || 0));
      } else if (sort === 'title') {
        filteredShows.sort((a, b) => a.title.localeCompare(b.title));
      }

      renderShowsCatalog();
    };

    if (searchInput) searchInput.oninput = applyFilters;
    if (typeSelect) typeSelect.onchange = applyFilters;
    if (sortSelect) sortSelect.onchange = applyFilters;

    if (addShowBtn) {
      addShowBtn.onclick = () => openAddCustomShowModal();
    }
  }

  function renderShowsCatalog() {
    const gridEl = document.getElementById('admin-shows-grid');
    const emptyEl = document.getElementById('admin-shows-empty');
    const countEl = document.getElementById('admin-shows-count');

    if (!gridEl) return;

    if (countEl) {
      countEl.textContent = `Showing ${filteredShows.length} of ${catalogShows.length} total shows in catalog`;
    }

    if (filteredShows.length === 0) {
      gridEl.style.display = 'none';
      if (emptyEl) emptyEl.style.display = 'block';
      return;
    }

    gridEl.style.display = 'grid';
    if (emptyEl) emptyEl.style.display = 'none';

    gridEl.innerHTML = filteredShows.map(show => {
      const posterUrl = UI.getSecurePosterUrl(show.poster);
      const isTv = show.type === 'tv' || show.type === 'series';
      const typeLabel = isTv ? '📺 TV Show' : (show.type === 'anime' ? '⚡ Anime' : '🎬 Movie');
      
      return `
        <div class="glass-card" style="border-radius:16px; overflow:hidden; border:1px solid rgba(255,255,255,0.08); display:flex; flex-direction:column; background:rgba(20,20,26,0.7); transition:transform 0.25s, border-color 0.25s;" onmouseover="this.style.borderColor='rgba(20,209,255,0.4)'; this.style.transform='translateY(-3px)';" onmouseout="this.style.borderColor='rgba(255,255,255,0.08)'; this.style.transform='translateY(0)';">
          
          <div style="height:260px; position:relative; overflow:hidden; background:#121216;">
            <img src="${posterUrl}" alt="${show.title}" loading="lazy" style="width:100%; height:100%; object-fit:cover;" onerror="this.onerror=null;this.src='data:image/svg+xml;utf8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22170%22 height=%22255%22 viewBox=%220 0 170 255%22%3E%3Crect width=%22170%22 height=%22255%22 fill=%22%231a1a1a%22/%3E%3Ctext x=%2250%25%22 y=%2250%25%22 dominant-baseline=%22middle%22 text-anchor=%22middle%22 font-size=%2236%22 fill=%22%23333%22%3E🎬%3C/text%3E%3C/svg%3E'">
            
            <div style="position:absolute; top:10px; left:10px; display:flex; gap:6px; flex-wrap:wrap;">
              <span style="font-size:10.5px; font-weight:800; padding:3px 10px; border-radius:100px; background:rgba(0,0,0,0.8); color:#14d1ff; backdrop-filter:blur(6px); border:1px solid rgba(20,209,255,0.35);">${typeLabel}</span>
              ${show.isCustom ? `<span style="font-size:10.5px; font-weight:800; padding:3px 10px; border-radius:100px; background:rgba(229,9,20,0.85); color:#fff;">CUSTOM</span>` : ''}
            </div>

            <div style="position:absolute; top:10px; right:10px;">
              <span style="font-size:11.5px; font-weight:800; padding:3px 8px; border-radius:8px; background:rgba(0,0,0,0.8); color:#ffc832; backdrop-filter:blur(6px); border:1px solid rgba(255,200,50,0.35);">⭐ ${show.imdb}</span>
            </div>

            <div style="position:absolute; bottom:0; inset-x:0; padding:10px 14px; background:linear-gradient(0deg, rgba(10,10,14,0.95) 0%, transparent 100%);">
              <span style="font-size:11px; color:rgba(229,226,225,0.65); font-family:monospace;">ID: ${show.id}</span>
            </div>
          </div>

          <div style="padding:16px; flex:1; display:flex; flex-direction:column; justify-content:space-between;">
            <div>
              <h4 style="font-size:15px; font-weight:800; color:#fff; margin-bottom:4px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${show.title}">${show.title}</h4>
              <p style="font-size:12px; color:rgba(229,226,225,0.55); margin-bottom:14px;">${show.year} • ${show.genre}</p>
            </div>

            <div style="display:flex; flex-direction:column; gap:8px; margin-top:8px;">
              <button onclick="AdminPage.testShowStream('${show.id}', '${show.type}')" class="btn btn-primary btn-sm" style="border-radius:10px; font-size:13px; padding:10px; gap:8px; justify-content:center; background:linear-gradient(135deg, #e50914 0%, #ff3d4f 100%); font-weight:800;">
                <span class="material-symbols-outlined" style="font-size:18px;">play_circle</span>
                <span>Play & Test Stream</span>
              </button>

              <button onclick="AdminPage.inspectShowDetails('${show.id}', '${show.type}')" class="btn btn-ghost btn-sm" style="border-radius:10px; font-size:12.5px; padding:8px; gap:8px; justify-content:center; border:1px solid rgba(255,255,255,0.12); font-weight:600;">
                <span class="material-symbols-outlined" style="font-size:18px;">info</span>
                <span>Inspect Show Details</span>
              </button>
            </div>

          </div>

        </div>
      `;
    }).join('');
  }

  // ── TEST STREAM & PLAYBACK VERIFICATION FOR ANY SHOW ──
  async function testShowStream(contentId, type = 'movie') {
    const modal = document.getElementById('admin-show-modal');
    const modalBody = document.getElementById('admin-modal-body');
    const closeBtn = document.getElementById('admin-modal-close');

    if (!modal || !modalBody) return;

    modal.style.display = 'flex';
    if (closeBtn) closeBtn.onclick = () => modal.style.display = 'none';

    const isTv = type === 'tv' || type === 'series';
    const season = 1;
    const episode = 1;

    const vidlinkUrl = isTv
      ? `https://vidlink.pro/tv/${contentId}/${season}/${episode}`
      : `https://vidlink.pro/movie/${contentId}`;

    const superembedUrl = isTv
      ? `https://multiembed.mov/?video_id=${contentId}&tmdb=1&s=${season}&e=${episode}`
      : `https://multiembed.mov/?video_id=${contentId}&tmdb=1`;

    const embed2Url = isTv
      ? `https://www.2embed.cc/embedtv/${contentId}&s=${season}&e=${episode}`
      : `https://www.2embed.cc/embed/${contentId}`;

    modalBody.innerHTML = `
      <div style="margin-bottom:20px;">
        <div style="display:flex; align-items:center; gap:10px; margin-bottom:6px;">
          <span style="font-size:12px; font-weight:800; background:rgba(50,220,120,0.18); color:#32dc78; padding:4px 12px; border-radius:100px;">● Stream Tester</span>
          <span style="font-size:13px; color:rgba(229,226,225,0.6);">TMDB ID: ${contentId}</span>
        </div>
        <h3 style="font-size:24px; font-weight:900; color:#fff;">Live Player Stream Verification</h3>
      </div>

      <div style="display:flex; gap:10px; margin-bottom:20px; flex-wrap:wrap;">
        <button class="btn btn-secondary-outline btn-sm admin-player-server active" data-src="${vidlinkUrl}" style="border-radius:10px; font-size:13px; font-weight:700;">VidLink Server (Primary)</button>
        <button class="btn btn-ghost btn-sm admin-player-server" data-src="${superembedUrl}" style="border-radius:10px; font-size:13px; border:1px solid rgba(255,255,255,0.15); font-weight:700;">SuperEmbed Server</button>
        <button class="btn btn-ghost btn-sm admin-player-server" data-src="${embed2Url}" style="border-radius:10px; font-size:13px; border:1px solid rgba(255,255,255,0.15); font-weight:700;">2Embed Server</button>
        <button onclick="Router.navigate('player', {id:'${contentId}'})" class="btn btn-primary btn-sm" style="border-radius:10px; font-size:13px; margin-left:auto; font-weight:800;">Full Player Page →</button>
      </div>

      <div style="position:relative; width:100%; height:460px; border-radius:16px; overflow:hidden; background:#000; border:1px solid rgba(255,255,255,0.12);">
        <iframe id="admin-preview-iframe" src="${vidlinkUrl}" style="width:100%; height:100%; border:none;" allowfullscreen allow="autoplay; encrypted-media"></iframe>
      </div>

      <div style="margin-top:16px; padding:14px 18px; border-radius:12px; background:rgba(255,255,255,0.04); font-size:13px; color:rgba(229,226,225,0.7); display:flex; justify-content:space-between; align-items:center;">
        <span>Status: If video loads smoothly, this stream source is 100% operational for end users.</span>
        <button onclick="document.getElementById('admin-preview-iframe').src += ''" class="btn btn-ghost btn-sm" style="font-size:12px; padding:6px 14px; font-weight:700;">Reload Stream</button>
      </div>
    `;

    modalBody.querySelectorAll('.admin-player-server').forEach(btn => {
      btn.onclick = () => {
        modalBody.querySelectorAll('.admin-player-server').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const iframe = document.getElementById('admin-preview-iframe');
        if (iframe) iframe.src = btn.dataset.src;
      };
    });
  }

  // ── INSPECT SHOW DETAILS MODAL ──
  async function inspectShowDetails(contentId, type = 'movie') {
    const modal = document.getElementById('admin-show-modal');
    const modalBody = document.getElementById('admin-modal-body');
    const closeBtn = document.getElementById('admin-modal-close');

    if (!modal || !modalBody) return;

    modal.style.display = 'flex';
    if (closeBtn) closeBtn.onclick = () => modal.style.display = 'none';

    modalBody.innerHTML = `
      <div style="text-align:center; padding:40px 0;">
        <div style="width:40px; height:40px; border:3px solid rgba(20,209,255,0.2); border-top-color:#14d1ff; border-radius:50%; animation:spin 0.9s linear infinite; margin:0 auto 14px;"></div>
        <p style="color:rgba(229,226,225,0.6); font-size:14px;">Fetching TMDB show metadata...</p>
      </div>
    `;

    let details = null;
    if (window.TMDB) {
      details = await TMDB.getDetails(contentId, type).catch(() => null);
    }

    if (!details) {
      details = catalogShows.find(s => s.id == contentId) || { title: 'Unknown', description: 'N/A' };
    }

    modalBody.innerHTML = `
      <div style="display:flex; gap:28px; flex-wrap:wrap;">
        <div style="width:220px; flex-shrink:0;">
          <img src="${UI.getSecurePosterUrl(details.poster)}" style="width:100%; border-radius:16px; border:1px solid rgba(255,255,255,0.15);" alt="Poster">
        </div>
        
        <div style="flex:1; min-width:280px;">
          <div style="display:flex; align-items:center; gap:10px; margin-bottom:10px;">
            <span style="font-size:12px; font-weight:800; background:rgba(20,209,255,0.18); color:#14d1ff; padding:4px 12px; border-radius:100px;">TMDB ID: ${details.id}</span>
            <span style="font-size:13px; color:rgba(229,226,225,0.5);">${details.year || ''}</span>
          </div>

          <h2 style="font-size:26px; font-weight:900; color:#fff; margin-bottom:14px;">${details.title}</h2>
          <p style="font-size:14.5px; color:rgba(229,226,225,0.75); line-height:1.7; margin-bottom:24px;">${details.description || details.overview || 'No overview provided.'}</p>

          <div style="display:grid; grid-template-columns:1fr 1fr; gap:14px; margin-bottom:28px; background:rgba(255,255,255,0.04); padding:18px; border-radius:14px;">
            <div>
              <span style="font-size:12px; color:rgba(229,226,225,0.45); display:block; margin-bottom:4px;">Genre</span>
              <span style="font-size:14px; font-weight:700; color:#fff;">${details.genre || 'N/A'}</span>
            </div>
            <div>
              <span style="font-size:12px; color:rgba(229,226,225,0.45); display:block; margin-bottom:4px;">IMDB Rating</span>
              <span style="font-size:14px; font-weight:800; color:#ffc832;">⭐ ${details.imdb || 'N/A'}</span>
            </div>
          </div>

          <div style="display:flex; gap:12px; flex-wrap:wrap;">
            <button onclick="AdminPage.testShowStream('${details.id}', '${type}')" class="btn btn-primary" style="border-radius:12px; gap:10px; padding:12px 22px; font-weight:800;">
              <span class="material-symbols-outlined">play_circle</span>
              <span>Test Stream Player</span>
            </button>

            <button onclick="Router.navigate('detail', {id:'${details.id}', type:'${type}'}); document.getElementById('admin-show-modal').style.display='none';" class="btn btn-ghost" style="border-radius:12px; gap:8px; border:1px solid rgba(255,255,255,0.15); padding:12px 20px;">
              <span class="material-symbols-outlined">open_in_new</span>
              <span>View User Detail Page</span>
            </button>
          </div>
        </div>
      </div>
    `;
  }

  function openAddCustomShowModal() {
    const modal = document.getElementById('admin-show-modal');
    const modalBody = document.getElementById('admin-modal-body');
    const closeBtn = document.getElementById('admin-modal-close');

    if (!modal || !modalBody) return;

    modal.style.display = 'flex';
    if (closeBtn) closeBtn.onclick = () => modal.style.display = 'none';

    modalBody.innerHTML = `
      <h3 style="font-size:22px; font-weight:900; color:#14d1ff; margin-bottom:8px;">Add Custom Show / Override</h3>
      <p style="font-size:13px; color:rgba(229,226,225,0.6); margin-bottom:24px;">Add custom movie entries directly into Supabase database.</p>

      <div style="display:flex; flex-direction:column; gap:16px;">
        <div>
          <label class="input-label" style="font-size:12px; font-weight:800; text-transform:uppercase; display:block; margin-bottom:6px;">Title</label>
          <input type="text" id="custom-show-title" class="input-field" placeholder="Show Title" style="border-radius:12px; font-size:15px; padding:14px 16px; height:50px;">
        </div>

        <div>
          <label class="input-label" style="font-size:12px; font-weight:800; text-transform:uppercase; display:block; margin-bottom:6px;">Custom Content ID (TMDB or Unique String)</label>
          <input type="text" id="custom-show-id" class="input-field" placeholder="e.g. 550" style="border-radius:12px; font-size:15px; padding:14px 16px; height:50px;">
        </div>

        <div>
          <label class="input-label" style="font-size:12px; font-weight:800; text-transform:uppercase; display:block; margin-bottom:6px;">Poster Image URL</label>
          <input type="text" id="custom-show-poster" class="input-field" placeholder="https://image.tmdb.org/t/p/w500/..." style="border-radius:12px; font-size:15px; padding:14px 16px; height:50px;">
        </div>

        <div>
          <label class="input-label" style="font-size:12px; font-weight:800; text-transform:uppercase; display:block; margin-bottom:6px;">Overview / Description</label>
          <textarea id="custom-show-desc" class="input-field" rows="3" placeholder="Plot summary..." style="border-radius:12px; font-size:14px; padding:14px 16px; resize:vertical;"></textarea>
        </div>

        <button id="save-custom-show-btn" class="btn btn-primary" style="border-radius:14px; padding:16px; font-size:15px; font-weight:900; margin-top:10px;">SAVE TO DATABASE</button>
      </div>
    `;

    document.getElementById('save-custom-show-btn').onclick = async () => {
      const title = document.getElementById('custom-show-title').value.trim();
      const id = document.getElementById('custom-show-id').value.trim();
      const poster = document.getElementById('custom-show-poster').value.trim();
      const desc = document.getElementById('custom-show-desc').value.trim();

      if (!title || !id) {
        UI.toast('Please enter title and content ID.', 'warning');
        return;
      }

      try {
        if (window.sb) {
          await window.sb.from('content').upsert({
            id: String(id),
            title: title,
            poster: poster,
            description: desc,
            type: 'movie',
            created_at: new Date().toISOString()
          });
        }
        UI.toast('Custom media entry added!', 'success');
        modal.style.display = 'none';
        await loadShowsCatalog();
      } catch (err) {
        UI.toast('Failed to save entry.', 'error');
      }
    };
  }

  return {
    init,
    testShowStream,
    inspectShowDetails,
    openAddUserModal,
    openUserDetailsModal,
    toggleUserAdmin,
    grantUserSubscription,
    editGiftCode,
    resetGiftCodeForm,
    copyGiftCode,
    deleteGiftCode,
    loadTableDataInspector
  };
})();

window.AdminPage = AdminPage;
