# ARA Admin — Handleiding facturatie, abonnementen en betalingen

## 1. Verkoopfacturen

ARA's facturen zijn gewone facturen in ARA's eigen administratie: genummerd, geboekt en onveranderlijk.

- **Overzicht** (*Verkoopfacturen*): filter op concepten, openstaand, vervallen of betaald, en zoek op nummer of klant.
- **Status**:

  | Status | Betekenis |
  | --- | --- |
  | Concept | nog niet ingediend |
  | Ter goedkeuring | wacht op goedkeuring |
  | Goedgekeurd | klaar om te boeken |
  | Geboekt | definitief nummer gekregen |
  | Verstuurd | geboekt en als verstuurd geregistreerd |
  | Deels betaald | gedeeltelijk betaald |
  | Betaald | volledig betaald |
  | Vervallen | over de vervaldatum en nog open |
  | Creditnota | correctiefactuur |

- **Acties** op een factuur:
  - ter goedkeuring aanbieden;
  - goedkeuren (niet door wie de factuur maakte);
  - **boeken**: het definitieve, doorlopende nummer en de journaalpost ontstaan pas nu;
  - registreren als verstuurd;
  - een **creditnota** maken.

  Een geboekte factuur wordt nooit verwijderd.
- **Nieuwe losse factuur**: *Nieuwe factuur* opent het verkoopscherm van de boekhouding met ARA's administratie.
- **Rekeningoverzicht** van een klant: *Debiteuren* → *Rekeningoverzichten*.
- **Herinneringen**: de vervallen facturen staan per klant onder *Debiteuren*. Een herinnering stuurt u zelf, per e-mail
  of telefoon; leg haar vast als activiteit in het klantprofiel. Automatische herinneringsmails zijn nog niet gebouwd.

## 2. Abonnementen

**Aanmaken** (*Abonnementen* → *Nieuw abonnement*):

- de klant, een periodiek product, het interval, de prijs (leeg = de standaardprijs van het product), de valuta, het
  aantal en de startdatum;
- een **proefperiode** in dagen;
- een **pakket**. Een abonnement met een pakket stuurt de rechten van het ARA Accounting-account van de klant aan
  (pakket en status), mits het klantprofiel gekoppeld is.

**Beheren** per abonnement (alles met een verplichte reden, en vastgelegd in de geschiedenis):

- **Wijzigen** (upgrade of downgrade): ander product, pakket, prijs, interval of aantal. Dit geldt vanaf de volgende
  factuurperiode. Er wordt niet pro rata gerekend; een eventueel verschil factureert u apart.
- **Activeren** (van proef naar betaald): pas wanneer de klant heeft getekend. Een proefperiode wordt **nooit
  automatisch** omgezet naar betaald.
- **Opschorten / heractiveren / opzeggen**: altijd een bewuste beslissing. Het systeem schort een klant **nooit
  automatisch** op vanwege een ontbrekende of nog niet geverifieerde betaling.

## 3. Periodieke facturatie (facturatierun)

*Abonnementen* → **Facturatierun starten** (met een datum "factureren t/m"):

- Voor elk actief abonnement waarvan de factuurdatum is bereikt, ontstaat een **conceptfactuur** per periode, met de
  periode in de omschrijving.
- **Nooit dubbel.** Elke periode wordt in dezelfde transactie als de factuur vastgelegd. Een tweede run, of twee runs
  tegelijk, factureren dezelfde periode niet opnieuw.
- Een achterstand wordt ingehaald, tot 12 periodes per run.
- Proefabonnementen worden niet gefactureerd. Een verlopen proefperiode wordt gemeld (*Aandacht nodig* op het dashboard).
- De conceptfacturen volgen daarna de gewone goedkeuring en boeking.

## 4. Betalingen

**Registreren** (*Betalingen* → *Betaling registreren*):

- de klant, de wijze (bankoverschrijving, contant, anders) en de bank- of kasrekening;
- de datum, het bedrag, de referentie en eventueel de koers;
- optioneel **toewijzingen** aan openstaande facturen, ook gedeeltelijk of verdeeld over meerdere facturen.

De betaling staat dan **in afwachting**: er is nog niets geboekt en geen factuur is veranderd.

**Bevestigen** (Financieel manager):

1. Controleer de betaling op het **bankafschrift**, of tel het contante geld.
2. Vul bij *Verificatie* in waar u dat zag, bijv. "DSB afschrift 14-11 regel 7". Voeg eventueel een betalingsbewijs toe.
3. *Bevestigen en boeken*:
   - de betaling wordt geboekt (bank aan debiteur);
   - de toewijzingen worden toegepast en facturen worden *Betaald* of *Deels betaald*;
   - een **niet-toegewezen** rest blijft staan als vooruitbetaling.

**Daarna**:

- **Toewijzen**: verdeel een niet-toegewezen rest later over een openstaande factuur van dezelfde klant.
- **Terugbetalen**: betaal een (deel van een) niet-toegewezen rest terug, vanaf een bank- of kasrekening. Dit wordt
  geboekt.
- **Mislukt**: een gemelde betaling die niet binnenkomt, markeert u als *Mislukt* (met reden). Er wordt niets geboekt.

ARA bewaart **geen kaartgegevens**. Koppelingen met betaalproviders zijn voorbereid, maar niet gebouwd. Betalingen via
de bankimport (*Bank en kas* in de boekhouding) koppelt u daar aan facturen; ze tellen ook mee in de dashboards.

## 5. Debiteuren

*Debiteuren* toont per klant en valuta wat openstaat, met ouderdom (niet vervallen, 1–30, 31–60, 61–90, > 90 dagen).
Niet-toegewezen betalingen staan er als negatieve bedragen in.
