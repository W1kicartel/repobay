// Le 107 province italiane (con le città metropolitane) e le regioni: per capire dove lavora un installatore dalla zona che ha
// scritto a mano («Bergamo e provincia», «Milano e Brianza», «Lombardia», «tutta Italia, da remoto»). Servono alle pagine locali.
const P = (sigla, nome, regione, ...alias) => ({ sigla, nome, regione, alias });
export const PROVINCE = [
  P('TO', 'Torino', 'Piemonte'), P('VC', 'Vercelli', 'Piemonte'), P('NO', 'Novara', 'Piemonte'), P('CN', 'Cuneo', 'Piemonte'), P('AT', 'Asti', 'Piemonte'),
  P('AL', 'Alessandria', 'Piemonte'), P('BI', 'Biella', 'Piemonte'), P('VB', 'Verbano-Cusio-Ossola', 'Piemonte', 'Verbania', 'Ossola', 'Verbano'),
  P('AO', 'Aosta', "Valle d'Aosta", "Valle d'Aosta", 'Vallée d\'Aoste'),
  P('VA', 'Varese', 'Lombardia'), P('CO', 'Como', 'Lombardia'), P('SO', 'Sondrio', 'Lombardia', 'Valtellina'), P('MI', 'Milano', 'Lombardia'), P('BG', 'Bergamo', 'Lombardia'),
  P('BS', 'Brescia', 'Lombardia'), P('PV', 'Pavia', 'Lombardia'), P('CR', 'Cremona', 'Lombardia'), P('MN', 'Mantova', 'Lombardia'), P('LC', 'Lecco', 'Lombardia'),
  P('LO', 'Lodi', 'Lombardia'), P('MB', 'Monza e Brianza', 'Lombardia', 'Monza e della Brianza', 'Monza', 'Brianza'),
  P('BZ', 'Bolzano', 'Trentino-Alto Adige', 'Alto Adige', 'Südtirol', 'Bozen'), P('TN', 'Trento', 'Trentino-Alto Adige', 'Trentino'),
  P('VR', 'Verona', 'Veneto'), P('VI', 'Vicenza', 'Veneto'), P('BL', 'Belluno', 'Veneto'), P('TV', 'Treviso', 'Veneto'), P('VE', 'Venezia', 'Veneto', 'Mestre'),
  P('PD', 'Padova', 'Veneto'), P('RO', 'Rovigo', 'Veneto'),
  P('UD', 'Udine', 'Friuli-Venezia Giulia'), P('GO', 'Gorizia', 'Friuli-Venezia Giulia'), P('TS', 'Trieste', 'Friuli-Venezia Giulia'), P('PN', 'Pordenone', 'Friuli-Venezia Giulia'),
  P('IM', 'Imperia', 'Liguria', 'Sanremo'), P('SV', 'Savona', 'Liguria'), P('GE', 'Genova', 'Liguria'), P('SP', 'La Spezia', 'Liguria', 'Spezia'),
  P('PC', 'Piacenza', 'Emilia-Romagna'), P('PR', 'Parma', 'Emilia-Romagna'), P('RE', 'Reggio Emilia', 'Emilia-Romagna', "Reggio nell'Emilia"), P('MO', 'Modena', 'Emilia-Romagna'),
  P('BO', 'Bologna', 'Emilia-Romagna'), P('FE', 'Ferrara', 'Emilia-Romagna'), P('RA', 'Ravenna', 'Emilia-Romagna'), P('FC', 'Forlì-Cesena', 'Emilia-Romagna', 'Forlì', 'Cesena'),
  P('RN', 'Rimini', 'Emilia-Romagna'),
  P('MS', 'Massa-Carrara', 'Toscana', 'Massa', 'Carrara'), P('LU', 'Lucca', 'Toscana', 'Viareggio'), P('PT', 'Pistoia', 'Toscana'), P('FI', 'Firenze', 'Toscana'),
  P('LI', 'Livorno', 'Toscana'), P('PI', 'Pisa', 'Toscana'), P('AR', 'Arezzo', 'Toscana'), P('SI', 'Siena', 'Toscana'), P('GR', 'Grosseto', 'Toscana'), P('PO', 'Prato', 'Toscana'),
  P('PG', 'Perugia', 'Umbria'), P('TR', 'Terni', 'Umbria'),
  P('PU', 'Pesaro e Urbino', 'Marche', 'Pesaro', 'Urbino'), P('AN', 'Ancona', 'Marche'), P('MC', 'Macerata', 'Marche'), P('AP', 'Ascoli Piceno', 'Marche', 'Ascoli'),
  P('FM', 'Fermo', 'Marche'),
  P('VT', 'Viterbo', 'Lazio'), P('RI', 'Rieti', 'Lazio'), P('RM', 'Roma', 'Lazio'), P('LT', 'Latina', 'Lazio'), P('FR', 'Frosinone', 'Lazio'),
  P('AQ', "L'Aquila", 'Abruzzo', 'Aquila'), P('TE', 'Teramo', 'Abruzzo'), P('PE', 'Pescara', 'Abruzzo'), P('CH', 'Chieti', 'Abruzzo'),
  P('CB', 'Campobasso', 'Molise'), P('IS', 'Isernia', 'Molise'),
  P('CE', 'Caserta', 'Campania'), P('BN', 'Benevento', 'Campania'), P('NA', 'Napoli', 'Campania'), P('AV', 'Avellino', 'Campania'), P('SA', 'Salerno', 'Campania'),
  P('FG', 'Foggia', 'Puglia'), P('BA', 'Bari', 'Puglia'), P('TA', 'Taranto', 'Puglia'), P('BR', 'Brindisi', 'Puglia'), P('LE', 'Lecce', 'Puglia', 'Salento'),
  P('BT', 'Barletta-Andria-Trani', 'Puglia', 'Barletta', 'Andria', 'Trani'),
  P('PZ', 'Potenza', 'Basilicata'), P('MT', 'Matera', 'Basilicata'),
  P('CS', 'Cosenza', 'Calabria'), P('CZ', 'Catanzaro', 'Calabria'), P('RC', 'Reggio Calabria', 'Calabria', 'Reggio di Calabria'), P('KR', 'Crotone', 'Calabria'),
  P('VV', 'Vibo Valentia', 'Calabria', 'Vibo'),
  P('TP', 'Trapani', 'Sicilia'), P('PA', 'Palermo', 'Sicilia'), P('ME', 'Messina', 'Sicilia'), P('AG', 'Agrigento', 'Sicilia'), P('CL', 'Caltanissetta', 'Sicilia'),
  P('EN', 'Enna', 'Sicilia'), P('CT', 'Catania', 'Sicilia'), P('RG', 'Ragusa', 'Sicilia'), P('SR', 'Siracusa', 'Sicilia'),
  P('SS', 'Sassari', 'Sardegna', 'Olbia', 'Gallura'), P('NU', 'Nuoro', 'Sardegna'), P('CA', 'Cagliari', 'Sardegna'), P('OR', 'Oristano', 'Sardegna'),
  P('SU', 'Sud Sardegna', 'Sardegna', 'Carbonia', 'Iglesias', 'Medio Campidano'),
];
export const REGIONI = [...new Set(PROVINCE.map(p => p.regione))];

// il testo senza accenti, apostrofi e trattini, in minuscolo: «Forlì-Cesena» e «forli cesena» si equivalgono
export const normale = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/['’`-]/g, ' ').replace(/\s+/g, ' ').trim();
export const slugProvincia = p => normale(p.nome).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const slugRegione = r => normale(r).replace(/[^a-z0-9]+/g, '-');
for (const p of PROVINCE) p.slug = slugProvincia(p);
export const provinciaDaSlug = s => PROVINCE.find(p => p.slug === s) || null;

const parola = s => new RegExp(`(^|[^a-z0-9])${normale(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9])`);
const NOMI = PROVINCE.map(p => ({ p, re: [p.nome, ...p.alias].map(parola) }));
const PER_REGIONE = REGIONI.map(r => ({ r, re: parola(r), province: PROVINCE.filter(p => p.regione === r) }));
// «tutta Italia», «da remoto», «online»: lavora ovunque, ma non apre pagine locali da solo (sarebbero 107 pagine uguali)
const REMOTO = /(^|[^a-z])(tutta italia|in tutta italia|italia intera|remoto|da remoto|online|ovunque)($|[^a-z])/;

// dove lavora un installatore: le province (sigle) e se lavora anche da remoto
export function zoneDi(testo) {
  const t = normale(testo), sigle = new Set();
  for (const { p, re } of NOMI) if (re.some(x => x.test(t))) sigle.add(p.sigla);
  for (const { re, province } of PER_REGIONE) if (re.test(t)) for (const p of province) sigle.add(p.sigla);
  // la sigla fra parentesi o da sola: «Rho (MI)», «MB»
  for (const m of String(testo || '').matchAll(/\(([A-Z]{2})\)|^\s*([A-Z]{2})\s*$/g)) { const s = m[1] || m[2]; if (PROVINCE.some(p => p.sigla === s)) sigle.add(s); }
  return { province: [...sigle], remoto: REMOTO.test(t) || t === 'italia' };
}
export { slugRegione };
