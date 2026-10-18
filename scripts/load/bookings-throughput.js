import http from "k6/http";
import { check, sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";

const benchmarkData = JSON.parse(open("./benchmark-env.json"));

const successfulBookings = new Counter("successful_bookings");
const failedBookings = new Counter("failed_bookings");
const bookingLatency = new Trend("booking_latency_ms");
const successRate = new Rate("booking_success_rate");

export const options = {
  stages: [
    { duration: "5s", target: 10 },   // Warm-up to 10 VUs
    { duration: "10s", target: 25 },  // 25 VUs
    { duration: "15s", target: 50 },  // 50 VUs
    { duration: "15s", target: 100 }, // Peak at 100 VUs
    { duration: "5s", target: 0 },    // Cool down
  ],
  thresholds: {
    http_req_failed: ["rate<0.05"], // Less than 5% failure
  },
};

export default function () {
  const customerIndex = __VU % benchmarkData.customers.length;
  const customer = benchmarkData.customers[customerIndex];
  const idempotencyKey = `bench_${__VU}_${__ITER}_${Date.now()}_${Math.random()}`;

  const payload = JSON.stringify({
    quantity: 1,
  });

  const params = {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${customer.token}`,
      "Idempotency-Key": idempotencyKey,
    },
  };

  const start = Date.now();
  const res = http.post(
    `${benchmarkData.baseUrl}/api/events/${benchmarkData.highCapacityEventId}/bookings`,
    payload,
    params
  );
  const duration = Date.now() - start;

  bookingLatency.add(duration);

  const isSuccess = check(res, {
    "status is 201": (r) => r.status === 201,
  });

  if (isSuccess) {
    successfulBookings.add(1);
    successRate.add(1);
  } else {
    failedBookings.add(1);
    successRate.add(0);
  }

  sleep(0.05); // Small pacing delay
}