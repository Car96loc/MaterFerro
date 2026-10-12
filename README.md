# Master Ferro

Inventory and POS hosted on GitHub Pages, synchronized with Cloud Firestore.

## Access

Open https://car96loc.github.io/MaterFerro/ and request an email sign-in link
for carzunsan@gmail.com. Open the link on the device where you want to work.
Firebase retains the session in that browser. Use the sign-out icon to end it.
Only that verified email can read or edit inventory and sales.

## Data

The Firebase project is `ferromaster-pos`. Shared collections are:

- `artifacts/ferromaster-pos/public/data/inventory`
- `artifacts/ferromaster-pos/public/data/sales`

Existing Firestore records are retained. An empty collection stays empty.
Browser-local records from the old implementation are not automatically imported
because they may be outdated or include previously deleted products.
Writes require an authenticated session and a connection. The status indicator
distinguishes cached/pending changes from server-confirmed synchronization.
Sales and returns use Firestore transactions to update stock and sales together.

## Validation

Run `node --test firebase-sync.test.cjs`.
The tests mock the Firebase SDK; a two-device sign-in check remains necessary
to verify the complete browser and email delivery flow.

Deploy the included rules with:

```sh
firebase deploy --only firestore:rules --project ferromaster-pos --account carzunsan@gmail.com
```

Firebase Authentication must have email-link sign-in enabled and
`car96loc.github.io` in its authorized domains. These settings and the rules
were applied during setup.
