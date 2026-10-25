# Il marchio Repobay

**L'idea: la porta del negozio.** Un architrave spesso, come l'insegna sopra l'ingresso, due stipiti, e dentro, a terra, il quadrato: il programma che entra nell'attività. La porta è il cliente (il bar, il negozio, il salone), il quadrato è il software open source che ci arriva. Niente lettere, niente sfumature.

## I file

| File | Cosa | Dove si usa |
|---|---|---|
| `simbolo.svg` | il segno: porta inchiostro, prodotto viola | su carta e fondi chiari (testata del sito) |
| `simbolo-chiaro.svg` | porta bianca, prodotto viola chiaro | su notte e fondi scuri (piede del sito) |
| `simbolo-mono.svg` | un colore solo, `currentColor` | in linea nelle pagine, dove prende il colore del testo |
| `simbolo-mono-nero.svg`, `-bianco.svg`, `-viola.svg` | un colore solo, fisso | stampa, timbri, ricami |
| `simbolo-piatto.svg`, `icona-512.png`, `icona-1024.png` | la tessera: fondo viola, segno bianco | favicon (`web/icona.svg`), icone delle app, segnalibri |
| `simbolo-piatto-notte.svg`, `icona-notte-512.png` | la tessera su fondo inchiostro | dove il viola stona con lo sfondo |
| `avatar.svg`, `instagram-1080.png` | la tessera senza angoli, segno più piccolo | foto profilo sui social: regge il ritaglio tondo |
| `logo.svg`, `logo.png` | la firma orizzontale: segno + parola | intestazioni, documenti, presentazioni |
| `logo-chiaro.svg`, `logo-chiaro.png` | la firma orizzontale su scuro | video, piede delle email scure |
| `logo-mono.svg` | la firma in un colore solo (`currentColor`) | stampa in un colore, filigrane |
| `logo-impilato.svg`, `-chiaro.svg`, `.png` | la firma impilata: segno sopra, parola sotto | spazi quadrati, copertine, adesivi |

La parola è **Mona Sans**, peso 800, larghezza 110, spaziatura −0,025 em, tracciata come contorni: i file non dipendono da nessun carattere installato. Le maiuscole della parola sono alte come la luce della porta: il bordo superiore delle lettere è sull'intradosso dell'architrave, la base è sulla soglia.

## Colori

| Nome | Valore | Uso |
|---|---|---|
| Viola del marchio | `#6D3BFF` | il prodotto, le tessere, le azioni del sito |
| Inchiostro | `#15112B` | la porta su chiaro, i fondi notte |
| Viola di notte | `#8B63FF` | il prodotto sui fondi scuri (più chiaro, per il contrasto) |
| Bianco | `#FFFFFF` | la porta sui fondi scuri e sulle tessere |

## Regole

- **Aria intorno:** almeno quanto lo spessore dell'architrave (22 unità su 100), da ogni lato.
- **Misura minima:** il segno 16 px, la tessera 16 px, la firma orizzontale 90 px di larghezza.
- **Non si fa:** cambiare le proporzioni, inclinare, aggiungere ombre o sfumature, mettere il segno dentro altri cerchi o cornici, usare colori fuori dalla tabella, ricomporre la parola con un altro carattere.
- **Su fotografie:** la tessera, mai il segno nudo.

Generato da `strumenti/marchio/logo.py`; per rifare i file serve il carattere variabile Mona Sans (licenza OFL, github.com/github/mona-sans).
