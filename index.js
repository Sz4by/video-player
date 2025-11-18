const express = require('express');
const axios = require('axios');
const path = require('path');
const http = require('http');
const { URL } = require('url');
const WebSocket = require('ws');
const fs = require('fs'); // <-- ÚJ: fájlok olvasásához

// --- BIZTONSÁGI KULCS ---
const BOT_SECRET_KEY = process.env.BOT_SECRET_KEY;
if (!BOT_SECRET_KEY) {
    console.warn('FIGYELEM: A BOT_SECRET_KEY nincs beállítva! A bot nem fog tudni csatlakozni.');
}

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const port = process.env.PORT || 3000;

// Segédfüggvény a HTML fájl szinkron olvasásához
function getHtmlFile(filePath) {
    return new Promise((resolve, reject) => {
        fs.readFile(filePath, 'utf8', (err, data) => {
            if (err) return reject(err);
            resolve(data);
        });
    });
}

// --- A PROXY RÉSZ (Változatlan) ---
app.get('/proxy', async (req, res) => {
    const videoUrl = req.query.url;
    if (!videoUrl) return res.status(400).send('Hiányzó "url" paraméter');
    const isManifest = videoUrl.includes('.m3u8') || videoUrl.includes('.txt');
    
    // URL ellenőrzés és alapértelmezett Referer beállítása
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
        
        // 3xx átirányítás kezelése
        if (response.status >= 300 && response.status < 400 && response.headers.location) {
            let redirectUrl = response.headers.location;
            if (redirectUrl.startsWith('/')) redirectUrl = `${origin}${redirectUrl}`;
            response = await axios.get(redirectUrl, { responseType: isManifest ? 'text' : 'stream', headers: headers });
        }
        
        // Fejlécek beállítása és CORS engedélyezése
        res.setHeader('Content-Type', response.headers['content-type']);
        res.setHeader('Access-Control-Allow-Origin', '*');
        
        if (isManifest) {
            // M3U8 listában a relatív útvonalakat proxy linkekre cseréljük
            let manifest = response.data.replace(/^(?!#)(.*)$/gm, (match) => 
                `/proxy?url=${encodeURIComponent(new URL(match, videoUrl).href)}`
            );
            res.send(manifest);
        } else {
            // Sima fájl streamelése
            response.data.pipe(res);
        }
    } catch (error) {
        console.error('Proxy hiba:', error.message);
        if (!res.headersSent) res.status(500).send('Proxy hiba');
    }
});

// --- A WEBOLDAL KISZOLGÁLÁSA ÉS DEEP-LINK ÚTVONALAK ---

// 1. A főoldal változatlan (manuális beillesztés)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// 2. ÚJ DEEP-LINK ÚTVONAL: /link/https://videolink.mp4
app.get('/link/*', async (req, res) => {
    try {
        const fullVideoLink = req.params[0];
        if (!fullVideoLink || !fullVideoLink.startsWith('http')) {
            return res.status(400).send("Hiányzó vagy érvénytelen videó link a /link/ után.");
        }

        let htmlContent = await getHtmlFile(path.join(__dirname, 'index.html'));

        // Dinamikus Javascript kód befecskendezése az autó-lejátszáshoz
        const autoPlayScript = `
        <script>
            // Ide illesztjük be a videó linkjét
            const DEEP_LINK_URL = '${fullVideoLink.replace(/'/g, "\\'")}';
            
            // Az onload esemény figyeli a DOM betöltését
            window.onload = function() {
                // Az input mezőbe illesztés (hogy látszódjon a link)
                document.getElementById('url').value = DEEP_LINK_URL;
                // A proxy alapértelmezett BEKAPCSOLÁSA a CORS/VK problémák miatt
                document.getElementById('proxy-toggle').checked = true; 
                // Lejátszás indítása
                playVideo();
            };
        </script>
        </body>`;

        // A bezáró </body> tag cseréje a scripttel
        htmlContent = htmlContent.replace('</body>', autoPlayScript);

        res.send(htmlContent);

    } catch (error) {
        console.error('Hiba történt a deep-link feldolgozásakor:', error);
        res.status(500).send('Hiba történt a lejátszó generálásakor.');
    }
});


// --- WEBSOCKET "RÁDIÓTORONY" (Változatlan) ---
const webClients = new Set(); 
let authenticatedBot = null; 

wss.on('connection', (ws) => {
    // ... (wss.on('connection') logika változatlan)
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

// --- SZERVER INDÍTÁSA ---
server.listen(port, () => {
    console.log(`Szaby Lejátszó központ (Web+Proxy+WebSocket) elindult a ${port} porton`);
});
