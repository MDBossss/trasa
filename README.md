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
8. **Otvori sobu**: po zidu učitaj fotku s mobitela. Na gornjem rubu zida alat sam nacrta gdje koji bužir izlazi iz deke (projekcija kraja trase na najbliži zid). Izlaz se može povući lijevo-desno po fotki (korak 1 cm), što pomiče kraj bužira i na tlocrtu. Prozirnost tlocrta je slider u sidebaru.

Layout: alati u lijevoj traci (ikone + prečaci), datotečne akcije u meniju ☰, zoom/undo i grid/snap prekidači kao HUD na platnu (+ − 0 G), desni panel sa svojstvima odabira, listom bužira i soba te sklopivim setupom tlocrta po koracima. Kotačić zumira, Space + vučenje pomiče.

## Sljedeće

- ispravljanje fotke zida (4 kuta → pravokutnik u metrima)
- elementi na zidu: razvodna kutija, utičnica, prekidač, svjetlo, ormar, s visinama
- kabeli po zidu od izlaza bužira do kutije
- strujni krugovi i tablica ormara, BOM u metrima, checklist izvedbe, PDF export po sobi
