// Il tasto «Inietta»: per ogni installazione, lo script (server/bolla.sh) che chi installa lancia sul server del cliente per mettere
// la bolla nelle pagine servite da Nginx, e il comando da copiare. Repobay non entra mai nei server dei clienti: il comando lo lancia
// chi installa, che lì ha già accesso; lo script prova la configurazione e, se non va, rimette tutto com'era. Si toglie con --togli.
import { readFileSync } from 'node:fs';
import { bolla, linkAssistenza } from './assistenza.js';

const MODELLO = readFileSync(new URL('./bolla.sh', import.meta.url), 'utf8');

// dove va la bolla, programma per programma: «tutto» dove nessuna pagina è pubblica (gestionali, CRM, magazzino…), il percorso di
// amministrazione dove il programma ha pagine aperte a tutti; dove il percorso non è fisso (o non lo sappiamo), lo sceglie chi installa
const PERCORSI = {
  'TryGhost/Ghost': '/ghost/', 'wagtail/wagtail': '/admin/', 'joomla/joomla-cms': '/administrator/', 'bagisto/bagisto': '/admin/',
  'evershopcommerce/evershop': '/admin/', 'shopware/shopware': '/admin', 'knadh/listmonk': '/admin/', 'chatwoot/chatwoot': '/app/',
};
const TUTTO = new Set(['gestionale', 'magazzino', 'contabilità', 'crm', 'cassa']);
const SCELTA = new Set(['PrestaShop/PrestaShop', 'n8n-io/n8n', 'jitsi/jitsi-meet', 'heyform/heyform', 'calcom/cal.diy', 'alextselegidis/easyappointments', 'zammad/zammad',
  'LiveHelperChat/livehelperchat', 'moodle/moodle', 'chamilo/chamilo-lms', 'openemr/openemr', 'opensourcepos/opensourcepos']);
const INTERNI = new Set(['matomo-org/matomo', 'umami-software/umami', 'paperless-ngx/paperless-ngx', 'mealie-recipes/mealie', 'nextcloud/server', 'dani-garcia/vaultwarden',
  'louislam/uptime-kuma', 'gristlabs/grist-core', 'immich-app/immich', 'Mintplex-Labs/anything-llm', 'dgtlmoon/changedetection.io', 'gitroomhq/postiz-app',
  'freescout-help-desk/freescout', 'docusealco/docuseal', 'sysadminsmedia/homebox', 'inventree/InvenTree']);
export function doveBolla(p) {
  if (PERCORSI[p.repo]) return { modo: 'percorso', percorso: PERCORSI[p.repo] };
  if (SCELTA.has(p.repo)) return { modo: 'scelta', percorso: '' };
  if (INTERNI.has(p.repo) || TUTTO.has(p.categoria)) return { modo: 'tutto', percorso: '' };
  return { modo: 'scelta', percorso: '' };
}

// lo script di un'installazione: la bolla dentro (solo HTML, controllato: niente apici, «$» o a capo, che Nginx o la shell leggerebbero)
export function scriptBolla(cfg, k, p, { lingua = 'it' } = {}) {
  const html = bolla(cfg, k, { lingua }), d = doveBolla(p);
  if (/['$\\\n\r]/.test(html)) throw new Error('bolla con caratteri non ammessi nello script');
  return MODELLO.replaceAll('__BOLLA__', html).replaceAll('__MODO__', d.modo).replaceAll('__PERCORSO__', d.percorso)
    .replaceAll('__PRODOTTO__', String(p.nome || '').replace(/[^\p{L}\p{N} ._-]/gu, '').slice(0, 60));
}

// il comando da copiare per chi installa (e quello per toglierla): scarica lo script, poi lo lancia con sudo
export function comandoBolla(cfg, k, p) {
  const d = doveBolla(p), url = `${linkAssistenza(cfg, k)}/bolla.sh`;
  const scarica = `curl -fsSL ${url} -o repobay-bolla.sh`;
  const opz = d.modo === 'scelta' ? ' --percorso=/admin/' : '';
  return { modo: d.modo, percorso: d.percorso, script: url, comando: `${scarica} && sudo sh repobay-bolla.sh {{DOMINIO}}${opz}`, togli: `sudo sh repobay-bolla.sh {{DOMINIO}} --togli` };
}
