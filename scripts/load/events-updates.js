import http from "k6/http";
import { check, sleep } from "k6";
import { Counter, Trend } from "k6/metrics";

const benchmarkData = JSON.parse(open("./benchmark-env.json"));

const updateLatency = new Trend("event_update_latency_ms");
const successfulUpdates = new Counter("successful_event_updates");

export const options = {
  scenarios: {
    event_updates: {
      executor: "constant-vus",
      vus: 10,
      duration: "15s",
    },
  },
};

export default function () {
  const payload = JSON.stringify({
    title: `Keynote Title Iteration ${__ITER}`,
    venue: `Main Auditorium Room ${(__ITER % 5) + 1}`,
  });

  const params = {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${benchmarkData.organizerToken}`,
    },
  };

  const start = Date.now();
  const res = http.patch(
    `${benchmarkData.baseUrl}/api/events/${benchmarkData.updateEventId}`,
    payload,
    params
  );
  updateLatency.add(Date.now() - start);

  const isSuccess = check(res, {
    "status is 200": (r) => r.status === 200,
  });

  if (isSuccess) {
    successfulUpdates.add(1);
  }

  sleep(0.1);
}