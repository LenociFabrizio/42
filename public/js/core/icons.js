/* =============================================================
   icons.js — Set di icone SVG (stroke, currentColor). Leggere e
   coerenti. Uso: icon('map') → stringa SVG; oppure svg('map',22).
   ============================================================= */
const P = {
  map: '<path d="M9 3 3 6v15l6-3 6 3 6-3V3l-6 3-6-3Z"/><path d="M9 3v15M15 6v15"/>',
  route: '<circle cx="6" cy="19" r="2.5"/><circle cx="18" cy="5" r="2.5"/><path d="M8.5 19H14a4 4 0 0 0 0-8H9a4 4 0 0 1 0-8h6.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  calendar: '<rect x="3" y="4.5" width="18" height="17" rx="2.5"/><path d="M3 9h18M8 2.5v4M16 2.5v4"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 21a6.5 6.5 0 0 1 13 0"/><path d="M16 5.2a3.5 3.5 0 0 1 0 6.6M17.5 21a6.5 6.5 0 0 0-3-5.5"/>',
  bell: '<path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 6.8 19.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H2a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 3.7 6.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H8a1.6 1.6 0 0 0 1-1.5V2a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V8a1.6 1.6 0 0 0 1.5 1H22a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z"/>',
  crosshair: '<circle cx="12" cy="12" r="8"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none"/>',
  play: '<path d="M7 5v14l12-7-12-7Z" fill="currentColor" stroke="none"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none"/>',
  pause: '<rect x="7" y="5" width="3.5" height="14" rx="1" fill="currentColor" stroke="none"/><rect x="13.5" y="5" width="3.5" height="14" rx="1" fill="currentColor" stroke="none"/>',
  flag: '<path d="M5 21V4M5 4h12l-2 4 2 4H5"/>',
  trophy: '<path d="M8 21h8M12 17v4M6 4h12v4a6 6 0 0 1-12 0V4Z"/><path d="M6 5H3.5v2A3.5 3.5 0 0 0 7 10.5M18 5h2.5v2A3.5 3.5 0 0 1 17 10.5"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  chevronLeft: '<path d="m15 6-6 6 6 6"/>',
  heart: '<path d="M12 20s-7-4.5-9.5-9A5 5 0 0 1 12 6a5 5 0 0 1 9.5 5c-2.5 4.5-9.5 9-9.5 9Z"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  check: '<path d="m5 12 5 5L20 6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 10.6 6.8-4M8.6 13.4l6.8 4"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>',
  mountain: '<path d="m3 20 6-11 4 6 2-3 6 8H3Z"/>',
  camera: '<path d="M3 8.5A2 2 0 0 1 5 6.5h1.5l1.2-2h8.6l1.2 2H19a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><circle cx="12" cy="13" r="3.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  gauge: '<path d="M12 14 16 9"/><circle cx="12" cy="14" r="0.5" fill="currentColor"/><path d="M4 18a9 9 0 1 1 16 0"/>',
  pin: '<path d="M12 21s-7-6.3-7-11a7 7 0 0 1 14 0c0 4.7-7 11-7 11Z"/><circle cx="12" cy="10" r="2.5"/>',
  bike: '<circle cx="5.5" cy="17" r="3.5"/><circle cx="18.5" cy="17" r="3.5"/><path d="M5.5 17 10 8h4l2 4M9 8h5"/><path d="M15 6h3"/>',
  car: '<path d="M5 13 6.5 8.5A2 2 0 0 1 8.4 7h7.2a2 2 0 0 1 1.9 1.5L19 13M4 13h16v4a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1v-1H7v1a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1Z"/><circle cx="7.5" cy="15.5" r="0.6" fill="currentColor"/><circle cx="16.5" cy="15.5" r="0.6" fill="currentColor"/>',
  medal: '<circle cx="12" cy="15" r="6"/><path d="m8.5 9.5-3-6.5M15.5 9.5l3-6.5M12 12.5v1.5M12 15h.01"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5 5-2Z"/>',
  road: '<path d="M8 3 6 21M16 3l2 18M12 4v2M12 10v2M12 16v2"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  fuel: '<path d="M12 3s6 6.4 6 11a6 6 0 0 1-12 0c0-4.6 6-11 6-11Z"/>',
  wrench: '<path d="M15 4a5 5 0 0 0-6.2 6.2l-4.6 4.6a2 2 0 0 0 2.8 2.8l4.6-4.6A5 5 0 0 0 20 8l-3 3-2-2 3-3a5 5 0 0 0-3-2Z"/>',
  coffee: '<path d="M4 8h13v4a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V8Z"/><path d="M17 9h2a2.5 2.5 0 0 1 0 5h-2"/><path d="M7 2v2.5M11 2v2.5M4 21h13"/>',
  wind: '<path d="M3 9h9a3 3 0 1 0-3-3M3 15h11a3 3 0 1 1-3 3"/>',
  megaphone: '<path d="M4 10v4a1 1 0 0 0 1 1h2l5 4V5L7 9H5a1 1 0 0 0-1 1Z"/><path d="M16 8.5a4 4 0 0 1 0 7"/>',
  star: '<path d="m12 3 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 17.8 6.8 19.1l1-5.8L3.5 9.2l5.9-.9L12 3Z"/>',
  fire: '<path d="M12 3c1.2 3-2 4.2-2 7a2 2 0 0 0 4 0c0-.7 0-1 .4-1.7C15.5 9.8 17 11.5 17 14a5 5 0 0 1-10 0c0-3.6 3-5.4 5-11Z"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
  zap: '<path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z"/>',
  footprints: '<path d="M6.5 3c1.4 0 2 1.4 2 3s-.6 3-2 3-2-1.4-2-3 .6-3 2-3ZM4.7 12h3.6l-.4 6H5.1L4.7 12ZM17.5 6c1.4 0 2 1.4 2 3s-.6 3-2 3-2-1.4-2-3 .6-3 2-3ZM15.7 15h3.6l-.4 6h-2.8L15.7 15Z"/>',
  award: '<circle cx="12" cy="9" r="6"/><path d="m8.5 14-1.3 7.5L12 19l4.8 2.5L15.5 14"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/>',
  alert: '<path d="M12 3 2.5 20h19L12 3Z"/><path d="M12 10v5M12 18h.01"/>',
  lock: '<rect x="4" y="10.5" width="16" height="9.5" rx="2"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/>',
  building: '<path d="M4 21V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v16"/><path d="M3 21h18"/><path d="M9 8h.01M15 8h.01M9 12h.01M15 12h.01M9 16h.01M15 16h.01"/>',
  key: '<circle cx="8" cy="12" r="4"/><path d="M12 12h9M18 12v4M15 12v3"/>',
  navigation: '<path d="M12 2 5 21l7-3 7 3-7-19Z"/>',
  expand: '<path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3"/>',
};

export function svg(name, size = 24, extra = '') {
  const body = P[name] || P.pin;
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${extra}>${body}</svg>`;
}
export const icon = svg;
export default svg;
