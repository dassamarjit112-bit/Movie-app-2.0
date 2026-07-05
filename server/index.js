require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const { spawn } = require('child_process');
const { extractMasterPlaylistUrl } = require('./puppeteerExtractor');

// Attempt to load the legacy scraper (optional — won't crash if missing)
let scraper;
try {
  scraper = require('../utils/scraper');
} catch (_) {
  scraper = null;
}

const app = express();
app.use(cors());
app.use(express.json());

// ── Security: Permissions-Policy ─────────────────────────────
// Disables invasive browser APIs that ad-network scripts (e.g. tag.min.js)
// attempt to access, causing Permissions-Policy violation warnings.
app.use((req, res, next) => {
  res.setHeader(
    'Permissions-Policy',
    'bluetooth=(), usb=(), serial=(), midi=(), payment=(), camera=(), microphone=(), geolocation=()'
  );
  next();
});


// ──────────────────────────────────────────────────────────────
// Embedded Streaming Servers — India-friendly + Worldwide
// These servers work great in India for all movie types:
// Old classics, Bollywood, Hollywood, South Indian, etc.
// ──────────────────────────────────────────────────────────────
const STREAM_SERVERS = {
  movie: {
    // Primary embed servers (highest reliability in India)
    vidsrc_to: (id) => `https://vidsrc.to/embed/movie/${id}`,
    vidsrc_me: (id) => `https://vidsrc.me/embed/movie?tmdb=${id}`,
    embed_su: (id) => `https://embed.su/embed/movie/${id}`,
    embed2: (id) => `https://www.2embed.cc/embed/${id}`,
    vidlink: (id) => `https://vidlink.pro/movie/${id}`,
    autoembed: (id) => `https://autoembed.co/movie/tmdb/${id}`,
    multiembed: (id) => `https://multiembed.mov/?video_id=${id}&tmdb=1`,
    moviesapi: (id) => `https://moviesapi.club/movie/${id}`,
    vidsrc_icu: (id) => `https://vidsrc.icu/embed/movie/${id}`,
    superembed: (id) => `https://multiembed.mov/directstream.php?video_id=${id}&tmdb=1`,
    // Indian-friendly servers for Bollywood & regional content
    hindimovies: (id) => `https://hindimovies.to/embed/movie/${id}`,
    dbgo: (id) => `https://dbgo.fun/embed/movie/${id}`,
    flix555: (id) => `https://flix555.com/movie/${id}`,
    streamimdb: (id) => `https://streamimdb.ru/embed/movie/${id}`,
    // Old movies & classics servers
    clasicos: (id) => `https://clasicos.netlify.app/embed/movie/${id}`,
    moviesapi_club: (id) => `https://moviesapi.club/movie/${id}`,
  },
  tv: {
    vidsrc_to: (id, s, e) => `https://vidsrc.to/embed/tv/${id}/${s}/${e}`,
    vidsrc_me: (id, s, e) => `https://vidsrc.me/embed/tv?tmdb=${id}&season=${s}&episode=${e}`,
    embed_su: (id, s, e) => `https://embed.su/embed/tv/${id}/${s}/${e}`,
    embed2: (id, s, e) => `https://www.2embed.cc/embedtv/${id}&s=${s}&e=${e}`,
    vidlink: (id, s, e) => `https://vidlink.pro/tv/${id}/${s}/${e}`,
    autoembed: (id, s, e) => `https://autoembed.co/tv/tmdb/${id}-${s}-${e}`,
    moviesapi: (id, s, e) => `https://moviesapi.club/tv/${id}-${s}-${e}`,
    multiembed: (id, s, e) => `https://multiembed.mov/?video_id=${id}&tmdb=1&s=${s}&e=${e}`,
    vidsrc_icu: (id, s, e) => `https://vidsrc.icu/embed/tv/${id}/${s}/${e}`,
    streamimdb: (id, s, e, imdbId) => `https://streamimdb.ru/embed/tv/${imdbId || id}/${s}/${e}`,
    dbgo: (id, s, e) => `https://dbgo.fun/embed/tv/${id}/${s}/${e}`,
  }
};

// ── Server Health Check ───────────────────────────────────────
// Pre-checks which embed servers are responding before returning to client
const SERVER_TIMEOUT = 5000; // 5 second timeout per server

async function checkServerHealth(url) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), SERVER_TIMEOUT);
    const res = await axios.get(url, {
      signal: controller.signal,
      timeout: SERVER_TIMEOUT,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      validateStatus: (status) => status < 500 // Accept any non-500 status
    });
    clearTimeout(timeoutId);
    // Consider server healthy if we get any response that's not a 5xx
    return res.status < 500;
  } catch (err) {
    return false;
  }
}

/**
 * GET /api/servers/health
 * Returns which streaming servers are currently online and responsive
 */
app.get('/api/servers/health', async (req, res) => {
  const { tmdbId, type = 'movie', season, episode } = req.query;
  if (!tmdbId) {
    return res.status(400).json({ success: false, error: 'tmdbId is required' });
  }

  const mediaType = type === 'tv' ? 'tv' : 'movie';
  const servers = STREAM_SERVERS[mediaType];
  const results = [];

  for (const [name, builder] of Object.entries(servers)) {
    let url;
    if (mediaType === 'tv') {
      const s = parseInt(season) || 1;
      const e = parseInt(episode) || 1;
      url = builder(tmdbId, s, e, null);
    } else {
      url = builder(tmdbId);
    }
    
    const isAlive = await checkServerHealth(url);
    results.push({ name, url, isAlive, status: isAlive ? 'online' : 'offline' });
  }

  // Sort: online first, then offline
  results.sort((a, b) => (a.isAlive === b.isAlive ? 0 : a.isAlive ? -1 : 1));

  res.json({ success: true, servers: results });
});

/**
 * GET /api/servers/list
 * Returns all available streaming servers without health check
 */
app.get('/api/servers/list', (req, res) => {
  const { type = 'all' } = req.query;
  if (type === 'movie') {
    const servers = Object.entries(STREAM_SERVERS.movie).map(([name, builder]) => ({
      name,
      url: builder('{TMDB_ID}'),
      pattern: builder('{TMDB_ID}'),
      type: 'movie'
    }));
    return res.json({ success: true, servers });
  } else if (type === 'tv') {
    const servers = Object.entries(STREAM_SERVERS.tv).map(([name, builder]) => ({
      name,
      url: builder('{TMDB_ID}', '{SEASON}', '{EPISODE}', '{IMDB_ID}'),
      pattern: builder('{TMDB_ID}', '{SEASON}', '{EPISODE}', '{IMDB_ID}'),
      type: 'tv'
    }));
    return res.json({ success: true, servers });
  }
  
  // Return all servers
  const allServers = {};
  for (const [mediaType, serverMap] of Object.entries(STREAM_SERVERS)) {
    allServers[mediaType] = Object.keys(serverMap);
  }
  res.json({ success: true, servers: allServers });
});

/**
 * GET /api/stream
 * Query parameters:
 *   - mediaId: TMDB ID of the movie or TV show (required)
 *   - type: "movie" or "tv" (required)
 *   - season: season number (optional, for TV shows)
 *   - episode: episode number (optional, for TV shows)
 */
app.get('/api/stream', async (req, res) => {
  const { mediaId, type, season, episode } = req.query;
  if (!mediaId || !type) {
    return res.status(400).json({ success: false, error: 'mediaId and type are required' });
  }
  
  try {
    const streamSources = await scraper.resolveStreams({
      id: mediaId,
      type: type,
      season: season ? Number(season) : undefined,
      episode: episode ? Number(episode) : undefined
    });
    const activeStreams = streamSources.filter(src => src.isPlayable);
    const payload = activeStreams.map(s => ({
      provider: s.providerName,
      url: s.streamUrl,
      quality: s.quality,
      subtitles: s.subtitles || []
    }));
    res.json({ success: true, streams: payload });
  } catch (err) {
    console.error('CinePro scraping error:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch media streams' });
  }
});

/**
 * GET /api/scrape
 * Zero-API fallback scraper — searches DuckDuckGo + scrapes TMDB public pages
 */
app.get('/api/scrape', async (req, res) => {
  const { search, type = 'movie' } = req.query;
  if (!search) return res.status(400).json({ error: 'Provide a search parameter' });

  const mediaType = type === 'tv' ? 'tv' : 'movie';
  const siteTarget = mediaType === 'tv' ? 'site:themoviedb.org/tv' : 'site:themoviedb.org/movie';

  try {
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(search + ' ' + siteTarget)}`;
    const searchResponse = await axios.get(searchUrl, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    });

    let $ = cheerio.load(searchResponse.data);
    let tmdbId = null;
    let foundPath = '';
    const tmdbPathPattern = mediaType === 'tv' ? '/tv/' : '/movie/';

    $('.result__url, .result__a, a[href*="themoviedb.org"]').each((i, el) => {
      if (tmdbId) return;
      const text = $(el).text().trim();
      const href = $(el).attr('href') || '';
      const combined = text + ' ' + href;
      const idx = combined.indexOf(tmdbPathPattern);
      if (idx !== -1) {
        const after = combined.slice(idx + tmdbPathPattern.length);
        const idMatch = after.match(/^(\d+)/);
        if (idMatch) {
          tmdbId = idMatch[1];
          foundPath = combined;
        }
      }
    });

    if (!tmdbId) {
      const rawHtml = searchResponse.data;
      const pattern = new RegExp(`themoviedb\\.org${tmdbPathPattern.replace('/', '\\/')}(\\d+)`, 'i');
      const match = rawHtml.match(pattern);
      if (match) tmdbId = match[1];
    }

    if (!tmdbId) {
      return res.status(404).json({
        success: false,
        error: 'Could not locate a matching TMDB page for this title.'
      });
    }

    // Step 2: Fetch and parse the TMDB public page
    const targetUrl = `https://www.themoviedb.org/${mediaType}/${tmdbId}`;
    const pageResponse = await axios.get(targetUrl, {
      timeout: 12000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });

    $ = cheerio.load(pageResponse.data);

    const title =
      $('div.title h2 a').first().text().trim() ||
      $('section.inner_content h2 a').first().text().trim() ||
      $('h2').first().text().trim() ||
      search;

    const overview =
      $('div.overview p').text().trim() ||
      $('[class*="overview"] p').text().trim() ||
      $('p.overview').text().trim() ||
      '';

    let posterPath = null;
    const posterImgEl = $('img.poster').first() || $('[class*="poster"] img').first();
    const rawSrc = posterImgEl.attr('src') || posterImgEl.attr('data-src') || '';
    if (rawSrc) {
      posterPath = rawSrc.startsWith('http') ? rawSrc : `https://image.tmdb.org/t/p/w500${rawSrc}`;
    }

    const cast = [];
    $('li.card', 'ol.people').each((i, el) => {
      if (i >= 6) return;
      const name = $(el).find('p a').first().text().trim();
      const character = $(el).find('p.character').text().trim().replace(/\s+/g, ' ');
      if (name) cast.push({ name, character });
    });

    const releaseText = $('span.release_date').text().trim() ||
                        $('[class*="release_date"]').text().trim() || '';
    const yearMatch = releaseText.match(/\d{4}/);
    const year = yearMatch ? yearMatch[0] : null;

    // Build ALL embed streams using the server list
    const embedServers = STREAM_SERVERS[mediaType];
    const streams = Object.entries(embedServers).map(([name, builder]) => {
      if (mediaType === 'tv') {
        return { name, url: builder(tmdbId, 1, 1, null) };
      }
      return { name, url: builder(tmdbId) };
    });

    return res.json({
      success: true,
      tmdb_id: tmdbId,
      title,
      year,
      type: mediaType,
      description: overview,
      poster: posterPath,
      cast_list: cast,
      stream: streams[0]?.url || '',
      streams,
      source_url: targetUrl
    });

  } catch (error) {
    console.error('Scraping engine error:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve public movie data.'
    });
  }
});

/**
 * GET /api/sports/fancode
 */
const FANCODE_MIRROR_JSON = "https://raw.githubusercontent.com/kajju027/Fancode-Events-Json/main/fancode.json";

app.get('/api/sports/fancode', async (req, res) => {
  try {
    const response = await axios.get(FANCODE_MIRROR_JSON, { timeout: 10000 });
    const liveMatches = response.data.matches || response.data || [];
    
    if (!Array.isArray(liveMatches)) {
      throw new Error("Invalid response format from FanCode mirror");
    }

    const formattedFixtures = liveMatches.map((match, i) => ({
      matchId: match.match_id || `fc-${i}`,
      title: match.match_name || 'FanCode Event',
      tournament: match.event_name || 'Premium Sports',
      sportType: (match.event_category || 'cricket').toLowerCase(),
      homeTeam: match.team_1_name || 'Team 1',
      awayTeam: match.team_2_name || 'Team 2',
      homeLogo: match.team_1_flag || '',
      awayLogo: match.team_2_flag || '',
      banner: match.banner || '',
      streamUrl: match.stream_link || '',
      status: 'LIVE',
      score: 'LIVE',
      isFancode: true
    }));

    return res.json({ success: true, matches: formattedFixtures });
  } catch (error) {
    console.error("FanCode routing node failure:", error.message);
    return res.status(500).json({ error: "FanCode server cluster unreachable" });
  }
});
const { scrapeLayer3Link } = require('./vegaScraper');

/**
 * GET /api/download_link
 * Multi-layer download link resolver.
 * Priority:
 *   1. Puppeteer headless extraction from vidlink.pro / vidsrc (returns .m3u8)
 *   2. VegaMovies/HDHub4u stealth scrape (direct mp4/cloud link)
 *   3. Aggregator API fallback
 *   4. Layer-1 embed player link (lowest effort)
 */
app.get('/api/download_link', async (req, res) => {
  try {
    const { id, type, season = 1, episode = 1 } = req.query;
    if (!id || !type) return res.status(400).json({ error: 'Missing id or type' });

    console.log(`[DownloadAPI] Resolving download for TMDB ID: ${id} (${type})`);

    // ── Step 0: Resolve TMDB → IMDB + title/year ──────────────────────────────
    let imdbId = id;
    let movieTitle = null;
    let movieYear = null;

    try {
      const tmdbApiKey = process.env.TMDB_API_KEY || '8d6d91941230817f7807d643736e8a49';
      const tmdbUrl = type === 'series'
        ? `https://api.themoviedb.org/3/tv/${id}?api_key=${tmdbApiKey}&append_to_response=external_ids`
        : `https://api.themoviedb.org/3/movie/${id}?api_key=${tmdbApiKey}&append_to_response=external_ids`;
      const tmdbRes = await axios.get(tmdbUrl, { timeout: 5000 });
      if (tmdbRes.data) {
        if (tmdbRes.data.external_ids?.imdb_id) {
          imdbId = tmdbRes.data.external_ids.imdb_id;
          console.log(`[DownloadAPI] TMDB ${id} → IMDB ${imdbId}`);
        }
        movieTitle = tmdbRes.data.title || tmdbRes.data.name;
        const rd = tmdbRes.data.release_date || tmdbRes.data.first_air_date;
        if (rd) movieYear = rd.split('-')[0];
      }
    } catch (e) {
      console.warn('[DownloadAPI] TMDB lookup failed, continuing with raw ID.');
    }

    let finalUrl = null;
    let isM3U8 = false;

    // ── Step 1: Puppeteer headless extraction (primary method) ────────────────
    console.log(`[DownloadAPI] Step 1: Headless browser extraction via vidlink.pro...`);
    const m3u8 = await extractMasterPlaylistUrl(id, type === 'series' ? 'series' : 'movie', Number(season), Number(episode));
    if (m3u8) {
      console.log(`[DownloadAPI] ✅ Headless extraction succeeded: ${m3u8}`);
      finalUrl = m3u8;
      isM3U8 = true;
    }

    // ── Step 2: VegaMovies stealth scrape ─────────────────────────────────────
    if (!finalUrl && movieTitle) {
      console.log(`[DownloadAPI] Step 2: VegaMovies stealth scrape for '${movieTitle}'...`);
      finalUrl = await scrapeLayer3Link(movieTitle, movieYear, type);
    }

    // ── Step 3: Layer-2 aggregator APIs ──────────────────────────────────────
    if (!finalUrl) {
      console.log(`[DownloadAPI] Step 3: Layer-2 aggregator APIs...`);
      const aggregators = type === 'series'
        ? [`https://vidsrc.to/api/embed/tv/${imdbId}`, `https://embed.su/api/tv/${imdbId}`]
        : [`https://vidsrc.to/api/embed/movie/${imdbId}`, `https://embed.su/api/movie/${imdbId}`];
      const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://www.google.com/',
      };
      for (const endpoint of aggregators) {
        try {
          const r = await axios.get(endpoint, { headers, timeout: 5000 });
          const d = r.data;
          if (d?.download_mirror_url) finalUrl = d.download_mirror_url;
          else if (d?.url) finalUrl = d.url;
          if (finalUrl) { console.log(`[DownloadAPI] Aggregator hit: ${endpoint}`); break; }
        } catch (_) {}
      }
    }

    // ── Step 4: Layer-1 embed fallback ────────────────────────────────────────
    if (!finalUrl) {
      console.log(`[DownloadAPI] Step 4: All scrapers failed. Returning embed player URL.`);
      finalUrl = type === 'series'
        ? `https://vidsrc.to/embed/tv/${imdbId}/${season}/${episode}`
        : `https://vidsrc.to/embed/movie/${imdbId}`;
    }

    return res.status(200).json({ success: true, downloadUrl: finalUrl, isM3U8, title: movieTitle });

  } catch (error) {
    console.error('[DownloadAPI] Error:', error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

/**
 * GET /api/extract_stream
 * Runs headless Puppeteer to extract the .m3u8 from vidlink.pro, then pipes it
 * through FFmpeg to produce a real .mp4 file download streamed back to the client.
 *
 * Query params: id, type, season, episode, title
 */
app.head('/api/extract_stream', (req, res) => {
  // Fast response for frontend probe requests (prevents 30s timeout on HEAD)
  res.status(200).end();
});

app.get('/api/extract_stream', async (req, res) => {
  const { id, type = 'movie', season = 1, episode = 1, title = 'movie' } = req.query;
  if (!id) return res.status(400).json({ error: 'Missing TMDB id' });

  console.log(`[ExtractStream] Starting extraction for TMDB ID: ${id}`);

  let m3u8Url = null;
  try {
    const { exec } = require('child_process');
    m3u8Url = await new Promise((resolve) => {
      exec(`node server/puppeteerStandalone.js ${id} ${type} ${season} ${episode}`, { timeout: 45000 }, (error, stdout) => {
        if (error || !stdout) {
          console.error('[ExtractStream] Standalone script error:', error?.message);
          resolve(null);
        } else {
          resolve(stdout.trim());
        }
      });
    });
  } catch (err) {
    console.error('[ExtractStream] Extraction failed:', err.message);
  }

  if (!m3u8Url || !m3u8Url.startsWith('http')) {
    return res.status(404).json({
      success: false,
      error: 'Could not extract a stream URL. The provider may require a real browser session.',
    });
  }

  // Sanitise filename for Content-Disposition header
  const safeTitle = (title || 'cinestream').replace(/[^a-zA-Z0-9_\-\s]/g, '').trim().replace(/\s+/g, '_');
  const filename = `${safeTitle}_${type === 'series' ? `S${season}E${episode}` : 'movie'}.mp4`;

  // Set response headers so the browser triggers a real Save-As dialog
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'video/mp4');

  const isMp4 = m3u8Url.includes('.mp4');
  if (isMp4) {
    console.log(`[ExtractStream] Direct MP4 detected. Proxying without FFmpeg → ${filename}`);
    try {
      const streamRes = await axios({
        method: 'get',
        url: m3u8Url,
        responseType: 'stream',
        headers: {
          'Referer': 'https://vidlink.pro/',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
      
      if (streamRes.headers['content-length']) {
        res.setHeader('Content-Length', streamRes.headers['content-length']);
      }
      
      streamRes.data.pipe(res);
      req.on('close', () => { if (streamRes.data.destroy) streamRes.data.destroy(); });
    } catch (e) {
      console.error('[ExtractStream] MP4 proxy error:', e.message);
      if (!res.headersSent) res.status(500).json({ error: 'MP4 proxy failed' });
      else res.end();
    }
    return;
  }

  res.setHeader('Transfer-Encoding', 'chunked');
  console.log(`[ExtractStream] Piping m3u8 through FFmpeg → ${filename}`);
  console.log(`[ExtractStream] M3U8 URL: ${m3u8Url}`);

  // Load the bundled ffmpeg binary (works natively on Windows without system install)
  let ffmpegPath = 'ffmpeg';
  try {
    ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
  } catch (e) {
    try {
      ffmpegPath = require('ffmpeg-static');
    } catch (e2) {
      console.warn('[ExtractStream] @ffmpeg-installer and ffmpeg-static not found or failed, falling back to system ffmpeg');
    }
  }

  // Spawn ffmpeg: read the HLS playlist and copy streams into an mp4 container
  // -c copy = no re-encoding (fast, lossless remux)
  const ffmpegArgs = [
    '-user_agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    '-headers', `Referer: https://vidlink.pro/\r\nOrigin: https://vidlink.pro`,
    '-i', m3u8Url,
    '-c', 'copy',
    '-movflags', 'frag_keyframe+empty_moov+faststart',
    '-f', 'mp4',
    'pipe:1',  // write output to stdout so Node can pipe it
  ];

  const ffmpeg = spawn(ffmpegPath, ffmpegArgs, { stdio: ['ignore', 'pipe', 'pipe'] });

  // Pipe ffmpeg stdout directly into the HTTP response
  ffmpeg.stdout.pipe(res);

  ffmpeg.stderr.on('data', (chunk) => {
    // Log ffmpeg progress without flooding the console
    const line = chunk.toString();
    if (line.includes('frame=') || line.includes('time=') || line.includes('Error')) {
      process.stdout.write(`[FFmpeg] ${line}`);
    }
  });

  ffmpeg.on('close', (code) => {
    console.log(`[ExtractStream] FFmpeg exited with code ${code}`);
    if (!res.writableEnded) res.end();
  });

  ffmpeg.on('error', (err) => {
    console.error('[ExtractStream] FFmpeg spawn error:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: 'FFmpeg not found or failed to start. Is FFmpeg installed?' });
    } else if (!res.writableEnded) {
      res.end();
    }
  });

  // If client disconnects, kill ffmpeg to free resources
  req.on('close', () => {
    console.log('[ExtractStream] Client disconnected — killing FFmpeg.');
    ffmpeg.kill('SIGKILL');
  });
});

// --- Background Job API Endpoints ---
const downloadJobs = require('./downloadJobs');

app.post('/api/jobs/download', async (req, res) => {
  const { id, type = 'movie', season = 1, episode = 1, title = 'movie' } = req.body;
  if (!id) return res.status(400).json({ error: 'Missing TMDB id' });
  
  console.log(`[JobAPI] Requesting background extraction for TMDB ID: ${id}`);
  let downloadUrl = null;
  try {
    const { scrapeVidlink } = require('./vidlinkScraper');
    downloadUrl = await scrapeVidlink(id, type, season, episode);
  } catch (err) {
    console.error('[JobAPI] Vidlink extraction failed:', err.message);
  }


  if (!downloadUrl || !downloadUrl.startsWith('http')) {
    return res.status(404).json({ success: false, error: 'Could not extract a stream URL.' });
  }

  const safeTitle = (title || 'cinestream').replace(/[^a-zA-Z0-9_\-\s]/g, '').trim().replace(/\s+/g, '_');
  const filename = `${safeTitle}_${type === 'series' ? `S${season}E${episode}` : 'movie'}.mp4`;

  // Return the direct URL so the frontend can download it natively
  res.json({ success: true, directDownloadUrl: downloadUrl, filename });
});

app.get('/api/jobs/status/:jobId', (req, res) => {
  const job = downloadJobs.getJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json({ success: true, status: job.status, progress: job.progress, error: job.error });
});

app.get('/api/jobs/file/:jobId', (req, res) => {
  const job = downloadJobs.getJob(req.params.jobId);
  if (!job || job.status !== 'completed') {
    return res.status(404).json({ error: 'File not ready or job not found' });
  }
  res.download(job.filePath, job.filename);
});

// ── OneSignal Push Notification Proxy ──
app.post('/api/onesignal', async (req, res) => {
  const { title, body, image, url } = req.body;
  if (!title || !body) return res.status(400).json({ error: 'Missing title or body' });

  const APP_ID = "f7ade4f1-a755-4469-a204-46f57f451a7e";
  const REST_API_KEY = process.env.ONESIGNAL_REST_API_KEY;

  if (!REST_API_KEY) {
    return res.status(500).json({ error: 'Server misconfiguration: missing API key' });
  }

  const payload = {
    app_id: APP_ID,
    included_segments: ["Subscribed Users"],
    headings: { "en": title },
    contents: { "en": body }
  };
  
  if (image) payload.big_picture = image;
  if (url) payload.url = url;

  try {
    const response = await axios.post("https://onesignal.com/api/v1/notifications", payload, {
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Basic ${REST_API_KEY}`
      }
    });
    return res.status(response.status).json(response.data);
  } catch(e) {
    console.error("[OneSignal API] Error:", e.message);
    return res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`CinePro backend listening on http://localhost:${PORT}`);
  console.log(`Stream servers loaded: Movies=${Object.keys(STREAM_SERVERS.movie).length}, TV=${Object.keys(STREAM_SERVERS.tv).length}`);
});