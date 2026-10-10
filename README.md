# Trasa

Vizualni plan provlačenja bužira i razvodnih kutija po kući. Radi lokalno u pregledniku,
bez servera: projekt se automatski sprema u IndexedDB, a **Spremi** (Cmd+S) piše `.trasa.json` datoteku
(u Chromeu uvijek u istu datoteku, drugdje kao download) koja uz projekt pamti i gdje si stao. **Otvori** je vraća.

## Pokretanje

```sh
pnpm install
pnpm dev        # http://localhost:5173
pnpm typecheck
pnpm e2e        # Playwright smoke test protiv dev servera na :5177 (pnpm dev --port 5177)
```

## GitHub: app na Pages, projekti u istom repou (šifrirano)

- App: https://mislavvv.github.io/trasa/ (deploy iz `.github/workflows/pages.yml` na push na main, osim promjena u `projects/`).
- Projekti: gumb **GitHub** sprema u `projects/<slug>/project.json.enc` + `img/*.enc` u ovaj isti repo. Repo je javan
  (Pages na besplatnom planu), pa se sve šifrira na uređaju (AES-GCM, PBKDF2 iz lozinke) prije slanja; bez lozinke
  datoteke u repou nisu čitljive. Istu lozinku upišeš na svakom uređaju.
- Token: GitHub → Settings → Developer settings → Fine-grained tokens → samo repo `trasa`, permission
  **Contents: Read and write**. Token i lozinka ostaju u localStorageu tog uređaja.

## Rad

1. **Učitaj tlocrt** (gumb ili drag & drop slike). Gumbi ↺/↻ rotiraju tlocrt po 90°, nacrtano se rotira s njim. Grid pokriva cijelo platno pa se može crtati i izvan slike. Nakrivljen sken: **Nagib slike** u sidebaru (±1°, ±0.1°, upis), **Auto poravnaj** (traži kut pod kojim su zidovi najoštrije poravnati s gridom) ili **Poravnaj (A)**: dva klika duž zida koji treba biti ravan. Nagib pomiče samo sliku, pa poravnaj prije crtanja.
2. **Mjerilo (C)**: dva klika na poznatu udaljenost, upiši metre. Nakon toga grid je u cm, a duljine u metrima.
5. **Soba (R)**: klikaj kutove, zatvori klikom na prvi kut ili Enterom.
6. **Bužir (B)**: klikaj točke trase kroz deku, Enter ili dupli klik završi. Svaki dobije svoju boju i naziv (B1, B2...). Backspace briše zadnju točku, Esc odustaje.
7. **Odaberi (V)**: klik označi bužir ili sobu, vuci cijelu liniju ili pojedine točke, Delete briše. Odabrani bužir je isprekidan. Držanje **Alt** isključuje snap (slobodno pomicanje i crtanje).
8. **Otvori sobu**: zid-view je editor na fotki zida (jedinice cm, x od lijevog kuta gledano iznutra, visina od poda).
   Na gornjem rubu su izlazi bužira iz deke (projekcija kraja trase na najbliži zid); izlaz se vuče po fotki,
   lijevo-desno pomiče kraj bužira i na tlocrtu, gore-dolje postavlja visinu izlaza. Alati: **Kutija (K)**,
   **Utičnica (U)**, **Prekidač (P)**, **Svjetlo (L)**, **Ormar (O)** postavljaju element klikom (snap 1 cm i
   poravnanje s drugim elementima po x i visini; fotka je okvirna, pa nema snapa na apsolutne visine). **Kabel (C)**: klik na izlaz bužira ili element
   počinje, klikovi dodaju vodoravne/okomite lomove, klik na element završava; kabel je vezan za oba kraja i prati
   ih pri pomicanju. Desno: fotka zida, svojstva
   odabira (tip, oznaka, pozicija, vrsta prekidača, tip kabela, duljina) i lista svega na zidu.

## Sljedeće

- ispravljanje fotke zida (4 kuta → pravokutnik u metrima)
- strujni krugovi i tablica ormara, BOM u metrima, checklist izvedbe, PDF export po sobi
