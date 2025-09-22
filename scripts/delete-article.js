const fs = require('fs');
const path = require('path');
const axios = require('axios');
require('dotenv').config();

const API_KEY = process.env.HELPSCOUT_API_KEY;
if (!API_KEY) {
  console.error("HELPSCOUT_API_KEY manquant. Définissez-la dans '.env'.");
  process.exit(1);
}

const APPLY = process.env.APPLY === '1';
const TARGET_ID = (process.env.TARGET_ID || '').trim();
const TARGET_SLUG = (process.env.TARGET_SLUG || '').trim();
const TARGET_TITLE = (process.env.TARGET_TITLE || '').trim();
const DEBUG_LOG = process.env.DEBUG_LOG === '1';

const axiosInstance = axios.create({
  baseURL: 'https://docsapi.helpscout.net/v1/',
  auth: { username: API_KEY, password: 'X' },
  headers: { Accept: 'application/json' },
  timeout: 30000
});

function normalizeTitle(s) {
  if (!s) return '';
  try {
    const withoutEmoji = String(s).replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, '');
    return withoutEmoji.replace(/\s+/g, ' ').trim().toLowerCase();
  } catch (_) {
    return String(s).trim().toLowerCase();
  }
}

function loadSnapshot(file) {
  const p = path.join(process.cwd(), '.snapshot', 'helpscout', file);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function findArticleInSnapshot({ slug, title }) {
  const all = loadSnapshot('articles.json') || [];
  const nTitle = normalizeTitle(title || '');
  for (const wrap of all) {
    const it = wrap && wrap.article ? wrap.article : wrap;
    if (!it) continue;
    const itSlug = it.slug || (it.publicUrl ? String(it.publicUrl).split('/').pop() : undefined);
    if (slug && itSlug === slug) return it;
    if (nTitle && normalizeTitle(it.name) === nTitle) return it;
  }
  return null;
}

async function deleteArticle(id) {
  if (!APPLY) return { action: 'dryrun-delete', id };
  await axiosInstance.delete(`articles/${id}`);
  return { action: 'deleted', id };
}

async function main() {
  let id = TARGET_ID;
  let resolvedFrom = null;

  if (!id) {
    if (!TARGET_SLUG && !TARGET_TITLE) {
      console.error('Spécifiez TARGET_ID, TARGET_SLUG ou TARGET_TITLE.');
      process.exit(1);
    }
    const found = findArticleInSnapshot({ slug: TARGET_SLUG, title: TARGET_TITLE });
    if (!found) {
      console.error('Article introuvable dans le snapshot. Exécutez d’abord: npm run snapshot:helpscout');
      process.exit(1);
    }
    id = found.id;
    resolvedFrom = found.slug || found.publicUrl || found.name;
  }

  if (DEBUG_LOG) console.log('Suppression article ID=', id, 'résolu depuis=', resolvedFrom || TARGET_ID || TARGET_SLUG || TARGET_TITLE);
  try {
    const res = await deleteArticle(id);
    const outDir = path.join(process.cwd(), '.mapping');
    fs.mkdirSync(outDir, { recursive: true });
    const out = path.join(outDir, `delete-article-${APPLY ? 'applied' : 'dryrun'}-${Date.now()}.json`);
    fs.writeFileSync(out, JSON.stringify(res, null, 2));
    console.log(`${APPLY ? 'Suppression' : 'Dry-run suppression'} écrite dans ${out}`);
  } catch (e) {
    console.error('Erreur suppression article:', e.response?.status, e.response?.data || e.message);
    process.exit(1);
  }
}

main();


