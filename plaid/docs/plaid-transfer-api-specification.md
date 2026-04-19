# Plaid Transfer API - Complete Implementation Specification

## Overview

This document provides complete technical specifications for implementing Plaid's Transfer API. Use this as a reference for building a transfer initiation system that handles authorization, creation, and cancellation of transfers.

---

## Table of Contents

1. [Authentication](#authentication)
2. [API Endpoints](#api-endpoints)
3. [Transfer Authorization](#transfer-authorization)
4. [Transfer Creation](#transfer-creation)
5. [Transfer Cancellation](#transfer-cancellation)
6. [Data Models](#data-models)
7. [Error Handling](#error-handling)
8. [Testing in Sandbox](#testing-in-sandbox)
9. [Implementation Guidelines](#implementation-guidelines)

---

## Authentication

All API requests require authentication using one of the following methods:

### Header-based Authentication
```http
PLAID-CLIENT-ID: your_client_id
PLAID-SECRET: your_secret
```

### Request Body Authentication
```json
{
  "client_id": "your_client_id",
  "secret": "your_secret"
}
```

---

## API Endpoints

### Base URL
- Production: `https://production.plaid.com`
- Development: `https://development.plaid.com`
- Sandbox: `https://sandbox.plaid.com`

### Available Endpoints

1. **POST /transfer/authorization/create** - Create a transfer authorization
2. **POST /transfer/authorization/cancel** - Cancel a transfer authorization
3. **POST /transfer/create** - Create a transfer
4. **POST /transfer/cancel** - Cancel a transfer

---

## Transfer Authorization

### Endpoint: `/transfer/authorization/create`

**Purpose:** Authorize a transfer before creating it. This endpoint must be called prior to `/transfer/create`. Authorization expires after 1 hour if not used.

### Request Schema

```typescript
interface TransferAuthorizationCreateRequest {
  // Required fields
  access_token: string;           // Plaid access_token for the account
  account_id: string;             // Plaid account_id to be debited/credited
  type: 'debit' | 'credit';       // Transfer direction
  network: 'ach' | 'same-day-ach' | 'rtp' | 'wire';  // Payment network
  amount: string;                 // Decimal string with 2 digits precision (e.g., "10.00")
  user: {
    legal_name: string;           // REQUIRED - User's legal name or business name
    phone_number?: string;
    email_address?: string;
    address?: {
      street?: string;            // e.g., "100 Market St."
      city?: string;              // e.g., "San Francisco"
      region?: string;            // State/province (e.g., "CA")
      postal_code?: string;       // e.g., "94103"
      country?: string;           // Two-letter country code (e.g., "US")
    };
  };
  
  // Optional fields
  client_id?: string;             // Can be in header or body
  secret?: string;                // Can be in header or body
  ledger_id?: string;             // Specific ledger balance to use
  ach_class?: 'ccd' | 'ppd' | 'tel' | 'web';  // ACH SEC code
  wire_details?: {
    message_to_beneficiary?: string;  // Max 140 characters
    wire_return_fee?: string;
  };
  device?: {
    ip_address?: string;
    user_agent?: string;
  };
  iso_currency_code?: string;     // Default: "USD"
  idempotency_key?: string;       // Max 50 characters, expires after 48 hours
  user_present?: boolean;         // True if user initiating themselves
  originator_client_id?: string;  // For Platform customers
  test_clock_id?: string;         // Sandbox only
  ruleset_key?: string;           // Closed beta feature
}
```

### ACH Class Codes

- **ccd** - Corporate Credit or Debit: Fund transfer between two corporate bank accounts
- **ppd** - Prearranged Payment or Deposit: Pre-existing relationship with consumer, written authorization obtained
- **web** - Internet-Initiated Entry: Debits consumer's account, authorization obtained online
- **tel** - Telephone-Initiated Entry: Debits consumer, authorization obtained via recorded call

**Supported codes:**
- Credits: `ccd`, `ppd`
- Debits: `ccd`, `tel`, `web`

### Network Types and Details

#### ACH (`ach`)
- Standard ACH cutoff: 8:30 PM Eastern Time
- Use for standard transfers

#### Same Day ACH (`same-day-ach`)
- Same Day ACH cutoff: 3:00 PM Eastern Time
- Recommended to submit 15 minutes before cutoff
- Transaction limit: $1,000,000
- If processed after Same Day cutoff but before Standard ACH cutoff, sent as Standard ACH (no same-day charges)

#### Real-Time Payments (`rtp`)
- Plaid automatically routes between TCH Real Time Payment rail and FedNow
- If counterparty account not eligible for RTP, authorization fails with `INVALID_FIELD` error
- Pre-check eligibility with `/transfer/capabilities/get`

#### Wire (`wire`)
- **Currently in early availability** - contact Account Manager for access
- Type must be `credit` (wire debits not supported)
- Cutoff: 6:30 PM Eastern Time on business days
- Wires submitted after cutoff processed next business day
- Transaction limit: $999,999.99

### Response Schema

```typescript
interface TransferAuthorizationCreateResponse {
  authorization: {
    id: string;                   // Unique authorization identifier
    created: string;              // ISO 8601 datetime (e.g., "2006-01-02T15:04:05Z")
    decision: 'approved' | 'declined' | 'user_action_required';
    decision_rationale: {
      code: 'NSF' | 'RISK' | 'TRANSFER_LIMIT_REACHED' | 
            'MANUALLY_VERIFIED_ITEM' | 'ITEM_LOGIN_REQUIRED' | 
            'PAYMENT_PROFILE_LOGIN_REQUIRED' | 'ERROR' | 
            'MIGRATED_ACCOUNT_ITEM' | null;
      description: string;        // Human-readable explanation
    } | null;
    proposed_transfer: {
      ach_class?: string;
      account_id: string;
      funding_account_id: string | null;
      ledger_id: string | null;
      type: 'debit' | 'credit';
      user: {
        legal_name: string;
        phone_number: string | null;
        email_address: string | null;
        address: {
          street: string | null;
          city: string | null;
          region: string | null;
          postal_code: string | null;
          country: string | null;
        } | null;
      };
      amount: string;
      network: string;
      wire_details?: {
        message_to_beneficiary: string | null;
        wire_return_fee: string | null;
      } | null;
      iso_currency_code: string;
      originator_client_id: string | null;
      credit_funds_source?: string | null;
    };
  };
  request_id: string;
}
```

### Authorization Decision Logic

#### Approved (`approved`)
- **With `decision_rationale: null`**: Transfer passed risk check, proceed with `/transfer/create`
- **With non-null `decision_rationale`**: Risk check couldn't run, perform your own risk assessment before proceeding

#### Declined (`declined`)
- Transfer failed risk check, cannot proceed
- Check `decision_rationale.code` for reason:
  - `NSF`: Insufficient funds
  - `RISK`: High-risk transaction
  - `TRANSFER_LIMIT_REACHED`: Transfer limits exceeded

#### User Action Required (`user_action_required`)
- Additional user input needed (usually to fix broken bank connection)
- Launch Link in update mode
- When calling `/link/token/create`, set `transfer.authorization_id` to the `authorization.id`
- After Link flow completes, re-attempt authorization

### Decision Rationale Codes

**For Approved Transfers (non-null rationale):**
- `MANUALLY_VERIFIED_ITEM`: Item created via manual entry (Same Day Micro-deposit, Instant Micro-deposit, database verification)
- `ITEM_LOGIN_REQUIRED`: Unable to collect account info due to stale Item
- `MIGRATED_ACCOUNT_ITEM`: Item created via `/transfer/migrate_account`
- `ERROR`: Unspecified error preventing account info collection

**For Declined Transfers:**
- `NSF`: Transaction likely to result in insufficient funds return
- `RISK`: High-risk transaction
- `TRANSFER_LIMIT_REACHED`: Monthly or other transfer limit reached

### Example Request

```javascript
const request = {
  access_token: 'access-sandbox-71e02f71-0960-4a27-abd2-5631e04f2175',
  account_id: '3gE5gnRzNyfXpBK5wEEKcymJ5albGVUqg77gr',
  type: 'debit',
  network: 'ach',
  amount: '12.34',
  ach_class: 'ppd',
  user: {
    legal_name: 'Anne Charleston',
  },
};

const response = await client.transferAuthorizationCreate(request);
const authorizationId = response.data.authorization.id;
```

### Example Response

```json
{
  "authorization": {
    "id": "460cbe92-2dcc-8eae-5ad6-b37d0ec90fd9",
    "created": "2020-08-06T17:27:15Z",
    "decision": "approved",
    "decision_rationale": null,
    "proposed_transfer": {
      "ach_class": "ppd",
      "account_id": "3gE5gnRzNyfXpBK5wEEKcymJ5albGVUqg77gr",
      "funding_account_id": "8945fedc-e703-463d-86b1-dc0607b55460",
      "ledger_id": "563db5f8-4c95-4e17-8c3e-cb988fb9cf1a",
      "type": "credit",
      "user": {
        "legal_name": "Anne Charleston",
        "phone_number": "510-555-0128",
        "email_address": "acharleston@email.com",
        "address": {
          "street": "123 Main St.",
          "city": "San Francisco",
          "region": "CA",
          "postal_code": "94053",
          "country": "US"
        }
      },
      "amount": "12.34",
      "network": "ach",
      "iso_currency_code": "USD",
      "originator_client_id": null
    }
  },
  "request_id": "saKrIBuEB9qJZno"
}
```

---

## Transfer Creation

### Endpoint: `/transfer/create`

**Purpose:** Initiate a new transfer after authorization. This endpoint is retryable and idempotent using the `authorization_id` as the idempotency key.

### Request Schema

```typescript
interface TransferCreateRequest {
  // Required fields
  access_token: string;           // Plaid access_token
  account_id: string;             // Plaid account_id
  authorization_id: string;       // From /transfer/authorization/create
  description: string;            // Max 15 chars (RTP) or 10 chars (ACH)
  
  // Optional fields
  client_id?: string;
  secret?: string;
  amount?: string;                // If blank, uses max authorized amount
  metadata?: Record<string, string>;  // Max 50 key/value pairs
  test_clock_id?: string;         // Sandbox only
  facilitator_fee?: string;       // Platform fee to deduct
}
```

### Description Field Guidelines

- **Maximum length:** 15 characters for RTP, 10 characters for ACH
- **Purpose:** Should represent why money is moving, NOT your company name
- **Retry handling:** For reprocessing returned transfers:
  - First retry: `"Retry 1"`
  - Second retry: `"Retry 2"`
  - Can retry up to 2 times within 180 days
  - Only transfers returned with code `R01` or `R09` can be retried

### Metadata Constraints

- JSON values must be strings (no nested objects)
- Only ASCII characters allowed
- Maximum 50 key/value pairs
- Maximum key length: 40 characters
- Maximum value length: 500 characters

### Response Schema

```typescript
interface TransferCreateResponse {
  transfer: {
    id: string;                   // Unique transfer identifier
    authorization_id: string;
    ach_class?: string;
    account_id: string;
    funding_account_id: string | null;
    ledger_id: string | null;
    type: 'debit' | 'credit';
    user: {
      legal_name: string;
      phone_number: string | null;
      email_address: string | null;
      address: {
        street: string | null;
        city: string | null;
        region: string | null;
        postal_code: string | null;
        country: string | null;
      } | null;
    };
    amount: string;
    description: string;
    created: string;              // ISO 8601 datetime
    status: 'pending' | 'posted' | 'settled' | 'funds_available' | 
            'cancelled' | 'failed' | 'returned';
    sweep_status: 'unswept' | 'swept' | 'swept_settled' | 'return_swept' | null;
    network: 'ach' | 'same-day-ach' | 'rtp' | 'wire';
    wire_details?: {
      message_to_beneficiary: string | null;
      wire_return_fee: string | null;
    } | null;
    cancellable: boolean;
    failure_reason: {
      failure_code: string | null;  // e.g., "R01"
      ach_return_code: string | null;  // Deprecated
      description: string;
    } | null;
    metadata: Record<string, string> | null;
    iso_currency_code: string;
    standard_return_window: string | null;  // ISO 8601 date
    unauthorized_return_window: string | null;  // ISO 8601 date
    expected_settlement_date: string | null;  // Deprecated
    expected_funds_available_date: string | null;  // ISO 8601 date
    originator_client_id: string | null;
    refunds: Array<{
      id: string;
      transfer_id: string;
      amount: string;
      status: 'pending' | 'posted' | 'cancelled' | 'failed' | 'settled' | 'returned';
      failure_reason: {
        failure_code: string | null;
        ach_return_code: string | null;
        description: string;
      } | null;
      ledger_id: string | null;
      created: string;
      network_trace_id: string | null;
    }>;
    recurring_transfer_id: string | null;
    expected_sweep_settlement_schedule: Array<{
      sweep_settlement_date: string;  // ISO 8601 date
      swept_settled_amount: string;
    }>;
    credit_funds_source: string | null;  // Deprecated
    facilitator_fee: string;
    network_trace_id: string | null;
  };
  request_id: string;
}
```

### Transfer Status Values

- **pending**: New transfer created, in pending state
- **posted**: Successfully submitted to payment network
- **settled**: Successfully completed by payment network
  - For **credits**: Funds delivered to receiving bank account (terminal state)
  - For **debits**: Continue to `funds_available` state
- **funds_available**: (ACH debits only) Funds released from hold and applied to ledger's available balance (terminal state)
- **cancelled**: Cancelled by client (terminal state)
- **failed**: Failed, no funds moved (terminal state)
- **returned**: Posted transfer was returned (terminal state)

### Sweep Status Values

- **unswept**: Transfer hasn't been swept yet
- **swept**: Transfer swept to sweep account
- **swept_settled**: Credits available to withdraw or debits deducted from business checking
- **return_swept**: Transfer returned, funds pulled/pushed back to sweep account
- **null**: Transfer will never be swept (cancelled or returned before sweep)

### Example Request

```javascript
const request = {
  access_token: 'access-sandbox-71e02f71-0960-4a27-abd2-5631e04f2175',
  account_id: '3gE5gnRzNyfXpBK5wEEKcymJ5albGVUqg77gr',
  description: 'payment',
  authorization_id: '231h012308h3101z21909sw',
};

const response = await client.transferCreate(request);
const transfer = response.data.transfer;
```

### Example Response

```json
{
  "transfer": {
    "id": "460cbe92-2dcc-8eae-5ad6-b37d0ec90fd9",
    "authorization_id": "c9f90aa1-2949-c799-e2b6-ea05c89bb586",
    "ach_class": "ppd",
    "account_id": "3gE5gnRzNyfXpBK5wEEKcymJ5albGVUqg77gr",
    "funding_account_id": "8945fedc-e703-463d-86b1-dc0607b55460",
    "ledger_id": "563db5f8-4c95-4e17-8c3e-cb988fb9cf1a",
    "type": "credit",
    "user": {
      "legal_name": "Anne Charleston",
      "phone_number": "510-555-0128",
      "email_address": "acharleston@email.com",
      "address": {
        "street": "123 Main St.",
        "city": "San Francisco",
        "region": "CA",
        "postal_code": "94053",
        "country": "US"
      }
    },
    "amount": "12.34",
    "description": "payment",
    "created": "2020-08-06T17:27:15Z",
    "refunds": [],
    "status": "pending",
    "network": "ach",
    "cancellable": true,
    "failure_reason": null,
    "metadata": {
      "key1": "value1",
      "key2": "value2"
    },
    "iso_currency_code": "USD",
    "standard_return_window": "2023-08-07",
    "unauthorized_return_window": "2023-10-07",
    "expected_settlement_date": "2023-08-04",
    "originator_client_id": "569ed2f36b3a3a021713abc1",
    "recurring_transfer_id": null,
    "facilitator_fee": "1.23",
    "network_trace_id": null
  },
  "request_id": "saKrIBuEB9qJZno"
}
```

---

## Transfer Cancellation

### Transfer Authorization Cancellation

#### Endpoint: `/transfer/authorization/cancel`

**Purpose:** Cancel a transfer authorization that hasn't been used to create a transfer yet.

#### Request Schema

```typescript
interface TransferAuthorizationCancelRequest {
  client_id?: string;
  secret?: string;
  authorization_id: string;       // REQUIRED
}
```

#### Response Schema

```typescript
interface TransferAuthorizationCancelResponse {
  request_id: string;
}
```

#### Example

```javascript
const request = {
  authorization_id: '123004561178933',
};

const response = await client.transferAuthorizationCancel(request);
```

---

### Transfer Cancellation

#### Endpoint: `/transfer/cancel`

**Purpose:** Cancel a transfer. Only eligible if the transfer's `cancellable` property is `true`.

#### Request Schema

```typescript
interface TransferCancelRequest {
  client_id?: string;
  secret?: string;
  transfer_id: string;            // REQUIRED
  reason_code?: 'AC03' | 'AM09' | 'CUST' | 'DUPL' | 'FRAD' | 'TECH' | 
                'UPAY' | 'AC14' | 'AM06' | 'BE05' | 'FOCR' | 'MS02' | 
                'MS03' | 'RR04' | 'RUTA';
}
```

#### Reason Codes (Required for RTP, ignored for other networks)

- **AC03**: Invalid Creditor Account Number
- **AM09**: Incorrect Amount
- **CUST**: Requested By Customer - Cancellation requested
- **DUPL**: Duplicate Payment
- **FRAD**: Fraudulent Payment - Unauthorized or fraudulently induced
- **TECH**: Technical Problem - Cancellation due to system issues
- **UPAY**: Undue Payment - Payment made through another channel
- **AC14**: Invalid or Missing Creditor Account Type
- **AM06**: Amount Too Low
- **BE05**: Unrecognized Initiating Party
- **FOCR**: Following Refund Request
- **MS02**: No Specified Reason - Customer
- **MS03**: No Specified Reason - Agent
- **RR04**: Regulatory Reason
- **RUTA**: Return Upon Unable To Apply

#### Response Schema

```typescript
interface TransferCancelResponse {
  request_id: string;
}
```

#### Example

```javascript
const request = {
  transfer_id: '123004561178933',
};

const response = await client.transferCancel(request);
```

---

## Data Models

### Transfer Object

```typescript
interface Transfer {
  id: string;
  authorization_id: string;
  ach_class?: 'ccd' | 'ppd' | 'tel' | 'web';
  account_id: string;
  funding_account_id: string | null;
  ledger_id: string | null;
  type: 'debit' | 'credit';
  user: UserInfo;
  amount: string;
  description: string;
  created: string;
  status: TransferStatus;
  sweep_status: SweepStatus;
  network: 'ach' | 'same-day-ach' | 'rtp' | 'wire';
  wire_details?: WireDetails | null;
  cancellable: boolean;
  failure_reason: FailureReason | null;
  metadata: Record<string, string> | null;
  iso_currency_code: string;
  standard_return_window: string | null;
  unauthorized_return_window: string | null;
  expected_funds_available_date: string | null;
  originator_client_id: string | null;
  refunds: Refund[];
  recurring_transfer_id: string | null;
  expected_sweep_settlement_schedule: SweepSettlement[];
  facilitator_fee: string;
  network_trace_id: string | null;
}

type TransferStatus = 'pending' | 'posted' | 'settled' | 
                      'funds_available' | 'cancelled' | 
                      'failed' | 'returned';

type SweepStatus = 'unswept' | 'swept' | 'swept_settled' | 
                   'return_swept' | null;
```

### User Info Object

```typescript
interface UserInfo {
  legal_name: string;
  phone_number?: string | null;
  email_address?: string | null;
  address?: {
    street?: string | null;
    city?: string | null;
    region?: string | null;
    postal_code?: string | null;
    country?: string | null;
  } | null;
}
```

### Wire Details Object

```typescript
interface WireDetails {
  message_to_beneficiary?: string | null;  // Max 140 characters
  wire_return_fee?: string | null;
}
```

### Failure Reason Object

```typescript
interface FailureReason {
  failure_code: string | null;      // e.g., "R01"
  ach_return_code?: string | null;  // Deprecated
  description: string;
}
```

### Refund Object

```typescript
interface Refund {
  id: string;
  transfer_id: string;
  amount: string;
  status: 'pending' | 'posted' | 'cancelled' | 'failed' | 'settled' | 'returned';
  failure_reason: FailureReason | null;
  ledger_id: string | null;
  created: string;
  network_trace_id: string | null;
}
```

### Sweep Settlement Object

```typescript
interface SweepSettlement {
  sweep_settlement_date: string;  // ISO 8601 date
  swept_settled_amount: string;
}
```

---

## Error Handling

### Common Error Responses

```typescript
interface PlaidError {
  error_type: string;
  error_code: string;
  error_message: string;
  display_message: string | null;
  request_id: string;
}
```

### Transfer-Specific Errors

#### Authorization Errors
- **INVALID_FIELD**: Field validation failed (e.g., amount exceeds network limit)
- **ITEM_LOGIN_REQUIRED**: Item needs re-authentication
- **INSUFFICIENT_FUNDS**: Account has insufficient balance

#### Transfer Creation Errors
- **AUTHORIZATION_EXPIRED**: Authorization older than 1 hour
- **AUTHORIZATION_ALREADY_USED**: Authorization already used for another transfer
- **INVALID_AUTHORIZATION**: Authorization ID invalid or doesn't match account

### ACH Return Codes

Common return codes for failed/returned transfers:

- **R01**: Insufficient Funds
- **R02**: Account Closed
- **R03**: No Account/Unable to Locate Account
- **R04**: Invalid Account Number
- **R05**: Unauthorized Debit (Consumer advises not authorized)
- **R07**: Authorization Revoked by Customer
- **R08**: Payment Stopped
- **R09**: Uncollected Funds
- **R10**: Customer Advises Not Authorized
- **R11**: Check Truncation Entry Return
- **R29**: Corporate Customer Advises Not Authorized
- **R33**: Return of XCK Entry

### RTP/RfP Error Codes

- Refer to Plaid documentation for specific RTP error codes
- Different from ACH return codes
- Usually relate to network-specific constraints

---

## Testing in Sandbox

### Authorization Decision Testing

#### Approved with null rationale
- Create authorization with `amount` **less than** available balance

#### Approved with MANUALLY_VERIFIED_ITEM rationale
- Create Item via Same Day Micro-deposits flow

#### User Action Required
- Reset login for an Item using Sandbox endpoints

#### Declined with NSF rationale
- Available balance **less than** authorization amount
- Use Sandbox user customization to set specific balance

#### Declined with RISK rationale
- Set available balance to **exactly $0**
- Use Sandbox user customization

### Sandbox Test Data Creation

Use `/sandbox/user/create` or `/sandbox/public_token/create` to create test scenarios with specific:
- Account balances
- Transaction histories
- Item states

### Example Sandbox Request

```javascript
// Create authorization that will be approved
const request = {
  access_token: 'access-sandbox-xxxxx',
  account_id: 'account-sandbox-xxxxx',
  type: 'debit',
  network: 'ach',
  amount: '50.00',  // Less than account balance
  ach_class: 'ppd',
  user: {
    legal_name: 'Test User',
  },
};
```

---

## Implementation Guidelines

### Workflow Overview

```
1. Create Authorization
   ↓
2. Check Decision
   ↓
3a. If Approved → Create Transfer
3b. If Declined → Handle Error
3c. If User Action Required → Launch Link
   ↓
4. Monitor Transfer Status
   ↓
5. Handle Webhooks (optional)
```

### Step-by-Step Implementation

#### Step 1: Create Authorization

```javascript
async function authorizeTransfer(params) {
  const authRequest = {
    access_token: params.accessToken,
    account_id: params.accountId,
    type: params.type,
    network: params.network,
    amount: params.amount,
    ach_class: params.achClass,
    user: {
      legal_name: params.userLegalName,
    },
    idempotency_key: generateIdempotencyKey(), // Implement UUID generation
  };
  
  const response = await plaidClient.transferAuthorizationCreate(authRequest);
  return response.data.authorization;
}
```

#### Step 2: Handle Authorization Decision

```javascript
function handleAuthorizationDecision(authorization) {
  switch (authorization.decision) {
    case 'approved':
      if (authorization.decision_rationale === null) {
        // Safe to proceed
        return { canProceed: true };
      } else {
        // Perform additional risk assessment
        return {
          canProceed: true,
          requiresReview: true,
          rationale: authorization.decision_rationale,
        };
      }
      
    case 'declined':
      return {
        canProceed: false,
        reason: authorization.decision_rationale,
      };
      
    case 'user_action_required':
      return {
        canProceed: false,
        requiresLink: true,
        authorizationId: authorization.id,
      };
  }
}
```

#### Step 3: Create Transfer

```javascript
async function createTransfer(authorizationId, params) {
  const transferRequest = {
    access_token: params.accessToken,
    account_id: params.accountId,
    authorization_id: authorizationId,
    description: params.description,
    amount: params.amount, // Optional, uses max authorized if omitted
    metadata: params.metadata,
  };
  
  const response = await plaidClient.transferCreate(transferRequest);
  return response.data.transfer;
}
```

#### Step 4: Monitor Transfer Status

```javascript
async function monitorTransferStatus(transferId) {
  const response = await plaidClient.transferGet({ transfer_id: transferId });
  const transfer = response.data.transfer;
  
  // Terminal states
  const terminalStates = ['settled', 'funds_available', 'cancelled', 'failed', 'returned'];
  
  if (terminalStates.includes(transfer.status)) {
    return { complete: true, transfer };
  }
  
  return { complete: false, transfer };
}
```

### Error Handling Best Practices

```javascript
async function safeTransferCreation(params) {
  try {
    // Step 1: Authorize
    const authorization = await authorizeTransfer(params);
    
    // Step 2: Check decision
    const decision = handleAuthorizationDecision(authorization);
    
    if (!decision.canProceed) {
      if (decision.requiresLink) {
        // Launch Link with authorization.id
        return { status: 'link_required', authorizationId: authorization.id };
      }
      return { status: 'declined', reason: decision.reason };
    }
    
    // Step 3: Create transfer
    const transfer = await createTransfer(authorization.id, params);
    
    return { status: 'success', transfer };
    
  } catch (error) {
    if (error.response?.data?.error_code === 'AUTHORIZATION_EXPIRED') {
      // Retry authorization
      return { status: 'retry', message: 'Authorization expired, please retry' };
    }
    
    // Log and handle other errors
    console.error('Transfer creation failed:', error);
    return { status: 'error', error: error.response?.data || error.message };
  }
}
```

### Idempotency Implementation

```javascript
// Generate idempotency key
function generateIdempotencyKey() {
  return `${Date.now()}-${Math.random().toString(36).substring(7)}`;
}

// Store and retrieve idempotency keys
class IdempotencyStore {
  private store = new Map<string, { key: string; expiresAt: number }>();
  
  create(identifier: string): string {
    const key = generateIdempotencyKey();
    const expiresAt = Date.now() + (48 * 60 * 60 * 1000); // 48 hours
    
    this.store.set(identifier, { key, expiresAt });
    return key;
  }
  
  get(identifier: string): string | null {
    const entry = this.store.get(identifier);
    
    if (!entry) return null;
    if (entry.expiresAt < Date.now()) {
      this.store.delete(identifier);
      return null;
    }
    
    return entry.key;
  }
}
```

### Network-Specific Considerations

```javascript
function validateNetworkConstraints(network, amount, type) {
  const constraints = {
    'same-day-ach': {
      maxAmount: 1000000,
      cutoffTime: { hour: 15, minute: 0, timezone: 'America/New_York' },
    },
    'wire': {
      maxAmount: 999999.99,
      allowedTypes: ['credit'],
      cutoffTime: { hour: 18, minute: 30, timezone: 'America/New_York' },
    },
  };
  
  const constraint = constraints[network];
  if (!constraint) return { valid: true };
  
  const amountNum = parseFloat(amount);
  
  if (amountNum > constraint.maxAmount) {
    return {
      valid: false,
      error: `Amount exceeds ${network} limit of $${constraint.maxAmount}`,
    };
  }
  
  if (constraint.allowedTypes && !constraint.allowedTypes.includes(type)) {
    return {
      valid: false,
      error: `${network} only supports ${constraint.allowedTypes.join(', ')} transfers`,
    };
  }
  
  return { valid: true };
}
```

### Webhook Integration (Optional)

```javascript
// Handle transfer webhooks for status updates
app.post('/webhooks/plaid/transfer', (req, res) => {
  const webhook = req.body;
  
  switch (webhook.webhook_type) {
    case 'TRANSFER':
      handleTransferWebhook(webhook);
      break;
  }
  
  res.json({ received: true });
});

function handleTransferWebhook(webhook) {
  const { webhook_code, transfer_id } = webhook;
  
  switch (webhook_code) {
    case 'TRANSFER_EVENTS_UPDATE':
      // Fetch latest transfer status
      updateTransferStatus(transfer_id);
      break;
      
    case 'TRANSFER_FAILED':
      // Handle failed transfer
      handleTransferFailure(transfer_id);
      break;
      
    case 'TRANSFER_POSTED':
      // Transfer successfully posted
      handleTransferPosted(transfer_id);
      break;
  }
}
```

---

## Best Practices

### 1. Always Use Idempotency Keys
- Generate unique keys for each authorization attempt
- Store mapping between user actions and idempotency keys
- Handle 48-hour expiration

### 2. Validate Before Authorization
- Check network constraints
- Validate amount format (2 decimal places)
- Ensure ACH class matches transfer type
- Verify cutoff times for time-sensitive networks

### 3. Handle All Decision Paths
- Implement Link update flow for `user_action_required`
- Perform additional risk assessment for approved transfers with non-null rationale
- Provide clear user feedback for declined transfers

### 4. Monitor Transfer Lifecycle
- Use webhooks for real-time updates (recommended)
- Poll `/transfer/get` for systems without webhook capability
- Track terminal states appropriately

### 5. Implement Proper Error Recovery
- Retry logic for transient failures
- Clear error messages for user-facing issues
- Logging for debugging and compliance

### 6. Security Considerations
- Never expose `client_id` or `secret` in client-side code
- Validate all user input
- Implement rate limiting
- Log all transfer operations for audit trail

### 7. Testing Strategy
- Test all decision paths in Sandbox
- Verify amount validations
- Test network-specific constraints
- Simulate error conditions

---

## Code Templates

### Complete Transfer Flow

```typescript
import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid';

// Initialize Plaid client
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

// Main transfer function
async function initiateTransfer(params: {
  accessToken: string;
  accountId: string;
  amount: string;
  type: 'debit' | 'credit';
  network: 'ach' | 'same-day-ach' | 'rtp' | 'wire';
  description: string;
  userLegalName: string;
  achClass?: 'ccd' | 'ppd' | 'tel' | 'web';
  metadata?: Record<string, string>;
}) {
  // Validate constraints
  const validation = validateNetworkConstraints(params.network, params.amount, params.type);
  if (!validation.valid) {
    throw new Error(validation.error);
  }
  
  // Create authorization
  const authResponse = await plaidClient.transferAuthorizationCreate({
    access_token: params.accessToken,
    account_id: params.accountId,
    type: params.type,
    network: params.network,
    amount: params.amount,
    ach_class: params.achClass || 'ppd',
    user: {
      legal_name: params.userLegalName,
    },
    idempotency_key: generateIdempotencyKey(),
  });
  
  const authorization = authResponse.data.authorization;
  
  // Handle decision
  if (authorization.decision === 'declined') {
    throw new Error(`Transfer declined: ${authorization.decision_rationale?.description}`);
  }
  
  if (authorization.decision === 'user_action_required') {
    return {
      status: 'link_required',
      authorizationId: authorization.id,
      message: 'User action required to complete authorization',
    };
  }
  
  // Create transfer
  const transferResponse = await plaidClient.transferCreate({
    access_token: params.accessToken,
    account_id: params.accountId,
    authorization_id: authorization.id,
    description: params.description,
    amount: params.amount,
    metadata: params.metadata,
  });
  
  return {
    status: 'success',
    transfer: transferResponse.data.transfer,
  };
}

// Helper function
function validateNetworkConstraints(
  network: string,
  amount: string,
  type: string
): { valid: boolean; error?: string } {
  const amountNum = parseFloat(amount);
  
  if (network === 'same-day-ach' && amountNum > 1000000) {
    return { valid: false, error: 'Same-day ACH limit is $1,000,000' };
  }
  
  if (network === 'wire') {
    if (amountNum > 999999.99) {
      return { valid: false, error: 'Wire transfer limit is $999,999.99' };
    }
    if (type !== 'credit') {
      return { valid: false, error: 'Wire transfers only support credits' };
    }
  }
  
  return { valid: true };
}

function generateIdempotencyKey(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(7)}`;
}
```

---

## Additional Resources

### Related Endpoints
- `/transfer/get` - Retrieve transfer details
- `/transfer/list` - List transfers
- `/transfer/event/list` - List transfer events
- `/transfer/event/sync` - Sync transfer events
- `/transfer/capabilities/get` - Check transfer capabilities
- `/link/token/create` - Create Link token for user action

### Documentation Links
- [ACH SEC Codes Guide](https://plaid.com/docs/transfer/creating-transfers/#ach-sec-codes)
- [Transfer Events Documentation](https://plaid.com/docs/transfer/reconciling-transfers/)
- [ACH Return Codes](https://plaid.com/docs/errors/transfer/#ach-return-codes)
- [RTP/RfP Error Codes](https://plaid.com/docs/errors/transfer/#rtprfp-error-codes)
- [Platform Customers Guide](https://plaid.com/docs/transfer/application/#originators-vs-platforms)

---

## Summary Checklist

When implementing Plaid Transfer API, ensure you:

- [ ] Set up proper authentication (headers or request body)
- [ ] Implement authorization before transfer creation
- [ ] Handle all three authorization decision types
- [ ] Validate network-specific constraints
- [ ] Use idempotency keys for authorizations
- [ ] Format amounts as decimal strings with 2 digits precision
- [ ] Keep descriptions within character limits
- [ ] Implement proper error handling
- [ ] Test all scenarios in Sandbox
- [ ] Set up webhook handlers (recommended)
- [ ] Monitor transfer status appropriately
- [ ] Handle cancellations correctly
- [ ] Implement Link update flow for user actions
- [ ] Log all operations for compliance
- [ ] Secure API credentials

---

**Document Version:** 1.0  
**Last Updated:** Based on Plaid API documentation as of April 2026  
**API Version:** Current
