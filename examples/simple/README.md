# Simple Egress Example

Demonstrates single LiveKit egress node orchestration.

## Architecture

```
┌─────────────┐      StartEgress       ┌──────────┐
│ RPC Client  │ ──────────────────────>│  Valkey  │
│ (client.ts) │                        └────┬─────┘
└─────────────┘                             │
                                            │ (pub/sub)
┌─────────────┐    CreateEgress/Update     │
│ RPC Server  │ <──────────────────────────┤
│ (server.ts) │                            │
└─────────────┘                            │
                                           ▼
                                    ┌─────────────┐
                                    │LiveKit      │
                                    │Egress Node  │
                                    └─────────────┘
```

## Run

From the **project root** directory:

Terminal 1: `docker compose up` (starts valkey + egress node)
Terminal 2: `npm run example:simple:server` (starts RPC server)
Terminal 3: `npm run example:simple:client [url]` (sends StartEgress)
Ctrl-C in Terminal 3 stops the egress gracefully

## What it demonstrates

- LiveKit egress container orchestration
- RPC client sending StartEgress command to egress node
- RPC server receiving CreateEgress/UpdateEgress events from egress node
- Graceful egress cleanup on Ctrl-C
