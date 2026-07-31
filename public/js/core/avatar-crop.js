/* =============================================================
   avatar-crop.js — Editor della foto profilo: zoom + spostamento con
   ritaglio quadrato fatto nel browser. Nessuna dipendenza esterna.

   Uso:
     const blob = await cropAvatar(file);   // null se l'utente annulla
     if (blob) { ...upload... }

   Perché ritagliare qui e non sul server:
   1) l'avatar è tondo e la foto non lo è: senza inquadratura il taglio lo
      decide il caso, e viene fuori mezza faccia;
   2) una foto da telefono pesa 3-8 MB, e la funzione serverless su Vercel
      accetta richieste fino a ~4,5 MB: passando dal canvas partono ~100 KB,
      quindi il limite non si sfiora nemmeno e l'upload va anche in 3G.

   Portato dal progetto gemello f1 (public/js/core/avatar-crop.js), con i
   colori di questo tema e lo zoom a pizzico, che su un'app mobile-first è
   il primo gesto che si prova.
   ============================================================= */
import { modal, toast } from './ui.js';

const OUTPUT_SIZE = 512;   // lato dell'immagine finale (px)
const MAX_PICK_BYTES = 25 * 1024 * 1024; // tetto sul file scelto, prima del ritaglio
const VIEWPORT = 272;      // lato dell'area di anteprima (px)
const MAX_ZOOM = 4;        // zoom massimo rispetto al "riempi cornice"

let styleInjected = false;
function injectStyle() {
  if (styleInjected) return;
  styleInjected = true;
  const css = `
  .cropper { user-select:none; -webkit-user-select:none; touch-action:none; }
  .cropper-stage {
    position:relative; width:${VIEWPORT}px; height:${VIEWPORT}px; margin:0 auto;
    border-radius:50%; overflow:hidden; background:var(--bg-000); cursor:grab;
    touch-action:none;
    box-shadow:0 0 0 3px var(--accent), 0 0 24px var(--accent-glow);
  }
  .cropper-stage.dragging { cursor:grabbing; }
  /* max-width/height a "none": base.css impone img{max-width:100%} e dentro una
     cornice di ${VIEWPORT}px teneva la larghezza inchiodata mentre l'altezza
     cresceva con lo zoom — la foto si stirava invece di ingrandirsi.
     touch-action anche qui: la gesture nasce sull'immagine e .modal-body scrolla. */
  .cropper-stage img {
    position:absolute; top:0; left:0; max-width:none; max-height:none;
    transform-origin:0 0; pointer-events:none; will-change:transform; touch-action:none;
  }
  .cropper-controls { display:flex; align-items:center; gap:10px; margin:20px auto 4px; max-width:${VIEWPORT}px; color:var(--text-lo); }
  .cropper-controls input[type=range] { flex:1; accent-color:var(--accent); }
  .cropper-hint { text-align:center; font-size:.8rem; color:var(--text-lo); margin-top:10px; }
  `;
  const tag = document.createElement('style');
  tag.textContent = css;
  document.head.append(tag);
}

/** Carica un File/Blob immagine in un HTMLImageElement. */
function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Immagine non valida')); };
    img.src = url;
  });
}

/**
 * Apre l'editor e restituisce una Promise<Blob|null> (null = annullato).
 * @param {File|Blob} file immagine sorgente
 * @param {{size?:number, mime?:string, quality?:number}} [opts]
 */
export async function cropAvatar(file, opts = {}) {
  const size = opts.size || OUTPUT_SIZE;
  const mime = opts.mime || 'image/jpeg';
  const quality = opts.quality ?? 0.9;

  injectStyle();
  const { img, url } = await loadImage(file);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (val) => { if (settled) return; settled = true; URL.revokeObjectURL(url); m.close(); resolve(val); };

    // "baseScale" = fattore che fa coprire la cornice al minimo (scale = 1).
    const baseScale = VIEWPORT / Math.min(img.naturalWidth, img.naturalHeight);
    let scale = 1;              // 1..MAX_ZOOM (relativo a baseScale)
    let posX = 0, posY = 0;     // angolo dell'immagine rispetto alla cornice (px)

    const dispW = () => img.naturalWidth * baseScale * scale;
    const dispH = () => img.naturalHeight * baseScale * scale;

    // L'immagine copre sempre la cornice: niente spicchi vuoti nel tondo.
    function clamp() {
      const minX = VIEWPORT - dispW(), minY = VIEWPORT - dispH();
      if (posX > 0) posX = 0; if (posX < minX) posX = minX;
      if (posY > 0) posY = 0; if (posY < minY) posY = minY;
    }
    function center() { posX = (VIEWPORT - dispW()) / 2; posY = (VIEWPORT - dispH()) / 2; }

    const imgEl = document.createElement('img');
    imgEl.src = url;
    imgEl.alt = '';
    const stage = document.createElement('div');
    stage.className = 'cropper-stage';
    stage.append(imgEl);

    const range = document.createElement('input');
    range.type = 'range'; range.min = '1'; range.max = String(MAX_ZOOM); range.step = '0.01'; range.value = '1';
    range.setAttribute('aria-label', 'Zoom');
    const controls = document.createElement('div');
    controls.className = 'cropper-controls';
    const less = document.createElement('span'); less.setAttribute('aria-hidden', 'true'); less.textContent = '−';
    const more = document.createElement('span'); more.setAttribute('aria-hidden', 'true'); more.textContent = '+';
    controls.append(less, range, more);

    const wrap = document.createElement('div');
    wrap.className = 'cropper';
    wrap.append(stage, controls);
    const hint = document.createElement('p');
    hint.className = 'cropper-hint';
    hint.textContent = 'Trascina per spostare · pizzica o usa il cursore per lo zoom';
    wrap.append(hint);

    function paint() {
      imgEl.style.width = `${dispW()}px`;
      imgEl.style.height = `${dispH()}px`;
      imgEl.style.transform = `translate(${posX}px, ${posY}px)`;
    }
    center(); paint();

    /** Zoom col cursore o la rotella: tiene fermo il centro della cornice. */
    function setScale(next, anchorX = VIEWPORT / 2, anchorY = VIEWPORT / 2) {
      const clamped = Math.min(MAX_ZOOM, Math.max(1, next));
      if (clamped === scale) return;
      const k = clamped / scale;
      posX = anchorX - (anchorX - posX) * k;
      posY = anchorY - (anchorY - posY) * k;
      scale = clamped;
      range.value = String(scale);
      clamp(); paint();
    }

    range.addEventListener('input', () => setScale(Number(range.value)));
    stage.addEventListener('wheel', (e) => {
      e.preventDefault();
      setScale(scale * (e.deltaY < 0 ? 1.08 : 0.926));
    }, { passive: false });

    // --- Trascinamento e pizzico (Pointer Events: mouse, penna e dita) ---
    const pts = new Map();      // puntatori attivi
    let startX = 0, startY = 0, startPosX = 0, startPosY = 0;
    // Stato del pizzico, fotografato quando il secondo dito appoggia: distanza,
    // zoom, punto di mezzo e posizione dell'immagine. Restano FERMI per tutto il
    // gesto — se si ricalcolassero a ogni movimento l'ancora scapperebbe con le
    // dita e l'immagine strisciava di traverso invece di ingrandirsi.
    let pinchDist = 0, pinchScale = 1;
    let pinchMidX = 0, pinchMidY = 0, pinchPosX = 0, pinchPosY = 0;

    const rect = () => stage.getBoundingClientRect();
    const dist = ([a, b]) => Math.hypot(a.x - b.x, a.y - b.y);
    const mid = ([a, b]) => {
      const r = rect();
      return [(a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top];
    };
    const twoPts = () => [...pts.values()].slice(0, 2);

    function beginPinch() {
      const two = twoPts();
      pinchDist = dist(two);
      pinchScale = scale;
      [pinchMidX, pinchMidY] = mid(two);
      pinchPosX = posX; pinchPosY = posY;
    }

    /** Pizzico: zoom sul punto di partenza tra le dita + spostamento del gesto. */
    function applyPinch() {
      if (pinchDist <= 0) return;
      const two = twoPts();
      const k = Math.min(MAX_ZOOM, Math.max(1, pinchScale * (dist(two) / pinchDist))) / pinchScale;
      const [mx, my] = mid(two);
      posX = pinchMidX - (pinchMidX - pinchPosX) * k + (mx - pinchMidX);
      posY = pinchMidY - (pinchMidY - pinchPosY) * k + (my - pinchMidY);
      scale = pinchScale * k;
      range.value = String(scale);
      clamp(); paint();
    }

    stage.addEventListener('pointerdown', (e) => {
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      stage.setPointerCapture(e.pointerId);
      stage.classList.add('dragging');
      if (pts.size === 1) {
        startX = e.clientX; startY = e.clientY; startPosX = posX; startPosY = posY;
      } else if (pts.size === 2) {
        beginPinch();
      }
    });
    stage.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size >= 2) { applyPinch(); return; }
      posX = startPosX + (e.clientX - startX);
      posY = startPosY + (e.clientY - startY);
      clamp(); paint();
    });
    const lift = (e) => {
      pts.delete(e.pointerId);
      if (pts.size === 0) stage.classList.remove('dragging');
      // Dito staccato dopo un pizzico: il trascinamento riparte da quello che resta.
      if (pts.size === 1) {
        const p = [...pts.values()][0];
        startX = p.x; startY = p.y; startPosX = posX; startPosY = posY;
        pinchDist = 0;
      } else if (pts.size >= 2) {
        beginPinch(); // erano tre dita: il pizzico ricomincia dalle due che restano
      }
    };
    stage.addEventListener('pointerup', lift);
    stage.addEventListener('pointercancel', lift);

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn btn-outline'; cancelBtn.textContent = 'Annulla';
    const okBtn = document.createElement('button');
    okBtn.className = 'btn btn-primary'; okBtn.textContent = 'Usa questa foto';

    cancelBtn.addEventListener('click', () => finish(null));
    okBtn.addEventListener('click', () => {
      okBtn.disabled = true;
      const canvas = document.createElement('canvas');
      canvas.width = size; canvas.height = size;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      // Sfondo scuro come l'app: si vedrebbe solo con un'immagine più piccola
      // della cornice, cosa che clamp() evita, ma un JPEG non ha trasparenza.
      ctx.fillStyle = '#05070b';
      ctx.fillRect(0, 0, size, size);
      const ratio = size / VIEWPORT; // dalla cornice all'immagine finale
      ctx.drawImage(img, posX * ratio, posY * ratio, dispW() * ratio, dispH() * ratio);
      canvas.toBlob((blob) => finish(blob), mime, quality);
    });

    const m = modal({
      title: 'Inquadra la foto',
      content: wrap,
      footer: [cancelBtn, okBtn],
      onClose: () => finish(null),
    });
  });
}

/**
 * Selettore file + editor in un colpo: usato per la foto profilo e per
 * l'immagine del club, che hanno bisogno esattamente della stessa cosa (un
 * quadrato leggero, già inquadrato).
 * @param {{size?:number, quality?:number}} [opts]
 * @returns {Promise<Blob|null>} null se l'utente annulla o il file non va bene
 */
export function pickSquareImage(opts = {}) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.style.display = 'none';
  document.body.append(input);

  return new Promise((resolve) => {
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      input.remove();
      if (!file) { resolve(null); return; }
      if (!file.type.startsWith('image/')) {
        toast.error('Serve un\'immagine (JPG, PNG o WEBP).');
        resolve(null);
        return;
      }
      // Il ritaglio passa dal canvas: il limite serve solo a non far decodificare
      // al telefono un file assurdo (l'immagine caricata poi pesa ~100 KB).
      if (file.size > MAX_PICK_BYTES) {
        toast.error('Immagine troppo grande: scegline una sotto i 25 MB.');
        resolve(null);
        return;
      }
      try { resolve(await cropAvatar(file, opts)); }
      catch { toast.error('Immagine non leggibile: prova con un\'altra.'); resolve(null); }
    });
    // Selettore chiuso senza scegliere niente: senza questo l'input resterebbe
    // attaccato al DOM per sempre.
    input.addEventListener('cancel', () => { input.remove(); resolve(null); });
    input.click();
  });
}

export default cropAvatar;
