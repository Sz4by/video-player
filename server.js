const express = require('express');
const app = express();
// Render a PORT környezeti változót használja
const port = process.env.PORT || 3000; 

// Útvonal kezelése: /link/ utáni bármilyen URL-t elfog
app.get('/link/*', (req, res) => {
    // A teljes videó link kinyerése a címsorból
    const fullVideoLink = req.params[0];

    if (!fullVideoLink || !fullVideoLink.startsWith('http')) {
        return res.status(400).send("Hiba: Kérem adja meg a teljes videó linket a /link/ után, 'http'-vel kezdve.");
    }

    // HTML5 lejátszó generálása (a te képernyőképed szerint)
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

// A szerver elindítása
app.listen(port, () => {
  console.log(\`A szerver fut a \${port} porton\`);
});
