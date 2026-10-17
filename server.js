const express = require('express');
const crypto = require('crypto');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// Connects to your PostgreSQL database
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Database initialization
async function initDB() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS single_use_links (
            token TEXT PRIMARY KEY,
            content TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    `);
}
initDB().catch(console.error);

// CHANGE THIS: put the content your links should display
const PERMANENT_CONTENT = "This is my permanent secret content that never changes!";

// 1. DASHBOARD HOME PAGE
app.get('/', (req, res) => {
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Link Factory Dashboard</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f4f7f6; margin: 0; padding: 40px 20px; color: #333; }
        .container { max-width: 650px; margin: 0 auto; background: white; padding: 30px; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.05); }
        h1 { margin-top: 0; color: #111; font-size: 24px; }
        .content-preview { background: #f9f9f9; padding: 12px; border-left: 4px solid #0070f3; font-style: italic; margin-bottom: 25px; border-radius: 0 4px 4px 0; font-size: 14px; }
        label { font-weight: 600; display: block; margin-bottom: 8px; font-size: 14px; }
        select { width: 100%; padding: 12px; border: 1px solid #ccc; border-radius: 6px; font-size: 16px; margin-bottom: 20px; background: white; }
        button { width: 100%; background: #0070f3; color: white; border: none; padding: 14px; border-radius: 6px; font-size: 16px; font-weight: 600; cursor: pointer; transition: background 0.2s; }
        button:hover { background: #0051b3; }
        button:disabled { opacity: 0.6; cursor: not-allowed; }
        .results-box { margin-top: 30px; display: none; }
        .results-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
        .btn-copy { width: auto; background: #28a745; padding: 6px 12px; font-size: 12px; }
        .btn-copy:hover { background: #218838; }
        textarea { width: 100%; height: 200px; padding: 12px; border: 1px solid #ddd; border-radius: 6px; font-family: monospace; font-size: 13px; resize: vertical; box-sizing: border-box; background: #fafafa; }
    </style>
</head>
<body>
    <div class="container">
        <h1>Bulk Link Generator</h1>
        <p style="color:#666; font-size:14px;">Every link generated below will point to your pre-set content, but will self-destruct into a 404 error after its first use.</p>

        <div class="content-preview">
            <strong>Current Active Content:</strong><br>"${PERMANENT_CONTENT}"
        </div>

        <label for="count">How many unique links do you want to create?</label>
        <select id="count">
            <option value="1">1 Link</option>
            <option value="5">5 Links</option>
            <option value="10" selected>10 Links</option>
            <option value="50">50 Links</option>
            <option value="100">100 Links</option>
        </select>

        <button id="generate-btn" onclick="generateLinks()">Generate Links</button>

        <div class="results-box" id="results-box">
            <div class="results-header">
                <strong style="font-size: 14px;">Generated Links:</strong>
                <button class="btn-copy" id="copy-btn" onclick="copyToClipboard()">Copy All Links</button>
            </div>
            <textarea id="links-output" readonly></textarea>
        </div>
    </div>

    <script>
        async function generateLinks() {
            const button = document.getElementById('generate-btn');
            const count = document.getElementById('count').value;
            const resultsBox = document.getElementById('results-box');
            const output = document.getElementById('links-output');
            const copyBtn = document.getElementById('copy-btn');

            button.disabled = true;
            button.innerText = 'Generating...';
            copyBtn.innerText = 'Copy All Links';

            try {
                const response = await fetch('/bulk-generate?count=' + count);
                const data = await response.json();

                if (data.links && data.links.length > 0) {
                    output.value = data.links.join('\\n');
                    resultsBox.style.display = 'block';
                }
            } catch (err) {
                alert('Error generating links. Please try again.');
            } finally {
                button.disabled = false;
                button.innerText = 'Generate Links';
            }
        }

        function copyToClipboard() {
            const output = document.getElementById('links-output');
            output.select();
            document.execCommand('copy');
            document.getElementById('copy-btn').innerText = 'Copied!';
        }
    </script>
</body>
</html>`);
});

// 2. BULK GENERATION API
app.get('/bulk-generate', async (req, res) => {
    try {
        const count = parseInt(req.query.count, 10) || 1;
        const limit = Math.min(Math.max(count, 1), 100);

        // Render sits behind a proxy, so force https for non-local hosts
        const host = req.get('host');
        const protocol = host.startsWith('localhost') ? 'http' : 'https';

        const generatedLinks = [];
        const queryValues = [];
        const placeholders = [];

        for (let i = 0; i < limit; i++) {
            const token = crypto.randomBytes(16).toString('hex');
            generatedLinks.push(protocol + '://' + host + '/view/' + token);

            queryValues.push(token, PERMANENT_CONTENT);
            placeholders.push('($' + (i * 2 + 1) + ', $' + (i * 2 + 2) + ')');
        }

        const queryText = 'INSERT INTO single_use_links (token, content) VALUES ' + placeholders.join(', ');
        await pool.query(queryText, queryValues);

        res.json({ links: generatedLinks });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error generating bulk links.' });
    }
});

// 3. VIEW AND DESTROY A LINK
app.get('/view/:token', async (req, res) => {
    const token = req.params.token;

    try {
        // Atomic delete: two fast clicks cannot both retrieve the content
        const result = await pool.query(
            'DELETE FROM single_use_links WHERE token = $1 RETURNING content',
            [token]
        );

        if (result.rows.length > 0) {
            res.send('<h1>Here is your content:</h1><p>' + result.rows[0].content + '</p>');
        } else {
            res.status(404).send('<h1>404 Error: This link has expired or never existed.</h1>');
        }
    } catch (err) {
        console.error(err);
        res.status(500).send('Database error.');
    }
});

app.listen(PORT, () => {
    console.log('Server listening on port ' + PORT);
});
