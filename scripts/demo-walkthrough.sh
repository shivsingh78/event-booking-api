#!/usr/bin/env bash
set -euo pipefail

# Pass BASE_URL=https://your-service.onrender.com to run this against Render.
BASE_URL="${BASE_URL:-http://localhost:3000}"
BASE_URL="${BASE_URL%/}"
# Resend's controlled delivery test recipient keeps a live demo from targeting
# example.com. Override it with a unique inbox you control when appropriate.
DEMO_CUSTOMER_EMAIL="${DEMO_CUSTOMER_EMAIL:-delivered@resend.dev}"

echo "=== 1. Health & Readiness Check ==="
curl -s "$BASE_URL/health" | jq .
curl -s "$BASE_URL/ready" | jq .
echo ""

echo "=== 2. Register Customer ==="
TIMESTAMP=$(date +%s)
CUST_EMAIL="$DEMO_CUSTOMER_EMAIL"
REG_RES=$(curl -s -X POST "$BASE_URL/api/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$CUST_EMAIL\",\"password\":\"DemoPassword123!\"}")
echo "$REG_RES" | jq .
CUST_TOKEN=$(echo "$REG_RES" | jq -r .accessToken)
if [[ -z "$CUST_TOKEN" || "$CUST_TOKEN" == "null" ]]; then
  echo "Customer registration failed. Set DEMO_CUSTOMER_EMAIL to a fresh controlled inbox and try again." >&2
  exit 1
fi
echo ""

echo "=== 3. Organizer Login & Create Event ==="
ORG_TOKEN=$(curl -s -X POST "$BASE_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"bench_organizer@example.com","password":"BenchmarkPass123!"}' | jq -r .accessToken)

EVENT_RES=$(curl -s -X POST "$BASE_URL/api/events" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ORG_TOKEN" \
  -d '{
    "title": "Exclusive Tech Gala 2026",
    "venue": "Civic Auditorium Main Hall",
    "startsAt": "2026-11-05T19:00:00.000Z",
    "capacity": 10
  }')
echo "$EVENT_RES" | jq .
EVENT_ID=$(echo "$EVENT_RES" | jq -r .event.id)
echo "Created Event ID: $EVENT_ID"
echo ""

echo "=== 4. Customer Books 2 Tickets with Idempotency Key ==="
IDEM_KEY="demo_key_${TIMESTAMP}"
BOOK_RES1=$(curl -s -X POST "$BASE_URL/api/events/$EVENT_ID/bookings" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $CUST_TOKEN" \
  -H "Idempotency-Key: $IDEM_KEY" \
  -d '{"quantity": 2}')
echo "$BOOK_RES1" | jq .
echo ""

echo "=== 5. Replay Same Booking (Idempotency Proof) ==="
BOOK_RES2=$(curl -s -X POST "$BASE_URL/api/events/$EVENT_ID/bookings" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $CUST_TOKEN" \
  -H "Idempotency-Key: $IDEM_KEY" \
  -d '{"quantity": 2}')
echo "$BOOK_RES2" | jq .
echo ""

echo "=== 6. Organizer Updates Event Details (Triggers Notifications) ==="
UPD_RES=$(curl -s -X PATCH "$BASE_URL/api/events/$EVENT_ID" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ORG_TOKEN" \
  -d '{"venue": "Civic Auditorium - VIP Pavilion"}')
echo "$UPD_RES" | jq .
echo ""

echo "=== 7. Customer Views Own Bookings ==="
curl -s "$BASE_URL/api/bookings/me" \
  -H "Authorization: Bearer $CUST_TOKEN" | jq .
echo ""

echo "Demo Walkthrough Completed Successfully!"
