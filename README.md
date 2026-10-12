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

## Hosting: Cloudflare, projekti u GitHub repou (šifrirano)

- App: https://trasa.trasa-auth.workers.dev/ (Cloudflare Workers static assets; `pnpm deploy` = build + `wrangler deploy`).
  GitHub Pages nije korišten jer su Actions na računu zaključani zbog naplate.
- Projekti: gumb **GitHub** sprema u `projects/<slug>/project.json.enc` + `img/*.enc` u repo `mdbossss/trasa`. Repo je javan,
  pa se sve šifrira na uređaju (AES-GCM, PBKDF2 iz lozinke) prije slanja; bez lozinke datoteke u repou nisu čitljive.
  Istu lozinku upišeš na svakom uređaju.
- Prijava: gumb **Prijavi se GitHubom** u GitHub panelu. Tok ide preko Cloudflare Workera u `auth-worker/`
  (https://trasa-auth.trasa-auth.workers.dev), jer GitHub ne dopušta zamjenu OAuth koda iz preglednika. Worker je
  prvi put otvoren na `/` i tamo se jednim klikom registrira GitHub App "Trasa" (manifest tok, pravo Contents: write),
  pa se instalira na repo. Tokeni (8 h + refresh) ostaju u localStorageu uređaja; worker ih osvježava.
  Deploy workera: `cd auth-worker && pnpm install && npx wrangler deploy`. Ručni fine-grained token i dalje radi pod "Napredno".

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
   ih pri pomicanju. Klik na **rub zida** završi kabel u kutu: na susjednom zidu se pojavi na istoj visini i tamo ga
   nastaviš drugim kabelom (spojevi i materijal ga prate kroz kut, visinu u kutu mijenjaš u svojstvima). Desno: fotka zida, svojstva
   odabira (tip, oznaka, pozicija, vrsta prekidača, tip kabela, duljina) i lista svega na zidu.
9. **Spojevi** (gumb u headeru): za svaku razvodnu kutiju slika u mjerilu (100 × 100 mm, WAGO 221-412/413/415 s pravim
   dimenzijama, žile u bojama po HD 308) izvedena iz nacrtanog: kabel vezan na kutiju dobije ulogu iz onoga što mu je na
   drugom kraju (utičnica, svjetlo, prekidač, bužir kategorije Dolaz = napajanje, bužir do kutije u drugoj sobi = prolaz),
   a žile se grupiraju na stezaljke L / N / PE / povratna / putne / parkirano. Na prekidaču označi **Pali svjetla** i vrstu
   (obični, tipkalo, serijski, izmjenični, križni); ulogu kabela možeš ručno prepisati. **Korak po korak** vodi žilu po
   žilu (strelice ← →), desno je materijal po kutiji i provjere (kutija bez dolaza, prekidač bez svjetla, premalo žila…).
   Na dozi možeš označiti dubinu (plitka / duboka) za kasnije releje.
10. **Pametna rasvjeta**: **Modularna doza (M)** je okvir (2M–7M) s dubinom; **Tipkalo (T)** i **Relej (R)** se
    postave klikom na dozu/kutiju/nišu i žive u njoj. Relej (Shelly Plus 1 / 2PM / Dimmer Gen3 / i4 / RGBW PM) ima ulaze
    SW i izlaze O: na tipkalu odaberi "Na relej" + ulaz, na svjetlu "Napaja ga" + izlaz. Iz toga aplikacija izvede koliko
    žila kabel između kutije i doze mora nositi (L, N, PE + izlazi), piše to na kabelu ("4 potrebno · 3 ima → uzmi 5×1,5")
    i crta dozu s relejima, tipkalima i kratkim žilama (tipkalo → SW izravno, bez stezaljke). **LED niša (N)**: traka
    (m, W/m, 12/24 V) i napajanje × 1,2; napaja se kao svjetlo. Provjere: relej bez nule, relej u plitkoj dozi, kabel s
    premalo žila, izlaz releja bez kabela do svjetla, klasični prekidač na releju.
11. **Materijal** (header): popis po sobi ili za kuću (kabeli u metrima: zid + bužir + 30 cm rezerve po kraju, bužiri,
    WAGO, doze, oprema, releji, LED). **PDF za majstora**: pregled za ispis po sobi (tlocrt sobe s bužirima, svaki zid s
    elementima i kotama, svaka kutija i doza sa slikom i tablicom stezaljki, releji, materijal, otvorene provjere);
    u dijalogu ispisa odaberi "Spremi kao PDF". U Spojevima gumb **Ispiši kutiju** daje jedan A4 vodoravni list za tu kutiju: gdje je u sobi,
    legenda, kabeli i velika slika spoja.
13. **Mobitel = terenski način** (ekran ≤ 760 px): donja traka Tlocrt / Sobe / Spojevi / Materijal, paneli su
    "sheet" koji se povlači odozdo, kanvas se pomiče jednim prstom i zumira s dva, dodir odabire. Nema alata za
    crtanje (to ostaje na računalu). U Sobama gumb s kamerom slika zid direktno s mobitela; u Spojevima je slika
    spoja preko cijelog ekrana, koraci su ispod nje, stezaljke i materijal u sheetu.
14. **Postavke projekta** (☰ → Postavke projekta…, ili "postavke" uz materijal kutije): spremaju se u save.
    *Rezervne žile u kutiji*: "Presavij i izoliraj" (kapica/traka, broji se u materijalu) ili "Svaka u svoj WAGO"
    (dosadašnje ponašanje; stariji projekti bez postavke ostaju na njemu). PE iz kabela za prekidač uvijek ide na
    zajednički PE u kutiji, u dozi prekidača se presavije. Žila koja u kutiji nema s čime (npr. jedini PE u dozi s
    tipkalom i relejem) u načinu "kapica" dobiva kapicu, ne vlastiti WAGO; kapice se slažu u red uz WAGO-e.
    Materijal je i popis za kupnju: kvačica "nabavljeno" (ostaje na uređaju), podjela po sobama uz stavku, napomena o
    pakiranju (WAGO 50/100, koluti kabela i bužira), "Kopiraj popis" kao tekst i "Preuzmi CSV" za Excel.
12. **Lista bužira**: Svi / Po kategoriji / Po sobama. Bužir pripada sobi ako mu početak ili kraj leži u sobi ili
   najviše 10 cm izvan njezina zida. **Fokus** na sobu sakrije ostale bužire, kamera ostaje gdje je.

## Sljedeće

- Strujni krugovi: osigurači, snaga po krugu, faze, tablica ormara.
- Relej na DC strani LED niše (RGBW PM): nacrtati 24 V spoj, sad je samo u popisu.
- Ispravljanje fotke zida (4 kuta → pravokutnik u metrima), checklist izvedbe.
