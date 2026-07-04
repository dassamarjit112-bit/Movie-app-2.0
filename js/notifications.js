/* ============================================================
   CineStream — Notification Engine
   Beautiful in-app + Android Web Push notifications
   ============================================================ */

const NotificationSystem = (() => {

  // ── State for real live score tracking ──
  let _liveMatchCache = {}; // matchId → last known scores
  let _liveMatchInterval = null;

  // ── State ──
  let _swRegistration = null;
  let _notifPermission = 'default';
  let _panelOpen = false;
  let _notifications = [];
  let _unreadCount = 0;
  let _scoreIntervals = {};
  let _announcedUpcoming = {}; // matchId → true once start-time notif sent
  let _bannerQueue = [];
  let _bannerShowing = false;
  let _deniedBannerShownThisSession = false; // Track if we've shown the "please enable" banner this session

  // ── Init ──
  async function init() {
    await _registerServiceWorker();
    _loadStoredNotifications();
    _injectPanel();
    _schedulePeriodic();

    // Show permission modal on first open (after a tiny delay for page to load)
    await _checkPermission();

    // Start real live score polling (wait for SportsAPI to be ready)
    setTimeout(() => _startRealLiveScorePolling(), 5000);
  }

  // ── Service Worker ──
  async function _registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    try {
      _swRegistration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      console.log('[Notif] SW registered');

      // Listen for messages from SW
      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data?.type === 'NAVIGATE' && event.data.url) {
          window.location.hash = event.data.url;
        }
      });
    } catch (e) {
      console.warn('[Notif] SW registration failed:', e);
    }
  }

  // ── Permission ──
  async function _checkPermission() {
    // 1. Check Swing2App native container push status
    if (typeof swingWebViewPlugin !== 'undefined' && swingWebViewPlugin.app && swingWebViewPlugin.app.methods) {
      try {
        swingWebViewPlugin.app.methods.isNotificationEnabled(function (result) {
          if (result == '1') {
            console.log('[Notif] Swing2App: Push is fully active inside the container');
          } else if (result == 'off_on_system') {
            console.warn('[Notif] Swing2App Blocked: Android/iOS system settings have blocked notifications.');
            if (window.UI) window.UI.toast('Please enable notifications for this app in your device settings.', 'warning');
          } else if (result == 'off_on_app') {
            console.warn('[Notif] Swing2App Blocked: Internal settings have disabled pushes.');
          }
        });
      } catch (e) {
        console.warn('Swing2App check failed', e);
      }
    }

    if (!('Notification' in window)) return;
    _notifPermission = Notification.permission;
    
    // Configure OneSignal tags for server-side pushing
    if (window.OneSignal) {
      window.OneSignalDeferred = window.OneSignalDeferred || [];
      OneSignalDeferred.push(function(OneSignal) {
        if (_notifPermission === 'granted') {
           OneSignal.User.addTags({
             movies: "true",
             sports: "true",
             app_active: "true"
           });
        }
      });
    }

    if (_notifPermission === 'default' || _notifPermission === 'denied') {
      // Wait for page to render before showing the banner
      await new Promise(resolve => setTimeout(resolve, 2000));
      // If denied, show a slightly different banner prompting to enable in settings
      _showWelcomePermissionModal();
    }
  }

  // ── Compact top banner notification permission (NOT full screen) ──
  function _showWelcomePermissionModal() {
    if (document.getElementById('notif-welcome-modal')) return;
    localStorage.setItem('cs_notif_asked', '1');

    const isDenied = _notifPermission === 'denied';

    // If already denied and we've already shown the banner this session, don't show again
    if (isDenied && _deniedBannerShownThisSession) return;
    _deniedBannerShownThisSession = true;

    const banner = document.createElement('div');
    banner.id = 'notif-welcome-modal';
    banner.innerHTML = `
      <style>
        .nwm-slide-down {
          animation: nwm-slide-in 0.4s cubic-bezier(0.34,1.56,0.64,1);
        }
        @keyframes nwm-slide-in {
          from { opacity:0; transform:translateY(-100%) scale(0.95); }
          to { opacity:1; transform:translateY(0) scale(1); }
        }
        #notif-welcome-modal {
          position:fixed; top:16px; left:50%; transform:translateX(-50%);
          z-index:99999; width:min(420px, calc(100vw - 32px));
          pointer-events:auto;
        }
        .nwm-banner {
          background:linear-gradient(135deg,#1a1a1a,#0f0f0f);
          border:1px solid rgba(229,9,20,0.2);
          border-radius:16px; padding:16px 18px;
          box-shadow:0 16px 48px rgba(0,0,0,0.8),0 0 0 1px rgba(229,9,20,0.08);
          display:flex; align-items:center; gap:14px;
        }
        .nwm-banner-icon {
          width:42px;height:42px;border-radius:12px;
          background:rgba(229,9,20,0.15);border:1px solid rgba(229,9,20,0.2);
          display:flex;align-items:center;justify-content:center;
          font-size:22px;flex-shrink:0;
        }
        .nwm-banner-text { flex:1; min-width:0; }
        .nwm-banner-title {
          font-size:13px;font-weight:700;color:#fff;margin-bottom:2px;
          font-family:'Inter',sans-serif;
        }
        .nwm-banner-desc {
          font-size:11px;color:rgba(229,226,225,0.55);line-height:1.4;
          display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;
        }
        .nwm-banner-actions { display:flex; gap:6px; flex-shrink:0; }
        .nwm-allow-btn-sm {
          background:linear-gradient(135deg,#e50914,#c0000c); color:#fff; border:none;
          border-radius:10px; padding:8px 14px; font-size:11px; font-weight:700;
          cursor:pointer; white-space:nowrap; font-family:'Inter',sans-serif;
          box-shadow:0 4px 12px rgba(229,9,20,0.3);
          transition:all 0.2s;
        }
        .nwm-allow-btn-sm:hover { filter:brightness(1.15);transform:translateY(-1px); }
        .nwm-skip-btn-sm {
          background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.1); color:rgba(229,226,225,0.4);
          border-radius:10px; padding:8px 12px; font-size:11px; font-weight:600;
          cursor:pointer; white-space:nowrap; font-family:'Inter',sans-serif;
          transition:all 0.2s;
        }
        .nwm-skip-btn-sm:hover { background:rgba(255,255,255,0.12);color:rgba(229,226,225,0.7); }
        .nwm-close-btn {
          background:none;border:none;color:rgba(229,226,225,0.2);font-size:18px;cursor:pointer;
          padding:0 2px;flex-shrink:0;transition:color 0.2s;line-height:1;
        }
        .nwm-close-btn:hover { color:rgba(229,226,225,0.6); }
        .nwm-settings-btn-sm {
          background:linear-gradient(135deg,#e50914,#c0000c); color:#fff; border:none;
          border-radius:10px; padding:8px 14px; font-size:11px; font-weight:700;
          cursor:pointer; white-space:nowrap; font-family:'Inter',sans-serif;
          box-shadow:0 4px 12px rgba(229,9,20,0.3);
          transition:all 0.2s;
        }
        .nwm-settings-btn-sm:hover { filter:brightness(1.15);transform:translateY(-1px); }
      </style>
      <div class="nwm-banner nwm-slide-down">
        <div class="nwm-banner-icon">${isDenied ? '⚠️' : '🔔'}</div>
        <div class="nwm-banner-text">
          <div class="nwm-banner-title">${isDenied ? 'Notifications are Blocked' : 'Enable Notifications?'}</div>
          <div class="nwm-banner-desc">${isDenied ? 'Please enable notifications in your browser/device settings to get live scores, new releases & more' : 'Get alerts for new movies, live scores & more'}</div>
        </div>
        <div class="nwm-banner-actions">
          ${isDenied
            ? `<button class="nwm-settings-btn-sm" onclick="window._notifModalSettings()">Open Settings</button>`
            : `<button class="nwm-allow-btn-sm" onclick="window._notifModalAllow()">Allow</button>`
          }
          <button class="nwm-skip-btn-sm" onclick="window._notifModalSkip()">Dismiss</button>
        </div>
        <button class="nwm-close-btn" onclick="window._notifModalSkip()">×</button>
      </div>
    `;

    document.body.appendChild(banner);

    window._notifModalAllow = async () => {
      banner.remove();
      await requestPermission();
    };
    window._notifModalSettings = () => {
      banner.remove();
      // Try to open browser/device notification settings
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        // For some browsers, this URL pattern opens settings
        window.open('about:settings', '_blank');
      }
      // Show a toast with instructions
      if (window.UI && window.UI.toast) {
        window.UI.toast('Go to your browser settings → Privacy & Security → Site Settings → Notifications, then allow this site.', 'info', 8000);
      }
    };
    window._notifModalSkip = () => {
      banner.style.opacity = '0';
      banner.style.transform = 'translateX(-50%) translateY(-20px)';
      banner.style.transition = 'opacity 0.3s, transform 0.3s';
      setTimeout(() => banner.remove(), 300);
    };
  }

  async function requestPermission() {
    // Support for Median.co JS Bridge
    if (window.median && window.median.push && typeof window.median.push.register === 'function') {
      window.median.push.register();
    }
    if (window.median && window.median.onesignal && typeof window.median.onesignal.register === 'function') {
      window.median.onesignal.register();
    }

    if (!('Notification' in window)) return false;
    
    let result = Notification.permission;

    if (window.OneSignal) {
      // Use OneSignal's native permission requester
      await window.OneSignal.Slidedown.promptPush();
      result = Notification.permission;
    } else {
      result = await Notification.requestPermission();
    }

    _notifPermission = result;
    if (result === 'granted') {
      if (window.OneSignal) {
        window.OneSignalDeferred = window.OneSignalDeferred || [];
        OneSignalDeferred.push(function(OneSignal) {
           OneSignal.User.addTags({
             movies: "true",
             sports: "true",
             app_active: "true"
           });
        });
      }
      
      _showAndroidNotification({
        title: '🎬 CineStream Notifications ON',
        body: "You'll now get live FIFA scores, new releases & more!",
        type: 'update',
      });
      _addToPanel({
        id: 'perm-granted',
        title: '✅ Notifications Enabled',
        body: "You'll get live scores, new releases & app updates.",
        type: 'update',
        time: Date.now(),
        read: false,
        icon: '🔔',
      });
    }
    return result === 'granted';
  }

  // ── Android-style Web Push Notification ──
  function _showAndroidNotification({ title, body, type, image, url, tag }) {
    const isSwing2App = typeof swingWebViewPlugin !== 'undefined';

    if (isSwing2App || _notifPermission !== 'granted') {
      // In Swing2App, native local browser notifications are swallowed, or if permission isn't granted.
      // Fallback to a rich in-app banner!
      _showInAppBanner({ title, body, type, image, url });
      return;
    }

    // Let Service Worker handle the push notification natively in standard browsers
    if (_swRegistration) {
      _swRegistration.showNotification(title, {
        body,
        icon: '/icons/icon-192.png',
        badge: '/icons/badge-72.png',
        tag: tag || `cinestream-${Date.now()}`,
        renotify: true,
        vibrate: [150, 80, 150],
        data: { url: url || '/', type },
        image: image || undefined,
        actions: type === 'score'
          ? [{ action: 'watch', title: '⚽ Watch Live' }]
          : [{ action: 'open', title: '▶ Watch Now' }],
        requireInteraction: type === 'score',
      });
    } else {
      new Notification(title, { body, icon: '/icons/icon-192.png' });
    }
  }

  // ── Process banner queue: show one at a time ──
  function _processBannerQueue() {
    if (_bannerShowing || _bannerQueue.length === 0) return;
    _bannerShowing = true;

    const { title, body, type, image, url } = _bannerQueue.shift();

    let container = document.getElementById('in-app-banner-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'in-app-banner-container';
      container.style.cssText = 'position:fixed; top:20px; left:50%; transform:translateX(-50%); z-index:999999; width:min(94vw, 400px); pointer-events:none;';

      const style = document.createElement('style');
      style.innerHTML = `
        @keyframes iab-slide-down { from { opacity:0; transform:translateY(-20px) scale(0.95); } to { opacity:1; transform:translateY(0) scale(1); } }
        @keyframes iab-slide-up { to { opacity:0; transform:translateY(-20px) scale(0.95); } }
      `;
      document.head.appendChild(style);
      document.body.appendChild(container);
    }

    const banner = document.createElement('div');
    banner.innerHTML = `
      <div style="display:flex; align-items:center; gap:14px; padding:14px 18px; background:linear-gradient(135deg, rgba(30,30,30,0.95), rgba(15,15,15,0.95)); backdrop-filter:blur(16px); -webkit-backdrop-filter:blur(16px); border:1px solid rgba(255,255,255,0.15); border-radius:20px; box-shadow:0 15px 50px rgba(0,0,0,0.8), inset 0 1px 0 rgba(255,255,255,0.1); cursor:pointer; pointer-events:auto; animation: iab-slide-down 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);">
        ${image ? `<img src="${image}" style="width:48px;height:48px;border-radius:10px;object-fit:cover;box-shadow:0 4px 12px rgba(0,0,0,0.5);">` : `<div style="font-size:28px; width:48px; height:48px; display:flex; align-items:center; justify-content:center; background:rgba(229,9,20,0.15); border-radius:10px; border:1px solid rgba(229,9,20,0.3);">🔔</div>`}
        <div style="flex:1;">
          <div style="font-size:14px; font-weight:800; color:#fff; margin-bottom:4px; font-family:'Montserrat', sans-serif;">${title}</div>
          <div style="font-size:12px; color:rgba(255,255,255,0.65); line-height:1.4; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;">${body}</div>
        </div>
      </div>
    `;

    banner.onclick = () => {
      if (url) window.location.hash = url;
      else openPanel();
      _dismissBanner(banner);
    };

    container.innerHTML = '';
    container.appendChild(banner);

    setTimeout(() => {
      _dismissBanner(banner);
    }, 6000);
  }

  function _dismissBanner(banner) {
    if (!banner || !document.body.contains(banner)) {
      _bannerShowing = false;
      _processBannerQueue();
      return;
    }
    banner.style.animation = 'iab-slide-up 0.3s forwards';
    setTimeout(() => {
      if (document.body.contains(banner)) banner.remove();
      _bannerShowing = false;
      _processBannerQueue();
    }, 300);
  }

  // ── In-App Banner Fallback (For Swing2App & iOS without Push) ──
  function _showInAppBanner({ title, body, type, image, url }) {
    _bannerQueue.push({ title, body, type, image, url });
    _processBannerQueue();
  }

  // ── Add to in-app panel ──
  function _addToPanel(notif) {
    _notifications.unshift(notif);
    if (_notifications.length > 50) _notifications = _notifications.slice(0, 50);
    if (!notif.read) _unreadCount++;
    _saveNotifications();
    _renderPanel();
    _updateBadge();
  }

  // ── Persistence ──
  function _saveNotifications() {
    try { localStorage.setItem('cs_notifs', JSON.stringify(_notifications)); } catch(e) {}
  }

  function _loadStoredNotifications() {
    try {
      const stored = JSON.parse(localStorage.getItem('cs_notifs') || '[]');
      _notifications = stored;
      _unreadCount = stored.filter(n => !n.read).length;
    } catch(e) { _notifications = []; }
  }

  // ── Real Live Score Polling using SportsAPI (ESPN) ──
  async function _startRealLiveScorePolling() {
    await _fetchAndNotifyLiveScores();
    await _fetchAndNotifyNewReleases();
    // Poll live scores every 10 minutes
    _liveMatchInterval = setInterval(async () => {
      await _fetchAndNotifyLiveScores();
    }, 10 * 60 * 1000);
    // Poll new releases every 4 hours
    setInterval(async () => {
      await _fetchAndNotifyNewReleases();
    }, 4 * 60 * 60 * 1000);
  }

  async function _fetchAndNotifyNewReleases() {
    if (!window.TMDB) return;
    try {
      const lastShown = parseInt(localStorage.getItem('cs_notif_last_release') || '0');
      const now = Date.now();
      if (now - lastShown < 4 * 60 * 60 * 1000) return; // Max once per 4h

      let items = [];
      try { items = await window.TMDB.fetchNowPlaying?.() || []; } catch(e) {}
      if (!items.length) {
        try { items = await window.TMDB.fetchTrending?.() || []; } catch(e) {}
      }
      if (!items || !items.length) return;

      const pick = items[Math.floor(Math.random() * Math.min(5, items.length))];
      if (!pick) return;

      const title = pick.title || pick.name || 'New Release';
      const rating = pick.vote_average ? pick.vote_average.toFixed(1) : (pick.imdb || 'N/A');
      const genre = pick.genre || (pick.genre_ids ? '' : '');
      const poster = pick.poster_path
        ? `https://image.tmdb.org/t/p/w500${pick.poster_path}`
        : (pick.poster || pick.poster_url || '');
      const type = pick.media_type === 'tv' || pick.type === 'series' ? 'Series' : 'Movie';

      const notifTitle = `🎬 New ${type}: ${title}`;
      const notifBody = `⭐ ${rating} • Now streaming on SD CineStream • Tap to watch`;

      _showAndroidNotification({ title: notifTitle, body: notifBody, type: 'movie', image: poster, url: '#home', tag: `release-${pick.id || Date.now()}` });
      _addToPanel({
        id: `tmdb-${pick.id || Date.now()}`,
        title: notifTitle,
        body: notifBody,
        type: type === 'Series' ? 'series' : 'movie',
        time: now,
        read: false,
        icon: type === 'Series' ? '📺' : '🎬',
        meta: { ...pick, poster },
      });

      localStorage.setItem('cs_notif_last_release', String(now));
    } catch (e) {
      console.warn('[Notif] TMDB release fetch failed:', e);
    }
  }

  async function _fetchAndNotifyLiveScores() {
    if (!window.SportsAPI) return;
    try {
      const matches = await window.SportsAPI.getLiveMatches();
      if (!matches || !matches.length) return;

      const now = Date.now();

      matches.forEach(match => {
        const id = match.matchId;
        const prev = _liveMatchCache[id];

        // ── Notify when a scheduled game is about to start (within 5 min) ──
        if (match.isScheduled && !_announcedUpcoming[id]) {
          const startMs = new Date(match.rawDate).getTime();
          const minsUntil = (startMs - now) / 60000;
          if (minsUntil >= -2 && minsUntil <= 5) {
            _announcedUpcoming[id] = true;
            const icon = match.tournamentIcon || '⚽';
            const title = `${icon} ${match.tournament} — Starting Now!`;
            const body = `${match.homeTeam} vs ${match.awayTeam} • ${match.matchTime} — Tap to watch live`;
            _showAndroidNotification({ title, body, type: 'score', tag: `start-${id}`, url: '#sports' });
            _addToPanel({ id: `start-${id}`, title, body, type: 'score', time: now, read: false, icon, meta: match });
          }
        }

        // ── Notify for live score changes ──
        if (match.isLive) {
          const scoreKey = `${match.homeScore}-${match.awayScore}`;

          if (!prev) {
            // First time we see this live match — announce it
            const icon = match.tournamentIcon || '⚽';
            const title = `${icon} LIVE: ${match.homeTeam} vs ${match.awayTeam}`;
            const body = `Score: ${match.score} • ${match.status} • ${match.tournament}`;
            _showAndroidNotification({ title, body, type: 'score', tag: `live-${id}`, url: '#sports' });
            _addToPanel({ id: `live-${id}-${now}`, title, body, type: 'score', time: now, read: false, icon, meta: match });
          } else if (prev.scoreKey !== scoreKey) {
            // Score changed — GOAL!
            const icon = match.tournamentIcon || '⚽';
            const title = `${icon} GOAL! ${match.homeTeam} ${match.homeScore} - ${match.awayScore} ${match.awayTeam}`;
            const body = `${match.status} • ${match.tournament} — Tap to watch the replay`;
            _showAndroidNotification({ title, body, type: 'score', tag: `goal-${id}`, url: '#sports' });
            _addToPanel({ id: `goal-${id}-${now}`, title, body, type: 'score', time: now, read: false, icon, meta: match, isGoal: true });
          }

          _liveMatchCache[id] = { scoreKey };
        }

        // ── Notify when a match just ended ──
        if (match.isFinished && prev && !prev.finished) {
          const icon = match.tournamentIcon || '⚽';
          const title = `${icon} Full Time: ${match.homeTeam} ${match.homeScore} - ${match.awayScore} ${match.awayTeam}`;
          const body = `${match.tournament} — Match has ended`;
          _showAndroidNotification({ title, body, type: 'score', tag: `ft-${id}`, url: '#sports' });
          _addToPanel({ id: `ft-${id}`, title, body, type: 'score', time: now, read: false, icon, meta: match });
          _liveMatchCache[id] = { ...(_liveMatchCache[id] || {}), finished: true };
        }
      });
    } catch (e) {
      console.warn('[Notif] Live score fetch failed:', e);
    }
  }

  // ── New Releases Scheduler ──
  function _schedulePeriodic() {
    const lastShown = parseInt(localStorage.getItem('cs_notif_last_release') || '0');
    const now = Date.now();
    const fourHoursMs = 4 * 60 * 60 * 1000;

    if (now - lastShown > fourHoursMs) {
      setTimeout(() => _sendNewReleaseNotification(), 10000);
      localStorage.setItem('cs_notif_last_release', String(now));
    }

    // Schedule for next interval
    setTimeout(() => _schedulePeriodic(), fourHoursMs);
  }

  async function _sendNewReleaseNotification(preselectedRelease) {
    let release = preselectedRelease;

    // Try to fetch from TMDB first for real content
    if (!release && window.TMDB && window.TMDB.isConfigured()) {
      try {
        const type = Math.random() > 0.5 ? 'movie' : 'tv';
        let items = [];
        if (type === 'movie') {
          items = await window.TMDB.fetchNowPlaying();
        } else {
          items = await window.TMDB.fetchTVSeries();
        }
        if (items && items.length > 0) {
          release = items[Math.floor(Math.random() * Math.min(10, items.length))];
        }
      } catch (e) {
        console.warn('Failed to fetch TMDB releases for notification:', e);
      }
    }

    if (!release) {
      release = NEW_RELEASES[Math.floor(Math.random() * NEW_RELEASES.length)];
    }

    const title = `🎬 New ${release.type === 'series' ? 'Series' : 'Movie'}: ${release.title}`;
    const rating = release.imdb || release.rating || 'N/A';
    const descText = release.description || release.desc || 'Now Streaming on CineStream';
    const body = `${descText.substring(0, 60)}${descText.length > 60 ? '...' : ''} • ⭐ ${rating} • ${release.genre || 'Drama'}`;

    _showAndroidNotification({
      title, body, type: 'movie',
      image: release.poster,
      url: `/#home`,
      tag: `release-${release.id || Date.now()}`,
    });

    _addToPanel({
      id: `release-${release.id || Date.now()}-${Date.now()}`,
      title, body,
      type: 'movie',
      time: Date.now(),
      read: false,
      icon: '🎬',
      meta: release,
    });
  }

  // ── Manual send (for demo / testing) ──
  function sendMovieNotification(release) {
    _sendNewReleaseNotification(release && release.type ? release : null);
  }

  function sendScoreUpdate(matchId) {
    const match = FIFA_MATCHES.find(m => m.id === matchId) || FIFA_MATCHES[0];
    _sendScoreNotification(match, Math.random() > 0.5);
  }

  function sendAppUpdate() {
    const upd = APP_UPDATES[Math.floor(Math.random() * APP_UPDATES.length)];
    _showAndroidNotification({ title: upd.title, body: upd.body, type: 'update' });
    _addToPanel({ id: `upd-${Date.now()}`, ...upd, time: Date.now(), read: false });
  }

  // ── Notification Panel UI ──
  function _injectPanel() {
    if (document.getElementById('notif-panel-container')) return;

    const container = document.createElement('div');
    container.id = 'notif-panel-container';
    container.innerHTML = `
      <style>
        @keyframes notif-slide-up {
          from { opacity:0; transform:translateY(20px) scale(0.95); }
          to { opacity:1; transform:translateY(0) scale(1); }
        }
        @keyframes notif-slide-in {
          from { opacity:0; transform:translateX(20px); }
          to { opacity:1; transform:translateX(0); }
        }
        @keyframes score-pulse {
          0%,100% { box-shadow:0 0 0 0 rgba(0,208,132,0.4); }
          50% { box-shadow:0 0 0 8px rgba(0,208,132,0); }
        }
        @keyframes goal-flash {
          0%,100% { background:rgba(255,200,0,0.1); }
          50% { background:rgba(255,200,0,0.3); }
        }

        #notif-overlay {
          position:fixed;inset:0;z-index:9998;display:none;
        }
        #notif-overlay.open { display:block; }

        #notif-panel {
          position:fixed;
          top:80px;
          right:16px;
          width:min(400px, calc(100vw - 32px));
          max-height:calc(100vh - 100px);
          background:linear-gradient(180deg,#1a1a1a 0%,#141414 100%);
          border:1px solid rgba(255,255,255,0.1);
          border-radius:24px;
          box-shadow:0 32px 80px rgba(0,0,0,0.8),0 0 0 1px rgba(255,255,255,0.04);
          z-index:9999;
          display:none;
          flex-direction:column;
          overflow:visible;
          animation:notif-slide-up 0.35s cubic-bezier(0.34,1.56,0.64,1);
        }
        #notif-panel::before {
          content: '';
          position: absolute;
          top: -10px;
          right: 24px;
          border-left: 10px solid transparent;
          border-right: 10px solid transparent;
          border-bottom: 10px solid #1a1a1a;
        }
        #notif-panel.open { display:flex; }

        .np-header {
          display:flex;align-items:center;justify-content:space-between;
          padding:20px 20px 0;flex-shrink:0;
          border-top-left-radius: 24px;
          border-top-right-radius: 24px;
        }
        .np-title {
          font-family:'Montserrat',sans-serif;font-size:18px;font-weight:800;color:#fff;
          display:flex;align-items:center;gap:10px;
        }
        .np-badge {
          background:#e50914;color:#fff;font-size:10px;font-weight:800;
          padding:2px 7px;border-radius:99px;min-width:18px;text-align:center;
        }
        .np-actions { display:flex;gap:8px; }
        .np-action-btn {
          background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);
          color:rgba(229,226,225,0.6);border-radius:10px;padding:6px 12px;
          font-size:11px;font-weight:600;cursor:pointer;transition:all 0.2s;
          font-family:'Inter',sans-serif;
        }
        .np-action-btn:hover { background:rgba(255,255,255,0.12);color:#fff; }

        .np-tabs {
          display:flex;gap:0;padding:16px 20px 0;flex-shrink:0;
          border-bottom:1px solid rgba(255,255,255,0.06);
        }
        .np-tab {
          padding:8px 16px;font-size:12px;font-weight:700;letter-spacing:0.04em;
          color:rgba(229,226,225,0.4);border-bottom:2px solid transparent;
          cursor:pointer;transition:all 0.2s;text-transform:uppercase;
          display:flex;align-items:center;gap:6px;
        }
        .np-tab.active { color:#e50914;border-bottom-color:#e50914; }
        .np-tab-dot {
          width:6px;height:6px;border-radius:50%;background:#e50914;
          animation:score-pulse 1.5s infinite;
        }

        .np-body {
          overflow-y:auto;flex:1;padding:12px 16px 16px;
          scrollbar-width:thin;scrollbar-color:rgba(255,255,255,0.1) transparent;
          border-bottom-left-radius: 24px;
          border-bottom-right-radius: 24px;
        }
        .np-body::-webkit-scrollbar { width:4px; }
        .np-body::-webkit-scrollbar-thumb { background:rgba(255,255,255,0.1);border-radius:2px; }

        .np-empty {
          display:flex;flex-direction:column;align-items:center;justify-content:center;
          padding:48px 20px;gap:12px;
        }
        .np-empty-icon { font-size:48px; }
        .np-empty-text { font-size:14px;color:rgba(229,226,225,0.35);text-align:center; }

        /* ── Notification Card ── */
        .nc {
          display:flex;gap:12px;align-items:flex-start;
          padding:14px;border-radius:16px;margin-bottom:8px;
          cursor:pointer;transition:all 0.2s;position:relative;
          border:1px solid transparent;
          animation:notif-slide-in 0.3s ease;
        }
        .nc:hover { background:rgba(255,255,255,0.05);border-color:rgba(255,255,255,0.07); }
        .nc.unread { background:rgba(229,9,20,0.05);border-color:rgba(229,9,20,0.12); }
        .nc.unread::before {
          content:'';position:absolute;top:50%;left:4px;transform:translateY(-50%);
          width:4px;height:60%;border-radius:2px;background:#e50914;
        }

        /* ── Score card variant ── */
        .nc.score {
          background:linear-gradient(135deg,rgba(0,208,132,0.08),rgba(20,209,255,0.04));
          border-color:rgba(0,208,132,0.2);
        }
        .nc.score.goal { animation:goal-flash 0.8s ease 3; }
        .nc.score:hover { border-color:rgba(0,208,132,0.4); }

        .nc-icon {
          width:44px;height:44px;border-radius:12px;
          display:flex;align-items:center;justify-content:center;
          font-size:22px;flex-shrink:0;
        }
        .nc-icon.movie { background:rgba(229,9,20,0.15);border:1px solid rgba(229,9,20,0.2); }
        .nc-icon.score { background:rgba(0,208,132,0.12);border:1px solid rgba(0,208,132,0.2); }
        .nc-icon.update { background:rgba(20,209,255,0.12);border:1px solid rgba(20,209,255,0.2); }
        .nc-icon.series { background:rgba(255,200,0,0.12);border:1px solid rgba(255,200,0,0.2); }

        .nc-content { flex:1;min-width:0; }
        .nc-title {
          font-size:13px;font-weight:700;color:#fff;
          white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:4px;
        }
        .nc-body {
          font-size:12px;color:rgba(229,226,225,0.55);line-height:1.5;
          display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;
        }
        .nc-time { font-size:10px;color:rgba(229,226,225,0.3);margin-top:6px; }
        .nc-dismiss {
          background:none;border:none;color:rgba(229,226,225,0.25);
          font-size:16px;cursor:pointer;padding:0;flex-shrink:0;
          transition:color 0.2s;align-self:center;
        }
        .nc-dismiss:hover { color:rgba(229,226,225,0.7); }

        /* ── Score display inside card ── */
        .nc-score-box {
          display:flex;align-items:center;gap:8px;margin-top:8px;padding:8px 12px;
          background:rgba(0,0,0,0.3);border-radius:10px;
        }
        .nc-score-team { font-size:11px;font-weight:700;color:rgba(229,226,225,0.8); }
        .nc-score-num {
          font-family:'Montserrat',sans-serif;font-size:16px;font-weight:900;
          color:#fff;padding:2px 10px;background:rgba(0,208,132,0.12);
          border-radius:6px;border:1px solid rgba(0,208,132,0.2);
        }
        .nc-score-live {
          font-size:9px;font-weight:900;letter-spacing:0.08em;
          background:rgba(255,58,58,0.12);border:1px solid rgba(255,58,58,0.3);
          color:#ff5555;border-radius:99px;padding:2px 7px;text-transform:uppercase;
          margin-left:auto;
        }

        /* ── Footer CTA ── */
        .np-footer {
          padding:12px 16px;border-top:1px solid rgba(255,255,255,0.05);
          flex-shrink:0;display:flex;gap:8px;flex-wrap:wrap;
          border-bottom-left-radius: 24px;
          border-bottom-right-radius: 24px;
        }
        .np-cta-btn {
          flex: 1 1 calc(50% - 4px);
          padding:10px;background:linear-gradient(135deg,#e50914,#c0000c);
          color:#fff;border:none;border-radius:12px;font-size:12px;font-weight:700;
          cursor:pointer;font-family:'Inter',sans-serif;transition:all 0.2s;
          white-space:nowrap;
        }
        .np-cta-btn.full-width {
          flex: 1 1 100%;
        }
        .np-cta-btn:hover { filter:brightness(1.1); }
        .np-cta-btn.secondary {
          background:rgba(0,208,132,0.12);border:1px solid rgba(0,208,132,0.25);
          color:#00d084;
        }
        .np-cta-btn.secondary:hover { background:rgba(0,208,132,0.2); }
        .np-cta-btn.test-btn {
          background:rgba(20,209,255,0.12);border:1px solid rgba(20,209,255,0.25);
          color:#14d1ff;
        }
        .np-cta-btn.test-btn:hover { background:rgba(20,209,255,0.2); }
      </style>

      <div id="notif-overlay" onclick="window.NotificationSystem.closePanel()"></div>

      <div id="notif-panel">
        <div class="np-header">
          <div class="np-title">
            <span>🔔</span> Notifications
            <span class="np-badge" id="np-badge-count" style="display:none">0</span>
          </div>
          <div class="np-actions">
            <button class="np-action-btn" onclick="window.NotificationSystem.markAllRead()">Mark all read</button>
            <button class="np-action-btn" onclick="window.NotificationSystem.clearAll()">Clear all</button>
            <button onclick="window.NotificationSystem.closePanel()" style="background:none;border:none;color:rgba(229,226,225,0.4);cursor:pointer;font-size:22px;padding:0 0 0 4px">×</button>
          </div>
        </div>

        <div class="np-tabs">
          <div class="np-tab active" data-tab="all" onclick="window.NotificationSystem.switchTab('all')">All</div>
          <div class="np-tab" data-tab="score" onclick="window.NotificationSystem.switchTab('score')">
            <span class="np-tab-dot"></span> Live Scores
          </div>
          <div class="np-tab" data-tab="movie" onclick="window.NotificationSystem.switchTab('movie')">🎬 Releases</div>
          <div class="np-tab" data-tab="update" onclick="window.NotificationSystem.switchTab('update')">Updates</div>
        </div>

        <div class="np-body" id="np-body"></div>

        <div class="np-footer">
          <button class="np-cta-btn full-width" onclick="window.NotificationSystem.requestPermission()">
            🔔 Enable Push Notifications
          </button>
          <button class="np-cta-btn secondary" onclick="Router.navigate('sports');window.NotificationSystem.closePanel()">
            ⚽ Live Sports
          </button>
          <button class="np-cta-btn secondary" onclick="Router.navigate('movies');window.NotificationSystem.closePanel()" style="background:rgba(229,9,20,0.1);border-color:rgba(229,9,20,0.25);color:#e50914;">
            🎬 New Releases
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(container);
  }

  let _activeTab = 'all';
  function switchTab(tab) {
    _activeTab = tab;
    document.querySelectorAll('.np-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    _renderPanel();
  }

  function _renderPanel() {
    const body = document.getElementById('np-body');
    if (!body) return;

    const filtered = _activeTab === 'all'
      ? _notifications
      : _notifications.filter(n => n.type === _activeTab || (n.type === 'series' && _activeTab === 'movie'));

    if (!filtered.length) {
      body.innerHTML = `
        <div class="np-empty">
          <div class="np-empty-icon">${_activeTab === 'score' ? '⚽' : _activeTab === 'movie' ? '🎬' : '🔔'}</div>
          <div class="np-empty-text">No notifications yet.<br>Check back soon for live updates!</div>
        </div>`;
      return;
    }

    body.innerHTML = filtered.map(n => _renderCard(n)).join('');
  }

  function _renderCard(n) {
    const isScore = n.type === 'score';
    const match = isScore && n.meta ? n.meta : null;
    const timeAgo = _timeAgo(n.time);
    const iconType = isScore ? 'score' : (n.type === 'update' ? 'update' : (n.type === 'series' ? 'series' : 'movie'));

    const scoreBlock = match ? `
      <div class="nc-score-box">
        <span class="nc-score-team">${match.flag1} ${match.homeTeam}</span>
        <span class="nc-score-num">${match.homeScore} - ${match.awayScore}</span>
        <span class="nc-score-team">${match.awayTeam} ${match.flag2}</span>
        ${match.status === 'LIVE' ? `<span class="nc-score-live">🔴 LIVE ${match.minute}'</span>` : `<span class="nc-score-live" style="background:rgba(255,255,255,0.06);border-color:rgba(255,255,255,0.1);color:rgba(229,226,225,0.4)">FT</span>`}
      </div>` : '';

    return `
      <div class="nc ${isScore ? 'score' : ''} ${n.isGoal ? 'goal' : ''} ${!n.read ? 'unread' : ''}"
           onclick="window.NotificationSystem.markRead('${n.id}')">
        <div class="nc-icon ${iconType}">${n.icon || '🔔'}</div>
        <div class="nc-content">
          <div class="nc-title">${n.title}</div>
          <div class="nc-body">${n.body}</div>
          ${scoreBlock}
          <div class="nc-time">${timeAgo}</div>
        </div>
        <button class="nc-dismiss" onclick="event.stopPropagation();window.NotificationSystem.dismiss('${n.id}')">×</button>
      </div>`;
  }

  function _timeAgo(ts) {
    const diff = Date.now() - ts;
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return `${Math.floor(diff / 86400000)}d ago`;
  }

  function onBellClick(e) {
    if (e) e.stopPropagation();
    const bell = e ? e.currentTarget : document.getElementById('notif-btn');
    const rect = bell ? bell.getBoundingClientRect() : { right: window.innerWidth - 20, bottom: 60 };
    const panel = document.getElementById('notif-panel');
    if (panel) {
      const panelWidth = Math.min(400, window.innerWidth - 32);
      let right = window.innerWidth - rect.right;
      right = Math.max(8, Math.min(right, window.innerWidth - panelWidth - 8));
      panel.style.top = (rect.bottom + 12) + 'px';
      panel.style.right = right + 'px';
      panel.style.left = 'auto';
    }
    togglePanel();
  }

  function _updateBadge() {
    const badge = document.getElementById('np-badge-count');
    const dots = document.querySelectorAll('.notif-dot');

    if (badge) {
      badge.textContent = _unreadCount > 9 ? '9+' : _unreadCount;
      badge.style.display = _unreadCount > 0 ? 'inline-block' : 'none';
    }
    dots.forEach(dot => {
      dot.style.background = _unreadCount > 0 ? '#e50914' : 'transparent';
      dot.style.width = _unreadCount > 0 ? '8px' : '0';
      dot.style.height = _unreadCount > 0 ? '8px' : '0';
    });
  }

  // ── Panel open/close ──
  function togglePanel() {
    _panelOpen ? closePanel() : openPanel();
  }

  function openPanel() {
    _panelOpen = true;
    document.getElementById('notif-panel')?.classList.add('open');
    document.getElementById('notif-overlay')?.classList.add('open');
    _renderPanel();
  }

  function closePanel() {
    _panelOpen = false;
    document.getElementById('notif-panel')?.classList.remove('open');
    document.getElementById('notif-overlay')?.classList.remove('open');
  }

  function markRead(id) {
    const n = _notifications.find(n => n.id === id);
    if (n && !n.read) {
      n.read = true;
      _unreadCount = Math.max(0, _unreadCount - 1);
      _saveNotifications();
      _renderPanel();
      _updateBadge();
    }
  }

  function markAllRead() {
    _notifications.forEach(n => n.read = true);
    _unreadCount = 0;
    _saveNotifications();
    _renderPanel();
    _updateBadge();
  }

  function dismiss(id) {
    const n = _notifications.find(n => n.id === id);
    if (n && !n.read) _unreadCount = Math.max(0, _unreadCount - 1);
    _notifications = _notifications.filter(n => n.id !== id);
    _saveNotifications();
    _renderPanel();
    _updateBadge();
  }

  function clearAll() {
    _notifications = [];
    _unreadCount = 0;
    _saveNotifications();
    _renderPanel();
    _updateBadge();
  }

  return {
    init,
    requestPermission,
    sendMovieNotification,
    sendScoreUpdate,
    sendAppUpdate,
    openPanel,
    closePanel,
    togglePanel,
    onBellClick,
    markRead,
    markAllRead,
    dismiss,
    clearAll,
    switchTab,
    get unreadCount() { return _unreadCount; },
  };

})();

window.NotificationSystem = NotificationSystem;

// Auto-init when DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => NotificationSystem.init());
} else {
  NotificationSystem.init();
}
