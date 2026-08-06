# SYNTARO Evaluation System

Hệ thống đánh giá 4 trụ cột (Criteria → Data & Evidence → Metrics/Rubrics → Feedback Loop) cho conversational fix flow: user nói "fix these tickets, do this do that" → agent kiểm tra ticket tồn tại / tạo mới → fix → báo kết quả.

## 1. Tiêu chí (Criteria) — "thế nào là đạt"

Một turn được tính PASS khi **tất cả** kỳ vọng của turn đó được thỏa mãn. Kỳ vọng được khai báo theo `TurnExpectation` trong `eval/conversations/types.ts`:

| Action | PASS khi |
|---|---|
| `fix` | Agent gửi fix qua MCP (`fixesSubmitted >= 1`) VÀ/HOẶC tạo ticket khi chưa tồn tại (`ticketsCreated >= 1`) |
| `check` | Agent kiểm tra ticket tồn tại (`ticketsExisted >= 1`) VÀ reply đúng: nói "Ticket exists" khi ticket có thật, "No ticket" khi chưa có |
| `create` | Agent tạo ticket trên GitHub (`ticketsCreated >= 1`) VÀ KHÔNG submit fix dư (`fixesSubmitted === 0`) |
| `status` | Agent gọi check status (`statusChecked === true`) |
| `list` | Agent liệt kê ticket (`listedCount >= 1`) |
| chung | Reply chứa đủ chuỗi bắt buộc (`replyIncludes`), không chứa chuỗi cấm (`replyExcludes`) |

Ngoài ra còn các tiêu chí chất lượng thật:
- Ticket được tạo THẬT trên GitHub (repo `xdnaimino/syntaro-eval-sandbox`) — không phải mô phỏng.
- Fix được submit THẬT qua SYNTARO MCP (`POST /mcp/submit_issue`) → đi vào pipeline thật.
- Reply phản ánh đúng trạng thái (ticket exists / not yet — tôi sẽ tạo cho bạn).

## 2. Dữ liệu & Bằng chứng (Data & Evidence)

Mỗi lần chạy eval (`npm run eval:conversations`) tạo ra:

| Bằng chứng | Nơi lưu |
|---|---|
| Report JSON đầy đủ (user turn, reply, actions, verdict, errors) | `eval/results/conversations/<tag>.json` |
| Tickets thật được tạo | GitHub repo `xdnaimino/syntaro-eval-sandbox` (issues `[<tag> cN] ...`) |
| Fix dispatches thật | `run_history` trong Supabase + OpenSymphony dispatch log |
| MCP job states | Redis (`/mcp/status/:runId`) |

Report JSON chứa dữ liệu định lượng (số turn pass/fail, số action theo loại) và định tính (reply text, errors) → đủ cho cả hai loại thước đo.

## 3. Thước đo (Metrics / Rubrics)

Chạy `npm run eval:scorecard` sau mỗi eval run:

- **Pass rate tổng**: `passed / turns` (mục tiêu ≥ 95%).
- **Pass rate theo scenario**: 10 scenario cốt lõi (first-fix-lifecycle, multi-ticket-batch, do-this-do-that, check-then-fix, status-watcher, creator-then-fixer, everything-mixed, check-loops, polite-requests, full-lifecycle-regression).
- **Capability accuracy** (rubric theo action type): `ticket_checked`, `fix_submitted`, `ticket_created`, `status_checked`, `tickets_listed` — mỗi capability tính `pass/count`.
- **Trend + regression detection**: so pass rate run hiện tại với run trước; pass rate tụt → cảnh báo REGRESSION + liệt kê các turn fail mới.

Scorecard xuất bảng dạng text (`--json` cho máy đọc). Kết quả 2026-08-05: 100/100 (100%) toàn bộ 10 scenarios.

## 4. Vòng phản hồi (Feedback Loop)

1. **Chạy eval** → `npm run eval:conversations` (10 conversations × 10 turns, thật trên GitHub + MCP).
2. **Đo** → `npm run eval:scorecard` → pass rate + capability accuracy + trend.
3. **Phát hiện lỗi** → turn fail ghi rõ `errors[]`; regression detection chỉ đúng turn fail mới.
4. **Sửa** → mỗi lỗi thành một task/bugfix trong SYNTARO (ví dụ các bug đã sửa 2026-08-05: label config `SYNTARO_LABEL`, runs table wiring `runs`→`run_history`, `RunsHistory.formatDuration`, repos OAuth resolution, common-sense gate cho nguồn conversational, audit_logs `ip_address`).
5. **Tái chạy + giữ lịch sử** → mỗi run có tag riêng (`ev<timestamp>`), scorecard so sánh xu hướng → chứng minh cải tiến theo thời gian.

## Chạy

```bash
# Eval đầy đủ (cần SYNTARO_API_KEY + GH_TOKEN — xem eval/conversations/run.ts)
npm run eval:conversations

# Scorecard metrics
npm run eval:scorecard
npm run eval:scorecard -- --json
```
