# Thumbtack → Maverick lead flow

Maverick must never create an HCP record or estimate merely because a Thumbtack lead exists. The webhook queue is idempotent, customer messages are independently gated, and HCP writes require explicit customer intent plus complete identity and service address.

```mermaid
flowchart TD
  A[Thumbtack webhook] --> B[Persist and dedupe event]
  B --> C[Shadow lead-state queue]
  C --> D[Qualify scope]
  D --> E[Pricebook verbal estimate]
  E --> F{Customer wants formal estimate?}
  F -- No / price shopping --> G[Polite close: no HCP write]
  F -- Yes --> H[Collect name and service address]
  H --> I{Explicit consent + validated fields?}
  I -- No --> H
  I -- Yes --> J[Create HCP customer/address/estimate]
  J --> K[Send only after HCP success]
  K --> L[Customer approves]
  L --> M[Coordinate in Thumbtack; schedule in HCP]
```

## Activation gates

Outbound Thumbtack replies require both `THUMBTACK_AUTO_REPLY_ENABLED=true` and `THUMBTACK_NATIVE_AUTO_REPLY_DISABLED=true`. HCP writes are a third, separate gate: `THUMBTACK_HCP_WRITES_ENABLED=true`. Until all required gates are enabled and the lead-state processor is reviewed, incoming events remain in shadow mode and no customer-facing message or HCP write occurs.
