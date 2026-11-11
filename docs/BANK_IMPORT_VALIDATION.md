# ARA Accounting — Bank Import Validation (Suriname)

## Principles

- **No compatibility claim without a real file.** ARA Accounting does not say it supports a bank's format until a real
  export from that bank has been validated. No sample statements were made up; the synthetic files in the automated
  tests only exercise the parser, and they say so.
- **Configurable formats.** Every bank account has its own column layout. It covers:
  - the delimiter `;`, `,` or tab, and a header line;
  - the date format (DD-MM-YYYY, DD/MM/YYYY, DD.MM.YYYY, YYYY-MM-DD, MM/DD/YYYY);
  - the decimal separator;
  - either one signed amount column, or separate debit and credit columns;
  - description, counterparty, counterparty account and reference columns.

  A local account number is enough; IBAN is not used.
- **Format library.** Platform administrators keep reusable formats per bank. Customers can apply a *validated* format
  to their account in one step (Bank en kas → account → *Kolomindeling*) or set the layout themselves.
- **Privacy.** A validation sample is read in memory and **not stored**. Only its SHA-256, the line count, the period and
  the totals are kept as evidence.

## Banks for which a sample is requested

The owner confirms this list (OWNER_ACTION_REGISTER O7). The status per bank is shown in Platformbeheer → Bankformaten.

| Bank | Status |
| --- | --- |
| De Surinaamsche Bank (DSB) | no sample |
| Hakrinbank | no sample |
| Finabank | no sample |
| Republic Bank (Suriname) | no sample |
| Southern Commercial Bank | no sample |
| Volkscredietbank | no sample |
| Godo | no sample |

## What to collect per bank

1. A **CSV export** from internet banking for one month, unmodified. Do not open and re-save it in Excel; that changes
   dates and decimals.
2. The **statement for the same period** (PDF or paper), with the number of transactions, total credited and total
   debited.
3. The **encoding**, if known. The importer expects UTF-8; the validator warns when a file is not UTF-8.

If a bank only offers PDF, Excel (.xlsx) or MT940 exports, record that in the format's notes. Those formats are not
supported yet and would be a development item.

## Validating (in the application)

Platformbeheer → **Bankformaten**:

1. **Formaat toevoegen**: bank, format name, column layout (columns count from 0).
2. **Beheren → Valideren met een echt bestand**:
   - upload the CSV;
   - enter the line count, total credited and total debited from the bank's statement;
   - confirm it is a real, unmodified export.
3. The outcome:
   - The format becomes **Gevalideerd** only when the file parses without errors **and** the three figures match exactly.
   - A parse error names the line.
   - A mismatch shows which figure differs and what was read.
4. Changing the layout of a validated format sets it back to *Niet gevalideerd*.

## Validating offline (shell)

```bash
npm run bank:validate -- profile.json export.csv 42 125000.00 98765.43
```

`profile.json` contains the column layout, for example:

```json
{ "delimiter": ";", "hasHeader": true, "dateColumn": 0, "dateFormat": "DD-MM-YYYY", "amountColumn": 3,
  "decimalSeparator": ",", "descriptionColumn": 1, "referenceColumn": 2 }
```

The script prints only counts, dates and totals; it never prints transaction text.

## After validation

- Import the same file in a test administration (Bank en kas → *Afschrift importeren*). Enter the statement's closing
  balance so the reconciliation check runs.
- Test duplicate detection: import an overlapping second month; the lines already imported must be skipped.
- Record any bank-specific quirk in the format notes (for example "export includes a balance line at the end; delete it").
