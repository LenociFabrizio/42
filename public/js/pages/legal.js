/* legal.js — script condiviso delle pagine legali (tema, back, consenso). */
import '../core/theme.js';
import { svg } from '../core/ui.js';
import { initConsent } from '../core/consent.js';
import { stampVersion } from '../core/version.js';

const back = document.getElementById('back-btn');
if (back) back.innerHTML = svg('chevronLeft', 24);
initConsent();
stampVersion();
