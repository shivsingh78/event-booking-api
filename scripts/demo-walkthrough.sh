#!/usr/bin/env bash
set -e

BASE_URL="http://localhost:3000"
echo "=== 1. Health & Readiness Check ==="
curl -s "$BASE_URL/health" | jq .
curl -s "$BASE_URL/ready" | jq .
echo ""

echo "=== 2. Register Customer ==="
TIMESTAMP=$(date +%s)
CUST_EMAIL="demo_customer_${TIMESTAMP}@example.com"
REG_RES=$(curl -s -X POST "$BASE_URL/api/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$CUST_EMAIL\",\"password\":\"DemoPassword123!\"}")
echo "$REG_RES" | jq .
CUST_TOKEN=$(echo "$REG_RES" | jq -r .accessToken)
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