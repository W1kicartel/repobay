// Le rotte di Stripe: il conto Connect di builder e installatori (aperto e compilato dentro l'area con i componenti incorporati di
// Stripe, o sulla pagina di Stripe se lo script non si carica), il pannello Express, il webhook firmato.
import { verificaFirma } from '../stripe.js';
import { gestisciEvento } from '../soldi.js';
import { squadra } from '../assistenza.js';
import { errore } from '../http.js';

// i paesi dove Stripe accetta i trasferimenti di una piattaforma europea (separate charges and transfers, senza on_behalf_of): lo
// Spazio economico europeo, il Regno Unito, la Svizzera, gli Stati Uniti e il Canada (https://docs.stripe.com/connect/cross-border-payouts).
// Altrove Stripe non versa: lì restano la crypto o il bonifico
export const PAESI_STRIPE = ['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IS', 'IT', 'LV', 'LI', 'LT', 'LU', 'MT', 'NL', 'NO',
  'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'GB', 'CH', 'US', 'CA'];

export function rotteStripe(c) {
  const { cfg, db, h, stripe, notifiche } = c;
  return {
    'POST /api/stripe/collega': async (req, res, { io }) => {
      c.serve(io); let conto = io.stripe;
      // chi gestisce la piattaforma incassa sul conto Stripe della piattaforma (vedi versaQuote in soldi.js): un altro conto non serve
      if (squadra(db, cfg).includes(io.id)) throw errore(400, 'Le tue parti restano sul conto Stripe della piattaforma: non serve collegarne un altro');
      const x = await h.json(req).catch(() => ({}));
      // il paese del conto è quello dove vive (o ha sede) chi riceve: Stripe lo verifica, e dopo non si cambia. «Per conto»
      // (on_behalf_of) i trasferimenti fra paesi non si fanno: solo STRIPE_PAESE
      const paesi = cfg.stripe.perConto ? [cfg.stripe.paese] : PAESI_STRIPE;
      const voluto = String(x?.paese || '').toUpperCase(), paese = voluto || cfg.stripe.paese;
      if (!paesi.includes(paese)) throw errore(400, 'Stripe non versa ancora in questo paese: per ricevere la tua parte collega un wallet (crypto)');
      if (conto && voluto && !io.stripe_pronto) {   // un conto aperto nel paese sbagliato e non ancora compilato: se ne apre uno nuovo
        const a = await stripe.get(`/v1/accounts/${encodeURIComponent(conto)}`);
        if (a.country && a.country !== paese && !a.details_submitted) conto = null;
      }
      if (!conto) {
        // «per conto» l'installatore è il venditore davanti al cliente: serve anche la capacità di accettare carte
        const capacita = { transfers: { requested: true }, ...(cfg.stripe.perConto ? { card_payments: { requested: true } } : {}) };
        // un conto come gli Express, scritto con le proprietà «controller» (il campo «type» è superato): pannello Express, onboarding
        // di Stripe, commissioni e perdite a carico della piattaforma. Con i pagamenti divisi (separate charges and transfers) le perdite
        // dei conti connessi sono per forza della piattaforma: Stripe lo fa accettare una volta nel profilo della piattaforma
        // (dashboard.stripe.com/settings/connect/platform-profile), altrimenti rifiuta la creazione del conto.
        const a = await stripe.post('/v1/accounts', { controller: { stripe_dashboard: { type: 'express' }, fees: { payer: 'application' }, losses: { payments: 'application' } }, country: paese, ...(io.email ? { email: io.email } : {}), capabilities: capacita,
          business_profile: { product_description: `Installazione e assistenza di software open source tramite ${cfg.nome}` }, metadata: { utente: io.id } }, { idempotenza: paese === cfg.stripe.paese ? `conto-${io.id}` : `conto-${io.id}-${paese}` });
        conto = a.id; db.prepare('UPDATE utente SET stripe = ?, stripe_pronto = 0 WHERE id = ?').run(conto, io.id);
      }
      // dentro l'area: la pagina carica Connect.js e chiede la sessione del conto qui sotto. Senza la chiave pubblicabile, o se lo
      // script di Stripe non si carica (un blocco degli annunci), si va sulla pagina di Stripe e si torna all'area
      if (x?.incorporato && cfg.stripe.pubblica) return h.rispondi(res, 200, { incorporato: true, pubblica: cfg.stripe.pubblica });
      const l = await stripe.post('/v1/account_links', { account: conto, type: 'account_onboarding', refresh_url: `${cfg.url}/area?stripe=rinnova#soldi`, return_url: `${cfg.url}/area?stripe=fatto#soldi` });
      h.rispondi(res, 200, { url: l.url });
    },
    // la sessione dei componenti incorporati (https://docs.stripe.com/connect/get-started-connect-embedded-components): Connect.js la
    // chiede all'apertura e di nuovo quando scade. Vale solo per il conto di chi è dentro: l'attivazione (identità, IBAN, termini di
    // Stripe) e la gestione del conto, dove si cambia l'IBAN. Con i conti Express la prima volta Stripe chiede di confermare chi sei
    // in una sua finestrella (un codice via SMS o email): non si può togliere finché i dati li raccoglie Stripe
    'POST /api/stripe/sessione': async (req, res, { io }) => {
      c.serve(io); if (!io.stripe) throw errore(400, 'Collega prima il conto');
      const s = await stripe.post('/v1/account_sessions', { account: io.stripe, components: {
        account_onboarding: { enabled: true, features: { external_account_collection: true } },
        account_management: { enabled: true, features: { external_account_collection: true } } } });
      h.rispondi(res, 200, { client_secret: s.client_secret });
    },
    'POST /api/stripe/pannello': async (req, res, { io }) => {
      c.serve(io); if (!io.stripe) throw errore(400, 'Collega prima il conto');
      h.rispondi(res, 200, { url: (await stripe.post(`/v1/accounts/${io.stripe}/login_links`, {})).url });
    },
    'POST /api/stripe/webhook': async (req, res) => {
      const corpo = await h.corpoGrezzo(req, 1024 * 1024);
      if (!cfg.stripe.firme.some(f => verificaFirma(corpo, req.headers['stripe-signature'], f))) throw errore(400, 'firma non valida');
      let ev; try { ev = JSON.parse(corpo); } catch { throw errore(400, 'JSON non valido'); }
      try { h.rispondi(res, 200, { ricevuto: true, esito: await gestisciEvento(ev, { db, cfg, stripe, notifica: notifiche.notifica, email: notifiche.email }) }); }
      catch (e) { db.prepare('DELETE FROM evento WHERE id = ?').run(ev.id); throw e; }   // Stripe lo rimanda: si riprova da capo
    },
  };
}
