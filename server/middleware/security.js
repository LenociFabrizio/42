/**
 * security.js (middleware)
 * ------------------------------------------------------------
 * Header di sicurezza tramite Helmet + Content-Security-Policy
 * calibrata sugli ORIGINI realmente usati dall'app:
 *   - MapLibre GL JS servito da CDN (unpkg / jsdelivr)
 *   - Tiles mappa raster (CARTO dark, OpenStreetMap) come immagini
 *   - Web worker di MapLibre creati da blob:
 *   - Geocoding via Nominatim (OpenStreetMap)
 *   - Google Fonts (css + font files)
 *
 * NB: se cambi provider mappe/font, aggiorna gli elenchi qui sotto.
 * ------------------------------------------------------------
 */
import helmet from 'helmet';

const CDN = ['https://unpkg.com', 'https://cdn.jsdelivr.net'];

export function securityHeaders() {
  return helmet({
    // COEP romperebbe il caricamento di tiles/immagini cross-origin: off.
    crossOriginEmbedderPolicy: false,
    // Consenti che le immagini (avatar/tiles) siano usate cross-origin.
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        // Gli script dell'app sono locali; MapLibre arriva dai CDN sopra.
        scriptSrc: ["'self'", ...CDN],
        // 'unsafe-inline' per gli stili inline usati nei componenti UI.
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', ...CDN],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        // Tiles e avatar: immagini da qualsiasi https + data/blob (canvas, ImageBitmap).
        imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
        // Fetch di tiles/style/glyphs/geocoding: https generico + self.
        connectSrc: ["'self'", 'https:'],
        // MapLibre istanzia i propri worker da blob URL.
        workerSrc: ["'self'", 'blob:'],
        childSrc: ["'self'", 'blob:'],
        manifestSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'self'"],
        upgradeInsecureRequests: null, // lasciato gestire a Vercel/hosting in prod
      },
    },
  });
}
