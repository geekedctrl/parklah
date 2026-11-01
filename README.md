# ParkEase MVP

> **Status: Under development.** This project is an active prototype and is not ready for production use.

ParkEase is a university parking prototype. Authentication and account roles run in FastAPI with PostgreSQL; the parking, wallet, gate, payment, and LPR experiences are still simulated. The existing driver parking simulator remains browser-local and is not yet a production parking ledger.

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
 $env:DRIVER_EMAIL='driver@university.edu'; $env:DRIVER_PASSWORD='<unique-password-12-chars-or-more>'
 $env:OPERATOR_EMAIL='operator@university.edu'; $env:OPERATOR_PASSWORD='<different-unique-password>'
 $env:ADMIN_EMAIL='admin@university.edu'; $env:ADMIN_PASSWORD='<another-unique-password>'
 docker compose exec -e DRIVER_EMAIL -e DRIVER_PASSWORD -e OPERATOR_EMAIL -e OPERATOR_PASSWORD -e ADMIN_EMAIL -e ADMIN_PASSWORD api python create_users.py
```

Existing accounts are left unchanged if the command is run again. Afterward, sign in at `/login`. Configure HTTPS before enabling `COOKIE_SECURE=true` in a remotely deployed environment. Driver signup is limited to `CAMPUS_EMAIL_DOMAINS`; SMTP verification and password recovery tokens are sent by the configured mail server. With SMTP unset, the backend logs development tokens to its container log.

The API currently secures identity, role-specific profile/operations/admin endpoints, and the public aggregate signboard. The legacy simulator's reservations, sessions, wallet ledger, and capacity still live in the browser and must not be treated as shared authoritative campus data. Payments and LPR remain simulated.

## Two-minute demonstration

1. Open **Reserve**, choose WXY 1234, review the RM4 reservation / RM10 total estimate, and confirm.
2. Open **Demo controls**, advance 45 minutes and observe the 15-minute reminder.
3. Simulate the reserved gate scan and wait through the visual recognition buffer.
4. Open **My Parking**, check out for RM6, then inspect the receipt and Activity ledger.

The Demo panel can fast-forward to expiry, change time, simulate walk-in traffic, top up demo funds, open the signboard and reset the local state.
