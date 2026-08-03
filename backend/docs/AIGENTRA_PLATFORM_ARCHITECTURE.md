# Aigentra Platform Architecture

Aigentra is positioned as a social-native crypto trading operating system: a public mobile-first trading product with a separated developer/operator control plane.

## Current Codebase Baseline

The existing service already contains the early backend for a trading intelligence platform:

- Express API and websocket-capable runtime
- Zora coin monitoring and market listeners
- Neynar webhook ingestion for creator/social triggers
- Firebase Admin and Firestore persistence
- Automated buy/sell logic
- Activity feed records
- Bot configuration and targeting controls
- Manual trade execution endpoints
- Spend permission support

This makes the current backend useful as the first trading-intelligence service, not the final monolith.

## Product Surfaces

### Public App

The public product should be the default experience:

- Home: social trading feed, live trades, AI signals, creator launches, whale alerts
- Markets: coins, narratives, watchlists, trend clusters
- Trade: clean execution panel with chart, smart routing, review flow
- Portfolio: assets, PNL, positions, risk, allocation
- Profile: identity, public trades, creator tools, copy-trading reputation

### Developer Control

Internal tools must stay separate from the consumer app:

- Route: `/control`
- Firebase developer login
- Admin wallet allowlist
- Bot status and controls
- Target creator management
- Position management
- Manual buy/sell controls
- Spend permissions
- Audit-friendly operational workflows

## Production Service Split

The current Node service should eventually become several services:

- API Gateway: auth, rate limiting, RBAC, request tracing
- Trading Engine: orders, execution, slippage policy, kill switches
- Market Data Service: prices, candles, order books, liquidity, websockets
- Social Feed Service: posts, comments, follows, creator signals
- Notification Service: push, email, in-app alerts
- Wallet Service: custody integrations, permissions, withdrawals, vault controls
- Analytics Engine: PNL, cohorts, rankings, whale tracking
- AI Signal Engine: scoring, recommendations, risk labels
- Admin Service: moderation, operator actions, audit logs

## Data Layer

Recommended production storage:

- PostgreSQL: users, accounts, orders, trades, ledger records
- Redis: websocket fanout, rate limits, hot market cache
- ClickHouse: trade analytics, market history, event firehose
- Firestore: lightweight realtime state during early phases
- S3/R2: user media, creator assets, exports, compliance documents
- Secret Manager/KMS: API keys, wallet credentials, signer controls

## Security Boundary

Public trading platforms need fintech-grade controls:

- KYC and AML before regulated flows
- RBAC for internal users
- Immutable audit logs for every operator action
- Rate limits on auth, trade, config, and webhook routes
- HMAC verification for webhooks
- Withdrawal velocity limits
- Wallet monitoring and sanctions screening
- DDoS/WAF protection
- Key custody separation
- Emergency pause and liquidation controls

## Route Policy

Public routes should expose only consumer-safe reads and app bootstrapping.

Developer/operator routes must require Firebase ID tokens and admin authorization. In the current backend, the developer token verifier now guards the internal API surface after `/auth/login`, while webhook routes remain externally reachable for provider callbacks.

## Build Phases

### Phase 1: Public Shell + Control Separation

- Public Aigentra mobile-first app shell
- `/control` developer login
- Existing bot tools moved behind internal route
- Admin API protection wired into backend

### Phase 2: Real Public Accounts

- Consumer auth
- Watchlists
- Portfolio read model
- Social profiles
- Follow graph
- Notification preferences

### Phase 3: Trading Core

- Order lifecycle
- Trade review and confirmations
- Smart routing
- Risk labels
- Ledger-grade records
- Compliance-ready event logs

### Phase 4: Social Trading

- Verified trade feed
- Copy trade workflows
- Creator coins
- Comments and reactions
- Strategy pages
- Reputation scores

### Phase 5: Exchange Scale

- Dedicated matching/routing layer
- Multi-region market data
- Institutional analytics
- Full admin console
- Compliance operations
- Public APIs and developer ecosystem
