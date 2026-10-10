# Trasa

Vizualni plan provlačenja bužira i razvodnih kutija po kući. Radi lokalno u pregledniku,
bez servera: projekt se automatski sprema u IndexedDB, a za backup/prijenos postoji Export/Import JSON.

## Pokretanje

```sh
pnpm install
pnpm dev        # http://localhost:5173
pnpm typecheck
pnpm e2e        # Playwright smoke test protiv dev servera na :5177 (pnpm dev --port 5177)
```

## Rad

1. **Učitaj tlocrt** (gumb ili drag & drop slike).
2. **Mjerilo (C)**: dva klika na poznatu udaljenost, upiši metre. Nakon toga grid je u cm, a duljine u metrima.
3. **Soba (R)**: klikaj kutove, zatvori klikom na prvi kut ili Enterom.
4. **Bužir (B)**: klikaj točke trase kroz deku, Enter ili dupli klik završi. Svaki dobije svoju boju i naziv (B1, B2...). Backspace briše zadnju točku, Esc odustaje.
5. **Odaberi (V)**: klik označi bužir ili sobu, vuci točke, Delete briše. Odabrani bužir je isprekidan.
6. **Otvori sobu**: po zidu učitaj fotku s mobitela. Na gornjem rubu zida alat sam nacrta gdje koji bužir izlazi iz deke (projekcija kraja trase na najbliži zid).

Grid i snap na 45° se mogu isključiti u alatnoj traci. Kotačić zumira, Space + vučenje pomiče.

## Sljedeće

- ispravljanje fotke zida (4 kuta → pravokutnik u metrima)
- elementi na zidu: razvodna kutija, utičnica, prekidač, svjetlo, ormar, s visinama
- kabeli po zidu od izlaza bužira do kutije
- strujni krugovi i tablica ormara, BOM u metrima, checklist izvedbe, PDF export po sobi
