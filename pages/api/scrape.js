// pages/api/scrape.js
// Vercel Serverless Function — Zero-API Movie/TV Scraper
// Route: GET /api/scrape?search=Inception&type=movie
// No TMDB API key required. Uses DuckDuckGo + Cheerio public page parsing.

const axios = require('axios');
const cheerio = require('cheerio');

const SCRAPER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Cache-Control': 'no-cache'
};

module.exports = async function handler(req, res) {
  // CORS headers — required for cross-origin browser requests
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  }

  const { search, type = 'movie' } = req.query;

  if (!search || search.trim().length < 2) {
    return res.status(400).json({
      success: false,
      error: 'Provide a "search" query parameter with at least 2 characters.'
    });
  }

  const mediaType = type === 'tv' ? 'tv' : 'movie';
  const siteTarget = `site:themoviedb.org/${mediaType}`;

  try {
    // ── Step 1: Search DuckDuckGo HTML to locate the TMDB page URL ──
    const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(search.trim() + ' ' + siteTarget)}`;
    const ddgRes = await axios.get(ddgUrl, {
      timeout: 10000,
      headers: SCRAPER_HEADERS
    });

    let $ = cheerio.load(ddgRes.data);
    const tmdbPathPrefix = `themoviedb.org/${mediaType}/`;
    let tmdbId = null;

    // Extract TMDB ID from search result links
    $('a.result__url, .result__a, a[href*="themoviedb.org"]').each((_, el) => {
      if (tmdbId) return;
      const text = ($(el).attr('href') || '') + ' ' + ($(el).text() || '');
      const idx = text.indexOf(tmdbPathPrefix);
      if (idx !== -1) {
        const after = text.slice(idx + tmdbPathPrefix.length);
        const m = after.match(/^(\d+)/);
        if (m) tmdbId = m[1];
      }
    });

    // Fallback: regex scan raw HTML
    if (!tmdbId) {
      const rawMatch = ddgRes.data.match(
        new RegExp(`themoviedb\\.org\\/${mediaType}\\/(\\d+)`, 'i')
      );
      if (rawMatch) tmdbId = rawMatch[1];
    }

    if (!tmdbId) {
      return res.status(404).json({
        success: false,
        error: `No TMDB page found for "${search}". Try a more specific title or switch between Movie and TV Show.`
      });
    }

    // ── Step 2: Scrape the TMDB public page ──
    const tmdbPageUrl = `https://www.themoviedb.org/${mediaType}/${tmdbId}`;
    const tmdbRes = await axios.get(tmdbPageUrl, {
      timeout: 12000,
      headers: SCRAPER_HEADERS
    });

    $ = cheerio.load(tmdbRes.data);

    // Title
    const title =
      $('div.title h2 a').first().text().trim() ||
      $('section.inner_content h2 a').first().text().trim() ||
      $('div.title h2').first().text().trim() ||
      $('h2 a').first().text().trim() ||
      search.trim();

    // Overview/Description
    const description =
      $('div.overview p').text().trim() ||
      $('[class*="overview"] p').text().trim() ||
      $('p.overview').text().trim() ||
      '';

    // Poster
    let poster = null;
    const posterSrc =
      $('div.poster img').attr('src') ||
      $('div.poster img').attr('data-src') ||
      $('[class*="poster"] img').attr('src') ||
      $('[class*="poster"] img').attr('data-src') || '';
    if (posterSrc) {
      poster = posterSrc.startsWith('http')
        ? posterSrc
        : `https://image.tmdb.org/t/p/w500${posterSrc}`;
    }

    // Backdrop / thumbnail
    let thumbnail = null;
    const backdropSrc =
      $('[class*="backdrop"] img').attr('src') ||
      $('[class*="backdrop"] img').attr('data-src') || '';
    if (backdropSrc) {
      thumbnail = backdropSrc.startsWith('http')
        ? backdropSrc
        : `https://image.tmdb.org/t/p/w1280${backdropSrc}`;
    }

    // Year
    const releaseText =
      $('[class*="release_date"]').text().trim() ||
      $('span.release_date').text().trim() ||
      $('[class*="release"] span').text().trim() || '';
    const yearMatch = releaseText.match(/\d{4}/);
    const year = yearMatch ? yearMatch[0] : null;

    // Cast — TMDB loads cast via JS, static parse may yield limited results
    const cast = [];
    $('li.card, .card').each((i, el) => {
      if (i >= 6) return;
      const name = $(el).find('p a').first().text().trim();
      const character = $(el).find('p.character').text().trim().replace(/\s+/g, ' ');
      if (name) cast.push({ name, character: character || null });
    });

    // ── Step 3: Build stream embed URLs from the scraped TMDB ID (FilmU default, FrameX TV 2nd, VidLink, Own Server) ──
    const streams = mediaType === 'tv'
      ? [
          `https://embed.filmu.in/tv/${tmdbId}/1/1`,
          `https://framextv.tech/embed/${tmdbId}/1/1`,
          `https://vidlink.pro/tv/${tmdbId}/1/1`,
          `https://free-movie-cloud.vercel.app/tv/s1/e1/${tmdbId}`
        ]
      : [
          `https://embed.filmu.in/movie/${tmdbId}`,
          `https://framextv.tech/embed/${tmdbId}`,
          `https://vidlink.pro/movie/${tmdbId}`,
          `https://free-movie-cloud.vercel.app/movie/${tmdbId}`
        ];

    return res.status(200).json({
      success: true,
      tmdb_id: tmdbId,
      title,
      year,
      type: mediaType,
      description,
      poster,
      thumbnail,
      cast_list: cast,
      stream: streams[0],
      streams,
      source_url: tmdbPageUrl
    });

  } catch (err) {
    console.error('[/api/scrape] Error:', err.message);
    return res.status(500).json({
      success: false,
      error: 'Scraper failed to retrieve data. The external site may be temporarily unavailable.'
    });
  }
};
