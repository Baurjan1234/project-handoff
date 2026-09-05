# Architecture

Mermaid in markdown so it is diffable and any session can regenerate it. **Keep this
current in the same pull request as the change it describes.** A diagram that disagrees
with the code is worse than no diagram.

Nothing here is settled beyond the brief. The one genuinely open shape is the schedule
timing, drawn at the bottom.

## Components

```mermaid
flowchart LR
  subgraph req["Requester side"]
    RA["Agent session<br/>Claude Code, Cursor"]
    RW["Plain web form<br/>Tier 2"]
    DEMO["apps/requester<br/>Agent Kit demo"]
  end

  subgraph mono["Handoff workspace"]
    MCP["apps/mcp<br/>handoff_verify"]
    WEB["apps/web<br/>expert app"]
    SVC["Verifier + schedule admin<br/>server side only"]
    SCHEMA["packages/schema<br/>types, money, hashing<br/>ChainAdapter"]
    CHAIN["packages/chain<br/>the only Hedera SDK importer"]
    CONTENT["packages/content<br/>storage adapter"]
  end

  subgraph ext["External"]
    HEDERA["Hedera testnet<br/>HCS topics, escrow account<br/>Schedule Service"]
    MIRROR["Mirror node REST"]
    STORE["Supabase object store"]
    FAC["Blocky402 facilitator<br/>api.testnet.blocky402.com<br/>designated fee payer"]
  end

  EX["Expert<br/>own Hedera account"]

  RA -- "x402" --> MCP
  RW --> MCP
  DEMO -- "x402" --> MCP
  MCP -. "verify, settle" .-> FAC
  DEMO -. "Agent Kit tools" .-> HEDERA
  MCP --> SCHEMA
  WEB --> SCHEMA
  SVC --> SCHEMA
  MCP --> CHAIN
  WEB --> CHAIN
  SVC --> CHAIN
  MCP --> CONTENT
  WEB --> CONTENT
  CHAIN --> HEDERA
  CHAIN --> MIRROR
  CONTENT --> STORE
  EX --> WEB
  EX -. "signs the HCS message only" .-> HEDERA
  SVC -. "ScheduleSign" .-> HEDERA
  FAC -. "settles the service fee" .-> HEDERA
```

Two rules the picture encodes:

- Only `packages/chain` imports the Hedera SDK. Everything else goes through the
  `ChainAdapter` interface that `packages/schema` owns, which is what makes the
  mock-to-testnet cutover a one-line swap.
- The verifier and schedule-admin keys live in a server-side process only. Nothing with
  a browser build ever holds them.

## Order lifecycle

```mermaid
stateDiagram-v2
    [*] --> POSTED
    POSTED --> CLAIMED: first valid claim from a certified account
    POSTED --> TIMEOUT: order deadline passes unclaimed
    CLAIMED --> DELIVERED: expert publishes signed attestation on HCS
    CLAIMED --> CLAIM_TIMEOUT: claimant idle past claim-timeout
    CLAIM_TIMEOUT --> POSTED: reopen once, new claimant gets a fresh schedule
    CLAIM_TIMEOUT --> TIMEOUT: already reopened once
    DELIVERED --> SETTLED: verifier plus schedule admin ScheduleSign
    DELIVERED --> VIOLATION: mechanical schema violation
    SETTLED --> [*]
    TIMEOUT --> [*]: schedule expires unexecuted, funds return
    VIOLATION --> [*]: ScheduleDelete, the only clawback
```

Three things this diagram is load-bearing for:

- **`CLAIM_TIMEOUT` and `TIMEOUT` are different events.** Claim-timeout is short relative
  to the order deadline, so a lazy claimant cannot hold funds hostage. Do not collapse
  them into one timer.
- **Consensus timestamp decides who won a claim.** The expert app may render a claim
  optimistically, but it has to handle losing the race when the mirror node confirms an
  earlier one.
- **`DELIVERED` to `SETTLED` is an idempotent retry.** If the verifier is asleep when the
  expert signs, the attestation still stands on HCS and payment lands on recovery. Never
  double-pay.

## Happy path

```mermaid
sequenceDiagram
    autonumber
    participant R as Requester agent
    participant M as apps/mcp
    participant S as Content store
    participant H as Hedera testnet
    participant E as Expert in apps/web
    participant V as Verifier and schedule admin

    R->>M: handoff_verify with class, cert tag, price, deadline
    M->>S: store artifact, take hash
    M->>H: lock funds in escrow, publish order envelope on HCS
    H-->>M: transaction ids
    M-->>R: order id, escrow tx, topic id
    E->>H: claim from a certified account
    Note over E,H: consensus timestamp decides the race
    E->>S: fetch artifact by signed URL
    E->>H: publish signed attestation from the expert's own account
    V->>H: read the attestation from a mirror node
    V->>V: validate against the order schema
    V->>H: ScheduleSign, idempotent
    H-->>E: payment executed
    E->>H: mirror-node read confirms settlement
```

Hashes only cross the chain boundary. The artifact and the expert's written notes go to
the content store; only `artifact_hash_in` and `notes_hash` reach HCS.

## The x402 service gate

Distinct from the escrow, and the two must never be conflated. The service fee is a
micropayment for calling `handoff_verify`. The order value is the price of the judgment
and it goes to escrow.

```mermaid
sequenceDiagram
    autonumber
    participant C as Requester agent
    participant S as apps/mcp, the gated service
    participant F as Blocky402 testnet facilitator
    participant H as Hedera testnet

    C->>S: call handoff_verify
    S-->>C: HTTP 402, price in a PAYMENT-REQUIRED header
    C->>C: build TransferTransaction, partially sign with its ECDSA key
    C->>S: retry with base64 payload in the PAYMENT-SIGNATURE header
    S->>F: POST /verify
    F-->>S: isValid
    S->>S: post the order, lock the escrow, publish the envelope
    S-->>C: order id and transaction ids, receipt in PAYMENT-RESPONSE
    F->>H: co-sign as designated fee payer, POST /settle
    H-->>F: receipt, settlement is asynchronous
```

The facilitator is the designated fee payer, so the client never pays gas and the client's
key never leaves the client. Facilitator base URL is `https://api.testnet.blocky402.com`
and the network identifier is `hedera:testnet`. The mainnet host is forbidden by hard
rule 5.

Three constraints the diagram does not show. The x402 signer must be an **ECDSA**
account. Payment is in **HBAR**, not USDC, because USDC on testnet needs a token
association on both accounts first. The x402 receiver is a **separate account** from the
escrow, never the escrow threshold key.

## Escrow quorum

Two of three on the escrow account.

| Key | Held by | Signs for |
|---|---|---|
| Requester session key | The requester | Clawback, with the platform |
| Platform verifier key | Us | Early execute, and clawback |
| Schedule admin key | Us | Early execute, and schedule deletion |

Early execute is verifier plus admin, after the attestation validates. Clawback is
requester plus platform, only after a mechanical schema failure.

**Admitted honestly:** the verifier key and the admin key are both ours this week, so a
compromised backend has quorum. Two Node processes on one team are not two custodians.
Decentralizing the verifier is the production roadmap.

## Open: when the schedule is created

P1's hour-one spike settles this. Hedera's Schedule Service normally wants a fully formed
inner transfer, so variant B is the expected outcome.

```mermaid
flowchart TB
  subgraph VA["Variant A, schedule at post"]
    A1["POSTED<br/>lock funds and ScheduleCreate<br/>with the payee unknown"] --> A2["CLAIMED<br/>payee resolves"] --> A3["DELIVERED<br/>ScheduleSign"]
  end
  subgraph VB["Variant B, schedule at claim, expected"]
    B1["POSTED<br/>lock funds, publish a payee-less envelope"] --> B2["CLAIMED<br/>ScheduleCreate, payee now known"] --> B3["DELIVERED<br/>ScheduleSign"]
  end
```

Under variant B the post-to-claim window is protected by the threshold key alone, which
is trusted-platform and gets admitted out loud. The demo narration then says "committed
at claim", not "committed at post".

Decide by the end of hour one, then update this file, the brief's lifecycle block, and
the narration together. Until it is decided, do not hard-code either shape.
