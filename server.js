const express = require('express');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { Pool } = require('pg');

const app = express();
const PORT = Number(process.env.PORT) || 3000;

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'carolyn001p@gmail.com';
const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_USER = process.env.SMTP_USER || process.env.MAIL_USERNAME || '';
const SMTP_PASS = process.env.SMTP_PASS || process.env.SMTP_PASSWORD || process.env.MAIL_PASSWORD || '';
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER || 'no-reply@example.com';
const ADMIN_KEY = process.env.ADMIN_KEY || '';
const HAS_DATABASE = Boolean(process.env.DATABASE_URL);
const inMemoryLinks = new Map();

const mailTransport = SMTP_USER && SMTP_PASS && ADMIN_EMAIL
  ? nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  })
  : null;

app.set('trust proxy', 1);

const pool = HAS_DATABASE ? new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
}) : null;

async function initDB() {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS single_use_links (
      token TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

async function saveLink(token, content) {
  if (!pool) {
    inMemoryLinks.set(token, content);
    return;
  }

  await pool.query(
    'INSERT INTO single_use_links (token, content) VALUES ($1, $2)',
    [token, content]
  );
}

async function consumeLink(token) {
  if (!pool) {
    const content = inMemoryLinks.get(token);
    if (!content) return null;
    inMemoryLinks.delete(token);
    return content;
  }

  const result = await pool.query(
    'DELETE FROM single_use_links WHERE token = $1 RETURNING content',
    [token]
  );

  if (!result.rows.length) return null;
  return result.rows[0].content;
}

const PERMANENT_CONTENT = "For price discounts on your quiz, email: carolyn001p@gmail.com. Don't text about this on this platform. It's our secret. Assume you did not receive this link whether you agree to it or not.";

const STYLES = `
:root {
  --bg: #eef2f3;
  --card: #ffffff;
  --ink: #14262b;
  --muted: #5d7177;
  --line: #d9e2e4;
  --accent: #0f6b6b;
  --accent-dark: #0b5252;
  --accent-soft: #e2f0ef;
  --danger: #a63d2f;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0e1a1d;
    --card: #162428;
    --ink: #e7f0f1;
    --muted: #94aab0;
    --line: #26393e;
    --accent: #3fb3b0;
    --accent-dark: #5cc9c6;
    --accent-soft: #1b3436;
    --danger: #e0806f;
  }
}

* { box-sizing: border-box; }
html, body { height: 100%; }
body {
  margin: 0;
  font-family: "DM Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  background: var(--bg);
  color: var(--ink);
  line-height: 1.55;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px 16px;
}
.card {
  width: 100%;
  max-width: 560px;
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 16px;
  padding: 36px 32px;
  box-shadow: 0 10px 30px rgba(20, 38, 43, 0.08);
}
h1 { margin: 0 0 8px; font-size: 26px; line-height: 1.2; letter-spacing: -0.01em; }
p.lead { margin: 0 0 24px; color: var(--muted); font-size: 15px; }
.message {
  background: var(--accent-soft);
  border-left: 4px solid var(--accent);
  border-radius: 4px 10px 10px 4px;
  padding: 16px 18px;
  font-size: 16px;
  margin: 0 0 8px;
  overflow-wrap: anywhere;
}
.message a { color: var(--accent-dark); font-weight: 600; }
.note { color: var(--muted); font-size: 13px; margin: 14px 0 0; }
label { display: block; font-weight: 600; font-size: 14px; margin: 24px 0 8px; }
select {
  width: 100%;
  padding: 12px 14px;
  font: inherit;
  color: var(--ink);
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 10px;
}
button, .btn {
  display: inline-block;
  width: 100%;
  margin-top: 18px;
  padding: 14px;
  font: inherit;
  font-weight: 600;
  text-align: center;
  text-decoration: none;
  color: #fff;
  background: var(--accent);
  border: 0;
  border-radius: 10px;
  cursor: pointer;
  transition: background 0.15s;
}
button:hover { background: var(--accent-dark); }
button:disabled { opacity: 0.6; cursor: not-allowed; }
select:focus-visible, button:focus-visible, a:focus-visible {
  outline: 3px solid var(--accent);
  outline-offset: 2px;
}
.results { display: none; margin-top: 28px; border-top: 1px solid var(--line); padding-top: 20px; }
.results-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.results-head strong { font-size: 15px; }
.results-head button { width: auto; margin: 0; padding: 8px 14px; font-size: 13px; }
textarea {
  width: 100%;
  height: 200px;
  margin-top: 12px;
  padding: 12px;
  font: 13px/1.6 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: var(--ink);
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: 10px;
  resize: vertical;
}
.error { color: var(--danger); }
`;

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function linkifyEmails(escaped) {
  return escaped.replace(
    /([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g,
    '<a href="mailto:$1">$1</a>'
  );
}

function page(title, body) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex, nofollow">
  <title>${escapeHtml(title)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600;700&display=swap" rel="stylesheet">
  <style>${STYLES}</style>
</head>
<body>
  <main class="card">${body}</main>
</body>
</html>`;
}

function isAdmin(req) {
  const supplied = (
    req.get('x-admin-key') ||
    req.get('x-admin-token') ||
    req.get('authorization') ||
    req.query.key ||
    req.query.adminKey ||
    ''
  ).toString().trim();

  const expected = String(ADMIN_KEY || '').trim();

  if (!expected) {
    return true;
  }

  const bearer = supplied.toLowerCase().startsWith('bearer ')
    ? supplied.slice(7).trim()
    : supplied;

  return bearer === expected;
}

app.use((req, res, next) => {
  res.set({
    'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex, nofollow',
    'Referrer-Policy': 'no-referrer'
  });
  next();
});

app.get('/', (req, res) => {
  if (!isAdmin(req)) {
    return res.status(404).send(page('Not found', '<h1>Page not found</h1><p class="lead">There is nothing here.</p>'));
  }

  const body = `
    <h1>Create one-time links</h1>
    <p class="lead">Each link shows your message once, then stops working.</p>

    <div class="message">${escapeHtml(PERMANENT_CONTENT)}</div>
    <p class="note">This is the message every link will show.</p>

    <label for="count">Number of links</label>
    <select id="count">
      <option value="1">1 link</option>
      <option value="5">5 links</option>
      <option value="10" selected>10 links</option>
      <option value="50">50 links</option>
      <option value="100">100 links</option>
    </select>

    <button id="generate-btn" type="button">Create links</button>

    <section class="results" id="results" aria-live="polite">
      <div class="results-head">
        <strong id="results-title">Your links</strong>
        <button id="copy-btn" type="button">Copy all</button>
      </div>
      <textarea id="links-output" readonly></textarea>
      <p class="note error" id="error" hidden></p>
    </section>

    <script>
      (() => {
        const $ = (id) => document.getElementById(id);
        const btn = $('generate-btn');
        const copyBtn = $('copy-btn');
        const results = $('results');
        const output = $('links-output');
        const errorBox = $('error');
        const title = $('results-title');

        if (!btn || !copyBtn || !results || !output || !errorBox || !title) {
          console.error('Create-links page is missing required elements.');
          return;
        }

        async function createLinks() {
          const countEl = $('count');
          const count = countEl ? countEl.value : '10';
          const adminKey = new URLSearchParams(window.location.search).get('key') || '';

          btn.disabled = true;
          btn.textContent = 'Creating...';
          errorBox.hidden = true;
          errorBox.textContent = '';

          try {
            if (!window.fetch) {
              throw new Error('Your browser does not support fetch().');
            }

            const response = await fetch('/bulk-generate?count=' + encodeURIComponent(String(count)), {
              method: 'GET',
              headers: {
                'x-admin-key': adminKey,
                'Accept': 'application/json'
              }
            });

            const rawText = await response.text();
            let data = {};

            try {
              data = rawText ? JSON.parse(rawText) : {};
            } catch (parseError) {
              throw new Error(rawText || 'The server returned an invalid response.');
            }

            if (!response.ok || !Array.isArray(data.links)) {
              throw new Error((data && data.error) || 'Request failed.');
            }

            output.value = data.links.join('\n');
            title.textContent = data.links.length + (data.links.length === 1 ? ' link' : ' links') + ' ready';
            copyBtn.textContent = 'Copy all';
            results.style.display = 'block';
          } catch (err) {
            console.error(err);
            errorBox.textContent = err && err.message ? err.message : 'Could not create links. Check your connection and try again.';
            results.style.display = 'block';
            errorBox.hidden = false;
          } finally {
            btn.disabled = false;
            btn.textContent = 'Create links';
          }
        }

        btn.addEventListener('click', createLinks);

        copyBtn.addEventListener('click', async () => {
          try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
              await navigator.clipboard.writeText(output.value);
            } else {
              output.focus();
              output.select();
              document.execCommand('copy');
            }
            copyBtn.textContent = 'Copied';
          } catch (e) {
            output.focus();
            output.select();
            document.execCommand('copy');
            copyBtn.textContent = 'Copied';
          }
        });
      })();
    </script>
  `;

  res.send(page('One-time links', body));
});

app.get('/bulk-generate', async (req, res) => {
  if (!isAdmin(req)) {
    return res.status(401).json({ error: 'Admin key required. Open the page with ?key=YOUR_KEY or send x-admin-key.' });
  }

  try {
    const count = Number.parseInt(req.query.count, 10) || 1;
    const limit = Math.min(Math.max(count, 1), 100);
    const base = `${req.protocol}://${req.get('host')}`;

    const links = [];

    for (let i = 0; i < limit; i++) {
      const token = crypto.randomBytes(16).toString('hex');
      links.push(`${base}/view/${token}`);
      await saveLink(token, PERMANENT_CONTENT);
    }

    res.json({ links });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error generating links.' });
  }
});

const expiredPage = page('Page not available', '<h1>Page not available</h1><p class="lead">This page can\'t be found.</p>');
const BOT_PATTERN = /bot|crawl|spider|preview|facebookexternalhit|whatsapp|telegram|slack|discord|twitter|linkedin|skype|embedly|quora|pinterest|vkshare|google-read-aloud|bingpreview|headless|curl|wget|python-requests|okhttp|java\//i;

function isPrefetch(req) {
  const purpose = (req.get('purpose') || req.get('sec-purpose') || req.get('x-purpose') || '').toLowerCase();
  return purpose.includes('prefetch') || purpose.includes('preview') || req.get('x-moz') === 'prefetch';
}

async function sendVisitNotification({ token, content, url }) {
  if (!mailTransport || !ADMIN_EMAIL) {
    console.log('Link visit notification skipped: set ADMIN_EMAIL and SMTP credentials.');
    return;
  }

  const subject = 'NOTIFICATION';
  const text = [
    'A one-time link was opened and consumed.',
    '',
    `Token: ${token}`,
    `URL: ${url}`,
    '',
    'Message preview:',
    content.slice(0, 1000)
  ].join('\n');

  const html = `
    <h2>One-time link was visited</h2>
    <p><strong>Token:</strong> ${escapeHtml(token)}</p>
    <p><strong>URL:</strong> <a href="${escapeHtml(url)}">${escapeHtml(url)}</a></p>
    <p><strong>Message preview:</strong></p>
    <pre style="white-space: pre-wrap; word-break: break-word;">${escapeHtml(content.slice(0, 1000))}</pre>
  `;

  await mailTransport.sendMail({
    from: SMTP_FROM,
    to: ADMIN_EMAIL,
    subject,
    text,
    html
  });
}

const neutralPage = page('Message', '<h1>Message</h1>');

app.head('/view/:token', (req, res) => res.status(200).end());

app.get('/view/:token', async (req, res) => {
  const ua = req.get('user-agent') || '';
  if (!ua || BOT_PATTERN.test(ua) || isPrefetch(req)) {
    return res.status(200).send(neutralPage);
  }

  try {
    const content = await consumeLink(req.params.token);

    if (!content) {
      return res.status(404).send(expiredPage);
    }

    const token = req.params.token;
    const url = `${req.protocol}://${req.get('host')}/view/${token}`;

    try {
      await sendVisitNotification({ token, content, url });
    } catch (mailErr) {
      console.error('Email notification failed:', mailErr);
    }

    const message = linkifyEmails(escapeHtml(content));
    return res.send(page('Message', `<h1>Message</h1><div class="message">${message}</div>`));
  } catch (err) {
    console.error(err);
    return res.status(500).send(page('Error', '<h1>Something went wrong</h1><p class="lead">Please try again in a moment.</p>'));
  }
});

initDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log('Server listening on port ' + PORT);
    });
  })
  .catch((err) => {
    console.error('Database init failed:', err);
    process.exit(1);
  });
