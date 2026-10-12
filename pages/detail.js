/* CineStream — Detail Page Controller */

const isSeries = (type) => type === 'series' || type === 'tv';

const DetailPage = (() => {
  let currentContent = null;
  let inWatchlist = false;

  async function init(params) {
    // Check if params has id
    const contentId = params.id || '1';
    const contentType = params.type || 'movie';

    // Always fetch full details from TMDB — never rely on demo content
    let item = null;
    try {
      if (window.TMDB) {
        const fullItem = await TMDB.getDetails(contentId, contentType === 'series' ? 'tv' : 'movie');
        if (fullItem) {
          item = fullItem;
          window.registerDemoContent(item);
        }
      }
    } catch (err) {
      console.warn('Failed to fetch details directly from TMDB:', err);
    }
    if (!item) {
      if (window.UI) UI.toast('Could not find title details.', 'error');
      Router.navigate('home');
      return;
    }
    currentContent = item;

    // Render nav and footer
    document.getElementById('navbar-mount').innerHTML = UI.renderNavbar('home');
    document.getElementById('footer-mount').innerHTML = UI.renderFooter();
    document.getElementById('mobile-nav-mount').innerHTML = UI.renderMobileNav('home');
    UI.updateNavbarUser();
    UI.initRipples();

    // Populate data
    const img = document.getElementById('detail-backdrop-img');
    if (img) {
      img.style.opacity = '0';
      img.src = item.thumbnail || item.poster;
      img.style.opacity = '0.35';
    }

    const titleEl = document.getElementById('detail-title');
    if (titleEl) titleEl.textContent = item.title;

    const descEl = document.getElementById('detail-description');
    if (descEl) descEl.textContent = item.description;

    const typeBadge = document.getElementById('detail-type-badge');
    if (typeBadge) {
      if (isSeries(item.type)) {
        typeBadge.textContent = 'TV SERIES';
        typeBadge.className = 'badge badge-gold';
      } else {
        typeBadge.textContent = 'MOVIE';
        typeBadge.className = 'badge badge-red';
      }
    }

    const genreBadge = document.getElementById('detail-genre-badge');
    if (genreBadge) {
      genreBadge.textContent = item.genre || 'Drama';
    }

    const ratingBadge = document.getElementById('detail-rating-badge');
    if (ratingBadge) {
      ratingBadge.textContent = `⭐ ${item.imdb || '8.0'} IMDb`;
    }

    const yearEl = document.getElementById('detail-year');
    if (yearEl) yearEl.textContent = item.year || '2024';

    const durationEl = document.getElementById('detail-duration');
    if (durationEl) {
      durationEl.textContent = isSeries(item.type)
        ? `${item.seasons || 1} Season${(item.seasons || 1) > 1 ? 's' : ''}`
        : UI.formatDuration(item.duration || 120);
    }

    // Play Button Setup
    const playBtn = document.getElementById('detail-play-btn');
    if (playBtn) {
      playBtn.onclick = () => {
        if (item.type === 'anime' || contentType === 'anime') {
          Router.navigate('player', { id: item.id, type: 'anime', anilist_id: item.anilist_id, season: 1, episode: 1 });
        } else if (isSeries(item.type)) {
          Router.navigate('player', { id: item.id, type: 'series', season: 1, episode: 1 });
        } else {
          Router.navigate('player', { id: item.id, type: 'movie' });
        }
      };
    }

    // Download Button Setup — opens quality picker modal
    const downloadBtn = document.getElementById('detail-download-btn');
    const downloadText = document.getElementById('detail-download-text');
    if (downloadBtn) {
      if (window.OfflineStorage) {
        window.OfflineStorage.isDownloaded(item.id).then(isDownloaded => {
          if (isDownloaded) {
            downloadText.textContent = 'DOWNLOADED';
            downloadBtn.style.color = '#00d084';
            downloadBtn.style.borderColor = 'rgba(0,208,132,0.35)';
            downloadBtn.style.background = 'rgba(0,208,132,0.08)';
            const icon = downloadBtn.querySelector('.material-symbols-outlined');
            if (icon) icon.textContent = 'offline_pin';
          }
        });
      }

      downloadBtn.onclick = async () => {
        if (!window.Auth) {
          UI.toast('Please log in to download content.', 'info');
          Router.navigate('login');
          return;
        }
        const session = await window.Auth.getSession();
        if (!session) {
          UI.toast('Please log in to download content.', 'info');
          Router.navigate('login');
          return;
        }

        // If already downloaded, go to downloads page
        if (downloadText.textContent === 'DOWNLOADED') {
          Router.navigate('downloads');
          return;
        }

        if (isSeries(item.type)) {
          openDownloadModal(item, session.user.id, true);
        } else {
          // Direct download for movie (default to 1080p)
          triggerDownload(item.id, 'movie', '1080p', item.title, item.poster || item.thumbnail, session.user.id, null, 1, 1);
        }
      };
    }

    // Watchlist Management
    setupWatchlistButton(item.id);

    // Episodes Section (only for Series)
    const episodesSection = document.getElementById('episodes-section');
    if (episodesSection) {
      if (isSeries(item.type)) {
        episodesSection.style.display = 'block';
        setupEpisodes(item);
      } else {
        episodesSection.style.display = 'none';
      }
    }

    // More like this row
    populateRecommendations(item);
    // Render Cast & Crew after other sections
    renderCastCrew(item);
  }

  async function setupWatchlistButton(contentId) {
    const watchlistBtn = document.getElementById('detail-watchlist-btn');
    const iconEl = document.getElementById('watchlist-icon');
    const textEl = document.getElementById('watchlist-text');

    if (!watchlistBtn || !iconEl || !textEl) return;

    const session = await window.Auth.getSession();
    if (session) {
      const watchlist = await Subscriptions.getWatchlist(session.user.id);
      inWatchlist = watchlist.some(w => w.content_id === contentId);
      updateWatchlistUI(inWatchlist);
    }

    watchlistBtn.onclick = async () => {
      if (!session) {
        UI.toast('Please log in to manage your watchlist.', 'info');
        Router.navigate('login');
        return;
      }
      
      UI.setLoading(watchlistBtn, true);
      try {
        const added = await Subscriptions.toggleWatchlist(session.user.id, contentId);
        inWatchlist = added;
        updateWatchlistUI(inWatchlist);
        UI.toast(added ? 'Added to Watchlist' : 'Removed from Watchlist', 'success');
      } catch (err) {
        UI.toast('Failed to update watchlist.', 'error');
      } finally {
        UI.setLoading(watchlistBtn, false);
      }
    };
  }

  function updateWatchlistUI(added) {
    const iconEl = document.getElementById('watchlist-icon');
    const textEl = document.getElementById('watchlist-text');
    if (!iconEl || !textEl) return;

    if (added) {
      iconEl.textContent = 'bookmark_added';
      iconEl.classList.add('icon-fill');
      iconEl.style.color = 'var(--c-secondary-container)';
      textEl.textContent = 'In Watchlist';
    } else {
      iconEl.textContent = 'bookmark_add';
      iconEl.classList.remove('icon-fill');
      iconEl.style.color = '';
      textEl.textContent = 'Watchlist';
    }
  }

  function renderCastCrew(item) {
    const castContainer = document.querySelector('.cast-row');
    if (!castContainer) return;
    const cast = item.cast || [];
    const displayed = cast.slice(0, 12);
    castContainer.innerHTML = displayed.map(member => {
      const imgSrc = member.profile_path ? member.profile_path : 'https://placehold.co/64?text=No+Image';
      const role = member.character || member.role || '';
      return `
        <div style="display:flex; flex-direction:column; align-items:center; text-align:center; min-width:80px; flex-shrink:0;">
          <img src="${imgSrc}" alt="${member.name}" style="width:64px; height:64px; border-radius:50%; object-fit:cover; border:2px solid rgba(255,255,255,0.1)"/>
          <span style="font-size:12px; font-weight:600; margin-top:8px; display:block; white-space:nowrap; max-width:90px; overflow:hidden; text-overflow:ellipsis">${member.name}</span>
          ${role ? `<span style="font-size:10px; color:rgba(229,226,225,0.45); margin-top:2px; white-space:nowrap; max-width:90px; overflow:hidden; text-overflow:ellipsis; display:block;">${role}</span>` : ''}
        </div>`;
    }).join('');
  }

function setupEpisodes(item) {
    const select = document.getElementById('season-selector');
    const list = document.getElementById('episodes-list');
    if (!select || !list) return;

    // Reset season options
    select.innerHTML = '';
    
    // Extract actual available seasons directly from the API response
    let availableSeasons = [1];
    if (item.episodes && Object.keys(item.episodes).length > 0) {
      availableSeasons = Object.keys(item.episodes).map(Number).sort((a,b) => a - b);
    } else {
      const seasonsCount = item.seasons || 1;
      availableSeasons = Array.from({length: seasonsCount}, (_, i) => i + 1);
    }
    
    for (const sNum of availableSeasons) {
      const label = sNum === 0 ? 'Specials' : `Season ${sNum}`;
      select.innerHTML += `<option value="${sNum}">${label}</option>`;
    }
    
    // Ensure the selector defaults to Season 1 if it exists, otherwise the first available
    const defaultSeason = availableSeasons.includes(1) ? 1 : availableSeasons[0];
    select.value = String(defaultSeason);

    const renderEpisodesForSeason = (seasonNum) => {
      const episodes = item.episodes && item.episodes[seasonNum] ? item.episodes[seasonNum] : [];
      if (episodes.length === 0) {
        list.innerHTML = `<div style="color:rgba(255,255,255,0.6); padding:16px;">No episodes available for this season.</div>`;
        return;
      }
      const targetPlayerType = (item.type === 'anime' || contentType === 'anime') ? 'anime' : 'series';
      list.innerHTML = episodes.map(ep => `
        <div class="glass-card" style="display:flex; gap:20px; padding:16px; border-radius:12px; align-items:center; cursor:pointer;" onclick="Router.navigate('player', {id:'${item.id}', type:'${targetPlayerType}', anilist_id:'${item.anilist_id || ''}', season:${seasonNum}, episode:${ep.epNum}})">
          <div style="position:relative; width:160px; aspect-ratio:16/9; border-radius:6px; overflow:hidden; flex-shrink:0;">
            <img src="${ep.thumb}" alt="Episode Thumbnail" style="width:100%; height:100%; object-fit:cover;">
            <div style="position:absolute; inset:0; background:rgba(0,0,0,0.4); display:flex; align-items:center; justify-content:center;">
              <span class="material-symbols-outlined" style="font-size:32px; color:#fff;">play_circle</span>
            </div>
          </div>
          <div style="flex:1">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px">
              <span style="font-size:14px; font-weight:700; color:#fff;">Episode ${ep.epNum}: ${ep.title}</span>
              <span style="font-size:12px; color:rgba(229,226,225,0.45); font-weight:500;">${ep.duration}m</span>
            </div>
            <p style="font-size:12.5px; color:rgba(229,226,225,0.65); line-height:1.4">${ep.desc}</p>
          </div>
          <button class="btn btn-icon-circle" style="background:rgba(20,209,255,0.1); color:#14d1ff; border:1px solid rgba(20,209,255,0.3); width:36px; height:36px;" onclick="event.stopPropagation(); DetailPage.triggerDownload('${item.id}', 'series', '1080p', '${item.title}', '${item.poster || item.thumbnail}', null, null, ${seasonNum}, ${ep.epNum})">
            <span class="material-symbols-outlined" style="font-size:18px;">download</span>
          </button>
        </div>`).join('');
    };

    select.onchange = (e) => {
      renderEpisodesForSeason(e.target.value);
    };

    // Render the default season
    renderEpisodesForSeason(String(defaultSeason));
  }

  async function populateRecommendations(item) {
    const row = document.getElementById('detail-recommendations-row');
    if (!row) return;

    try {
      // Fetch similar titles from TMDB via proxy
      const tmdbType = item.type === 'series' ? 'tv' : 'movie';
      
      let similar = [];
      if (window.TMDB && typeof window.TMDB.fetchSimilar === 'function') {
         similar = await window.TMDB.fetchSimilar(tmdbType, item.tmdb_id || item.id);
      } else {
         const apiKey = window.ENV?.TMDB_API_KEY || window.ENV?.TMDB_API_KEYS || 'b7bb606801e160a12504bae3568cced9';
         const res = await fetch(
           `/tmdb-api/${tmdbType}/${item.tmdb_id || item.id}/similar?api_key=${apiKey.split(',')[0]}&language=en-US&page=1`
         );
         if (!res.ok) throw new Error('TMDB similar failed');
         const data = await res.json();
         similar = (data.results || []).slice(0, 8);
      }

      if (!similar || similar.length === 0) {
        row.innerHTML = '<p style="color:rgba(255,255,255,0.4);padding:12px;">No recommendations found.</p>';
        return;
      }

      row.innerHTML = similar.map(rec => {
        const recType = rec.first_air_date ? 'series' : 'movie';
        const poster = rec.poster_path
          ? `/tmdb-img-500${rec.poster_path}`
          : 'data:image/svg+xml;utf8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22170%22 height=%22255%22%3E%3Crect width=%22170%22 height=%22255%22 fill=%22%231a1a1a%22/%3E%3Ctext x=%2250%25%22 y=%2250%25%22 dominant-baseline=%22middle%22 text-anchor=%22middle%22 font-size=%2236%22 fill=%22%23333%22%3E%F0%9F%8E%AC%3C/text%3E%3C/svg%3E';
        const title = rec.title || rec.name || 'Unknown';
        const year = (rec.release_date || rec.first_air_date || '').slice(0, 4);
        return `
          <div class="poster-card-item" style="flex-shrink:0">
            <div class="poster-card" onclick="Router.navigate('detail',{id:'${rec.id}',type:'${recType}'})" title="${title}">
              <img src="${UI.getSecurePosterUrl ? UI.getSecurePosterUrl(poster) : poster.replace('http://', 'https://')}" alt="${title}" loading="lazy" onerror="this.onerror=null;this.src='https://placehold.co/170x255?text=No+Image'">
              <div class="card-overlay">
                <p style="font-size:12px;font-weight:600;color:#fff;line-height:1.3">${title}</p>
                <p style="font-size:11px;color:rgba(255,255,255,0.6);margin-top:2px">${year}</p>
              </div>
            </div>
            <p style="margin-top:8px;font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${title}</p>
            <p style="font-size:11px;color:rgba(229,226,225,0.45);margin-top:2px">${year}</p>
          </div>`;
      }).join('');
    } catch (err) {
      console.error('Error populating recommendations:', err);
      row.innerHTML = '<p style="color:rgba(255,255,255,0.4);padding:12px;">Could not load recommendations.</p>';
    }
  }

  // ─────────────────────────────────────────────────────
  // Download Modal Logic
  // ─────────────────────────────────────────────────────
  function openDownloadModal(item, userId, isSeries) {
    const overlay = document.getElementById('dl-modal-overlay');
    const modal = document.getElementById('dl-modal');
    const titleEl = document.getElementById('dl-modal-title');
    const grid = document.getElementById('dl-quality-grid');
    const statusRow = document.getElementById('dl-status-row');
    const statusText = document.getElementById('dl-status-text');
    if (!overlay || !modal) return;

    // Set movie title
    if (titleEl) titleEl.textContent = `Download: ${item.title}`;

    if (isSeries) {
      let allEpisodes = [];
      if (item.episodes) {
        Object.keys(item.episodes).forEach(s => {
          item.episodes[s].forEach(ep => {
            allEpisodes.push({ season: s, ...ep });
          });
        });
      }
      grid.style.display = 'block';
      grid.style.maxHeight = '360px';
      grid.style.overflowY = 'auto';
      grid.style.scrollbarWidth = 'thin';
      grid.style.scrollbarColor = 'rgba(255,255,255,0.15) transparent';
      
      if (allEpisodes.length === 0) {
        grid.innerHTML = '<p style="color:rgba(255,255,255,0.5); text-align:center; padding:20px;">No episodes available.</p>';
      } else {
        grid.innerHTML = allEpisodes.map((ep, i) => `
          <button class="dl-quality-btn" style="border-color:rgba(20,209,255,0.3);background:rgba(20,209,255,0.08);width:100%;margin-bottom:8px;display:flex;align-items:center;justify-content:space-between;flex-direction:row;"
            onclick="DetailPage.triggerDownload('${item.id}', 'series', '1080p', '${item.title}', '${item.poster || item.thumbnail}', '${userId}', null, ${ep.season}, ${ep.epNum})">
            <div style="display:flex;flex-direction:column;align-items:flex-start;text-align:left;">
              <span class="dl-quality-label" style="color:#14d1ff;">S${ep.season} E${ep.epNum}: ${ep.title}</span>
              <span class="dl-quality-sub">${ep.duration}m</span>
            </div>
            <span class="material-symbols-outlined" style="color:#14d1ff;font-size:22px;flex-shrink:0;">download</span>
          </button>
        `).join('');
      }
    } else {
      grid.style.display = 'grid';
      grid.style.maxHeight = 'none';
      grid.style.overflowY = 'visible';
      const qualities = [
        { label: '4K Ultra HD', sub: '2160p · ~15 GB', badge: '4K', color: '#ffc832', bg: 'rgba(255,200,50,0.08)', border: 'rgba(255,200,50,0.3)', resolution: '2160p' },
        { label: '1080p Full HD', sub: 'Best quality · ~4 GB', badge: 'HD', color: '#14d1ff', bg: 'rgba(20,209,255,0.08)', border: 'rgba(20,209,255,0.3)', resolution: '1080p' },
        { label: '720p HD', sub: 'Recommended · ~1.5 GB', badge: 'REC', color: '#00d084', bg: 'rgba(0,208,132,0.08)', border: 'rgba(0,208,132,0.3)', resolution: '720p' },
        { label: '480p SD', sub: 'Mobile friendly · ~500 MB', badge: 'SD', color: 'rgba(255,255,255,0.6)', bg: 'rgba(255,255,255,0.04)', border: 'rgba(255,255,255,0.12)', resolution: '480p' }
      ];

      grid.innerHTML = qualities.map((q, i) => `
        <button class="dl-quality-btn" id="dl-q-${i}"
          style="border-color:${q.border};background:${q.bg};"
          onclick="DetailPage.triggerDownload('${item.id}', 'movie', '${q.resolution}', '${item.title}', '${item.poster || item.thumbnail}', '${userId}', ${i})"
        >
          <span class="dl-quality-badge" style="background:${q.bg};color:${q.color};border:1px solid ${q.border};">${q.badge}</span>
          <span class="dl-quality-label" style="color:${q.color};padding-right:36px;">${q.label}</span>
          <span class="dl-quality-sub">${q.sub}</span>
        </button>
      `).join('');
    }

    // Hide status initially
    statusRow.style.display = 'none';

    // Show overlay + slide in modal
    overlay.style.display = 'flex';
    requestAnimationFrame(() => {
      modal.style.transform = 'translateY(0)';
    });

    // Close on overlay click
    overlay.onclick = (e) => {
      if (e.target === overlay) closeDownloadModal();
    };
  }

  function closeDownloadModal() {
    const overlay = document.getElementById('dl-modal-overlay');
    const modal = document.getElementById('dl-modal');
    if (!modal) return;
    modal.style.transform = 'translateY(100%)';
    setTimeout(() => {
      if (overlay) overlay.style.display = 'none';
    }, 380);
  }

  async function triggerDownload(contentId, type, resolution, title, poster, userId, btnIndex, season = 1, episode = 1) {
    const statusRow = document.getElementById('dl-status-row');
    const statusText = document.getElementById('dl-status-text');
    const btn = btnIndex !== null ? document.getElementById(`dl-q-${btnIndex}`) : null;

    // Show spinner
    if (statusRow) statusRow.style.display = 'block';
    if (statusText) statusText.textContent = `Resolving download link...`;
    if (btn) btn.style.opacity = '0.6';
    else UI.toast(`Resolving link for ${title}...`, 'info');

    try {
      const seasonNum = type === 'series' ? season : 1;
      const episodeNum = type === 'series' ? episode : 1;
      
      const storageId = type === 'series' ? `${contentId}_S${seasonNum}E${episodeNum}` : String(contentId);
      const displayTitle = type === 'series' ? `${title} (S${seasonNum} E${episodeNum})` : title;

      if (window.OfflineStorage) {
        await window.OfflineStorage.saveMovie(
          storageId,
          displayTitle,
          poster,
          null,
          0,
          { type, season: seasonNum, episode: episodeNum }
        );
      }

      const apiBase = window.BACKEND_URL || '';

      // Start background job on server
      if (statusText) statusText.textContent = 'Requesting server download...';
      let jobRes;
      try {
        jobRes = await fetch(`${apiBase}/api/jobs/download`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: contentId, type, season: seasonNum, episode: episodeNum, title })
        });
      } catch (err) {
        // Network error, backend not reachable
        jobRes = { ok: false, status: 404 };
      }

      // If backend is missing (e.g. deployed to Vercel without Express), fallback to Layer-2 direct link
      if (!jobRes || !jobRes.ok || jobRes.status === 404) {
        console.warn('[DownloadModal] Backend job server not found. Falling back to serverless aggregator link...');
        if (statusText) statusText.textContent = 'Resolving download link...';
        
        const dlRes = await fetch(`${apiBase}/api/download_link?id=${contentId}&type=${type}&season=${seasonNum}&episode=${episodeNum}`);
        const text = await dlRes.text();
        let dlData;
        try {
          dlData = JSON.parse(text);
        } catch (e) {
          throw new Error('Failed to parse download link response.');
        }

        if (!dlData.success || !dlData.downloadUrl) {
          throw new Error(dlData.error || 'Failed to resolve download link');
        }

        if (statusText) statusText.textContent = 'Downloading stream...';
        
        try {
          const extractUrl = `${apiBase}/api/extract_stream?id=${encodeURIComponent(contentId)}&type=${encodeURIComponent(type)}&season=${encodeURIComponent(seasonNum)}&episode=${encodeURIComponent(episodeNum)}&title=${encodeURIComponent(title)}`;
          
          const videoRes = await fetch(extractUrl);
          if (!videoRes.ok) throw new Error(`HTTP ${videoRes.status}`);

          const reader = videoRes.body.getReader();
          const totalBytes = Number(videoRes.headers.get('Content-Length')) || 0;
          let processedBytes = 0;
          const chunks = [];

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            chunks.push(value);
            processedBytes += value.length;

            if (totalBytes > 0) {
              const pct = Math.min(99, Math.round((processedBytes / totalBytes) * 100));
              if (statusText) statusText.textContent = `Downloading stream... ${pct}%`;
            }
          }

          if (statusText) statusText.textContent = 'Saving to device...';
          const mediaBlob = new Blob(chunks, { type: 'video/mp4' });

          if (window.OfflineStorage) {
            await window.OfflineStorage.saveMovie(
              storageId,
              displayTitle,
              poster,
              mediaBlob,
              mediaBlob.size,
              { type, season: seasonNum, episode: episodeNum }
            );
          }
        } catch (e) {
          console.warn('[DownloadModal] Chunked fetch failed. Triggering native anchor download as fallback.', e);
          if (statusText) statusText.textContent = 'Fallback: Starting browser download...';
          
          const a = document.createElement('a');
          a.style.display = 'none';
          a.href = dlData.downloadUrl;
          a.target = '_blank';
          a.download = `${title.replace(/[^a-zA-Z0-9_-]/g, '_')}.mp4`;
          document.body.appendChild(a);
          a.click();
          setTimeout(() => document.body.removeChild(a), 1000);
        }

        if (type !== 'series') {
          const dlText = document.getElementById('detail-download-text');
          const dlBtn  = document.getElementById('detail-download-btn');
          if (dlText) dlText.textContent = 'DOWNLOADED';
          if (dlBtn) {
            dlBtn.style.color = '#00d084';
            dlBtn.style.borderColor = 'rgba(0,208,132,0.35)';
            dlBtn.style.background = 'rgba(0,208,132,0.08)';
            const icon = dlBtn.querySelector('.material-symbols-outlined');
            if (icon) icon.textContent = 'offline_pin';
          }
        }
        setTimeout(() => closeDownloadModal(), 1200);
        return;
      }
      
      const text = await jobRes.text();
      let jobData;
      try {
        jobData = JSON.parse(text);
      } catch (e) {
        throw new Error('Server returned invalid JSON. Is the backend running?');
      }

      if (!jobData.success) {
        throw new Error(jobData.error || 'Failed to start download job');
      }

      // Handle direct download bypass (e.g. from vidlink network extraction)
      if (jobData.directDownloadUrl) {
        if (statusText) statusText.textContent = 'Downloading offline file...';
        
        try {
          const extractUrl = `/api/extract_stream?id=${encodeURIComponent(contentId)}&type=${encodeURIComponent(type)}&season=${encodeURIComponent(seasonNum)}&episode=${encodeURIComponent(episodeNum)}&title=${encodeURIComponent(title)}`;
          
          const videoRes = await fetch(extractUrl);
          if (!videoRes.ok) throw new Error(`HTTP ${videoRes.status}`);

          const reader = videoRes.body.getReader();
          const totalBytes = Number(videoRes.headers.get('Content-Length')) || 0;
          let processedBytes = 0;
          const chunks = [];

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            chunks.push(value);
            processedBytes += value.length;

            if (totalBytes > 0) {
              const pct = Math.min(99, Math.round((processedBytes / totalBytes) * 100));
              if (statusText) statusText.textContent = `Downloading... ${pct}%`;
            }
          }

          const mediaBlob = new Blob(chunks, { type: 'video/mp4' });

          if (window.OfflineStorage) {
            await window.OfflineStorage.saveMovie(
              storageId,
              displayTitle,
              poster,
              mediaBlob,
              mediaBlob.size,
              { type, season: seasonNum, episode: episodeNum }
            );
          }
        } catch (e) {
          console.warn('[DownloadModal] Direct download proxy fetch failed. Triggering native anchor download as fallback.', e);
          if (statusText) statusText.textContent = 'Fallback: Starting browser download...';
          
          const a = document.createElement('a');
          a.style.display = 'none';
          a.href = jobData.directDownloadUrl;
          a.target = '_blank';
          a.download = jobData.filename || `${title.replace(/[^a-zA-Z0-9_-]/g, '_')}.mp4`;
          document.body.appendChild(a);
          a.click();
          setTimeout(() => document.body.removeChild(a), 1000);
        }

        if (type !== 'series') {
          const dlText = document.getElementById('detail-download-text');
          const dlBtn  = document.getElementById('detail-download-btn');
          if (dlText) dlText.textContent = 'DOWNLOADED';
          if (dlBtn) {
            dlBtn.style.color = '#00d084';
            dlBtn.style.borderColor = 'rgba(0,208,132,0.35)';
            dlBtn.style.background = 'rgba(0,208,132,0.08)';
            const icon = dlBtn.querySelector('.material-symbols-outlined');
            if (icon) icon.textContent = 'offline_pin';
          }
        }
        setTimeout(() => closeDownloadModal(), 1200);
        return;
      }

      if (!jobData.jobId) {
        throw new Error('Failed to start download job (Missing Job ID)');
      }

      const jobId = jobData.jobId;
      
      // Poll job status
      const pollInterval = setInterval(async () => {
        try {
          const statusRes = await fetch(`${apiBase}/api/jobs/status/${jobId}`);
          const statusData = await statusRes.json();
          
          if (statusData.status === 'failed') {
            clearInterval(pollInterval);
            throw new Error(statusData.error || 'Download failed on server');
          }
          
          if (statusData.status === 'completed') {
            clearInterval(pollInterval);
            if (statusText) statusText.textContent = 'Ready! Starting download...';
            
            // Trigger native download from server cache
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = `${apiBase}/api/jobs/file/${jobId}`;
            a.download = jobData.filename || `${title.replace(/[^a-zA-Z0-9_-]/g, '_')}.mp4`;
            a.target = '_blank';
            document.body.appendChild(a);
            a.click();
            setTimeout(() => document.body.removeChild(a), 1000);

            if (type !== 'series') {
              const dlText = document.getElementById('detail-download-text');
              const dlBtn  = document.getElementById('detail-download-btn');
              if (dlText) dlText.textContent = 'DOWNLOADED';
              if (dlBtn) {
                dlBtn.style.color = '#00d084';
                dlBtn.style.borderColor = 'rgba(0,208,132,0.35)';
                dlBtn.style.background = 'rgba(0,208,132,0.08)';
                const icon = dlBtn.querySelector('.material-symbols-outlined');
                if (icon) icon.textContent = 'offline_pin';
              }
            }

            setTimeout(() => closeDownloadModal(), 1200);
          } else {
            // Update progress
            if (statusText) statusText.textContent = `Downloading on server... ${statusData.progress}%`;
          }
        } catch (pollErr) {
          console.warn('Poll error:', pollErr);
        }
      }, 1500);

    } catch (err) {
      console.error('[DownloadModal] Error:', err);
      if (statusText) statusText.textContent = err.message || 'Could not resolve download. Try again.';
      if (btn) btn.style.opacity = '1';
      else UI.toast('Download failed. Please try again.', 'error');
    }
  }

  return { init, closeDownloadModal, triggerDownload };
})();

window.DetailPage = DetailPage;
