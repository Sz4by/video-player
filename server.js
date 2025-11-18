const express = require('express');
const app = express();
// Render a PORT környezeti változót fogja használni
const port = process.env.PORT || 3000; 

// Útvonal kezelése: /link/ utáni bármilyen URL-t elfog (a .htaccess-t helyettesíti)
app.get('/link/*', (req, res) => {
    // Kinyeri a teljes videó linket a kérés útvonalából
    // A [0] index a /link/ utáni teljes részt tartalmazza, pl.: https://ok6-29.vkuser.net/...
    const fullVideoLink = req.params[0];

    // Ellenőrzés
    if (!fullVideoLink || !fullVideoLink.startsWith('http')) {
        return res.status(400).send("Hiba: Kérem adja meg a teljes videó linket a /link/ után, 'http'-vel kezdve.");
    }

    // HTML5 lejátszó generálása (a te képernyőképed szerint, minimalista stílussal)
    const htmlResponse = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>Saját Dinamikus Lejátszó</title>
        <style>
            body { 
                background-color: #000; 
                margin: 0; 
                display: flex; 
                justify-content: center; 
                align-items: center; 
                height: 100vh;
                width: 100vw;
                overflow: hidden;
            }
            video { 
                max-width: 100%; 
                max-height: 100vh; 
            }
        </style>
    </head>
    <body>
        <video controls autoplay>
            <source src="${fullVideoLink}" type="video/mp4">
            A böngésződ nem támogatja a HTML5 videó lejátszást.
        </video>
    </body>
    </html>
    `;
    res.send(htmlResponse);
});

// Főoldal (alapértelmezett oldal)
app.get('/', (req, res) => {
    res.send('A lejátszó a /link/ utan adando URL-t várja. Példa: /link/https://videolink.mp4');
});


// A JAVÍTOTT RÉSZ: A Template String backtick-kel (`) van írva.
app.listen(port, () => {
  console.log(`A szerver fut a ${port} porton`); 
});
