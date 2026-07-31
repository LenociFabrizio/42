/* =============================================================
   vehicle-catalog.js — Marche e modelli di auto e moto per i menu a tendina
   del garage, più il componente che li mette insieme.

   PERCHÉ UN ELENCO LOCALE E NON UN'API ESTERNA
   Le API pubbliche gratuite di marche/modelli (la vPIC della NHTSA è la più
   citata) sono registri americani: migliaia di costruttori, moltissimi
   irrilevanti qui, nomi di modelli in versione USA e nessuna moto europea
   decente. Inoltre metterebbero una dipendenza di rete nel mezzo di un form:
   servizio giù o offline (siamo una PWA) = campo bloccato, e servirebbe aprire
   la CSP verso un dominio terzo per un dato che non cambia mai.
   Un elenco curato sul mercato italiano è più corto, più pertinente, funziona
   senza rete e non racconta a nessuno che veicolo guidi. Il modulo si carica
   solo quando si apre il form del garage.

   Nessuna pretesa di completezza: c'è sempre "Altro…", che apre la scrittura
   libera. Il server continua ad accettare testo libero, quindi un modello
   mancante non blocca nessuno.
   ============================================================= */
import { el } from './ui.js';

const OTHER = '__other__';

/** Auto, raggruppate per provenienza (i gruppi diventano <optgroup>). */
export const CAR_MAKES = [
  { name: 'Abarth', group: 'Italiane', models: ['500', '595', '695', '124 Spider', 'Grande Punto'] },
  { name: 'Alfa Romeo', group: 'Italiane', models: ['Giulia', 'Stelvio', 'Tonale', 'Junior', 'Giulietta', 'MiTo', '147', '156', '159', 'GT', 'Brera', '4C'] },
  { name: 'Ferrari', group: 'Italiane', models: ['296 GTB', 'SF90', 'F8 Tributo', '488', 'Roma', 'Portofino', '812 Superfast', 'California', '458 Italia', 'F430'] },
  { name: 'Fiat', group: 'Italiane', models: ['500', '600', 'Panda', 'Punto', 'Grande Punto', 'Tipo', 'Bravo', '500X', '500L', 'Uno', 'Coupé', 'Barchetta'] },
  { name: 'Lamborghini', group: 'Italiane', models: ['Revuelto', 'Huracán', 'Aventador', 'Urus', 'Gallardo', 'Murciélago'] },
  { name: 'Lancia', group: 'Italiane', models: ['Ypsilon', 'Delta', 'Musa', 'Thesis', 'Fulvia'] },
  { name: 'Maserati', group: 'Italiane', models: ['Ghibli', 'Grecale', 'Levante', 'Quattroporte', 'GranTurismo', 'MC20'] },

  { name: 'Audi', group: 'Tedesche', models: ['A1', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'Q2', 'Q3', 'Q5', 'Q7', 'Q8', 'TT', 'R8', 'S3', 'RS3', 'RS6', 'e-tron'] },
  { name: 'BMW', group: 'Tedesche', models: ['Serie 1', 'Serie 2', 'Serie 3', 'Serie 4', 'Serie 5', 'Serie 6', 'Serie 7', 'Serie 8', 'X1', 'X2', 'X3', 'X4', 'X5', 'X6', 'X7', 'Z4', 'M2', 'M3', 'M4', 'M5', 'i4', 'iX'] },
  { name: 'Mercedes-Benz', group: 'Tedesche', models: ['Classe A', 'Classe B', 'Classe C', 'Classe E', 'Classe S', 'Classe G', 'Classe V', 'CLA', 'CLS', 'GLA', 'GLB', 'GLC', 'GLE', 'GLS', 'SLK', 'AMG GT'] },
  { name: 'Opel', group: 'Tedesche', models: ['Corsa', 'Astra', 'Insignia', 'Mokka', 'Crossland', 'Grandland', 'Zafira', 'Meriva', 'Adam'] },
  { name: 'Porsche', group: 'Tedesche', models: ['911', '718 Cayman', '718 Boxster', 'Cayenne', 'Macan', 'Panamera', 'Taycan'] },
  { name: 'Smart', group: 'Tedesche', models: ['Fortwo', 'Forfour', '#1', '#3'] },
  { name: 'Volkswagen', group: 'Tedesche', models: ['Golf', 'Polo', 'Passat', 'Tiguan', 'T-Roc', 'T-Cross', 'Touareg', 'Touran', 'Sharan', 'Arteon', 'Scirocco', 'Up!', 'ID.3', 'ID.4'] },

  { name: 'Alpine', group: 'Francesi', models: ['A110'] },
  { name: 'Citroën', group: 'Francesi', models: ['C1', 'C3', 'C3 Aircross', 'C4', 'C4 Cactus', 'C5', 'C5 Aircross', 'Berlingo', 'Saxo', 'Xsara'] },
  { name: 'DS', group: 'Francesi', models: ['DS3', 'DS4', 'DS7', 'DS9'] },
  { name: 'Peugeot', group: 'Francesi', models: ['108', '205', '206', '207', '208', '308', '408', '508', '2008', '3008', '5008', 'RCZ', 'Partner'] },
  { name: 'Renault', group: 'Francesi', models: ['Twingo', 'Clio', 'Captur', 'Megane', 'Scenic', 'Kadjar', 'Austral', 'Espace', 'Talisman', 'Laguna', 'Zoe'] },

  { name: 'Cupra', group: 'Altre europee', models: ['Formentor', 'Leon', 'Ateca', 'Born', 'Terramar'] },
  { name: 'Dacia', group: 'Altre europee', models: ['Sandero', 'Duster', 'Logan', 'Jogger', 'Spring'] },
  { name: 'Jaguar', group: 'Altre europee', models: ['XE', 'XF', 'XJ', 'F-Type', 'F-Pace', 'E-Pace', 'I-Pace'] },
  { name: 'Land Rover', group: 'Altre europee', models: ['Defender', 'Discovery', 'Discovery Sport', 'Range Rover', 'Range Rover Sport', 'Range Rover Evoque', 'Freelander'] },
  { name: 'Lotus', group: 'Altre europee', models: ['Elise', 'Exige', 'Emira', 'Evora'] },
  { name: 'Mini', group: 'Altre europee', models: ['Cooper', 'Countryman', 'Clubman', 'Cabrio', 'Paceman'] },
  { name: 'SEAT', group: 'Altre europee', models: ['Ibiza', 'Leon', 'Arona', 'Ateca', 'Tarraco', 'Alhambra', 'Toledo'] },
  { name: 'Škoda', group: 'Altre europee', models: ['Fabia', 'Octavia', 'Superb', 'Scala', 'Kamiq', 'Karoq', 'Kodiaq', 'Enyaq', 'Yeti', 'Rapid'] },
  { name: 'Volvo', group: 'Altre europee', models: ['XC40', 'XC60', 'XC90', 'V40', 'V60', 'V90', 'S60', 'S90', 'C40'] },

  { name: 'Honda', group: 'Giapponesi e coreane', models: ['Civic', 'Jazz', 'HR-V', 'CR-V', 'ZR-V', 'Accord', 'S2000', 'Insight'] },
  { name: 'Hyundai', group: 'Giapponesi e coreane', models: ['i10', 'i20', 'i30', 'Bayon', 'Kona', 'Tucson', 'Santa Fe', 'Ioniq 5'] },
  { name: 'Kia', group: 'Giapponesi e coreane', models: ['Picanto', 'Rio', 'Ceed', 'XCeed', 'Stonic', 'Niro', 'Sportage', 'Sorento', 'EV6'] },
  { name: 'Lexus', group: 'Giapponesi e coreane', models: ['UX', 'NX', 'RX', 'IS', 'ES', 'LS', 'LC'] },
  { name: 'Mazda', group: 'Giapponesi e coreane', models: ['2', '3', '6', 'MX-5', 'CX-3', 'CX-30', 'CX-5', 'CX-60', 'RX-8'] },
  { name: 'Mitsubishi', group: 'Giapponesi e coreane', models: ['Space Star', 'Colt', 'Lancer', 'ASX', 'Eclipse Cross', 'Outlander', 'Pajero'] },
  { name: 'Nissan', group: 'Giapponesi e coreane', models: ['Micra', 'Juke', 'Qashqai', 'X-Trail', 'Note', 'Leaf', 'Ariya', '350Z', '370Z', 'GT-R'] },
  { name: 'Subaru', group: 'Giapponesi e coreane', models: ['Impreza', 'WRX', 'BRZ', 'XV', 'Forester', 'Outback', 'Levorg'] },
  { name: 'Suzuki', group: 'Giapponesi e coreane', models: ['Swift', 'Ignis', 'Vitara', 'S-Cross', 'Jimny', 'Baleno', 'Across'] },
  { name: 'Toyota', group: 'Giapponesi e coreane', models: ['Aygo', 'Yaris', 'Yaris Cross', 'Corolla', 'C-HR', 'RAV4', 'Auris', 'Prius', 'Supra', 'GR86', 'Land Cruiser', 'Hilux', 'bZ4X'] },

  { name: 'Chevrolet', group: 'Americane', models: ['Camaro', 'Corvette', 'Spark', 'Aveo', 'Cruze', 'Captiva', 'Matiz'] },
  { name: 'Chrysler', group: 'Americane', models: ['300C', 'Voyager', 'PT Cruiser'] },
  { name: 'Dodge', group: 'Americane', models: ['Challenger', 'Charger', 'Viper', 'Journey', 'Nitro'] },
  { name: 'Ford', group: 'Americane', models: ['Fiesta', 'Focus', 'Puma', 'Kuga', 'Mustang', 'Mondeo', 'EcoSport', 'C-Max', 'Ka', 'Explorer', 'Ranger', 'Transit'] },
  { name: 'Jeep', group: 'Americane', models: ['Renegade', 'Compass', 'Avenger', 'Wrangler', 'Cherokee', 'Grand Cherokee', 'Gladiator'] },
  { name: 'Tesla', group: 'Americane', models: ['Model 3', 'Model Y', 'Model S', 'Model X'] },

  { name: 'BYD', group: 'Altre', models: ['Dolphin', 'Atto 3', 'Seal', 'Han'] },
  { name: 'MG', group: 'Altre', models: ['MG3', 'MG4', 'MG5', 'ZS', 'HS'] },
];

/** Moto e scooter, raggruppate per provenienza. */
export const MOTO_MAKES = [
  { name: 'Aprilia', group: 'Italiane', models: ['RS 125', 'RS 457', 'RS 660', 'RSV4', 'Tuono 660', 'Tuono V4', 'Tuareg 660', 'Shiver 900', 'Dorsoduro 900', 'Pegaso', 'SR GT'] },
  { name: 'Benelli', group: 'Italiane', models: ['TRK 502', 'TRK 502 X', 'TRK 702', 'Leoncino 500', 'Leoncino 800', '502 C', 'Imperiale 400', 'BN 302', 'TNT'] },
  { name: 'Beta', group: 'Italiane', models: ['RR 125', 'RR 300', 'RR 350', 'RR 390', 'RR 430', 'Xtrainer', 'Alp 200'] },
  { name: 'Bimota', group: 'Italiane', models: ['KB4', 'Tesi H2', 'DB7'] },
  { name: 'Cagiva', group: 'Italiane', models: ['Mito', 'Raptor', 'Elefant'] },
  { name: 'Ducati', group: 'Italiane', models: ['Panigale V2', 'Panigale V4', 'Streetfighter V2', 'Streetfighter V4', 'Monster', 'Multistrada V2', 'Multistrada V4', 'Hypermotard', 'Scrambler', 'Diavel', 'DesertX', 'SuperSport', '899 Panigale', '1198'] },
  { name: 'Energica', group: 'Italiane', models: ['Ego', 'Eva Ribelle', 'Experia'] },
  { name: 'Fantic', group: 'Italiane', models: ['Caballero 125', 'Caballero 500', 'XEF 250', 'XX 250'] },
  { name: 'Moto Guzzi', group: 'Italiane', models: ['V7', 'V9', 'V85 TT', 'V100 Mandello', 'California', 'Griso', 'Breva', 'Stelvio'] },
  { name: 'MV Agusta', group: 'Italiane', models: ['F3 800', 'F4', 'Brutale 800', 'Brutale 1000', 'Dragster 800', 'Turismo Veloce', 'Superveloce 800', 'Rush'] },
  { name: 'Piaggio', group: 'Italiane', models: ['Beverly', 'Liberty', 'Medley', 'MP3', 'X10', 'Zip', 'Typhoon'] },
  { name: 'SWM', group: 'Italiane', models: ['Superdual', 'RS 300 R', 'Gran Milano', 'Varez'] },
  { name: 'Vespa', group: 'Italiane', models: ['Primavera', 'Sprint', 'GTS', 'GTV', 'PX', '946', 'Elettrica'] },

  { name: 'Honda', group: 'Giapponesi', models: ['CB125R', 'CB500F', 'CB650R', 'CB1000R', 'Hornet CB750', 'CBR600RR', 'CBR1000RR-R', 'Africa Twin', 'Transalp XL750', 'NC750X', 'X-ADV', 'Forza 750', 'Rebel 500', 'Gold Wing', 'CRF300L', 'SH125', 'PCX125', 'VFR800'] },
  { name: 'Kawasaki', group: 'Giapponesi', models: ['Ninja 400', 'Ninja 650', 'Ninja ZX-6R', 'Ninja ZX-10R', 'Ninja H2', 'Z650', 'Z900', 'Z1000', 'ER-6n', 'Versys 650', 'Versys 1000', 'Vulcan S', 'W800', 'KLX 300'] },
  { name: 'Suzuki', group: 'Giapponesi', models: ['GSX-R600', 'GSX-R750', 'GSX-R1000', 'GSX-S750', 'GSX-S1000', 'GSX-8S', 'SV650', 'V-Strom 650', 'V-Strom 800', 'Hayabusa', 'Bandit', 'Burgman', 'DR 650'] },
  { name: 'Yamaha', group: 'Giapponesi', models: ['MT-03', 'MT-07', 'MT-09', 'MT-10', 'R1', 'R3', 'R6', 'R7', 'Ténéré 700', 'Tracer 7', 'Tracer 9', 'XSR700', 'XSR900', 'TMAX', 'XMAX', 'FZ6', 'Fazer', 'WR 250'] },

  { name: 'BMW', group: 'Europee', models: ['R 1250 GS', 'R 1300 GS', 'S 1000 RR', 'S 1000 XR', 'F 900 R', 'F 850 GS', 'F 800 GS', 'R nineT', 'R 18', 'G 310 R', 'C 400 GT', 'K 1600'] },
  { name: 'GasGas', group: 'Europee', models: ['EC 300', 'MC 250', 'ES 700'] },
  { name: 'Husqvarna', group: 'Europee', models: ['Svartpilen 401', 'Vitpilen 401', 'Norden 901', '701 Enduro', 'TE 300', 'FE 350'] },
  { name: 'KTM', group: 'Europee', models: ['125 Duke', '390 Duke', '690 Duke', '790 Duke', '890 Duke', '1290 Super Duke R', 'RC 390', '390 Adventure', '890 Adventure', '1290 Super Adventure', 'EXC 300', 'SX-F 450'] },
  { name: 'Norton', group: 'Europee', models: ['Commando', 'V4SV'] },
  { name: 'Sherco', group: 'Europee', models: ['SE 300', 'SEF 450'] },
  { name: 'Triumph', group: 'Europee', models: ['Trident 660', 'Street Triple', 'Speed Triple', 'Tiger 660', 'Tiger 900', 'Tiger 1200', 'Bonneville T100', 'Bonneville T120', 'Thruxton', 'Scrambler 900', 'Scrambler 1200', 'Rocket 3', 'Daytona'] },

  { name: 'Harley-Davidson', group: 'Americane', models: ['Sportster S', 'Iron 883', 'Forty-Eight', 'Nightster', 'Street Bob', 'Fat Boy', 'Softail', 'Road King', 'Street Glide', 'Road Glide', 'Pan America'] },
  { name: 'Indian', group: 'Americane', models: ['Scout', 'Chief', 'Chieftain', 'Springfield', 'Roadmaster', 'FTR'] },
  { name: 'Zero Motorcycles', group: 'Americane', models: ['SR/F', 'SR/S', 'FX', 'DSR'] },

  { name: 'CFMoto', group: 'Altre', models: ['450 SR', '650 NK', '700 CL-X', '800 MT'] },
  { name: 'Kymco', group: 'Altre', models: ['Agility', 'People', 'Downtown', 'X-Town', 'AK 550'] },
  { name: 'QJ Motor', group: 'Altre', models: ['SRK 700', 'SRV 550'] },
  { name: 'Royal Enfield', group: 'Altre', models: ['Hunter 350', 'Classic 350', 'Meteor 350', 'Himalayan', 'Scram 411', 'Interceptor 650', 'Continental GT 650'] },
  { name: 'SYM', group: 'Altre', models: ['Jet 14', 'Symphony', 'Maxsym'] },
  { name: 'Voge', group: 'Altre', models: ['300 R', '500 DS', '525 DSX', '900 DSX'] },
  { name: 'Zontes', group: 'Altre', models: ['310 R', '350 T', '703 RR'] },
];

/** Marche del tipo richiesto ('car' | 'moto'). */
export const makesFor = (type) => (type === 'car' ? CAR_MAKES : MOTO_MAKES);

/**
 * Campi Marca e Modello a tendina, con scrittura libera come via di fuga.
 * Il modello dipende dalla marca; cambiando tipo di veicolo l'elenco si rifà.
 *
 * @param {object} [opts]
 * @param {string} [opts.type]      'moto' | 'car'
 * @param {(label: string) => void} [opts.onChange] chiamato con "Marca Modello"
 *   quando la scelta è completa: serve a proporre il nome del veicolo.
 * @returns {{fields: HTMLElement, setType: Function, values: Function}}
 */
export function makeModelFields({ type = 'moto', onChange } = {}) {
  const makeSel = el('select', { class: 'select' });
  const makeFree = el('input', { class: 'input', maxlength: '40', placeholder: 'Scrivi la marca', style: 'margin-top:6px' });
  const modelSel = el('select', { class: 'select' });
  const modelFree = el('input', { class: 'input', maxlength: '40', placeholder: 'Scrivi il modello', style: 'margin-top:6px' });
  makeFree.hidden = true;
  modelFree.hidden = true;

  const fields = el('div', { class: 'grid grid-2' }, [
    el('div', { class: 'field' }, [el('label', { text: 'Marca' }), makeSel, makeFree]),
    el('div', { class: 'field' }, [el('label', { text: 'Modello' }), modelSel, modelFree]),
  ]);

  let current = type;

  function fillMakes() {
    makeSel.innerHTML = '';
    makeSel.append(el('option', { value: '', text: '— Scegli la marca —' }));
    let group = null;
    let holder = makeSel;
    for (const mk of makesFor(current)) {
      if (mk.group !== group) {
        group = mk.group;
        holder = el('optgroup', { label: group });
        makeSel.append(holder);
      }
      holder.append(el('option', { value: mk.name, text: mk.name }));
    }
    makeSel.append(el('option', { value: OTHER, text: 'Altro…' }));
  }

  function fillModels() {
    const mk = makesFor(current).find((x) => x.name === makeSel.value);
    modelSel.innerHTML = '';
    const free = makeSel.value === OTHER;
    // Marca scritta a mano: il modello non può che essere scritto a mano.
    modelSel.hidden = free;
    modelFree.hidden = !free;
    if (free) return;
    modelSel.append(el('option', { value: '', text: mk ? '— Scegli il modello —' : '— Prima la marca —' }));
    for (const m of mk?.models || []) modelSel.append(el('option', { value: m, text: m }));
    if (mk) modelSel.append(el('option', { value: OTHER, text: 'Altro…' }));
    modelSel.disabled = !mk;
  }

  function values() {
    const make = makeSel.value === OTHER ? makeFree.value.trim() : makeSel.value;
    const model = (makeSel.value === OTHER || modelSel.value === OTHER)
      ? modelFree.value.trim()
      : modelSel.value;
    return { make, model };
  }

  const announce = () => {
    const { make, model } = values();
    if (make && model) onChange?.(`${make} ${model}`);
  };

  makeSel.addEventListener('change', () => {
    makeFree.hidden = makeSel.value !== OTHER;
    fillModels();
    if (makeSel.value === OTHER) makeFree.focus();
    announce();
  });
  modelSel.addEventListener('change', () => {
    modelFree.hidden = modelSel.value !== OTHER;
    if (modelSel.value === OTHER) modelFree.focus();
    announce();
  });
  makeFree.addEventListener('input', announce);
  modelFree.addEventListener('input', announce);

  fillMakes();
  fillModels();

  return {
    fields,
    /** Cambio auto ↔ moto: le marche non sono le stesse. */
    setType(t) {
      if (t === current) return;
      current = t;
      makeSel.value = '';
      makeFree.value = '';
      modelFree.value = '';
      makeFree.hidden = true;
      modelFree.hidden = true;
      fillMakes();
      fillModels();
    },
    values,
  };
}

export default { CAR_MAKES, MOTO_MAKES, makesFor, makeModelFields };
