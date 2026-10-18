# Event Booking System — Video Demonstration Walkthrough & Script

**Duration**: 3–4 Minutes (Within 2–5 Minute Requirement)  
**Format**: Face + Screen Recording with English Narration  
**Presenter**: Senior Backend Engineer  

---

## Pre-Recording Checklist

- [ ] Web camera & microphone connected and tested.
- [ ] Terminal split-screen ready (Server + Worker log in bottom/side terminal, requests on top).
- [ ] Local or hosted API running:
  ```bash
  # Terminal 1: Start API server
  pnpm start
  # Terminal 2: Start background email worker
  pnpm worker
  ```
- [ ] Browser tabs open:
  1. `README.md` (architecture diagram & data model).
  2. `docs/performance.md` (before-and-after comparison table).
  3. Resend Dashboard / test inbox (or worker logs showing email events).
- [ ] For a hosted demo, run the executable walkthrough with the deployed URL.
  `delivered@resend.dev` is Resend's controlled delivery-test recipient; set
  `DEMO_CUSTOMER_EMAIL` to a unique inbox you control if you need to inspect
  the message yourself:
  ```bash
  BASE_URL=https://your-service.onrender.com \
  DEMO_CUSTOMER_EMAIL=delivered@resend.dev \
  bash scripts/demo-walkthrough.sh
  ```

---

## Timed Walkthrough Script

### 0:00 – 0:35 | Introduction & Architecture Overview
**Visual**: Show face on camera, then screen sharing the Mermaid Architecture diagram in `README.md`.
**Spoken Script**:
> "Hello! Today I am presenting the completed, production-ready Event Booking API.
> The system is built with Node.js, Express, TypeScript, PostgreSQL, and BullMQ on Redis.
> Our primary engineering goal was ensuring strictly concurrent-safe ticket reservations—preventing overselling under high concurrency while maintaining high throughput and asynchronous email workflows.
> Notice our dual-service architecture: the API handles authentication, event management, and booking transactions. PostgreSQL serves as the authoritative source of truth for inventory. All notifications use a durable Transactional Outbox pattern processed asynchronously by a dedicated BullMQ background worker."

---

### 0:35 – 1:15 | Authentication, Roles, & Event Creation
**Visual**: Terminal showing cURL commands for registration, login, and organizer event creation.

**Commands to run**:
```bash
# Set BASE_URL=https://your-service.onrender.com for a deployed API.
BASE_URL="${BASE_URL:-http://localhost:3000}"
BASE_URL="${BASE_URL%/}"
CUST_EMAIL="${DEMO_CUSTOMER_EMAIL:-delivered@resend.dev}"

# 1. Register customer
curl -X POST "$BASE_URL/api/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$CUST_EMAIL\",\"password\":\"DemoPassword123!\"}"

# 2. Login as organizer and save token
ORG_TOKEN=$(curl -s -X POST "$BASE_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"bench_organizer@example.com","password":"BenchmarkPass123!"}' | jq -r .accessToken)

# 3. Create a published event with 10 tickets
EVENT_ID=$(curl -s -X POST "$BASE_URL/api/events" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ORG_TOKEN" \
  -d '{
    "title": "Exclusive Tech Gala 2026",
    "venue": "Civic Auditorium",
    "startsAt": "2026-11-01T18:00:00.000Z",
    "capacity": 10
  }' | jq -r .event.id)

echo "Created Event ID: $EVENT_ID"
```

**Spoken Script**:
> "Authentication enforces strict role-based access control. Public registration creates customer accounts only, while organizers are provisioned securely via controlled tokens.
> Here, our organizer logs in and creates 'Exclusive Tech Gala 2026' with an initial inventory of 10 tickets."

---

### 1:15 – 2:00 | Transactional Booking, Idempotency & Notifications
**Visual**: Terminal showing booking request, idempotent replay, and background worker log.

**Commands to run**:
```bash
# Customer login
CUST_TOKEN=$(curl -s -X POST "$BASE_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$CUST_EMAIL\",\"password\":\"DemoPassword123!\"}" | jq -r .accessToken)

# Book 2 tickets with Idempotency Key
curl -i -X POST "$BASE_URL/api/events/$EVENT_ID/bookings" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $CUST_TOKEN" \
  -H "Idempotency-Key: demo-idem-key-001" \
  -d '{"quantity": 2}'

# Replay exact same request (Idempotent response, no duplicate deduction)
curl -i -X POST "$BASE_URL/api/events/$EVENT_ID/bookings" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $CUST_TOKEN" \
  -H "Idempotency-Key: demo-idem-key-001" \
  -d '{"quantity": 2}'
```

**Worker Log Highlight**:
> Point to the worker terminal displaying:
> `[Worker] Processing job outbox_... of type booking_confirmation`
> `[EmailService] Booking confirmation email to delivered@resend.dev for event "Exclusive Tech Gala 2026"`

**Organizer Event Update (Task B)**:
```bash
# Update event venue & title -> triggers event_updated notifications to booked customers
curl -X PATCH "$BASE_URL/api/events/$EVENT_ID" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ORG_TOKEN" \
  -d '{"venue": "Grand Symphony Hall Room B"}'
```

**Spoken Script**:
> "When booking, the client supplies an Idempotency-Key. The booking executes atomically: inventory is conditionally decremented, the booking record is created, and an outbox event is durably committed in a single PostgreSQL transaction.
> Notice when I re-send the exact same request, the system detects the idempotent key and returns the original booking with zero double-decrementing.
> Meanwhile, look at our background worker process: it picked up the booking confirmation job and dispatched the email asynchronously without blocking the user's HTTP response.
> When the organizer updates the event venue, all confirmed customers receive an automated notification."

---

### 2:00 – 3:00 | Concurrency Proof, Baseline Degradation & Optimizations
**Visual**: Switch screen to `docs/performance.md` and show the before-and-after table.

**Run the automated concurrency verification**:
```bash
pnpm test:concurrency
```

**Spoken Script**:
> "Now let's examine concurrency and performance.
> We designed an automated concurrency test where 40 simultaneous requests contend for only 10 tickets.
> As verified in our test results, exactly 10 succeed, 30 are gracefully rejected with HTTP 409, and the database inventory lands on exactly 0. Zero tickets are ever oversold.
> 
> In Phase A, our baseline load test reached a severe degradation point under k6:
> Global IP rate-limiting starved requests after 300 hits, and a 10-connection pool caused 99.24% of requests to fail under 100 VUs.
> 
> To optimize:
> 1. We keyed rate limits by authenticated customer ID rather than global IP.
> 2. We tuned the connection pool to 50 connections.
> 3. We baked user email into the JWT claims, eliminating redundant database queries inside transactions.
> 4. We introduced composite indexes for event inventory scans."

---

### 3:00 – 3:45 | Final Benchmark Results & Summary
**Visual**: Show `artifacts/performance/optimized/throughput.log` and `docs/performance.md`.

**Spoken Script**:
> "The results speak for themselves:
> - In our final benchmark under 100 concurrent VUs, we achieved **9,027 successful transactional bookings** with **0.00% error rate**—a **30.1x throughput improvement** to **180+ bookings per second**.
> - In our contention surge test, 50 tickets were booked cleanly, 150 were gracefully turned away with 409, and zero 500 errors occurred.
> - The entire test suite has 32 passing tests covering authentication, RBAC, transactions, idempotency, outbox, and concurrency.
> 
> All source code, load test scripts, and deployment configurations are documented in our repository. Thank you!"

---

## Recording Tips for the Presenter

1. Keep cURL commands in a quick text snippet or run a bash demo script `scripts/demo-walkthrough.sh`.
2. Keep speech clear and steady.
3. Keep the video between 3:00 and 4:00 minutes.
