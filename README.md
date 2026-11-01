# ParkEase MVP

> **Status: integration-ready deployment.** Parking reservations, visits, capacity, vehicles and operator events are stored in PostgreSQL. External payment collection remains sandboxed. Campus SSO and gate/LPR hardware must be configured by Sunway before those external services are live.

ParkEase is a single-campus parking service for users, assigned facility operators and campus admins. PostgreSQL is authoritative for account-backed parking and operational records. Browser state is presentation-only. No sample car parks or capacities are seeded: an admin must enter verified campus inventory before users can reserve and operators can be scoped.

## Run locally

```sh
npm install
npm run dev
```

Open the local Vite URL. Configure `VITE_API_BASE` only if the API is hosted on a separate origin; in deployment, use the same-origin `/api` proxy.

Run the browser journeys with `npx playwright install chromium` (first time only), then `npm run test:e2e`. The end-to-end suite checks a reserved entry and checkout, expiry/refund, and the 360px mobile navigation layout.

## Run with Docker

Set server-side credentials in `.env` (do not commit it):

```dotenv
POSTGRES_USER=parkease
POSTGRES_PASSWORD=<long-random-database-password>
POSTGRES_DB=parkease
JWT_SECRET=<at-least-32-random-bytes>
CAMPUS_EMAIL_DOMAINS=university.edu
COOKIE_SECURE=true
SMTP_HOST=smtp.example.edu
SMTP_PORT=587
SMTP_USER=<smtp-user>
SMTP_PASSWORD=<smtp-password>
SMTP_FROM=noreply@university.edu
GATE_WEBHOOK_SECRET=<shared-secret-from-campus-gate-integration>
# Set these when Sunway provides its OpenID Connect application details.
SSO_ISSUER_URL=
SSO_CLIENT_ID=
SSO_CLIENT_SECRET=
SSO_REDIRECT_URI=http://localhost:8080/api/auth/sso/callback
APP_BASE_URL=http://localhost:8080
ENABLE_DEMO_DATA=false
# Optional: bind test records to existing accounts instead of generating test logins.
DEMO_USER_EMAIL=
DEMO_OPERATOR_EMAIL=
```

Use `COOKIE_SECURE=false` for local HTTP development only. Put a TLS reverse proxy in front of the published Nginx port, restrict that port at the firewall, and use a unique JWT secret and database password in production. Only Nginx is published; the API is on the web network and Postgres is attached only to the internal data network. PostgreSQL data persists in the `postgres_data` volume.

Build and start the services:

```sh
docker compose up --build -d
```

Open `http://localhost:8080`. Nginx serves the UI and proxies `/api` to FastAPI. Health checks are available at `/health` and `/api/health`.

Stop it with:

```sh
docker compose down
```

Create one verified initial account per role from the backend. Set strong, unique passwords and campus-approved email addresses in the shell running Compose, then run:

```sh
 $env:USER_EMAIL='user@university.edu'; $env:USER_PASSWORD='<unique-password-12-chars-or-more>'
 $env:OPERATOR_EMAIL='operator@university.edu'; $env:OPERATOR_PASSWORD='<different-unique-password>'
 $env:ADMIN_EMAIL='admin@university.edu'; $env:ADMIN_PASSWORD='<another-unique-password>'
 docker compose exec -e USER_EMAIL -e USER_PASSWORD -e OPERATOR_EMAIL -e OPERATOR_PASSWORD -e ADMIN_EMAIL -e ADMIN_PASSWORD api python create_users.py
```

Existing accounts are left unchanged if the command is run again. Afterward, sign in at `/login`. Configure HTTPS before enabling `COOKIE_SECURE=true` in a remotely deployed environment. User signup is limited to `CAMPUS_EMAIL_DOMAINS`; SMTP verification and password recovery tokens are sent by the configured mail server. With SMTP unset, the backend logs development tokens to its container log.

The API enforces role permissions and operator facility scopes. Configure a campus admin, add verified facilities and zones, then assign operators to those facilities from **Users & staff**. Users can then add a vehicle, reserve, view their active visit, and review account activity.

### Gate and LPR connection

The API accepts authenticated provider events at `POST /api/integrations/gate/events`. Send JSON with `external_id` (unique provider event ID), `facility_id`, `plate`, `lane`, `event_type` (`entry` or `exit`), and optional ISO timestamp `occurred_at`. Include `X-Gate-Webhook-Secret` matching the server's `GATE_WEBHOOK_SECRET`. A matched entry converts the user's reservation into an active visit. A matched exit closes the visit and records the sandbox parking charge. Duplicate event IDs are idempotent. The operator event feed polls backend records; the old browser-generated event endpoint has been removed.

The generated webhook secret only protects the adapter endpoint; it does not connect a camera or gate by itself. Sunway's gate/LPR provider still needs the endpoint URL, secret, and a mapping from its facilities/lanes to ParkEase IDs. The operator screen reports when it is waiting for those events.

### SSO and payment

Sunway SSO uses the OIDC adapter and requires the issuer URL, client ID, client secret, and registered callback URI. Until those are supplied, campus email/password authentication remains available for configured accounts. Payments are deliberately fixed to sandbox; no external payment is taken or settled. Do not treat sandbox balances or reports as real funds.

### Isolated test dataset

Set `ENABLE_DEMO_DATA=true` only in a local/test deployment. A campus admin can create or remove the **Demo data for testing** dataset from the campus overview. It creates three `[DEMO]` facilities, one active test visit, one active reservation, and test gate events. By default it creates generated test logins and sandbox funds. Optionally set `DEMO_USER_EMAIL` and `DEMO_OPERATOR_EMAIL` to bind fixtures to existing accounts; this temporarily scopes those accounts to the demo facilities and leaves their existing profile, wallet, and real-facility records untouched. Removing the dataset restores their previous account flags and scopes and deletes only fixture records, while retaining audit entries. Demo facilities are excluded from campus totals and the public signboard. Keep the setting false in production.

The public signboard shows only aggregate live campus occupancy. The local test dataset uses explicit demo-only accounts and records; it does not create real gate events or payment transactions.
