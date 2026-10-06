# Linked — scope en ontwikkelverantwoording

Datum: 6 oktober 2026. Team: vier studenten, eerste twee weken van een
ontwikkelperiode van tien weken. Acht weken zijn beschikbaar voor vervolg.

## Uitgangspunt

Het team heeft in de opdracht de scope beperkt tot vier user stories.
Het conceptdocument is gelezen als toekomstbeeld: een app en mogelijk
een armband sturen verzoeken naar een centraal punt en vrijwilligers.
Locatie, partnerafspraken en de armbandverbinding zijn daarin nog deels
open vragen. Ze zijn geen vereiste voor de huidige vier stories.

## Analyse vóór de aanpassing

De bestaande app was een lokaal prototype met drie rolweergaven:
gebruiker, vrijwilliger en hulpdesk. Er waren app- en armbanddemo-alerts,
annulering, acceptatie door demo-vrijwilliger Alex, afsluiten door een
demo-hulpdesk, eenmalige geolocatie met toestemming, handmatig ontmoetingspunt,
een kaartlink en localStorage met synchronisatie tussen tabbladen.

De locatieaanvraag was echte browserfunctionaliteit; de hulpverlening en
armband waren simulaties. Er was geen backend of echte ontvanger. Een alert
kreeg meteen status `received`, dus verzenden en ontvangen waren niet
als aparte stappen zichtbaar. Sommige teksten suggereerden een menselijke
reactie, terwijl alleen rollen in dezelfde browser reageerden.

Accounts, profielen, chat, echte armbandverbinding, externe notificaties
en continu live volgen waren niet geïmplementeerd. De tijdelijke toast
was alleen lokale feedback, geen verstuurde notificatie. De rolpagina's
waren eenvoudige demo-overzichten, geen beveiligde operationele dashboards.

## Koppeling aan de vier stories

| Story | Bestaand onderdeel | Keuze voor deze fase |
| --- | --- | --- |
| 1. Webapp openen | Gebruikersweergave in index.html | Eén direct scherm |
| 2. Alertknop drukken | trigger() met duplicaatcontrole | startRequest() |
| 3. Status zien | received/accepted met rolweergaven | Verzonden en demo-ontvangst |
| 4. Alert annuleren | closeAlert() met cancelled | cancelRequest() + bevestiging |

Deze tabel koppelt onderdelen conceptueel. De oude functies zijn vereenvoudigd
tot een kleine statusflow; de uitgebreide code staat op de archiefbranch.

## Wat blijft en wat eenvoudiger wordt

- Dezelfde bestandsstructuur: HTML, CSS, JavaScript en een Node-testbestand.
- De groene kleuren, afgeronde kaarten, leesbare typografie en grote knop.
- De bescherming tegen meerdere actieve verzoeken.
- De mogelijkheid tot annuleren en opnieuw aanvragen.
- Commentaar, korte regels en ondersteuning voor toetsenbordbediening.
- Eén statusvariabele vervangt de alertlijst en drie rolweergaven.
- Vaste HTML-elementen vervangen grote dynamische HTML-templates.
- Een timer van 1,5 seconde simuleert ontvangst, na de status verzonden.
- Geen opslag of synchronisatie: elk tabblad is een eigen lokale demo.

De inactieve knop wordt verborgen én uitgeschakeld. De actie controleert
ook zelf of al een verzoek actief is. Annuleren stopt de timer en wijzigt
een verzoeknummer. Daardoor kan een oude callback geen geannuleerd of
nieuw verzoek alsnog bevestigen. Focus volgt de beschikbare actie.

## Naar een latere fase

De vrijwilligers-/hulpdeskweergaven, demo-acceptatie, afsluiting door een
hulpdesk, armbanddemo, locatieaanvraag, ontmoetingspunt, kaartlink,
alertgeschiedenis en browseropslag zijn verwijderd uit de actieve versie.
Ze zijn terug te vinden in het Git-checkpoint, niet als verborgen actieve
features in deze versie.

Accounts, profielen, chat, echte notificaties en echte hardwarekoppelingen
blijven mogelijke toekomstige onderwerpen. Het team hoeft die niet
automatisch allemaal te bouwen. Uitbreidingen volgen pas uit gekozen
user stories en testresultaten.

## Grenzen van de simulatie

Op verzoek van het team is de volledige productinterface Engelstalig,
inclusief knoppen, statusmeldingen, demo-uitleg en de HTML-taal (`en`).
De Nederlandse codecommentaren en projectdocumentatie blijven behouden.
Codex heeft deze vertaling uitgevoerd en de bestaande flowtests bijgewerkt;
de scope en werking van de flow zijn gelijk gebleven.

Daarna vroeg het team om alleen de productinterface te tonen. De demo-
rondleiding, sessie-uitleg en schoolprojectfooter zijn verwijderd. De pagina
toont nu één hulpkaart. De teksten zijn korter en bevatten geen lange
gedachtestreepjes. Alleen de noodzakelijke demo-aanduiding blijft staan,
zodat de ontvangstsimulatie geen echte hulpverlening suggereert.

`sent` betekent dat het verzoek lokaal in de demo is gestart; er is geen
netwerkverzending. `received` betekent alleen dat de demo-timer is afgelopen,
niet dat een hulpverlener het heeft ontvangen. Beide worden zichtbaar als
demo benoemd. Een vaste uitleg vermeldt dat er geen hulp onderweg is.

Annulering is lokaal. Een toekomstige backend moet annulering en ontvangst
apart bevestigen; de huidige demo is geen bewijs dat die integratie werkt.
Bij herladen verdwijnt de lokale status. Verzoekherstel is buiten scope.

## Git-bewaring

Vóór codewijzigingen is `archive/linked-expanded-prototype` aangemaakt.
Commit `57a6b83` bewaart alle gewijzigde en nieuwe projectbestanden,
inclusief de formatterinstellingen en VS Code-wordwrap.
Daarna is `feature/linked-phase-one-flow` aangemaakt voor deze afbakening.
De oorspronkelijke geschiedenis is behouden; er is geen remote push gedaan.

## Codex als extra ontwikkeltool

Het team formuleerde de context, vier user stories, afbakening en eisen.
Codex las het conceptdocument en de bestaande code, bracht de aanwezige
functionaliteit in kaart, maakte het Git-checkpoint en de aparte branch,
en voerde de vereenvoudiging, codecommentaren, tests en documentatie uit.

Ook de eerdere uitgebreide versie en de eerdere commentaar- en
formatteringswijzigingen zijn met Codex gegenereerd/aangepast. We schrijven
deze implementatie daarom niet toe aan uitsluitend handwerk van studenten.

Deze documentatie legt de opdracht en technische uitvoering vast. Er is
niet aangetoond dat alle vier studenten iedere keuze individueel hebben
beoordeeld, dat partners akkoord zijn of dat eindgebruikers de flow al hebben
getest. Het team moet de code samen doorlopen, keuzes onderbouwen, zelf
testen uitvoeren en echte bevindingen en iteraties aan het logboek toevoegen.

## Uitgevoerde technische controles

- `node app.test.cjs`: alle flowcontroles geslaagd, inclusief dubbele
  klikken, annuleren vóór/na ontvangst en callbacks van oude verzoeken.
- `node --check app.js`: geldige JavaScript-syntax.
- `git diff --check`: geen whitespacefouten.
- Een tijdelijke headless Edge-test met de echte HTML, CSS en app.js:
  openen, aanvragen, verzonden zien, vroeg annuleren, opnieuw aanvragen,
  gesimuleerde ontvangst zien en daarna annuleren.
- Exacte browser-viewports van 320, 390 en 1280 pixels breed:
  geen horizontale overflow en de hulpknop direct in beeld bij 844 pixels
  hoogte. Ook de focusoverdracht naar annuleren en opnieuw aanvragen is
  gecontroleerd. Het tijdelijke browserharnas is daarna verwijderd.

Dit waren technische controles door Codex, geen gebruikerstests met
studenten of de doelgroep en geen fysieke telefoontests. Een handmatig
testscenario voor het team staat in README.md.

## Voorstel voor de overige acht weken

Dit is een voorstel om samen te beoordelen, geen al uitgevoerde planning.

| Periode | Focus | Concreet resultaat |
| --- | --- | --- |
| Week 3–4 | Code doorlopen en basisflow testen met gebruikers | Bevindingen + verbeteringen |
| Week 5–6 | Ontvangende kant ontwerpen en eventueel klein backend-experiment | Aantoonbare ontvangstbevestiging |
| Week 7–8 | Annulering en foutgevallen testen; één uitbreiding kiezen | Geteste flow + onderbouwde scope |
| Week 9–10 | Hertesten, toegankelijkheid en overdracht | Demo, resultaten en procesverantwoording |

Verdeel onderzoek, interface, flow en tests/documentatie over het team,
maar laat elkaar werk uitleggen en reviewen. Bespreek voor een echte
ontvangende kant ook wat gebeurt bij geen verbinding, vertraagde ontvangst
en een mislukte annulering. Beslis pas daarna of bijvoorbeeld locatie nodig
is. Plan hardware en partners alleen als daar tijd en duidelijke afspraken
voor zijn.
