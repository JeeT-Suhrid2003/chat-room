# Stress Test Results

## Summary

The recorded k6 run completed successfully: all 62,718 HTTP checks passed, no requests failed, and the 95th-percentile request duration was 7.77 ms, within the configured 500 ms limit.

## Test setup

- **Tool:** k6
- **Script:** `stress-test.js`
- **Target:** `http://frontend.small-room.local/`
- **Load:** Ramp to 50 virtual users, hold, ramp to 100, hold, then ramp down
- **Duration:** 16 minutes
- **Checks:** HTTP status is 200
- **Thresholds:** p(95) request duration below 500 ms; request failure rate below 1%

## Results

| Metric | Result | Threshold / expectation | Outcome |
| --- | ---: | ---: | --- |
| HTTP checks passed | 62,718 / 62,718 (100%) | All status checks return 200 | Pass |
| HTTP requests failed | 0 / 62,718 (0%) | Less than 1% | Pass |
| Request duration, average | 3.57 ms | — | — |
| Request duration, p(90) | 5.16 ms | — | — |
| Request duration, p(95) | 7.77 ms | Below 500 ms | Pass |
| Request duration, maximum | 138.87 ms | — | — |
| Request rate | 65.33 requests/s | — | — |
| Maximum virtual users | 100 | 100 | Reached |
| Data received | 306 MB | — | — |
| Data sent | 5.1 MB | — | — |

## Notes

This run checks HTTP GET requests to the frontend root page. It does not measure Socket.IO connections, chat message throughput, or database write performance. Results describe this run and its environment; repeat the test under your target deployment conditions before using them as a capacity guarantee.
