<?php
// A .htaccess átirányításnak köszönhetően a teljes videó URL a 'video_url' paraméterben érkezik meg.
$videoUrl = isset($_GET['video_url']) ? $_GET['video_url'] : '';

// Ellenőrzés és tisztítás
if (empty($videoUrl) || !filter_var($videoUrl, FILTER_VALIDATE_URL)) {
    // Ezt a hibát látod, ha csak a 'szaby.com/link/' címet nyitod meg
    die("Hiba: Kérem adja meg a teljes videó linket a /link/ után.");
}

$videoUrl = htmlspecialchars($videoUrl);

// HTML5 lejátszó oldal generálása
echo '<!DOCTYPE html>
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
        <source src="' . $videoUrl . '" type="video/mp4">
        A böngésződ nem támogatja a HTML5 videó lejátszást.
    </video>
</body>
</html>';

?>
