/* CineStream — Zero-API Scraper Page Controller */

const ScraperPage = (() => {
  // Always use relative path — works on Vercel (serverless), and locally via vite proxy
  // Local dev: start backend with `npm run backend` OR configure vite proxy below
  const API_BASE = '/api';

  let currentResult = null;
  let activeStreamIndex = 0;

  async function init() {
    document.getElementById('navbar-mount').innerHTML = UI.renderNavbar('scraper');
    document.getElementById('footer-mount').innerHTML = UI.renderFooter();
    document.getElementById('mobile-nav-mount').innerHTML = UI.renderMobileNav('scraper');
    UI.updateNavbarUser();
    UI.initRipples();

    const session = await window.Auth.getSession();
    if (!session) {
      UI.toast('Please login to use the scraper.', 'info');
      Router.navigate('login');
      return;
    }

    bindEvents();

    // Auto-search if a query was passed via router params
    const params = window.RouterParams || {};
    if (params.q) {
      const input = document.getElementById('scraper-search-input');
      if (input) input.value = decodeURIComponent(params.q);
      if (params.type) {
        const sel = document.getElementById('scraper-type-select');
        if (sel) sel.value = params.type;
      }
      await doSearch();
    }
  }

  function bindEvents() {
    const searchBtn = document.getElementById('scraper-search-btn');
    const searchInput = document.getElementById('scraper-search-input');

    if (searchBtn) searchBtn.onclick = doSearch;
    if (searchInput) {
      searchInput.onkeydown = (e) => {
        if (e.key === 'Enter') doSearch();
      };
    }
  }

  async function doSearch() {
    const input = document.getElementById('scraper-search-input');
    const typeSelect = document.getElementById('scraper-type-select');
    const query = input?.value?.trim();
    const type = typeSelect?.value || 'movie';

    if (!query || query.length < 2) {
      showStatus('Please enter at least 2 characters to search.', 'warning');
      return;
    }

    setLoadingState(true);
    hideAllSections();

    try {
      const res = await fetch(`${API_BASE}/scrape?search=${encodeURIComponent(query)}&type=${type}`, {
        signal: AbortSignal.timeout(20000)
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        showStatus(data.error || 'No results found for this title. Try a different search.', 'error');
        showEmpty();
        return;
      }

      currentResult = data;
      activeStreamIndex = 0;
      renderResult(data);

    } catch (err) {
      if (err.name === 'TimeoutError') {
        showStatus('Request timed out. The scraper is taking too long — try a simpler search term.', 'error');
      } else if (err.message?.includes('Failed to fetch')) {
        showStatus('Cannot reach the scraper API. If running locally, start the backend: npm run backend', 'error');
      } else {
        showStatus('An unexpected error occurred. Please try again.', 'error');
        console.error('Scraper fetch error:', err);
      }
      showEmpty();
    } finally {
      setLoadingState(false);
    }
  }

  function renderResult(data) {
    // Poster
    const posterEl = document.getElementById('scraper-poster');
    const posterWrap = document.getElementById('scraper-poster-wrap');
    if (data.poster) {
      posterEl.src = data.poster;
      posterEl.onerror = () => {
        posterWrap.style.background = 'linear-gradient(135deg, rgba(229,9,20,0.15), rgba(20,209,255,0.1))';
        posterEl.style.display = 'none';
      };
    } else {
      posterWrap.style.background = 'linear-gradient(135deg, rgba(229,9,20,0.15), rgba(20,209,255,0.1))';
      posterEl.style.display = 'none';
    }

    // Title, type, year
    const titleEl = document.getElementById('scraper-title');
    const descEl = document.getElementById('scraper-desc');
    const typeBadge = document.getElementById('scraper-type-badge');
    const yearBadge = document.getElementById('scraper-year-badge');

    if (titleEl) titleEl.textContent = data.title || 'Unknown Title';
    if (descEl) descEl.textContent = data.description || 'No description available from public source.';
    if (typeBadge) typeBadge.textContent = data.type === 'tv' ? '📺 TV Show' : '🎬 Movie';
    if (yearBadge && data.year) yearBadge.textContent = data.year;

    // Cast chips
    const castWrap = document.getElementById('scraper-cast-wrap');
    const castEl = document.getElementById('scraper-cast');
    if (data.cast_list && data.cast_list.length > 0 && castEl) {
      castEl.innerHTML = data.cast_list.map(c => `
        <span class="cast-chip">
          <span class="material-symbols-outlined" style="font-size:13px; color:rgba(229,226,225,0.4);">person</span>
          <span>${c.name}${c.character ? ` <span style="color:rgba(229,226,225,0.4)">as ${c.character}</span>` : ''}</span>
        </span>
      `).join('');
      if (castWrap) castWrap.style.display = 'block';
    } else {
      if (castWrap) castWrap.style.display = 'none';
    }

    // Source link
    const sourceLink = document.getElementById('scraper-source-link');
    if (sourceLink && data.source_url) sourceLink.href = data.source_url;

    // Stream server buttons
    const streamsEl = document.getElementById('scraper-streams');
    if (streamsEl && data.streams?.length) {
      const serverNames = ['FrameX TV', 'VidLink', 'Own Server'];
      streamsEl.innerHTML = data.streams.map((url, i) => `
        <button class="scraper-stream-btn ${i === 0 ? 'active' : ''}" data-index="${i}" title="${url}">
          <span class="material-symbols-outlined" style="font-size:16px;">dns</span>
          ${serverNames[i] || `Server ${i + 1}`}
        </button>
      `).join('');

      streamsEl.querySelectorAll('.scraper-stream-btn').forEach(btn => {
        btn.onclick = () => {
          activeStreamIndex = parseInt(btn.dataset.index);
          streamsEl.querySelectorAll('.scraper-stream-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
        };
      });
    }

    // Play button
    const playBtn = document.getElementById('scraper-play-btn');
    if (playBtn) {
      playBtn.onclick = () => {
        if (!currentResult?.tmdb_id) {
          UI.toast('No TMDB ID found — cannot play this title.', 'error');
          return;
        }
        const activeStream = currentResult.streams?.[activeStreamIndex] || currentResult.stream;
        Router.navigate('player', {
          id: currentResult.tmdb_id,
          type: currentResult.type === 'tv' ? 'tv' : 'movie',
          title: currentResult.title,
          stream: activeStream
        });
      };
    }

    // More info button
    const detailBtn = document.getElementById('scraper-detail-btn');
    if (detailBtn) {
      detailBtn.onclick = () => {
        if (!currentResult?.tmdb_id) {
          UI.toast('No TMDB ID found — cannot show details.', 'error');
          return;
        }
        Router.navigate('detail', {
          id: currentResult.tmdb_id,
          type: currentResult.type === 'tv' ? 'tv' : 'movie'
        });
      };
    }

    // Show result section
    const resultEl = document.getElementById('scraper-result');
    if (resultEl) resultEl.style.display = 'block';
  }

  // ── Helpers ──

  function setLoadingState(loading) {
    const btn = document.getElementById('scraper-search-btn');
    const loader = document.getElementById('scraper-loading');
    if (btn) UI.setLoading(btn, loading);
    if (loader) loader.style.display = loading ? 'block' : 'none';
  }

  function hideAllSections() {
    const ids = ['scraper-result', 'scraper-empty', 'scraper-status'];
    ids.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
  }

  function showEmpty() {
    const el = document.getElementById('scraper-empty');
    if (el) el.style.display = 'block';
  }

  function showStatus(message, type = 'info') {
    const el = document.getElementById('scraper-status');
    if (!el) return;

    const colors = {
      info:    { bg: 'rgba(20,209,255,0.08)',  border: 'rgba(20,209,255,0.2)',  text: 'rgba(20,209,255,0.9)',  icon: 'info' },
      success: { bg: 'rgba(76,175,80,0.08)',   border: 'rgba(76,175,80,0.2)',   text: 'rgba(76,175,80,0.9)',   icon: 'check_circle' },
      warning: { bg: 'rgba(255,193,7,0.08)',   border: 'rgba(255,193,7,0.2)',   text: 'rgba(255,193,7,0.9)',   icon: 'warning' },
      error:   { bg: 'rgba(229,9,20,0.08)',    border: 'rgba(229,9,20,0.2)',    text: 'rgba(229,9,20,0.9)',    icon: 'error' },
    };
    const c = colors[type] || colors.info;

    el.style.cssText = `display:flex; align-items:flex-start; gap:10px; margin-top:16px; padding:14px 20px; border-radius:10px; font-size:14px; font-weight:500; background:${c.bg}; border:1px solid ${c.border}; color:${c.text};`;
    el.innerHTML = `<span class="material-symbols-outlined" style="font-size:18px; flex-shrink:0; margin-top:1px;">${c.icon}</span><span>${message}</span>`;
  }

  return { init };
})();

window.ScraperPage = ScraperPage;
