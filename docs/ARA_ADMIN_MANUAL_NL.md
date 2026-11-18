# ARA Admin Portal — Handleiding beheer

Voor medewerkers van ARA Intelligent Solutions. Het Admin Portal is de centrale omgeving om klanten, verkoop,
abonnementen, betalingen en de eigen financiën van ARA te beheren. Bijbehorende handleidingen:

- [CRM](ARA_CRM_MANUAL_NL.md);
- [Facturatie en abonnementen](ARA_BILLING_MANUAL_NL.md);
- [Financiën](ARA_FINANCE_MANUAL_NL.md).

## 1. Hoe het in elkaar zit

- ARA heeft een **eigen organisatie** in ARA Accounting (de "ARA-thuisorganisatie"), met een eigen bedrijf en een eigen
  administratie.
- **Klanten, offertes, abonnementen, betalingen en support** staan in het Admin Portal.
- **Facturen, betalingen, bank, inkoop en het grootboek** van ARA lopen via de gewone boekhoudengine, in ARA's eigen
  administratie. Er is dus één boekhouding en geen tweede systeem.
- De gegevens van ARA zijn volledig gescheiden van die van klanten. Een klant ziet nooit gegevens van ARA of van andere
  klanten.

## 2. Eerste inrichting (eenmalig)

1. Een **platformbeheerder** (ingesteld via `PLATFORM_ADMIN_EMAILS`) opent `/admin`.
2. Zolang ARA's organisatie nog niet bestaat, verschijnt **ARA Admin inrichten**. Vul in:
   - de naam van de organisatie en van het bedrijf;
   - de rechtsvorm;
   - de basisvaluta;
   - het eerste boekjaar;
   - of ARA BTW-plichtig is.
3. Klik op **ARA-organisatie inrichten**. Het systeem maakt aan:
   - de organisatie, het bedrijf en de administratie;
   - het standaard rekeningschema, met opbrengstrekeningen (8110–8140) en de kostenrekeningen software (4130) en
     hosting (4140);
   - de productcatalogus (ARA Accounting, ARA Payroll, ARA Belastingaangifte, implementatie, onboarding, support,
     consultancy) **zonder prijzen**.
4. U wordt **ARA Super Administrator**.

## 3. Toegang en rollen

Open het portaal via **ARA Admin** rechtsboven in ARA Accounting, of ga naar `/admin`.

| Rol | Mag |
| --- | --- |
| ARA Super Administrator | alles, ook medewerkers en instellingen |
| ARA Administrator | alles behalve medewerkers en organisatie-instellingen |
| Financieel manager | boekhouding, facturen, betalingen bevestigen, abonnementen, rapportages |
| Salesmanager | CRM, producten, offertes, conceptfacturen, abonnementen aanmaken |
| CRM-manager | CRM, conceptoffertes, support |
| Supportmedewerker | support; klanten inzien |
| Medewerker alleen lezen | alles inzien, niets wijzigen |

**Medewerkers** (menu *Medewerkers*): nodig iemand uit met naam, e-mail en rol. Zonder e-mailinstelling verschijnt de
uitnodigingslink eenmalig; geef die zelf door. Een rol wijzigen of iemand uitschakelen gaat in dezelfde tabel.

**Verificatie in twee stappen** is verplicht voor de beheerders- en financiële rollen. Na 7 dagen kunt u zonder MFA
niet meer verder in het portaal.

## 4. Dashboard

Alle cijfers komen rechtstreeks uit de administratie. Drie begrippen staan bewust apart:

| Begrip | Betekenis |
| --- | --- |
| **Gefactureerd** | geboekte verkoopfacturen min creditnota's (factuurdatum) |
| **Ontvangen** | betalingen van klanten in bank en kas (betaaldatum) |
| **Boekhoudkundige omzet** | opbrengsten in het grootboek van het boekjaar (alleen geboekte posten) |

Verder ziet u:

- klanten (totaal, actief, nieuw);
- abonnementen per status;
- **MRR/ARR per valuta**: actieve abonnementen, per maand omgerekend en niet tussen valuta omgezet;
- openstaande en vervallen bedragen;
- kosten en bedrijfsresultaat;
- de kaspositie;
- grafieken van de laatste 12 maanden;
- open taken en recente activiteit;
- een lijst **Aandacht nodig**: betalingen die op bevestiging wachten, conceptfacturen, open tickets en verlopen
  proefperiodes.

## 5. Klantportaal ("Mijn ARA-account")

Klanten met een eigen ARA Accounting-account zien onder **Mijn ARA-account**:

- hun abonnementen;
- hun definitieve facturen (PDF) en de betaalstatus;
- hun offertes (PDF);
- support.

Voorwaarden:

1. De klant is in het CRM **gekoppeld** aan zijn ARA Accounting-organisatie: klantprofiel → *ARA Accounting-account*
   → organisatie-ID uit Platformbeheer → Organisaties.
2. Alleen een **beheerder** van de klantorganisatie (eigenaar of kantoorbeheerder) kan offertes accepteren of afwijzen.
3. Een betaling verschijnt pas als *betaald* nadat ARA haar heeft **bevestigd** (zie de facturatiehandleiding).

## 6. Instellingen

Onder **Instellingen** vindt u:

- de koppelingen naar ARA's eigen boekhouding: administratie-instellingen (inkoopgoedkeuring, koersbeleid),
  rekeningschema, BTW-codes en bedrijfsgegevens. Die laatste staan op offertes en facturen;
- de status van documentopslag (Supabase Storage of database) en e-mail;
- pakketten en productiegereedheid in Platformbeheer.

**Documenten** (contracten, betalingsbewijzen, klantdocumenten):

- toegestaan zijn PDF, JPG of PNG tot 20 MB;
- met Supabase ingesteld staan ze in een **private bucket**, anders in de database;
- downloaden kan alleen via het portaal, en elke download wordt vastgelegd.

## 7. Wat het systeem nooit doet

- Een betaling als ontvangen tonen zonder bevestiging door een medewerker.
- Een klant automatisch opschorten omdat een betaling ontbreekt of nog niet is geverifieerd.
- Prijzen, BTW-tarieven of bankkoppelingen verzinnen.
- Een geboekte factuur wijzigen of verwijderen; corrigeren gaat met een creditnota.
