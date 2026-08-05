# Thumbtack → Maverick lead flow

Maverick must never create an HCP record or estimate merely because a Thumbtack lead exists. The webhook queue is idempotent, customer messages are independently gated, and HCP writes require explicit customer intent plus complete identity and service address.

```mermaid
flowchart TD
  A[Thumbtack webhook] --> B[Persist and dedupe event]
  B --> C[Shadow lead-state queue]
  C --> D[Customer-only event gate]
  D --> E[Qualify scope]
  E --> F[Pricebook verbal estimate]
  F --> G{Customer wants formal estimate?}
  G -- No / price shopping --> H[Polite close: no HCP write]
  G -- Yes --> I[Collect name, callback phone, and service address]
  I --> J{Explicit consent + validated fields?}
  J -- No --> I
  J -- Yes --> K[Create HCP customer/address/estimate]
  K --> L[Send only after HCP success]
  L --> M[Customer approves]
  M --> N[Coordinate in Thumbtack; schedule in HCP]
```

## Activation gates

Outbound Thumbtack replies require both `THUMBTACK_AUTO_REPLY_ENABLED=true` and `THUMBTACK_NATIVE_AUTO_REPLY_DISABLED=true`. HCP writes are a third, separate gate: `THUMBTACK_HCP_WRITES_ENABLED=true`. Until all required gates are enabled and the lead-state processor is reviewed, incoming events remain in shadow mode and no customer-facing message or HCP write occurs.
