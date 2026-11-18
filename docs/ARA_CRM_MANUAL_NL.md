# ARA Admin — Handleiding CRM, producten, offertes en support

## 1. Klanten en leads

**Eén record van eerste contact tot klant.** Een lead wordt geen kopie wanneer hij klant wordt: hetzelfde record
doorloopt de fases.

| Fase | Betekenis |
| --- | --- |
| Lead | eerste naam of contact |
| Benaderd | er is contact gelegd |
| Gekwalificeerd | er is een concrete behoefte |
| Offerte | er is een offerte verstuurd (wordt automatisch gezet bij het versturen) |
| **Klant** | klant; ARA maakt nu de **debiteur** aan in ARA's administratie |
| Inactief | geen actieve relatie meer |

- **Nieuw**: menu *Klanten* → *Nieuwe klant of lead*. Een record dat direct als *Klant* wordt aangemaakt, krijgt meteen
  een debiteur.
- **CRM-pijplijn**: menu *CRM*. Kolommen per fase; de fase wijzigt u per kaart.
- **Zoeken en filteren**: op naam, nummer (CUS-00001), e-mail, KKF-nummer of contactpersoon; filter op fase,
  accountmanager en categorie.

**Klantprofiel** (klik op de naam):

- gegevens: adres, KKF, fiscaal nummer, accountmanager, betalingstermijn, voorkeursvaluta;
- **contactpersonen**, met één hoofdcontact;
- **activiteiten en communicatie**: notitie, telefoon, e-mail, afspraak of taak (met datum). Activiteiten worden nooit
  verwijderd; een taak rondt u af met *Afronden*;
- offertes, facturen, abonnementen, betalingen, documenten en supporttickets van deze klant;
- **ARA Accounting-account**: koppeling met de eigen organisatie van de klant (voor abonnementsrechten en het
  klantportaal).

Wijzigingen in naam, adres, fiscale gegevens of betalingstermijn worden ook doorgevoerd bij de debiteur in de
boekhouding.

## 2. Producten en diensten

Menu *Producten en diensten*. Per product legt u vast:

- code, naam (NL/EN), categorie en omschrijving;
- **facturatie**: eenmalig, of periodiek met een interval (maand, kwartaal, jaar);
- **standaardprijs** en valuta. Leeg betekent "prijs op aanvraag"; prijzen bepaalt de eigenaar;
- **BTW-code**: kies die pas na advies van de belastingadviseur;
- **opbrengstrekening**: de omzet van het product komt op die rekening;
- **pakket**: welke rechten een abonnement op dit product geeft in ARA Accounting.

Nieuwe producten voegt u toe zonder programmeerwerk. Een product dat niet meer verkocht wordt, zet u op *Inactief*.

## 3. Offertes

1. **Nieuwe offerte** (vanuit *Offertes* of vanaf het klantprofiel):
   - kies de klant en eventueel een contactpersoon;
   - vul de datum, de geldigheid, de valuta en de betalingstermijn in;
   - voeg regels toe, met een product (vult omschrijving, prijs en BTW voor) of als **vrije regel**;
   - per regel: aantal, prijs, **korting %** en BTW-code;
   - optioneel: inleiding, voorwaarden en notities.

   Het nummer (OFF-2026-00001) wordt automatisch toegekend. De totalen worden per regel afgerond, precies zoals op
   facturen.
2. **Versturen**:
   - met e-mail ingesteld: *PDF mailen* naar de klant;
   - zonder e-mail: download de PDF en kies *Handmatig overhandigd*. Het systeem doet nooit alsof er een e-mail is
     verzonden.
3. **Bekeken**: opent de klant de offerte in het klantportaal, dan wordt de status *Bekeken*.
4. **Reactie**: *Geaccepteerd* of *Afgewezen*, met de naam van wie namens de klant besliste. Een klantbeheerder kan dat
   ook zelf in het portaal doen.
5. **Verlopen**: na de geldigheidsdatum wordt een openstaande offerte automatisch *Verlopen*.
6. **Revisie**: wilt u een verstuurde, afgewezen, verlopen of geaccepteerde offerte aanpassen, kies dan *Revisie maken*
   met een reden. De vorige versie blijft bewaard in de revisiegeschiedenis; de offerte wordt weer een concept.
7. **Factureren**: *Omzetten naar conceptfactuur* maakt een conceptfactuur in ARA's administratie, met dezelfde regels,
   kortingen en BTW-codes. De offerte blijft bewaard, met de status *Omgezet naar factuur*. Was de klant nog prospect,
   dan wordt hij nu klant (met debiteur).

## 4. Support

- **Tickets**: menu *Support*. Elk ticket heeft een nummer (TIC-2026-00001), een prioriteit, een status (Open, In
  behandeling, Wacht op klant, Opgelost, Gesloten) en eventueel een toegewezen medewerker.
- Klanten kunnen tickets indienen en erop reageren via **Mijn ARA-account**.
- **Antwoorden**:
  - een gewoon antwoord ziet de klant, en hij krijgt een melding;
  - een **interne notitie** blijft alleen voor ARA zichtbaar.
- Berichten worden nooit gewijzigd of verwijderd.
