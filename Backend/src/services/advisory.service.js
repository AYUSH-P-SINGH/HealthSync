/**
 * Health advisory service.
 *
 * Three layers, in priority order:
 *   1. Admin-published advisories (HealthAdvisory model) — authoritative.
 *   2. WHO "Disease Outbreak News" RSS feed — best-effort supplement,
 *      cached in memory, never blocks the response.
 *   3. Rotating daily healthcare tips — shown so the Health tab is never
 *      empty when there is nothing to warn about.
 */
const HealthAdvisory = require('../models/HealthAdvisory');
const auditService = require('./audit.service');
const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');

const WHO_FEED_URL = 'https://www.who.int/feeds/entity/csr/don/en/rss.xml';
const WHO_TIMEOUT_MS = 5000;
const WHO_CACHE_OK_MS = 6 * 60 * 60 * 1000; // refresh every 6h on success
const WHO_CACHE_FAIL_MS = 30 * 60 * 1000; // retry after 30min on failure

let whoCache = { fetchedAt: 0, ttl: 0, items: [] };

const HEALTH_TIPS = [
  { title: 'Stay hydrated', body: 'Aim for 2–3 litres of water a day. Mild dehydration is a common cause of headaches and fatigue.' },
  { title: 'Move for 30 minutes', body: 'A brisk 30-minute walk, five days a week, meaningfully lowers the risk of heart disease and type 2 diabetes.' },
  { title: 'Prioritise sleep', body: 'Adults need 7–9 hours. Consistent sleep and wake times matter as much as total duration.' },
  { title: 'Wash hands properly', body: '20 seconds with soap — especially before meals and after public transport — remains the cheapest infection prevention there is.' },
  { title: 'Know your numbers', body: 'Get blood pressure, blood sugar and cholesterol checked at least once a year, even if you feel fine.' },
  { title: 'Eat the rainbow', body: 'Five servings of varied fruit and vegetables daily provide the micronutrients supplements struggle to replace.' },
  { title: 'Limit added sugar', body: 'Keep added sugar under about 25 g (6 teaspoons) a day. Sugary drinks are the easiest place to cut.' },
  { title: 'Protect your eyes', body: 'Follow the 20-20-20 rule during screen work: every 20 minutes, look at something 20 feet away for 20 seconds.' },
  { title: 'Don\'t skip vaccinations', body: 'Keep adult boosters (tetanus, flu, and others your doctor recommends) up to date — immunity fades over time.' },
  { title: 'Mind your mental health', body: 'Two weeks of persistent low mood, poor sleep, or loss of interest is a reason to talk to a professional, not to wait.' },
  { title: 'Cut back on salt', body: 'Keep salt under 5 g a day. Processed and restaurant food carries most hidden sodium.' },
  { title: 'Stretch your back', body: 'If you sit for work, stand and stretch every hour. Most chronic back pain starts with static posture.' },
  { title: 'Store medicines safely', body: 'Check expiry dates quarterly and keep medicines away from heat and humidity — bathrooms are the worst spot.' },
  { title: 'Sun protection counts', body: 'Use SPF 30+ when outdoors for long periods; UV damage is cumulative and largely invisible until it isn\'t.' },
  { title: 'Complete antibiotic courses', body: 'Stopping antibiotics early breeds resistant bacteria. Take the full course exactly as prescribed.' },
  { title: 'Check your allergies list', body: 'Keep your allergy list updated in HealthSync — it powers automatic safety checks on every new prescription.' },
  { title: 'Breakfast with protein', body: 'A protein-rich breakfast steadies blood sugar and reduces late-day snacking.' },
  { title: 'Track your family history', body: 'Many conditions run in families. Knowing yours helps your doctor screen earlier and smarter.' },
  { title: 'Limit alcohol', body: 'No level of alcohol is risk-free; keeping intake low and having alcohol-free days protects your liver and heart.' },
  { title: 'Practice deep breathing', body: 'Five minutes of slow, deep breathing lowers cortisol and measurably reduces blood pressure.' },
  { title: 'Keep records in one place', body: 'Upload old reports and prescriptions to your timeline so any doctor you consent to can see your full history.' },
];

/** Deterministic daily rotation — same 3 tips for everyone on a given day. */
const getDailyTips = (count = 3) => {
  const dayOfYear = Math.floor(
    (Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000
  );
  const tips = [];
  for (let i = 0; i < count; i += 1) {
    tips.push(HEALTH_TIPS[(dayOfYear * count + i) % HEALTH_TIPS.length]);
  }
  return tips;
};

/** Minimal RSS <item> parser — avoids adding an XML dependency. */
const parseRssItems = (xml, limit = 5) => {
  const items = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  const pick = (block, tag) => {
    const m = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
    if (!m) return null;
    return m[1]
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#39;|&apos;/g, "'")
      .replace(/&quot;/g, '"')
      .trim();
  };

  let match;
  while ((match = itemRe.exec(xml)) !== null && items.length < limit) {
    const block = match[1];
    const title = pick(block, 'title');
    if (!title) continue;
    items.push({
      title,
      link: pick(block, 'link'),
      publishedAt: pick(block, 'pubDate'),
      summary: (pick(block, 'description') || '').slice(0, 400),
      source: 'WHO Disease Outbreak News',
    });
  }
  return items;
};

/** Fetch WHO outbreak news, memory-cached. Never throws. */
const getExternalAlerts = async () => {
  const now = Date.now();
  if (now - whoCache.fetchedAt < whoCache.ttl) return whoCache.items;
  if (typeof fetch !== 'function') return [];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WHO_TIMEOUT_MS);
  try {
    const res = await fetch(WHO_FEED_URL, {
      signal: controller.signal,
      headers: { 'User-Agent': 'HealthSync/1.0 (health advisory feed)' },
    });
    if (!res.ok) throw new Error(`WHO feed HTTP ${res.status}`);
    const xml = await res.text();
    const items = parseRssItems(xml, 5);
    whoCache = { fetchedAt: now, ttl: WHO_CACHE_OK_MS, items };
    return items;
  } catch (error) {
    logger.warn('WHO outbreak feed unavailable (non-blocking)', { error: error.message });
    whoCache = { fetchedAt: now, ttl: WHO_CACHE_FAIL_MS, items: whoCache.items || [] };
    return whoCache.items;
  } finally {
    clearTimeout(timer);
  }
};

// ─── Patient/hospital-facing ───────────────────────────

const SEVERITY_ORDER = { critical: 0, warning: 1, advisory: 2, info: 3 };

/**
 * Everything the Health tab needs in one call:
 * active admin advisories + WHO supplement + fallback daily tips.
 */
const getActive = async () => {
  const now = new Date();
  const [advisories, externalAlerts] = await Promise.all([
    HealthAdvisory.find({
      isActive: true,
      $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
    })
      .sort({ createdAt: -1 })
      .limit(20),
    getExternalAlerts(),
  ]);

  const sorted = advisories
    .map((a) => a.toJSON())
    .sort(
      (a, b) =>
        (SEVERITY_ORDER[a.severity] ?? 4) - (SEVERITY_ORDER[b.severity] ?? 4) ||
        new Date(b.createdAt) - new Date(a.createdAt)
    );

  return {
    advisories: sorted,
    externalAlerts,
    tips: getDailyTips(3),
    // The single most urgent advisory, if any — used for the dashboard banner
    banner: sorted.find((a) => a.severity === 'critical' || a.severity === 'warning') || null,
  };
};

// ─── Admin management ──────────────────────────────────

const createAdvisory = async (adminId, body, ip, userAgent) => {
  const advisory = await HealthAdvisory.create({
    title: body.title,
    summary: body.summary || '',
    severity: body.severity || 'advisory',
    region: body.region || 'Nationwide',
    precautions: (body.precautions || []).filter(Boolean),
    expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
    publishedBy: adminId,
  });

  auditService.logAuthEvent({
    userId: adminId,
    action: 'ADVISORY_PUBLISHED',
    ip,
    userAgent,
    success: true,
    metadata: { advisoryId: advisory._id, severity: advisory.severity },
  });

  logger.info('Health advisory published', { advisoryId: advisory._id.toString() });

  return { advisory: advisory.toJSON(), message: 'Advisory published. Patients will see it immediately.' };
};

const listAll = async () => {
  const advisories = await HealthAdvisory.find().sort({ createdAt: -1 }).limit(100);
  return { advisories: advisories.map((a) => a.toJSON()) };
};

const updateAdvisory = async (adminId, advisoryId, body, ip, userAgent) => {
  const advisory = await HealthAdvisory.findById(advisoryId);
  if (!advisory) throw ApiError.notFound('Advisory not found.');

  const editable = ['title', 'summary', 'severity', 'region', 'isActive'];
  for (const key of editable) {
    if (body[key] !== undefined) advisory[key] = body[key];
  }
  if (Array.isArray(body.precautions)) advisory.precautions = body.precautions.filter(Boolean);
  if (body.expiresAt !== undefined) {
    advisory.expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
  }
  await advisory.save();

  auditService.logAuthEvent({
    userId: adminId,
    action: 'ADVISORY_UPDATED',
    ip,
    userAgent,
    success: true,
    metadata: { advisoryId: advisory._id, isActive: advisory.isActive },
  });

  return { advisory: advisory.toJSON(), message: 'Advisory updated.' };
};

const deleteAdvisory = async (adminId, advisoryId, ip, userAgent) => {
  const advisory = await HealthAdvisory.findById(advisoryId);
  if (!advisory) throw ApiError.notFound('Advisory not found.');

  await advisory.deleteOne();

  auditService.logAuthEvent({
    userId: adminId,
    action: 'ADVISORY_DELETED',
    ip,
    userAgent,
    success: true,
    metadata: { advisoryId },
  });

  return { message: 'Advisory deleted.' };
};

module.exports = {
  getActive,
  createAdvisory,
  listAll,
  updateAdvisory,
  deleteAdvisory,
  getDailyTips,
};
