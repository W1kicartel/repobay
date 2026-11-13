-- Pulizia del catalogo, 13/11/2026.
-- 1. Toglie dalla vetrina i prodotti che non si installano e basta: vanno usati per costruire qualcosa.
--    Non si cancellano: restano in bozza, così tornano in vetrina con una riga se si cambia idea.
-- 2. Rimette i nomi veri dei prodotti al posto dei nomi delle cartelle di GitHub.
--    Il nome serve solo a mostrarlo: gli indirizzi usano «slug», i collegamenti a GitHub usano «repo».
-- Prima di lanciarlo: copia del database (vedi strumenti/copia-db.sh o il comando nel LEGGIMI).

BEGIN;

-- 1. fuori dalla vetrina: la descrizione stessa dice «headless», «su misura», «per costruire»
UPDATE prodotto SET stato = 'bozza', nota = COALESCE(NULLIF(nota, ''), 'Tolto dalla vetrina il 13/11/2026: non è un programma da installare e usare, serve per costruirci sopra.')
 WHERE nome IN ('appsmith', 'Sylius', 'saleor', 'payload', 'medusa', 'vendure');

-- 2. i nomi. A sinistra quello che c'era (preso dal repo), a destra il nome con cui il prodotto si presenta.
UPDATE prodotto SET nome = CASE nome
  -- nomi che non dicevano niente a un'azienda
  WHEN 'server'             THEN 'Nextcloud'
  WHEN 'analytics'          THEN 'Plausible'
  WHEN 'wiki'               THEN 'Wiki.js'
  WHEN 'lms'                THEN 'Frappe LMS'
  WHEN 'hrms'               THEN 'Frappe HR'
  WHEN 'grist-core'         THEN 'Grist'
  WHEN 'civicrm-core'       THEN 'CiviCRM'
  WHEN 'openmrs-core'       THEN 'OpenMRS'
  WHEN 'laravel-crm'        THEN 'Krayin CRM'
  WHEN 'postiz-app'         THEN 'Postiz'
  WHEN 'DocumentServer'     THEN 'ONLYOFFICE'
  WHEN 'opensourcepos'      THEN 'Open Source POS'
  WHEN 'joomla-cms'         THEN 'Joomla'
  WHEN 'chamilo-lms'        THEN 'Chamilo'
  WHEN 'anything-llm'       THEN 'AnythingLLM'
  WHEN 'open-webui'         THEN 'Open WebUI'
  WHEN 'firefly-iii'        THEN 'Firefly III'
  WHEN 'jitsi-meet'         THEN 'Jitsi Meet'
  WHEN 'snipe-it'           THEN 'Snipe-IT'
  WHEN 'easyappointments'   THEN 'Easy!Appointments'
  WHEN 'livehelperchat'     THEN 'Live Helper Chat'
  WHEN 'invoiceninja'       THEN 'Invoice Ninja'
  WHEN 'concretecms'        THEN 'Concrete CMS'
  WHEN 'bigbluebutton'      THEN 'BigBlueButton'
  WHEN 'uptime-kuma'        THEN 'Uptime Kuma'
  -- stesso nome, scritto come lo scrive chi lo produce
  WHEN 'activepieces'       THEN 'Activepieces'
  WHEN 'bagisto'            THEN 'Bagisto'
  WHEN 'bigcapital'         THEN 'Bigcapital'
  WHEN 'chatwoot'           THEN 'Chatwoot'
  WHEN 'discourse'          THEN 'Discourse'
  WHEN 'docmost'            THEN 'Docmost'
  WHEN 'documenso'          THEN 'Documenso'
  WHEN 'docuseal'           THEN 'DocuSeal'
  WHEN 'dokuwiki'           THEN 'DokuWiki'
  WHEN 'dolibarr'           THEN 'Dolibarr'
  WHEN 'erpnext'            THEN 'ERPNext'
  WHEN 'espocrm'            THEN 'EspoCRM'
  WHEN 'evershop'           THEN 'EverShop'
  WHEN 'flarum'             THEN 'Flarum'
  WHEN 'formbricks'         THEN 'Formbricks'
  WHEN 'freescout'          THEN 'FreeScout'
  WHEN 'frigate'            THEN 'Frigate'
  WHEN 'gitea'              THEN 'Gitea'
  WHEN 'grav'               THEN 'Grav'
  WHEN 'grocy'              THEN 'Grocy'
  WHEN 'heyform'            THEN 'HeyForm'
  WHEN 'homebox'            THEN 'Homebox'
  WHEN 'immich'             THEN 'Immich'
  WHEN 'kimai'              THEN 'Kimai'
  WHEN 'leantime'           THEN 'Leantime'
  WHEN 'matomo'             THEN 'Matomo'
  WHEN 'mautic'             THEN 'Mautic'
  WHEN 'mealie'             THEN 'Mealie'
  WHEN 'meetily'            THEN 'Meetily'
  WHEN 'metabase'           THEN 'Metabase'
  WHEN 'monica'             THEN 'Monica'
  WHEN 'moodle'             THEN 'Moodle'
  WHEN 'odoo'               THEN 'Odoo'
  WHEN 'ollama'             THEN 'Ollama'
  WHEN 'openemr'            THEN 'OpenEMR'
  WHEN 'openproject'        THEN 'OpenProject'
  WHEN 'paperless-ngx'      THEN 'Paperless-ngx'
  WHEN 'photoprism'         THEN 'PhotoPrism'
  WHEN 'rallly'             THEN 'Rallly'
  WHEN 'rustdesk'           THEN 'RustDesk'
  WHEN 'shlink'             THEN 'Shlink'
  WHEN 'shopware'           THEN 'Shopware'
  WHEN 'spree'              THEN 'Spree'
  WHEN 'twenty'             THEN 'Twenty'
  WHEN 'umami'              THEN 'Umami'
  WHEN 'vaultwarden'        THEN 'Vaultwarden'
  WHEN 'wagtail'            THEN 'Wagtail'
  WHEN 'wekan'              THEN 'Wekan'
  WHEN 'woocommerce'        THEN 'WooCommerce'
  WHEN 'zammad'             THEN 'Zammad'
  WHEN 'zulip'              THEN 'Zulip'
  ELSE nome END;
-- Lasciati come sono, perché si scrivono davvero così: n8n, listmonk, changedetection.io, cal.diy,
-- AppFlowy, BookStack, Ghost, LimeSurvey, NexoPOS, NodeBB, PrestaShop, SuiteCRM, TastyIgniter,
-- InvenTree, InvoicePlane, InvoiceShelf, FOSSBilling.

-- 3. le categorie nuove: chi cerca «automazioni» o «documenti» non le trovava, erano dentro «altro».
UPDATE prodotto SET categoria = 'automazioni' WHERE nome IN ('n8n', 'Activepieces', 'changedetection.io');
UPDATE prodotto SET categoria = 'documenti'   WHERE nome IN ('Paperless-ngx', 'Documenso', 'DocuSeal', 'ONLYOFFICE', 'BookStack', 'Docmost', 'DokuWiki', 'Wiki.js', 'AppFlowy');
UPDATE prodotto SET categoria = 'informatica' WHERE nome IN ('RustDesk', 'Uptime Kuma', 'Vaultwarden', 'Gitea', 'Nextcloud', 'Frigate');
UPDATE prodotto SET categoria = 'gestionale'  WHERE nome IN ('Metabase', 'Grist');

COMMIT;
