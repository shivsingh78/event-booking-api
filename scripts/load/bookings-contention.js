import http from "k6/http";
import { check, sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";

const benchmarkData = JSON.parse(open("./benchmark-env.json"));

const successfulBookings = new Counter("contention_successful_bookings");
const soldOutResponses = new Counter("contention_sold_out_409");
const unexpectedErrors = new Counter("contention_unexpected_errors");
const latency = new Trend("contention_latency_ms");

export const options = {
  scenarios: {
    contention_surge: {
      executor: "shared-iterations",
      vus: 50,
      iterations: 200,
      maxDuration: "30s",
    },
  },
};

export default function () {
  const customerIndex = __VU % benchmarkData.customers.length;
  const customer = benchmarkData.customers[customerIndex];
  const idempotencyKey = `contend_${__VU}_${__ITER}_${Date.now()}_${Math.random()}`;

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
    `${benchmarkData.baseUrl}/api/events/${benchmarkData.limitedEventId}/bookings`,
    payload,
    params
  );
  latency.add(Date.now() - start);

  if (res.status === 201) {
    successfulBookings.add(1);
  } else if (res.status === 409) {
    soldOutResponses.add(1);
  } else {
    unexpectedErrors.add(1);
  }

  check(res, {
    "status is 201 or 409 (graceful)": (r) => r.status === 201 || r.status === 409,
    "no 500 error": (r) => r.status !== 500,
  });
}