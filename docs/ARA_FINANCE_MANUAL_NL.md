# ARA Admin — Handleiding financiën

De eigen financiële administratie van ARA Intelligent Solutions is **een eigen administratie in de boekhoudengine**,
volledig gescheiden van klantadministraties. Alle functies van ARA Accounting zijn er beschikbaar: grootboek, BTW,
periodes, jaarafsluiting en jaarrekening.

## 1. Inkomsten

| Soort | Waar het vandaan komt | Opbrengstrekening (standaard) |
| --- | --- | --- |
| Abonnementen | facturatierun en abonnementsfacturen | 8110 Opbrengst software-abonnementen |
| Implementatie en onboarding | offertes → facturen | 8120 |
| Support en dienstverlening | offertes, abonnementen | 8130 |
| Consultancy | offertes → facturen | 8140 |
| Overig | vrije factuurregels | 8090 Overige opbrengsten |

De rekening per product stelt u in onder *Producten en diensten*. Rekeningnummers en namen kunt u aanpassen in het
rekeningschema van ARA's administratie.

## 2. Uitgaven

*Uitgaven* → **Uitgave registreren**:

- de leverancier, de **kostensoort**, het factuurnummer van de leverancier, de datum, de omschrijving, de valuta, het
  bedrag excl. BTW en de BTW-code.

| Kostensoort | Rekening |
| --- | --- |
| Software-abonnementen | 4130 |
| Hosting en infrastructuur | 4140 |
| Marketing | 4400 |
| Salarissen | 4010 |
| Professionele diensten | 4700 |
| Kantoorkosten | 4200 |
| Bankkosten | 9020 |
| Overige bedrijfskosten | 4900 |

- De uitgave wordt een **inkoopfactuur**. Staat inkoopgoedkeuring aan (standaard), dan wacht ze onder *Inkoop* op
  goedkeuring door een collega (functiescheiding). Daarna wordt ze geboekt en betaald.
- Staat inkoopgoedkeuring uit, dan wordt de uitgave direct geboekt; met *Direct betaald van* boekt het systeem ook de
  betaling.
- Leveranciers legt u aan onder *Relaties* in de boekhouding. Bonnetjes en facturen scannen kan met **ARA Scan**.

## 3. Bank en kas

*Bank en kas* toont de rekeningen van ARA met:

- het saldo;
- het aantal regels dat nog verwerkt moet worden;
- de laatste import.

**Verwerken** opent de boekhouding met ARA's administratie. Daar:

1. **CSV-import** van het afschrift. Dubbele imports worden geweigerd, en elke regel blijft herleidbaar tot het
   bestand.
2. **Koppelen** van regels aan facturen. Het systeem doet voorstellen.
3. **Boeken** van regels op een rekening (bijv. bankkosten), of **negeren** met een reden.
4. **Aansluiten** (reconciliatie) per periode-einde, met goedkeuring.
5. Overboekingen tussen eigen rekeningen en het **kasboek**.

Een bankformaat is pas *gevalideerd* als het met een echt afschrift is getest (Platformbeheer → Bankformaten).

## 4. Financieel overzicht en rapportages

**Financiën** toont:

- opbrengsten en kosten uit het grootboek, het bedrijfsresultaat met marge, en de kaspositie;
- te ontvangen (debiteuren) en te betalen (crediteuren);
- gefactureerd en ontvangen;
- de kasstroom per maand;
- de winst-en-verliesrekening van het jaar.

**Rapportages**: kies het rapport en het jaar. Elk rapport kunt u exporteren als **PDF** of **Excel (CSV)**; elke export
wordt vastgelegd. Beschikbaar:

- omzet per maand (gefactureerd excl./incl. BTW, ontvangen);
- omzet per product/opbrengstrekening en per klant;
- terugkerende omzet (MRR/ARR per product en valuta);
- klant- en abonnementsgroei;
- openstaande en vervallen facturen;
- incasso en betaalgedrag (gemiddeld aantal dagen tot betaling, te laat betaald);
- kostenanalyse per rekening en maand;
- kasstroom;
- winst-en-verliesrekening;
- abonnementsverloop (churn);
- conversie van proef naar betaald.

De volledige jaarstukken (balans, kasstroomoverzicht, kengetallen), BTW-aangiftes, de jaarafsluiting en de jaarrekening
van ARA maakt u in de boekhouding: *Volledige rapportage* opent die met ARA's administratie.

## 5. Valuta en periodes

- Bedragen in de overzichten staan in de **basisvaluta** van ARA's administratie (standaard SRD).
- Facturen en betalingen in USD of EUR worden omgerekend met de koers volgens het koersbeleid.
- MRR wordt per valuta getoond, zonder omrekening.
- Periodes en boekjaren beheert u in ARA's administratie (*Instellingen* → administratie-instellingen). Een afgesloten
  periode accepteert geen boekingen meer.
