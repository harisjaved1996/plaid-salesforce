# Plaid `transfer/migrate_account` — Developer Reference

## What Is It?

`/transfer/migrate_account` is a Plaid API endpoint that converts a bank account's **routing number and account number** into a Plaid `access_token` and `account_id` — without requiring the user to go through Plaid Link or have a Plaid account.

This is the **only way** to use Plaid Transfer for a recipient (like Usman) who does not use your app or Plaid.

---

## Key Facts

- The recipient does **NOT** need a Plaid account
- The recipient does **NOT** need to use your app
- The recipient does **NOT** go through Plaid Link
- You call this endpoint on the **backend** using the recipient's bank details
- The resulting `access_token` + `account_id` can only be used with **Transfer endpoints** — not with other Plaid products like balance checks
- Access to this endpoint is **not enabled by default** — you must contact your Plaid Account Manager or Plaid Support to enable it

---

## Endpoint

```
POST /transfer/migrate_account
```

---

## Request Fields

| Field | Required | Type | Description |
|---|---|---|---|
| `account_number` | ✅ Yes | string | The user's bank account number |
| `routing_number` | ✅ Yes | string | The user's ACH routing number |
| `wire_routing_number` | ❌ No | string | Wire routing number (ABA number). Required only if you plan to do wire transfers on this account |
| `account_type` | ✅ Yes | string | Either `"checking"` or `"savings"` |

---

## Response Fields

| Field | Description |
|---|---|
| `access_token` | The Plaid access token for the newly created Item — use this in transfer calls |
| `account_id` | The Plaid account ID for the newly created Item — use this in transfer calls |
| `request_id` | Unique identifier for the request (for troubleshooting) |

---

## Code Example (Node.js)

```javascript
const { PlaidApi, Configuration, PlaidEnvironments } = require('plaid');

const configuration = new Configuration({
  basePath: PlaidEnvironments.sandbox,
  baseOptions: {
    headers: {
      'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
      'PLAID-SECRET': process.env.PLAID_SECRET,
    },
  },
});

const plaidClient = new PlaidApi(configuration);

async function migrateAccount(accountNumber, routingNumber, accountType) {
  try {
    const response = await plaidClient.transferMigrateAccount({
      account_number: accountNumber,
      routing_number: routingNumber,
      account_type: accountType, // 'checking' or 'savings'
    });

    const accessToken = response.data.access_token;
    const accountId = response.data.account_id;

    console.log('access_token:', accessToken);
    console.log('account_id:', accountId);

    return { accessToken, accountId };
  } catch (error) {
    console.error('Error migrating account:', error);
    throw error;
  }
}
```

---

## Example Response

```json
{
  "access_token": "access-sandbox-435beced-94e8-4df3-a181-1dde1cfa19f0",
  "account_id": "zvyDgbeeDluZ43AJP6m5fAxDlgoZXDuoy5gjN",
  "request_id": "mdqfuVxeoza6mhu"
}
```

---

## Important Limitations

- Items created via `migrate_account` are **only compatible with Transfer endpoints**
- They **cannot** be used with other Plaid products (e.g., `/accounts/balance/get`, transactions, identity)
- When used in `/transfer/authorization/create`, the response will include a `rationale_code` of `MIGRATED_ACCOUNT_ITEM` — this means the authorization risk check could not be fully run due to limited information. The transfer is still approved and can proceed, but you should perform your own risk assessment
- If you need access to other Plaid products for this account, you must use Plaid Link instead

---

## How It Fits into the Full Haris → Usman Transfer Flow

Plaid Transfer does **not** directly connect two user accounts in a single call. The platform's Ledger/funding account sits in the middle. The full flow requires **two separate transfers**:

### Step 1 — Migrate Usman's Account (one time only)
```javascript
// Call migrate_account with Usman's bank details
const { accessToken: usmanToken, accountId: usmanAccountId } =
  await migrateAccount('100000000', '121122676', 'checking');

// Save usmanToken and usmanAccountId to your database
// You only need to do this ONCE per recipient
```

### Step 2 — Debit Haris (pull $100 from Haris into your platform Ledger)
```javascript
// Authorization
const authResponse = await plaidClient.transferAuthorizationCreate({
  access_token: harisAccessToken,   // Haris's Plaid token (from Plaid Link)
  account_id: harisAccountId,
  type: 'debit',                    // Pull money FROM Haris
  network: 'ach',
  amount: '100.00',
  ach_class: 'web',
  user: { legal_name: 'Haris' },
});

// Transfer
await plaidClient.transferCreate({
  access_token: harisAccessToken,
  account_id: harisAccountId,
  authorization_id: authResponse.data.authorization.id,
  description: 'payment',
});
// → $100 now sits in your platform Ledger
```

### Step 3 — Credit Usman (push $100 from your platform Ledger to Usman)
```javascript
// Authorization
const authResponse2 = await plaidClient.transferAuthorizationCreate({
  access_token: usmanToken,         // Usman's migrated token
  account_id: usmanAccountId,
  type: 'credit',                   // Push money TO Usman
  network: 'ach',
  amount: '100.00',
  ach_class: 'ppd',
  user: { legal_name: 'Usman' },
});

// Transfer
await plaidClient.transferCreate({
  access_token: usmanToken,
  account_id: usmanAccountId,
  authorization_id: authResponse2.data.authorization.id,
  description: 'payment',
});
// → $100 delivered to Usman's bank account
```

### Money Flow Diagram

```
Haris's Bank
    |
    | (Step 2: debit transfer)
    ↓
Your Platform Ledger (Plaid)
    |
    | (Step 3: credit transfer)
    ↓
Usman's Bank  ← account registered via migrate_account
```

---

## When to Call `migrate_account`

- Call it **once per recipient** when you first receive their bank details
- Store the returned `access_token` and `account_id` in your database linked to that recipient
- Reuse the same token for all future transfers to that recipient — no need to call `migrate_account` again

---

## Environment Notes

- In **Sandbox**: Use test values like `account_number: '100000000'` and `routing_number: '121122676'`
- In **Production**: This endpoint must be explicitly enabled by Plaid — contact your account manager
- The `MIGRATED_ACCOUNT_ITEM` rationale code in authorization responses is expected and normal for migrated accounts

---

## Reference

- Official Plaid Docs: https://plaid.com/docs/api/products/transfer/account-linking/#transfermigrate_account
- Transfer Initiation Docs: https://plaid.com/docs/api/products/transfer/initiating-transfers/
