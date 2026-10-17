const express = require('express');
const crypto = require('crypto');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// Optional but strongly recommended: set ADMIN_KEY in your environment.
// Then open your dashboard at https://your-site.com/?key=YOUR_KEY
const ADMIN_KEY = process.env.ADMIN_KEY || '';

// Lets req.protocol be correct behind Render's proxy
app.set('trust proxy', 1);

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function initDB() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS single_use_links (
            token TEXT PRIMARY KEY,
            content TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    `);
}

const PERMANENT_CONTENT =
    "For price discounts, email: carolyn001p@gmail.com. Don't text about this on this platform. It's our secret. Assume you did not receive this link whether you agree to it or not.";

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Turns email addresses in (already escaped) text into mailto links
function linkifyEmails(escaped) {
    return escaped.replace(
        /([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g,
        '<a href="mailto:$1">$1</a>'
    );
}

// Never cache, never index, never leak the URL as a referrer
app.use((req, res, next) => {
    res.set({
        'Cache-Control': 'no-store',
        'X-Robots-Tag': 'noindex, nofollow',
        'Referrer-Policy': 'no-referrer'
    });
    next();
});

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
    if (!ADMIN_KEY) return true;
    const supplied = req.get('x-admin-key') || req.query.key || '';
    const a = Buffer.from(String(supplied));
    const b = Buffer.from(ADMIN_KEY);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// 1. DASHBOARD
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
            const adminKey = new URLSearchParams(location.search).get('key') || '';
            const btn = document.getElementById('generate-btn');
            const copyBtn = document.getElementById('copy-btn');
            const results = document.getElementById('results');
            const output = document.getElementById('links-output');
            const errorBox = document.getElementById('error');

            btn.addEventListener('click', async () => {
                const count = document.getElementById('count').value;
                btn.disabled = true;
                btn.textContent = 'Creating...';
                errorBox.hidden = true;
                try {
                    const response = await fetch('/bulk-generate?count=' + encodeURIComponent(count), {
                        headers: { 'x-admin-key': adminKey }
                    });
                    const data = await response.json();
                    if (!response.ok || !data.links) throw new Error(data.error || 'Request failed');
                    output.value = data.links.join('\\n');
                    document.getElementById('results-title').textContent =
                        data.links.length + (data.links.length === 1 ? ' link' : ' links') + ' ready';
                    copyBtn.textContent = 'Copy all';
                    results.style.display = 'block';
                } catch (err) {
                    results.style.display = 'block';
                    errorBox.textContent = 'Could not create links. Check your connection and try again.';
                    errorBox.hidden = false;
                } finally {
                    btn.disabled = false;
                    btn.textContent = 'Create links';
                }
            });

            copyBtn.addEventListener('click', async () => {
                try {
                    await navigator.clipboard.writeText(output.value);
                } catch (e) {
                    output.select();
                    document.execCommand('copy');
                }
                copyBtn.textContent = 'Copied';
            });
        </script>`;

    res.send(page('One-time links', body));
});

// 2. BULK GENERATION API
app.get('/bulk-generate', async (req, res) => {
    if (!isAdmin(req)) return res.status(404).json({ error: 'Not found' });

    try {
        const count = parseInt(req.query.count, 10) || 1;
        const limit = Math.min(Math.max(count, 1), 100);
        const base = req.protocol + '://' + req.get('host');

        const links = [];
        const values = [];
        const placeholders = [];

        for (let i = 0; i < limit; i++) {
            const token = crypto.randomBytes(16).toString('hex');
            links.push(base + '/view/' + token);
            values.push(token, PERMANENT_CONTENT);
            placeholders.push('($' + (i * 2 + 1) + ', $' + (i * 2 + 2) + ')');
        }

        await pool.query(
            'INSERT INTO single_use_links (token, content) VALUES ' + placeholders.join(', '),
            values
        );

        res.json({ links });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error generating links.' });
    }
});

const expiredPage = page(
    'Page not available',
    `<h1>Page not available</h1>
     <p class="lead">This page can't be found.</p>`
);

// 3. OPEN LINK DIRECTLY (shows the message and deletes the link atomically)
// Link-preview robots (WhatsApp, Telegram, Slack, email scanners, etc.) open URLs
// automatically. They get a harmless blank page and do NOT consume the link.
const BOT_PATTERN = /bot|crawl|spider|preview|facebookexternalhit|whatsapp|telegram|slack|discord|twitter|linkedin|skype|embedly|quora|pinterest|vkshare|google-read-aloud|bingpreview|headless|curl|wget|python-requests|okhttp|java\//i;

function isPrefetch(req) {
    const purpose = (req.get('purpose') || req.get('sec-purpose') || req.get('x-purpose') || '').toLowerCase();
    return purpose.includes('prefetch') || purpose.includes('preview') || req.get('x-moz') === 'prefetch';
}

const neutralPage = page('Message', '<h1>Message</h1>');

// HEAD requests must never consume a link (Express would otherwise route them to GET)
app.head('/view/:token', (req, res) => res.status(200).end());

app.get('/view/:token', async (req, res) => {
    const ua = req.get('user-agent') || '';
    if (!ua || BOT_PATTERN.test(ua) || isPrefetch(req)) {
        return res.status(200).send(neutralPage);
    }

    try {
        const result = await pool.query(
            'DELETE FROM single_use_links WHERE token = $1 RETURNING content',
            [req.params.token]
        );
        if (!result.rows.length) return res.status(404).send(expiredPage);

        const message = linkifyEmails(escapeHtml(result.rows[0].content));
        res.send(page('Message', `
            <h1>Message</h1>
            <div class="message">${message}</div>`));
    } catch (err) {
        console.error(err);
        res.status(500).send(page('Error', '<h1>Something went wrong</h1><p class="lead">Please try again in a moment.</p>'));
    }
});

// Start listening only after the table exists
initDB()
    .then(() => app.listen(PORT, () => console.log('Server listening on port ' + PORT)))
    .catch((err) => {
        console.error('Database init failed:', err);
        process.exit(1);
    });
