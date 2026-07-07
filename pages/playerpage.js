/* CineStream — Player Page Controller
   Enhanced with auto-fallback, server health monitoring,
   and advanced server switching UI */
   
const PlayerPage = (() => {
  let progressInterval = null;
  let currentContentId = null;
  let videoElement = null;
  let availableStreams = [];
  let activeStreamIndex = 0;
  let serverHealthCache = [];
  let autoFallbackTimer = null;
  let failCount = 0;
  const MAX_FAILS_BEFORE_FALLBACK = 2;

  async function init(params) {
    const contentId = params.id;
    const contentType = params.type || 'movie'; // 'movie' or 'series'
    currentContentId = contentId;
    window._playerContentType = contentType;

    if (!contentId) {
      UI.toast('No content specified.', 'error');
      Router.navigate('home');
      return;
    }
    
    // Check if user is subscribed
    const session = await window.Auth.getSession();
    if (!session) {
      UI.toast('Please sign in to stream content.', 'info');
      Router.navigate('login');
      return;
    }

    const subscribed = await Subscriptions.isSubscribed(session.user.id);
    if (!subscribed) {
      UI.toast('Active subscription required to stream premium titles.', 'warning');
      Router.navigate('subscribe');
      return;
    }

    // Fetch fresh details from TMDB
    let item = null;
    try {
      if (window.TMDB) {
        const tmdbType = contentType === 'series' ? 'tv' : 'movie';
        item = await TMDB.getDetails(contentId, tmdbType);
      }
    } catch (err) {
      console.warn('Failed to fetch details from TMDB for player:', err);
    }
    if (!item && window.TMDB) {
      try {
        const altType = contentType === 'series' ? 'movie' : 'tv';
        item = await TMDB.getDetails(contentId, altType);
      } catch (err) {}
    }
    if (!item) {
      UI.toast('Content not found. Please try again.', 'error');
      Router.navigate('home');
      return;
    }

    // Set title and subtitle
    const titleEl = document.getElementById('player-title');
    if (titleEl) titleEl.textContent = item.title || 'Loading...';
    const subtitleEl = document.getElementById('player-subtitle');
    videoElement = document.getElementById('hls-video');

    // Resolve episode info from params
    let season = 1, episode = 1;
    if (contentType === 'series') {
      if (params.ep) {
        const epMatch = params.ep.match(/S(\d+)\s*E(\d+)/i);
        if (epMatch) {
          season = parseInt(epMatch[1]);
          episode = parseInt(epMatch[2]);
        }
      } else {
        season = parseInt(params.season) || 1;
        episode = parseInt(params.episode) || 1;
      }
    }

    if (subtitleEl) {
      subtitleEl.textContent = contentType === 'series'
        ? `Season ${season} · Episode ${episode}`
        : `Movie · ${item.genre || ''}`;
    }

    // Show server health status indicator
    showServerStatusBar();

    // Fetch embed streams
    let embedStreams = [];
    try {
      if (contentType === 'series') {
        embedStreams = await TMDB.getRegionalStreams(item, season, episode);
      } else {
        embedStreams = await TMDB.getRegionalStreams(item, null, null);
      }
    } catch (e) {
      console.warn('Could not fetch embed streams:', e);
    }

    // Add Videoasy server as highest-priority stream
    const videasyUrl = buildVideasyUrl(contentType, item, season, episode);
    if (videasyUrl) {
      embedStreams.unshift(videasyUrl);
    }

    if (!embedStreams || embedStreams.length === 0) {
      UI.toast('No streams available for this title.', 'error');
      Router.navigate('home');
      return;
    }

    let primaryStream = embedStreams[0];
    const isIframeStream = true;
    const iframeElement = document.getElementById('iframe-video');
    const controlsContainer = document.querySelector('.player-controls');

    availableStreams = embedStreams;
    activeStreamIndex = 0;
    failCount = 0;

    // Show overlay server selector
    const serverSelectorOverlay = document.getElementById('server-selector-overlay');
    if (serverSelectorOverlay) {
      serverSelectorOverlay.style.display = availableStreams.length > 1 ? 'block' : 'none';
    }
    updateOverlayServerName();
    populateOverlayServerList();

    // Bind overlay server selector toggle
    const overlayBtn = document.getElementById('server-select-main-btn');
    const overlayDropdown = document.getElementById('server-dropdown-overlay');
    if (overlayBtn && overlayDropdown) {
      overlayBtn.onclick = (e) => {
        e.stopPropagation();
        const isOpen = overlayDropdown.style.display === 'block';
        overlayDropdown.style.display = isOpen ? 'none' : 'block';
      };
    }

    // Use iframe for embed servers
    if (videoElement) videoElement.style.display = 'none';
    if (controlsContainer) controlsContainer.style.display = 'none';

    // Show and load iframe
    if (iframeElement) {
      iframeElement.style.display = 'block';
      iframeElement.style.width = '100%';
      iframeElement.style.height = '100%';
      iframeElement.style.position = 'absolute';
      iframeElement.style.inset = '0';
      iframeElement.src = primaryStream;
    }

    // Auto fullscreen + landscape for all devices
    const playerContainer = document.getElementById('player-container');
    const tryFullscreen = () => {
      if (playerContainer) {
        if (playerContainer.requestFullscreen) {
          playerContainer.requestFullscreen().catch(() => {});
        } else if (playerContainer.webkitRequestFullscreen) {
          playerContainer.webkitRequestFullscreen();
        } else if (playerContainer.mozRequestFullScreen) {
          playerContainer.mozRequestFullScreen();
        }
      } else if (document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen().catch(() => {});
      }
      if (screen.orientation && screen.orientation.lock) {
        screen.orientation.lock('landscape').catch(() => {});
      } else if (screen.lockOrientation) {
        screen.lockOrientation('landscape');
      }
    };
    setTimeout(tryFullscreen, 400);

    // Listen for iframe load errors to auto-switch server
    iframeElement.addEventListener('error', () => {
      failCount++;
      if (failCount >= MAX_FAILS_BEFORE_FALLBACK) {
        UI.toast(`Server ${getServerName(activeStreamIndex)} failed. Auto-switching...`, 'warning');
        autoSwitchToNextServer();
      }
    });

    // Also detect if iframe fails to load content (timeout-based detection)
    let loadTimer = setTimeout(() => {
      // If after 15 seconds the iframe still hasn't loaded content, try next server
      if (failCount < MAX_FAILS_BEFORE_FALLBACK) {
        failCount++;
        if (failCount >= MAX_FAILS_BEFORE_FALLBACK) {
          UI.toast(`Server ${getServerName(activeStreamIndex)} is slow. Auto-switching...`, 'warning');
          autoSwitchToNextServer();
        }
      }
    }, 15000);

    iframeElement.addEventListener('load', () => {
      clearTimeout(loadTimer);
      failCount = 0; // Reset fail count on successful load
      // Hide loading spinner
      const spinner = document.getElementById('buffer-spinner');
      if (spinner) spinner.style.display = 'none';
    });

    // Auto-fallback timer removed per user request
    activeStreamIndex = 0;

    // Update server status
    updateServerHealthStatus();

    // Show spinner initially
    const spinner = document.getElementById('buffer-spinner');
    let loadingTimer = null;
    if (spinner) {
      spinner.style.display = 'flex';
      loadingTimer = setTimeout(() => {
        spinner.style.display = 'none';
      }, 5000);
    }

    // Clear loading timer once playback starts
    const onPlayClear = () => {
      if (loadingTimer) {
        clearTimeout(loadingTimer);
        loadingTimer = null;
      }
      if (videoElement) {
        videoElement.removeEventListener('play', onPlayClear);
      }
    };
    if (videoElement) {
      videoElement.addEventListener('play', onPlayClear);
    }

    // Handle ads
    const handleAds = (url) => {
      if (!url) return;
      if (/ad|ads|adservice|doubleclick/i.test(url)) {
        const adWin = window.open(url, '_blank');
        setTimeout(() => {
          if (adWin && !adWin.closed) adWin.close();
          if (videoElement) {
            videoElement.muted = false;
            videoElement.volume = 1.0;
            videoElement.play().catch(() => {});
            const container = document.getElementById('player-container');
            if (container && container.requestFullscreen) {
              container.requestFullscreen().catch(() => {});
            }
            if (screen.orientation && screen.orientation.lock) {
              screen.orientation.lock('landscape').catch(() => {});
            }
          }
        }, 5000);
      }
    };
    handleAds(primaryStream);

    // Fullscreen helpers
    function enforceFullScreenLandscape() {
      const container = document.getElementById('player-container');
      if (container && container.requestFullscreen) {
        container.requestFullscreen().catch(() => {});
      }
      if (screen.orientation && screen.orientation.lock) {
        screen.orientation.lock('landscape').catch(() => {});
      }
      if (videoElement) {
        videoElement.style.width = '100%';
        videoElement.style.height = '100%';
        videoElement.style.objectFit = 'contain';
      }
      const iframe = document.getElementById('iframe-video');
      if (iframe) {
        iframe.style.width = '100%';
        iframe.style.height = '100%';
      }
    }

    window.addEventListener('pageshow', (event) => {
      if (sessionStorage.getItem('playerFullScreen') === 'true') {
        enforceFullScreenLandscape();
      }
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && sessionStorage.getItem('playerFullScreen') === 'true') {
        enforceFullScreenLandscape();
      }
    });

    function setFullScreenFlag() {
      sessionStorage.setItem('playerFullScreen', 'true');
    }

    function onPlayerReady() {
      enforceFullScreenLandscape();
      setFullScreenFlag();
    }

    if (sessionStorage.getItem('playerFullScreen') === 'true') {
      enforceFullScreenLandscape();
    }

    if (!isIframeStream) {
      window.Player.init(videoElement, primaryStream, {
        autoplay: true,
        qualityMenuId: 'quality-menu',
        streams: availableStreams,
        withCredentials: true,
        requestHeaders: {
          'Accept': '*/*',
          'Origin': window.location.origin
        },
        onReady: onPlayerReady
      }); 
      window.Player.setupControls('player-container');
    } else {
      enforceFullScreenLandscape();
      setFullScreenFlag();
    }
    if (screen.orientation && screen.orientation.lock) {
      screen.orientation.lock('landscape').catch(() => {});
    }

    // Retrieve previous progress
    let pastRecord = null;
    try {
      const history = await Subscriptions.getWatchHistory(session.user.id);
      pastRecord = history.find(h => h.content_id === contentId);
      if (pastRecord && pastRecord.progress_seconds > 5 && !isIframeStream) {
        const onMetadata = () => {
          videoElement.currentTime = pastRecord.progress_seconds;
          UI.toast(`Resumed from ${window.Player.formatTime(pastRecord.progress_seconds)}`, 'info');
          videoElement.removeEventListener('loadedmetadata', onMetadata);
        };
        videoElement.addEventListener('loadedmetadata', onMetadata);
      }
    } catch (err) {
      console.log('No watch history found:', err);
    }

    if (progressInterval) clearInterval(progressInterval);
    let currentProgress = pastRecord ? pastRecord.progress_seconds : 0;
    if (currentProgress < 10) currentProgress = 10;
    Subscriptions.saveProgress(session.user.id, contentId, currentProgress, contentType);

    progressInterval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        currentProgress += 6;
        Subscriptions.saveProgress(session.user.id, contentId, currentProgress, contentType);
      }
    }, 6000);

    setupOverlayAutoHide();
  }

  function buildVideasyUrl(contentType, item, season, episode) {
    try {
      const base = 'https://player.videasy.net';
      const tmdbId = item.id;
      if (contentType === 'anime') {
        const animeItem = item;
        const anilistId = animeItem.anilist_id || animeItem.external_ids?.anilist_id || '';
        if (!anilistId) return null;
        const ep = episode || 1;
        return `${base}/anime/${tmdbId}/${anilistId}/${ep}`;
      } else if (contentType === 'series') {
        const s = season || 1;
        const e = episode || 1;
        return `${base}/tv/${tmdbId}/${s}/${e}`;
      } else {
        return `${base}/movie/${tmdbId}`;
      }
    } catch (e) {
      console.warn('Failed to build Videoasy URL:', e);
      return null;
    }
  }

  function getServerName(index) {
    const names = [
      'Videoasy',
      '2Embed',
      'VidLink',
      'Own Server',
      'AutoEmbed',
      'StreamIMDb'
    ];
    return names[index] || `Server ${index + 1}`;
  }

  function autoSwitchToNextServer() {
    if (!availableStreams || availableStreams.length === 0) return;
    const nextIdx = (activeStreamIndex + 1) % availableStreams.length;
    if (nextIdx === 0) {
      // We've tried all servers, go back to first
      UI.toast('All servers tried. Reverting to Server 1 (Videoasy).', 'info');
    }
    switchServer(nextIdx);
    failCount = 0;
  }

  function showServerStatusBar() {
    // Add server status indicator bar
    let statusBar = document.getElementById('server-status-bar');
    if (!statusBar) {
      statusBar = document.createElement('div');
      statusBar.id = 'server-status-bar';
      statusBar.style.cssText = `
        position: absolute; bottom: 70px; left: 50%; transform: translateX(-50%);
        z-index: 35; display: flex; align-items: center; gap: 8px;
        background: rgba(0,0,0,0.7); backdrop-filter: blur(8px);
        border: 1px solid rgba(255,255,255,0.1); border-radius: 8px;
        padding: 4px 12px; font-size: 11px; color: rgba(255,255,255,0.6);
        transition: opacity 0.3s; pointer-events: none;
      `;
      statusBar.innerHTML = `
        <span class="status-dot" style="width:6px;height:6px;border-radius:50%;display:inline-block;"></span>
        <span class="status-text">Checking servers...</span>
      `;
      document.getElementById('player-container')?.appendChild(statusBar);
      
      // Auto-hide status bar after 10 seconds
      setTimeout(() => {
        if (statusBar) {
          statusBar.style.opacity = '0';
          setTimeout(() => { if (statusBar) statusBar.style.display = 'none'; }, 500);
        }
      }, 10000);
    }
  }

  function updateServerHealthStatus() {
    const statusBar = document.getElementById('server-status-bar');
    if (!statusBar) return;
    
    const dot = statusBar.querySelector('.status-dot');
    const text = statusBar.querySelector('.status-text');
    
    if (availableStreams.length > 0) {
      const serverName = getServerName(activeStreamIndex);
      const onlineCount = availableStreams.length - activeStreamIndex;
      if (dot) dot.style.background = '#00d084';
      if (text) text.textContent = `${serverName} • ${availableStreams.length} servers available`;
    }
  }

  function setupOverlayAutoHide() {
    const container = document.getElementById('player-container');
    const topBar = container?.querySelector('.player-top-bar');
    const controls = container?.querySelector('.player-controls');
    const serverOverlay = document.getElementById('server-selector-overlay');
    const gradient = container?.querySelector('.player-gradient-overlay');
    const wakeCatcher = document.getElementById('ui-wake-catcher');
    let timer = null;
    let uiHidden = false;

    const hide = () => {
      if (videoElement && !videoElement.paused) {
        uiHidden = true;
        topBar?.classList.add('hidden');
        controls?.classList.add('hidden');
        if (serverOverlay) serverOverlay.style.opacity = '0';
        if (serverOverlay) serverOverlay.style.pointerEvents = 'none';
        if (gradient) gradient.style.opacity = '0';
        
        if (container) container.style.cursor = 'none';
        if (wakeCatcher) wakeCatcher.style.display = 'block';
      } else if (document.getElementById('iframe-video') && document.getElementById('iframe-video').style.display !== 'none') {
        // If iframe is active, we don't have easy access to pause state, hide anyway
        uiHidden = true;
        topBar?.classList.add('hidden');
        controls?.classList.add('hidden');
        if (serverOverlay) serverOverlay.style.opacity = '0';
        if (serverOverlay) serverOverlay.style.pointerEvents = 'none';
        if (gradient) gradient.style.opacity = '0';
        
        if (container) container.style.cursor = 'none';
        if (wakeCatcher) wakeCatcher.style.display = 'block';
      }
    };

    const resetTimer = () => {
      uiHidden = false;
      topBar?.classList.remove('hidden');
      controls?.classList.remove('hidden');
      if (serverOverlay) serverOverlay.style.opacity = '1';
      if (serverOverlay) serverOverlay.style.pointerEvents = 'auto';
      if (gradient) gradient.style.opacity = '1';
      
      if (container) container.style.cursor = 'default';
      if (wakeCatcher) wakeCatcher.style.display = 'none';
      
      clearTimeout(timer);
      timer = setTimeout(hide, 3000);
    };

    if (wakeCatcher) {
      wakeCatcher.addEventListener('click', (e) => {
        resetTimer();
      });
      wakeCatcher.addEventListener('touchstart', (e) => {
        resetTimer();
      }, { passive: true });
    }

    if (container) {
      container.addEventListener('mousemove', resetTimer);
      container.addEventListener('touchstart', resetTimer, { passive: true });
      container.addEventListener('click', (e) => {
        if (e.target === container || e.target === gradient || e.target === wakeCatcher) {
          if (uiHidden) resetTimer();
          else hide();
        }
      });
    }
    
    if (videoElement) {
      videoElement.addEventListener('pause', resetTimer);
      videoElement.addEventListener('play', resetTimer);
    }
    resetTimer();
  }

  function goBack() {
    if (window.Player && typeof window.Player.destroy === 'function') {
      window.Player.destroy();
    }
    const iframeElement = document.getElementById('iframe-video');
    if (iframeElement) iframeElement.src = '';
    
    if (progressInterval) {
      clearInterval(progressInterval);
      progressInterval = null;
    }
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
    Router.navigate('detail', { id: currentContentId, type: window._playerContentType || 'movie' });
  }

  function switchServer(idx) {
    if (!availableStreams || availableStreams.length === 0) {
      UI.toast('No alternative servers available.', 'info');
      return;
    }
    if (idx !== undefined) {
      activeStreamIndex = idx;
    } else {
      activeStreamIndex = (activeStreamIndex + 1) % availableStreams.length;
    }
    const newStream = availableStreams[activeStreamIndex];
    UI.toast(`Switched to ${getServerName(activeStreamIndex)}`, 'info');

    const iframeElement = document.getElementById('iframe-video');
    if (iframeElement) {
      iframeElement.src = newStream;
    }

    updateOverlayServerName();
    populateOverlayServerList();
  }

  function updateOverlayServerName() {
    const nameEl = document.getElementById('current-server-name');
    if (nameEl) {
      nameEl.textContent = getServerName(activeStreamIndex);
    }
  }

  function populateOverlayServerList() {
    const listContainer = document.getElementById('server-list-overlay');
    if (!listContainer || !availableStreams || availableStreams.length === 0) return;

    const serverNames = [
      'Videoasy',
      '2Embed',
      'VidLink',
      'Own Server',
      'AutoEmbed',
      'StreamIMDb'
    ];

    listContainer.innerHTML = '';
    const totalServers = Math.min(availableStreams.length, serverNames.length);

    for (let idx = 0; idx < totalServers; idx++) {
      const name = serverNames[idx] || `Server ${idx + 1}`;
      const isActive = idx === activeStreamIndex;
      const item = document.createElement('div');
      item.style.cssText = `
        padding: 10px 12px; font-size: 12px; font-weight: ${isActive ? '700' : '500'};
        color: ${isActive ? '#00d084' : 'rgba(229,226,225,0.7)'};
        cursor: pointer; transition: all 0.15s ease;
        display: flex; align-items: center; gap: 8px;
        border-radius: 8px; margin-bottom: 2px;
        background: ${isActive ? 'rgba(0,208,132,0.1)' : 'transparent'};
      `;
      item.innerHTML = `
        <span style="width:6px;height:6px;border-radius:50%;display:inline-block;flex-shrink:0;
          background:${isActive ? '#00d084' : 'rgba(255,255,255,0.25)'};
          animation:${isActive ? 'pulse 1.5s infinite' : 'none'};"></span>
        <span style="flex:1;">${name}</span>
        ${isActive ? '<span style="font-size:10px;color:#00d084;">● LIVE</span>' : ''}
      `;
      item.onmouseenter = () => {
        if (!isActive) {
          item.style.background = 'rgba(255,255,255,0.06)';
          item.style.color = '#fff';
        }
      };
      item.onmouseleave = () => {
        if (!isActive) {
          item.style.background = 'transparent';
          item.style.color = 'rgba(229,226,225,0.7)';
        }
      };
      item.onclick = () => {
        PlayerPage.switchServer(idx);
        failCount = 0;
        closeOverlayDropdown();
      };
      listContainer.appendChild(item);
    }
  }

  function closeOverlayDropdown() {
    const dropdown = document.getElementById('server-dropdown-overlay');
    if (dropdown) dropdown.style.display = 'none';
  }

  return { init, goBack, switchServer };
})();

window.PlayerPage = PlayerPage;