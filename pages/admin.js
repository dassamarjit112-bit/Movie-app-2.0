/* CineStream — Admin Panel Controller */

const AdminPage = (() => {
  let catalogShows = [];
  let filteredShows = [];
  let userProfiles = [];
  let activeGiftCodes = [];

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
        UI.toast('Refreshing admin catalog data...', 'info');
        loadAllData();
      };
    }

    // Setup Navigation Tabs
    setupAdminTabs();

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
      };
    });
  }

  async function loadAllData() {
    await Promise.all([
      loadShowsCatalog(),
      loadUsersList(),
      loadGiftCodes(),
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

      // Fetch active subscriptions count
      if (window.sb) {
        const { count } = await window.sb
          .from('subscriptions')
          .select('*', { count: 'exact', head: true })
          .eq('status', 'active');
        if (subsCountEl) subsCountEl.textContent = count || 0;
      }
    } catch (e) {
      console.warn('Metrics load error:', e);
    }
  }

  // ── SHOWS CATALOG MANAGER ("check all shows in admin pannel properly") ──
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

      // Fetch movies & TV shows from TMDB API
      if (window.TMDB) {
        tmdbMovies = await TMDB.getPopular('movie').catch(() => []);
        tmdbTV = await TMDB.getPopular('tv').catch(() => []);
      }

      // Fetch custom content inserted in Supabase
      let customContent = [];
      if (window.sb) {
        const { data } = await window.sb.from('content').select('*');
        if (data) customContent = data;
      }

      // Combine datasets
      const combined = [
        ...customContent,
        ...(window.DEMO_CONTENT || []),
        ...tmdbMovies,
        ...tmdbTV
      ];

      // Remove duplicates by ID
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
            imdb: item.imdb || item.vote_average ? String(item.vote_average).substring(0, 3) : '8.5',
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
        <div class="glass-card" style="border-radius:14px; overflow:hidden; border:1px solid rgba(255,255,255,0.08); display:flex; flex-direction:column; background:rgba(20,20,24,0.6); transition:transform 0.2s, border-color 0.2s;" onmouseover="this.style.borderColor='rgba(20,209,255,0.4)'; this.style.transform='translateY(-2px)';" onmouseout="this.style.borderColor='rgba(255,255,255,0.08)'; this.style.transform='translateY(0)';">
          
          <!-- Poster Container -->
          <div style="height:240px; position:relative; overflow:hidden; background:#121216;">
            <img src="${posterUrl}" alt="${show.title}" loading="lazy" style="width:100%; height:100%; object-fit:cover;" onerror="this.onerror=null;this.src='data:image/svg+xml;utf8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22170%22 height=%22255%22 viewBox=%220 0 170 255%22%3E%3Crect width=%22170%22 height=%22255%22 fill=%22%231a1a1a%22/%3E%3Ctext x=%2250%25%22 y=%2250%25%22 dominant-baseline=%22middle%22 text-anchor=%22middle%22 font-size=%2236%22 fill=%22%23333%22%3E🎬%3C/text%3E%3C/svg%3E'">
            
            <div style="position:absolute; top:8px; left:8px; display:flex; gap:4px; flex-wrap:wrap;">
              <span style="font-size:10px; font-weight:800; padding:2px 8px; border-radius:100px; background:rgba(0,0,0,0.75); color:#14d1ff; backdrop-filter:blur(4px); border:1px solid rgba(20,209,255,0.3);">${typeLabel}</span>
              ${show.isCustom ? `<span style="font-size:10px; font-weight:800; padding:2px 8px; border-radius:100px; background:rgba(229,9,20,0.8); color:#fff;">CUSTOM</span>` : ''}
            </div>

            <div style="position:absolute; top:8px; right:8px;">
              <span style="font-size:11px; font-weight:800; padding:2px 6px; border-radius:6px; background:rgba(0,0,0,0.75); color:#ffc832; backdrop-filter:blur(4px); border:1px solid rgba(255,200,50,0.3);">⭐ ${show.imdb}</span>
            </div>

            <div style="position:absolute; bottom:0; inset-x:0; padding:8px 12px; background:linear-gradient(0deg, rgba(10,10,14,0.95) 0%, transparent 100%);">
              <span style="font-size:10px; color:rgba(229,226,225,0.6); font-family:monospace;">ID: ${show.id}</span>
            </div>
          </div>

          <!-- Info Body -->
          <div style="padding:14px; flex:1; display:flex; flex-direction:column; justify-content:space-between;">
            <div>
              <h4 style="font-size:14px; font-weight:800; color:#fff; margin-bottom:4px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${show.title}">${show.title}</h4>
              <p style="font-size:11px; color:rgba(229,226,225,0.5); margin-bottom:12px;">${show.year} • ${show.genre}</p>
            </div>

            <!-- Admin Action Buttons -->
            <div style="display:flex; flex-direction:column; gap:6px; margin-top:8px;">
              <button onclick="AdminPage.testShowStream('${show.id}', '${show.type}')" class="btn btn-primary btn-sm" style="border-radius:8px; font-size:12px; padding:8px; gap:6px; justify-content:center; background:linear-gradient(135deg, #e50914 0%, #ff3d4f 100%);">
                <span class="material-symbols-outlined" style="font-size:16px;">play_circle</span>
                <span>Play & Test Stream</span>
              </button>

              <button onclick="AdminPage.inspectShowDetails('${show.id}', '${show.type}')" class="btn btn-ghost btn-sm" style="border-radius:8px; font-size:12px; padding:6px; gap:6px; justify-content:center; border:1px solid rgba(255,255,255,0.1);">
                <span class="material-symbols-outlined" style="font-size:16px;">info</span>
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

    // Build embed player options
    const isTv = type === 'tv' || type === 'series';
    const season = 1;
    const episode = 1;

    // Standard high quality player embed servers
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
      <div style="margin-bottom:16px;">
        <div style="display:flex; align-items:center; gap:10px; margin-bottom:6px;">
          <span style="font-size:11px; font-weight:800; background:rgba(50,220,120,0.15); color:#32dc78; padding:3px 10px; border-radius:100px;">● Stream Tester</span>
          <span style="font-size:12px; color:rgba(229,226,225,0.5);">TMDB ID: ${contentId}</span>
        </div>
        <h3 style="font-size:20px; font-weight:800; color:#fff;">Live Player Stream Verification</h3>
      </div>

      <!-- Server Switcher Tabs -->
      <div style="display:flex; gap:8px; margin-bottom:16px; flex-wrap:wrap;">
        <button class="btn btn-secondary-outline btn-sm admin-player-server active" data-src="${vidlinkUrl}" style="border-radius:8px; font-size:12px;">VidLink Server (Primary)</button>
        <button class="btn btn-ghost btn-sm admin-player-server" data-src="${superembedUrl}" style="border-radius:8px; font-size:12px; border:1px solid rgba(255,255,255,0.1);">SuperEmbed Server</button>
        <button class="btn btn-ghost btn-sm admin-player-server" data-src="${embed2Url}" style="border-radius:8px; font-size:12px; border:1px solid rgba(255,255,255,0.1);">2Embed Server</button>
        <button onclick="Router.navigate('player', {id:'${contentId}'})" class="btn btn-primary btn-sm" style="border-radius:8px; font-size:12px; margin-left:auto;">Full Player Page →</button>
      </div>

      <!-- Video Player Frame -->
      <div style="position:relative; width:100%; height:420px; border-radius:12px; overflow:hidden; background:#000; border:1px solid rgba(255,255,255,0.1);">
        <iframe id="admin-preview-iframe" src="${vidlinkUrl}" style="width:100%; height:100%; border:none;" allowfullscreen allow="autoplay; encrypted-media"></iframe>
      </div>

      <div style="margin-top:14px; padding:12px; border-radius:10px; background:rgba(255,255,255,0.03); font-size:12px; color:rgba(229,226,225,0.6); display:flex; justify-content:space-between; align-items:center;">
        <span>Status: If video loads smoothly, this stream source is 100% operational for end users.</span>
        <button onclick="document.getElementById('admin-preview-iframe').src += ''" class="btn btn-ghost btn-sm" style="font-size:11px; padding:4px 10px;">Reload Stream</button>
      </div>
    `;

    // Bind server switch buttons inside preview modal
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
        <div style="width:36px; height:36px; border:3px solid rgba(20,209,255,0.2); border-top-color:#14d1ff; border-radius:50%; animation:spin 0.9s linear infinite; margin:0 auto 12px;"></div>
        <p style="color:rgba(229,226,225,0.5); font-size:13px;">Fetching TMDB show metadata...</p>
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
      <div style="display:flex; gap:24px; flex-wrap:wrap;">
        <div style="width:200px; flex-shrink:0;">
          <img src="${UI.getSecurePosterUrl(details.poster)}" style="width:100%; border-radius:14px; border:1px solid rgba(255,255,255,0.1);" alt="Poster">
        </div>
        
        <div style="flex:1; min-width:260px;">
          <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
            <span style="font-size:11px; font-weight:800; background:rgba(20,209,255,0.15); color:#14d1ff; padding:2px 8px; border-radius:100px;">TMDB ID: ${details.id}</span>
            <span style="font-size:12px; color:rgba(229,226,225,0.4);">${details.year || ''}</span>
          </div>

          <h2 style="font-size:24px; font-weight:900; color:#fff; margin-bottom:12px;">${details.title}</h2>
          <p style="font-size:13.5px; color:rgba(229,226,225,0.7); line-height:1.6; margin-bottom:20px;">${details.description || details.overview || 'No overview provided.'}</p>

          <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:24px; background:rgba(255,255,255,0.03); padding:16px; border-radius:12px;">
            <div>
              <span style="font-size:11px; color:rgba(229,226,225,0.4); display:block;">Genre</span>
              <span style="font-size:13px; font-weight:600; color:#fff;">${details.genre || 'N/A'}</span>
            </div>
            <div>
              <span style="font-size:11px; color:rgba(229,226,225,0.4); display:block;">IMDB Rating</span>
              <span style="font-size:13px; font-weight:600; color:#ffc832;">⭐ ${details.imdb || 'N/A'}</span>
            </div>
          </div>

          <div style="display:flex; gap:10px; flex-wrap:wrap;">
            <button onclick="AdminPage.testShowStream('${details.id}', '${type}')" class="btn btn-primary" style="border-radius:10px; gap:8px;">
              <span class="material-symbols-outlined">play_circle</span>
              <span>Test Stream Player</span>
            </button>

            <button onclick="Router.navigate('detail', {id:'${details.id}', type:'${type}'}); document.getElementById('admin-show-modal').style.display='none';" class="btn btn-ghost" style="border-radius:10px; gap:6px; border:1px solid rgba(255,255,255,0.15);">
              <span class="material-symbols-outlined">open_in_new</span>
              <span>View User Detail Page</span>
            </button>
          </div>
        </div>
      </div>
    `;
  }

  // ── ADD CUSTOM SHOW OVERRIDE ──
  function openAddCustomShowModal() {
    const modal = document.getElementById('admin-show-modal');
    const modalBody = document.getElementById('admin-modal-body');
    const closeBtn = document.getElementById('admin-modal-close');

    if (!modal || !modalBody) return;

    modal.style.display = 'flex';
    if (closeBtn) closeBtn.onclick = () => modal.style.display = 'none';

    modalBody.innerHTML = `
      <h3 style="font-size:20px; font-weight:800; color:#14d1ff; margin-bottom:6px;">Add Custom Show / Override</h3>
      <p style="font-size:12px; color:rgba(229,226,225,0.5); margin-bottom:20px;">Add custom movie entries directly into Supabase database.</p>

      <div style="display:flex; flex-direction:column; gap:14px;">
        <div>
          <label class="input-label" style="font-size:11px; font-weight:700; text-transform:uppercase; display:block; margin-bottom:6px;">Title</label>
          <input type="text" id="custom-show-title" class="input-field" placeholder="Show Title" style="border-radius:10px; font-size:14px; padding:10px 14px;">
        </div>

        <div>
          <label class="input-label" style="font-size:11px; font-weight:700; text-transform:uppercase; display:block; margin-bottom:6px;">Custom Content ID (TMDB or Unique String)</label>
          <input type="text" id="custom-show-id" class="input-field" placeholder="e.g. 550" style="border-radius:10px; font-size:14px; padding:10px 14px;">
        </div>

        <div>
          <label class="input-label" style="font-size:11px; font-weight:700; text-transform:uppercase; display:block; margin-bottom:6px;">Poster Image URL</label>
          <input type="text" id="custom-show-poster" class="input-field" placeholder="https://image.tmdb.org/t/p/w500/..." style="border-radius:10px; font-size:14px; padding:10px 14px;">
        </div>

        <div>
          <label class="input-label" style="font-size:11px; font-weight:700; text-transform:uppercase; display:block; margin-bottom:6px;">Overview / Description</label>
          <textarea id="custom-show-desc" class="input-field" rows="3" placeholder="Plot summary..." style="border-radius:10px; font-size:13px; padding:10px 14px; resize:vertical;"></textarea>
        </div>

        <button id="save-custom-show-btn" class="btn btn-primary" style="border-radius:10px; padding:12px; font-size:14px; font-weight:800; margin-top:8px;">SAVE TO DATABASE</button>
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

  // ── USER MANAGEMENT ──
  async function loadUsersList() {
    const tableBody = document.getElementById('admin-users-table-body');
    const searchInput = document.getElementById('admin-users-search');
    if (!tableBody) return;

    try {
      if (window.sb) {
        const { data, error } = await window.sb.from('profiles').select('*').order('created_at', { ascending: false });
        if (!error && data) {
          userProfiles = data;
        }
      }
    } catch (e) {
      console.warn('Failed to load users:', e);
    }

    const renderUsers = () => {
      const q = (searchInput?.value || '').toLowerCase().trim();
      const filtered = userProfiles.filter(u => !q || (u.full_name || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q) || (u.id || '').toLowerCase().includes(q));

      if (filtered.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="5" style="padding:24px; text-align:center; color:rgba(229,226,225,0.4);">No user profiles found</td></tr>`;
        return;
      }

      tableBody.innerHTML = filtered.map(user => {
        const isAdmin = user.is_admin === true || user.admin === true || user.role === 'admin';
        return `
          <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
            <td style="padding:12px 16px;">
              <div style="display:flex; align-items:center; gap:10px;">
                <img src="${user.avatar_url || 'https://api.dicebear.com/7.x/initials/svg?seed=' + (user.full_name||'User')}" style="width:32px; height:32px; border-radius:50%; object-fit:cover;">
                <div>
                  <div style="font-weight:700; color:#fff;">${user.full_name || 'CineStream User'}</div>
                  <div style="font-size:11px; color:rgba(229,226,225,0.5);">${user.email || 'Registered User'}</div>
                </div>
              </div>
            </td>
            <td style="padding:12px 16px; font-family:monospace; font-size:11px; color:rgba(229,226,225,0.5);">${(user.id || '').substring(0, 18)}...</td>
            <td style="padding:12px 16px;">
              <span style="font-size:10px; font-weight:800; padding:2px 8px; border-radius:100px; ${isAdmin ? 'background:rgba(20,209,255,0.15); color:#14d1ff;' : 'background:rgba(255,255,255,0.06); color:rgba(229,226,225,0.6);'}">${isAdmin ? 'ADMINISTRATOR' : 'MEMBER'}</span>
            </td>
            <td style="padding:12px 16px;">
              <button onclick="AdminPage.toggleUserAdmin('${user.id}', ${!isAdmin})" class="btn ${isAdmin ? 'btn-ghost' : 'btn-secondary-outline'} btn-sm" style="border-radius:6px; font-size:11px; padding:4px 10px;">
                ${isAdmin ? 'Demote User' : 'Make Admin'}
              </button>
            </td>
            <td style="padding:12px 16px;">
              <button onclick="AdminPage.grantUserSubscription('${user.id}')" class="btn btn-ghost btn-sm" style="border-radius:6px; font-size:11px; color:#32dc78; padding:4px 10px; border-color:rgba(50,220,120,0.2);">
                Grant 30D Plan
              </button>
            </td>
          </tr>
        `;
      }).join('');
    };

    if (searchInput) searchInput.oninput = renderUsers;
    renderUsers();
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

        await window.sb.from('subscriptions').insert({
          user_id: userId,
          plan_id: 'premium',
          status: 'active',
          start_date: new Date().toISOString(),
          end_date: endDate.toISOString(),
          source: 'admin_grant'
        });

        UI.toast('Granted 30-Day Premium Subscription!', 'success');
        await loadMetrics();
      }
    } catch (err) {
      UI.toast('Failed to grant subscription.', 'error');
    }
  }

  // ── GIFT CODES MANAGEMENT ──
  async function loadGiftCodes() {
    const tableBody = document.getElementById('admin-giftcodes-table-body');
    const createBtn = document.getElementById('create-code-btn');
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
      if (activeGiftCodes.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="5" style="padding:24px; text-align:center; color:rgba(229,226,225,0.4);">No gift codes found</td></tr>`;
        return;
      }

      tableBody.innerHTML = activeGiftCodes.map(code => `
        <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
          <td style="padding:10px 12px; font-weight:800; font-family:monospace; color:#ffc832;">${code.code}</td>
          <td style="padding:10px 12px; font-size:12px; text-transform:capitalize;">${code.plan_id}</td>
          <td style="padding:10px 12px; font-size:12px;">${code.duration_days} Days</td>
          <td style="padding:10px 12px; font-size:12px;">${code.usage_count || 0} / ${code.max_uses || 100}</td>
          <td style="padding:10px 12px;">
            <button onclick="AdminPage.deleteGiftCode('${code.id}')" class="btn btn-ghost btn-sm" style="color:#ff6b6b; font-size:11px; padding:2px 8px;">Delete</button>
          </td>
        </tr>
      `).join('');
    };

    renderCodes();

    if (genRandomBtn && codeInput) {
      genRandomBtn.onclick = () => {
        codeInput.value = 'CINE' + Math.random().toString(36).substring(2, 8).toUpperCase();
      };
    }

    if (createBtn) {
      createBtn.onclick = async () => {
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
            await window.sb.from('gift_codes').insert({
              code: code,
              plan_id: plan,
              duration_days: days,
              max_uses: uses,
              usage_count: 0
            });
            UI.toast(`Gift code ${code} created!`, 'success');
            if (codeInput) codeInput.value = '';
            await loadGiftCodes();
          }
        } catch (err) {
          UI.toast('Failed to create code.', 'error');
        }
      };
    }
  }

  async function deleteGiftCode(id) {
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

  return {
    init,
    testShowStream,
    inspectShowDetails,
    toggleUserAdmin,
    grantUserSubscription,
    deleteGiftCode
  };
})();

window.AdminPage = AdminPage;
