const express = require('express');
const axios = require('axios');
const path = require('path');
const http = require('http');
const { URL } = require('url');
const WebSocket = require('ws');
const fs = require('fs');

// --- BIZTONSÁGI KULCS ---
const BOT_SECRET_KEY = process.env.BOT_SECRET_KEY;
if (!BOT_SECRET_KEY) {
    console.warn('FIGYELEM: A BOT_SECRET_KEY nincs beállítva!');
}

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const port = process.env.PORT || 3000;

// ---------------------------------------------------------------------
// --- MINIMALISTA HTML GENERÁLÓ SEGÉDFÜGGVÉNY ---
// ---------------------------------------------------------------------

// Létrehozza a fekete hátterű, videót tartalmazó HTML oldalt
function generateMinimalPlayerHtml(finalSrc, res) {
    if (!finalSrc || !finalSrc.startsWith('http')) {
        return res.status(400).send("Hiányzó vagy érvénytelen videó link az útvonal után.");
    }
    
    const minimalHtml = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>Lejátszás - Szaby</title>
        <style>
            body { 
                background-color: #000; margin: 0; display: flex; 
                justify-content: center; align-items: center; 
                height: 100vh; width: 100vw; overflow: hidden;
            }
            video { max-width: 100%; max-height: 100vh; }
            video:focus, video:active { outline: none; border: none; }
        </style>
    </head>
    <body>
        <video id="videoPlayer" controls autoplay src="${finalSrc}"></video>
        <script>
            const video = document.getElementById('videoPlayer');
            video.addEventListener('loadeddata', () => {
                 video.play().catch(e => console.log('Autoplay blokkolva. Kattintson a lejátszáshoz!'));
            });
        </script>
    </body>
    </html>
    `;
    res.send(minimalHtml);
}

// ---------------------------------------------------------------------
// --- A PROXY RÉSZ (CORS/Referer kikerülése) ---
// ---------------------------------------------------------------------

app.get('/proxy', async (req, res) => {
    const videoUrl = req.query.url;
    if (!videoUrl) return res.status(400).send('Hiányzó "url" paraméter');
    const isManifest = videoUrl.includes('.m3u8') || videoUrl.includes('.txt');
    
    let origin;
    try {
        origin = new URL(videoUrl).origin;
    } catch (e) {
        return res.status(400).send('Érvénytelen URL formátum');
    }

    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Referer': origin
    };
    try {
        let response = await axios.get(videoUrl, {
            responseType: isManifest ? 'text' : 'stream',
            headers: headers, maxRedirects: 0, validateStatus: (status) => (status >= 200 && status < 400)
        });
        
        if (response.status >= 300 && response.status < 400 && response.headers.location) {
            let redirectUrl = response.headers.location;
            if (redirectUrl.startsWith('/')) redirectUrl = `${origin}${redirectUrl}`;
            response = await axios.get(redirectUrl, { responseType: isManifest ? 'text' : 'stream', headers: headers });
        }
        
        res.setHeader('Content-Type', response.headers['content-type']);
        res.setHeader('Access-Control-Allow-Origin', '*');
        
        if (isManifest) {
            let manifest = response.data.replace(/^(?!#)(.*)$/gm, (match) => 
                `/proxy?url=${encodeURIComponent(new URL(match, videoUrl).href)}`
            );
            res.send(manifest);
        } else {
            response.data.pipe(res);
        }
    } catch (error) {
        console.error('Proxy hiba:', error.message);
        if (!res.headersSent) res.status(500).send('Proxy hiba');
    }
});

// ---------------------------------------------------------------------
// --- ÚTVONALAK ÉS ROUTING ---
// ---------------------------------------------------------------------

// 1. A FŐOLDAL (HTML ŰRLAP) KISZOLGÁLÁSA
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// 2. ÚTVONAL: PROXY NÉLKÜL (Direkt lejátszáshoz)
// Formátum: https://[RENDER CÍMED]/direct-link/https://videolink.mp4
app.get('/direct-link/*', (req, res) => {
    const fullVideoLink = req.params[0];
    generateMinimalPlayerHtml(fullVideoLink, res); 
});

// 3. ÚTVONAL: PROXYVAL (Korlátozott linkekhez)
// Formátum: https://[RENDER CÍMED]/proxy-link/https://videolink.mp4
app.get('/proxy-link/*', (req, res) => {
    const fullVideoLink = req.params[0];
    const proxiedSrc = `/proxy?url=${encodeURIComponent(fullVideoLink)}`; 
    generateMinimalPlayerHtml(proxiedSrc, res); 
});

// ---------------------------------------------------------------------
// --- WEBSOCKET RÉSZ (Változatlan) ---
// ---------------------------------------------------------------------

const webClients = new Set(); 
let authenticatedBot = null; 

wss.on('connection', (ws) => {
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            
            if (data.type === 'AUTH' && data.secret === BOT_SECRET_KEY) {
                console.log('Discord Bot sikeresen hitelesítve és csatlakozva.');
                authenticatedBot = ws;
                ws.isBot = true;
                return;
            }

            if (ws.isBot && data.type === 'PLAY_VIDEO') {
                console.log(`[BOT] Play parancs továbbítása: ${data.url}`);
                webClients.forEach(client => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify(data));
                    }
                });
            }
        } catch (e) {
            console.warn('Ismeretlen WebSocket üzenet:', message);
        }
    });

    ws.on('close', () => {
        if (ws.isBot) {
            console.log('Discord Bot lecsatlakozott.');
            authenticatedBot = null;
        } else {
            webClients.delete(ws);
            console.log(`Web kliens lecsatlakozott. Maradt: ${webClients.size}`);
        }
    });

    if (!ws.isBot) {
        webClients.add(ws);
        console.log(`Web kliens csatlakozott. Jelenleg: ${webClients.size}`);
    }
});

// ---------------------------------------------------------------------
// --- SZERVER INDÍTÁSA ---
// ---------------------------------------------------------------------

server.listen(port, () => {
    console.log(`Szaby Lejátszó központ elindult a ${port} porton`);
});
