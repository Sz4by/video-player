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
// --- MINIMALISTA HTML GENERÁLÓ SEGÉDFÜGGVÉNY (JAVÍTOTT - HLS TÁMOGATÁSSAL) ---
// ---------------------------------------------------------------------

function generateMinimalPlayerHtml(finalSrc, res) {
    if (!finalSrc || !finalSrc.startsWith('http')) {
        return res.status(400).send("Hiányzó vagy érvénytelen videó link az útvonal után.");
    }
    
    // Ez a HTML most már tartalmazza a HLS.js könyvtárat és a logikát
    const minimalHtml = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>Lejátszás - Szaby</title>
        <script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>
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
        <video id="videoPlayer" controls autoplay></video>
        
        <script>
            const video = document.getElementById('videoPlayer');
            const src = "${finalSrc}";

            // Ellenőrizzük, hogy támogatott-e a HLS
            if (Hls.isSupported()) {
                console.log('HLS támogatott, motor indítása...');
                const hls = new Hls();
                hls.loadSource(src);
                hls.attachMedia(video);
                
                hls.on(Hls.Events.MANIFEST_PARSED, function() {
                    video.play().catch(e => console.log('Autoplay blokkolva:', e));
                });
                
                // Hibakezelés: ha a HLS nem megy, megpróbáljuk natívan (hátha MP4)
                hls.on(Hls.Events.ERROR, function (event, data) {
                    if (data.fatal) {
                        console.warn('HLS hiba, váltás natív lejátszásra:', data);
                        hls.destroy();
                        video.src = src;
                        video.play();
                    }
                });
            } 
            // Safari vagy iOS esetében, ahol natív a HLS
            else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                video.src = src;
                video.addEventListener('loadedmetadata', function() {
                    video.play();
                });
            } 
            // Végső esetben sima videóként kezeljük
            else {
                video.src = src;
                video.play();
            }
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

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// 2. ÚTVONAL: PROXY NÉLKÜL (Most már HLS támogatással!)
app.get('/direct-link/*', (req, res) => {
    const fullVideoLink = req.params[0];
    generateMinimalPlayerHtml(fullVideoLink, res); 
});

// 3. ÚTVONAL: PROXYVAL
app.get('/proxy-link/*', (req, res) => {
    const fullVideoLink = req.params[0];
    // Itt a finalSrc maga a proxy útvonal lesz
    const proxiedSrc = `/proxy?url=${encodeURIComponent(fullVideoLink)}`; 
    generateMinimalPlayerHtml(proxiedSrc, res); 
});

// ---------------------------------------------------------------------
// --- WEBSOCKET RÉSZ ---
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
            authenticatedBot = null;
        } else {
            webClients.delete(ws);
        }
    });

    if (!ws.isBot) {
        webClients.add(ws);
    }
});

server.listen(port, () => {
    console.log(`Szaby Lejátszó központ elindult a ${port} porton`);
});
