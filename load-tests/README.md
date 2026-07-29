# STAS Load Tests

k6 load tests for 500-user scaling verification.

```bash
./scripts/run-load-test.sh
```

## Scenarios

- **api-benchmark**: Ramp to 200 concurrent health checks
- **webhook-flood**: Ramp to 200 concurrent webhook deliveries
- **queue-throughput**: Sustained 100 req/s for 3 minutes
- **full-suite**: 50 health VUs + ramp to 500 webhook VUs

## Acceptance Criteria

| Metric | Target |
|--------|--------|
| P95 webhook latency | <500ms |
| P95 health latency | <200ms |
| Error rate | <1% |
| No connection exhaustion | 0 pool errors |
