import { check, sleep } from 'k6';
import http from 'k6/http';

export const options = {
  stages: [
    { duration: '2m', target: 50 },  // Ramp-up to 50 users over 2 minutes
    { duration: '5m', target: 50 },  // Stay at 50 users for 5 minutes
    { duration: '2m', target: 100 }, // Ramp-up to 100 users (stress phase)
    { duration: '5m', target: 100 }, // Stay at 100 users
    { duration: '2m', target: 0 },   // Scale down to 0 recovery phase
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'], // 95% of requests must complete below 500ms
    http_req_failed: ['rate<0.01'],   // Error rate must stay below 1%
  },
};

export default function () {
  const res = http.get('http://frontend.small-room.local/');
  check(res, {
    'status is 200': (r) => r.status === 200,
  });
  sleep(1);
}