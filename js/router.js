/* ============================================================
   CineStream — SPA Router
   Hash-based routing with auth guards and page transitions
   ============================================================ */

const Router = (() => {
  // Route registry
  const routes = {
    'login':         { page: 'pages/login.html',          auth: false },
    'home':          { page: 'pages/home.html',            auth: false }, // public – browse without login
    'movies':        { page: 'pages/movies.html',          auth: true  }, // login required to watch
    'tvshows':       { page: 'pages/tvshows.html',         auth: true  }, // login required to watch
    'detail':        { page: 'pages/detail.html',          auth: true  }, // login required
    'player':        { page: 'pages/player.html',          auth: true  }, // login required
    'subscribe':     { page: 'pages/subscribe.html',       auth: true  },
    'giftcode':      { page: 'pages/giftcode.html',        auth: true  },
    'account':       { page: 'pages/account.html',         auth: true  },
    'admin':         { page: 'pages/admin.html',           auth: true  },
    'search':        { page: 'pages/search.html',          auth: true  },
    'anime':         { page: 'pages/anime.html',           auth: true  },
    'scraper':       { page: 'pages/scraper.html',         auth: true  },
    'select-country': { page: 'pages/select-country.html', auth: true  },
    'sports':        { page: 'pages/sports.html',          auth: false }, // public – browse sports without login
    'sports-stream': { page: 'pages/sports-stream.html',  auth: true  }, // login required to stream
    'apk':           { page: 'pages/apk.html',            auth: false }, // always public
    'downloads':     { page: 'pages/downloads.html',      auth: true  }
  };

  const appEl = document.getElementById('app');
  const loadingBar = document.getElementById('top-loading-bar');
  let currentRoute = null;
  let currentQuery = null;

  // ── Navigate to a route ──
  function navigate(route, params = {}) {
    const hash = params && Object.keys(params).length
      ? `#/${route}?${new URLSearchParams(params).toString()}`
      : `#/${route}`;
    window.location.hash = hash;
  }

  // ── Parse hash ──
  function parseHash() {
    const rawHash = window.location.hash;

    // Check if it's a Supabase auth callback hash
    if (rawHash.includes('access_token=') || rawHash.includes('recovery_token=') || rawHash.includes('type=signup') || rawHash.includes('error=')) {
      if (rawHash.includes('error=')) {
        const match = rawHash.match(/error_description=([^&]+)/);
        const errMsg = match ? decodeURIComponent(match[1].replace(/\+/g, ' ')) : 'Authentication failed';
        setTimeout(() => {
          if (window.UI && typeof window.UI.toast === 'function') {
            window.UI.toast(errMsg, 'error');
          }
          window.location.hash = '#/login';
        }, 100);
      } else {
        setTimeout(() => {
          if (window.UI && typeof window.UI.toast === 'function') {
            window.UI.toast('Authentication successful! 🎬', 'success');
          }
          window.location.hash = '#/select-country';
        }, 100);
      }
      return { route: 'select-country', params: {} };
    }

    const hash = rawHash.replace('#/', '') || 'home';
    const [route, queryStr] = hash.split('?');
    const params = {};
    if (queryStr) {
      new URLSearchParams(queryStr).forEach((v, k) => params[k] = v);
    }
    return { route: route || 'home', params };
  }

  // ── Load page HTML ──
  async function loadPage(pageFile) {
    // Show loading bar
    if (loadingBar) {
      loadingBar.style.width = '30%';
      loadingBar.style.opacity = '1';
    }

    try {
      const res = await fetch(pageFile);
      if (!res.ok) throw new Error(`Page not found: ${pageFile}`);
      const html = await res.text();

      if (loadingBar) loadingBar.style.width = '90%';
      return html;
    } catch (e) {
      console.error('Router: Failed to load page', e);
      return `<div class="flex-center" style="min-height:100vh;flex-direction:column;gap:16px;">
        <span class="material-symbols-outlined" style="font-size:64px;color:var(--c-primary-container)">error</span>
        <h2 class="text-headline-md">Page not found</h2>
        <button class="btn btn-primary" onclick="Router.navigate('home')">Go Home</button>
      </div>`;
    }
  }

  // ── Render a page ──
  async function render() {
    const { route, params } = parseHash();
    const routeConfig = routes[route] || routes['home'];

    // Store params globally for pages to read
    window.RouterParams = params;

    // Auth guard
    if (routeConfig.auth) {
      const session = await window.Auth.getSession();
      if (!session) {
        navigate('login');
        return;
      }
    }

    // Already on exact same route and params (no-op unless forced)
    const queryString = new URLSearchParams(params).toString();
    if (currentRoute === route && currentQuery === queryString && !params.force) {
      return;
    }

    currentRoute = route;
    currentQuery = queryString;
    const html = await loadPage(routeConfig.page);

    // Inject HTML
    appEl.innerHTML = `<div class="page-container">${html}</div>`;

    // Hide loading bar
    if (loadingBar) {
      loadingBar.style.width = '100%';
      setTimeout(() => {
        loadingBar.style.opacity = '0';
        loadingBar.style.width = '0%';
      }, 300);
    }

    // Update nav active states
    updateNavActive(route);

    // Run page-specific init
    runPageInit(route, params);

    // Run intersection observer for section animations
    initSectionObserver();

    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  // ── Route-specific initialization ──
  function runPageInit(route, params = {}) {
    switch (route) {
      case 'login':       window.LoginPage?.init(); break;
      case 'home':        window.HomePage?.init(); break;
      case 'movies':      window.MoviesPage?.init(); break;
      case 'tvshows':     window.TVShowsPage?.init(); break;
      case 'detail':      window.DetailPage?.init(params); break;
      case 'search':      window.SearchPage?.init(params); break;
      case 'player':      window.PlayerPage?.init(params); break;
      case 'subscribe':   window.SubscribePage?.init(); break;
      case 'giftcode':    window.GiftCodePage?.init(); break;
      case 'anime':       window.AnimePage?.init(); break;
      case 'account':     window.AccountPage?.init(); break;
      case 'admin':       window.AdminPage?.init(); break;
      case 'select-country': window.SelectCountryPage?.init(); break;
      case 'scraper':     window.ScraperPage?.init(); break;
      case 'sports':      window.SportsPage?.init(); break;
      case 'sports-stream': window.SportsStreamPage?.init(params); break;
      case 'apk':         window.ApkPage?.init(); break;
      case 'downloads':   window.DownloadsPage?.init(); break;
    }
    // Trigger global ad banner
    const adRoutes = ['login', 'home', 'movies', 'tvshows', 'sports', 'sports-stream', 'apk'];
    const banner = document.getElementById('global-ad-banner');
    if (adRoutes.includes(route)) {
      if (banner) banner.style.display = 'flex';
      if (typeof window.initAdBanner === 'function') {
        try { window.initAdBanner(); } catch (e) { console.warn('Ad banner init error:', e); }
      }
    } else {
      if (banner) banner.style.display = 'none';
    }
  }

  // ── Update navbar active state ──
  function updateNavActive(route) {
    document.querySelectorAll('[data-nav-link]').forEach(el => {
      el.classList.remove('active');
      if (el.dataset.navLink === route) el.classList.add('active');
    });

    document.querySelectorAll('.mobile-nav-item').forEach(el => {
      el.classList.remove('active');
      if (el.dataset.route === route) el.classList.add('active');
    });
  }

  // ── Intersection Observer for section animations ──
  function initSectionObserver() {
    const sections = document.querySelectorAll('.section');
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.08 });

    sections.forEach(s => observer.observe(s));
  }

  // ── Bootstrap ──
  function init() {
    window.addEventListener('hashchange', render);
    render();

    // Handle scroll for navbar
    window.addEventListener('scroll', () => {
      const navbar = document.querySelector('.navbar');
      if (navbar) {
        navbar.classList.toggle('scrolled', window.scrollY > 60);
      }
    });
  }

  return { navigate, init, parseHash };
})();

window.Router = Router;
