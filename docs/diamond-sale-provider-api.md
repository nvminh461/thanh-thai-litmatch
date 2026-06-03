# Tài liệu API Kim Cương Xả — Dành cho bên thứ ba

Tài liệu này mô tả giao diện tích hợp giữa **hệ thống Thanh Thái Litmatch** (gọi là *Merchant*) và **bên thứ ba xử lý nạp kim cương xả** (gọi là *Provider*).

Provider cần triển khai **1 endpoint nhận yêu cầu nạp** và gọi **1 webhook callback** về Merchant khi xử lý xong.

---

## 1. Tổng quan luồng

```text
[Người dùng] ── tạo QR ──► [Merchant]
                              │
                              │ lưu giao dịch: status = incomplete
                              ▼
[Người dùng] ── chuyển khoản (nội dung LMXA ...) ──► [SePay]
                              │
                              │ webhook SePay
                              ▼
                         [Merchant]
                              │
                              │ status = paid → provider_pending
                              │ POST DIAMOND_SALE_API_URL
                              ▼
                         [Provider] ── nạp kim cương Litmatch ──► [Litmatch]
                              │
                              │ POST /api/webhooks/diamond-sale
                              ▼
                         [Merchant]
                              │
                              │ status = completed | failed
                              ▼
                         [Người dùng / Admin]
```

**Tóm tắt:**

1. Người dùng tạo QR trên web Merchant, nhập **ID Litmatch** và **mật khẩu**.
2. Merchant sinh nội dung chuyển khoản dạng `LMXA {idLitmatch} {matkhau} {maDon}` và lưu giao dịch trạng thái `incomplete`.
3. Khi SePay xác nhận tiền vào, Merchant chuyển giao dịch sang `paid`, gọi API Provider, chuyển `provider_pending`.
4. Provider xử lý nạp kim cương, sau đó gọi webhook về Merchant với `status = success` hoặc `failed`.
5. Merchant chốt giao dịch `completed` hoặc `failed`. Admin có thể **retry** giao dịch lỗi với ID/mật khẩu mới.

---

## 2. Thông tin cấu hình trao đổi

| Biến env (Merchant) | Ai cung cấp | Mô tả |
|---|---|---|
| `DIAMOND_SALE_API_URL` | Provider | URL endpoint Provider nhận yêu cầu nạp |
| `DIAMOND_SALE_API_KEY` | Provider | API key Merchant gửi kèm khi gọi Provider |
| `DIAMOND_SALE_WEBHOOK_API_KEY` | Merchant | API key Provider gửi kèm khi callback webhook |
| `DIAMOND_SALE_CALLBACK_URL` | Merchant | URL webhook callback (mặc định: `{SITE_URL}/api/webhooks/diamond-sale`) |

**Provider cần cung cấp cho Merchant:**

- URL API nhận yêu cầu nạp
- API key xác thực inbound request

**Merchant cung cấp cho Provider:**

- URL webhook callback
- API key xác thực outbound webhook

---

## 3. API Provider phải triển khai (Inbound)

Merchant sẽ **POST JSON** tới `DIAMOND_SALE_API_URL` sau khi xác nhận người dùng đã chuyển khoản thành công.

### 3.1. Request

```http
POST {DIAMOND_SALE_API_URL}
Content-Type: application/json
Authorization: Apikey {DIAMOND_SALE_API_KEY}
```

**Body:**

| Field | Type | Required | Mô tả |
|---|---|---|---|
| `paymentId` | `string` | Yes | MongoDB ObjectId của giao dịch trên Merchant (24 hex chars) |
| `orderCode` | `string` | Yes | Mã đơn duy nhất, dạng `LMXA` + 8 ký tự A-Z/0-9. VD: `LMXAABC12345` |
| `source` | `string` | Yes | Nguồn giao dịch. Xem [§5.1](#51-source) |
| `litmatchId` | `string` | Yes | ID Litmatch (5–20 chữ số) |
| `password` | `string` | Yes | Mật khẩu người dùng nhập. Không có khoảng trắng, tối đa 64 ký tự |
| `diamondAmount` | `number` | Yes | Số kim cương cần nạp (integer > 0) |
| `amount` | `number` | Yes | Số tiền VND người dùng đã chuyển (integer > 0) |
| `transferContent` | `string` | Yes | Nội dung chuyển khoản đầy đủ |
| `callbackUrl` | `string` | No | URL webhook Merchant muốn Provider gọi lại. Nếu có, Provider **nên** dùng URL này thay vì hardcode |

**Ví dụ request:**

```json
{
  "paymentId": "665f8f3e0000000000000001",
  "orderCode": "LMXAABC12345",
  "source": "frontend_qr",
  "litmatchId": "123456789",
  "password": "matkhau123",
  "diamondAmount": 40000,
  "amount": 1000000,
  "transferContent": "LMXA 123456789 matkhau123 LMXAABC12345",
  "callbackUrl": "https://your-domain.com/api/webhooks/diamond-sale"
}
```

### 3.2. Response Provider nên trả về

Merchant chấp nhận **HTTP 2xx**. Body JSON hoặc text đều được parse.

| Field (khuyến nghị) | Type | Mô tả |
|---|---|---|
| `externalRequestId` | `string` | ID yêu cầu nội bộ của Provider. Merchant lưu để đối soát webhook |
| `requestId` | `string` | Alias của `externalRequestId` (Merchant đọc cả 3 field) |
| `id` | `string` | Alias của `externalRequestId` |
| `message` | `string` | Thông báo mô tả |
| `status` | `string` | Alias của `message` |

**Ví dụ response thành công (HTTP 200):**

```json
{
  "externalRequestId": "provider-req-001",
  "message": "Request accepted"
}
```

**Ví dụ response lỗi (HTTP 4xx/5xx):**

```json
{
  "message": "Invalid litmatch credentials"
}
```

> **Lưu ý:** Nếu Merchant không gọi được API Provider (HTTP lỗi, timeout, chưa cấu hình URL), giao dịch sẽ chuyển thẳng sang `failed`. Provider nên trả `200` ngay khi **chấp nhận** yêu cầu và xử lý bất đồng bộ, sau đó callback webhook.

### 3.3. Idempotency (khuyến nghị)

Merchant có thể gọi lại API khi **admin retry** giao dịch lỗi. Provider nên:

- Dùng `paymentId` hoặc `orderCode` làm khóa idempotent.
- Nếu đã nhận yêu cầu trước đó, trả lại cùng `externalRequestId` thay vì tạo bản ghi mới.

---

## 4. Webhook Provider gọi về Merchant (Outbound)

Sau khi xử lý nạp kim cương xong (thành công hoặc thất bại), Provider **POST JSON** về Merchant.

### 4.1. Request

```http
POST {DIAMOND_SALE_CALLBACK_URL}
Content-Type: application/json
Authorization: Apikey {DIAMOND_SALE_WEBHOOK_API_KEY}
```

**Body:**

| Field | Type | Required | Mô tả |
|---|---|---|---|
| `paymentId` | `string` | Conditional | MongoDB ObjectId giao dịch. **Bắt buộc** nếu không có `orderCode` |
| `orderCode` | `string` | Conditional | Mã đơn `LMXA...`. **Bắt buộc** nếu không có `paymentId` |
| `externalRequestId` | `string` | Khuyến nghị | ID yêu cầu nội bộ Provider, dùng cho đối soát và chống trùng |
| `status` | `string` | Yes | Chỉ chấp nhận `"success"` hoặc `"failed"` |
| `message` | `string` | No | Mô tả kết quả. Nếu bỏ trống Merchant dùng message mặc định |

**Ví dụ webhook thành công:**

```json
{
  "paymentId": "665f8f3e0000000000000001",
  "orderCode": "LMXAABC12345",
  "externalRequestId": "provider-req-001",
  "status": "success",
  "message": "Da nap thanh cong"
}
```

**Ví dụ webhook thất bại:**

```json
{
  "paymentId": "665f8f3e0000000000000001",
  "orderCode": "LMXAABC12345",
  "externalRequestId": "provider-req-001",
  "status": "failed",
  "message": "Sai mat khau Litmatch"
}
```

### 4.2. Response Merchant trả về

**HTTP 200 — xử lý thành công:**

```json
{
  "success": true,
  "status": "processed",
  "paymentId": "665f8f3e0000000000000001",
  "message": "Da nap thanh cong"
}
```

**HTTP 200 — webhook trùng (đã xử lý trước đó):**

```json
{
  "success": true,
  "status": "duplicate",
  "paymentId": "665f8f3e0000000000000001",
  "message": "Webhook already processed."
}
```

**HTTP 401 — sai API key:**

```json
{
  "success": false,
  "message": "Unauthorized"
}
```

**HTTP 400 — payload không hợp lệ:**

```json
{
  "success": false,
  "status": "invalid_payload",
  "message": "Trạng thái webhook kim cương xả không hợp lệ."
}
```

**HTTP 500 — lỗi server:**

```json
{
  "success": false,
  "status": "internal_error",
  "message": "Webhook processing failed"
}
```

### 4.3. Quy tắc chống trùng webhook

Merchant tạo `eventKey` theo công thức:

```text
{paymentId hoặc orderCode}:{externalRequestId}:{status}
```

Webhook có cùng `eventKey` sẽ được trả `status = duplicate` và **không** cập nhật lại giao dịch.

**Khuyến nghị cho Provider:**

- Luôn gửi `externalRequestId` cố định cho mỗi lần xử lý.
- Chỉ gửi webhook **một lần** cho mỗi kết quả cuối cùng (`success` hoặc `failed`).
- Nếu nhận `duplicate`, coi như đã ghi nhận thành công.

### 4.4. Ảnh hưởng tới trạng thái giao dịch

| `status` webhook | Trạng thái Merchant sau xử lý |
|---|---|
| `success` | `completed` |
| `failed` | `failed` (trừ khi giao dịch đã `completed` trước đó) |

---

## 5. Tham chiếu dữ liệu

### 5.1. `source`

| Giá trị | Mô tả |
|---|---|
| `frontend_qr` | Người dùng tạo QR trên web trước, có `orderCode` trong nội dung CK |
| `manual_transfer` | Khách tự chuyển khoản không tạo QR trước; Merchant tự tạo giao dịch khi SePay báo tiền |

### 5.2. Trạng thái giao dịch trên Merchant

| Status | Ý nghĩa |
|---|---|
| `incomplete` | Đã tạo QR, chưa nhận tiền |
| `paid` | Đã nhận tiền, đang chuẩn bị gọi Provider |
| `provider_pending` | Đã gọi Provider thành công, chờ webhook |
| `completed` | Provider báo nạp thành công |
| `failed` | Gọi Provider thất bại hoặc Provider báo nạp thất bại |

### 5.3. Định dạng nội dung chuyển khoản

**Có mã đơn (QR tạo từ web):**

```text
LMXA {idLitmatch} {matkhau} {orderCode}
```

Ví dụ:

```text
LMXA 123456789 matkhau123 LMXAABC12345
```

**Không có mã đơn (tự chuyển khoản):**

```text
LMXA {idLitmatch} {matkhau}
```

Ví dụ:

```text
LMXA 123456789 matkhau123
```

**Quy tắc:**

- Prefix cố định: `LMXA`
- `idLitmatch`: 5–20 chữ số
- `matkhau`: chuỗi không khoảng trắng, không ký tự điều khiển, tối đa 64 ký tự
- `orderCode`: `LMXA` + 8 ký tự `[A-Z0-9]`

### 5.4. Cách tính `diamondAmount`

Merchant tính theo cấu hình `diamondSaleRate` (admin chỉnh được):

- `baseAmount`: mốc tiền cơ sở (mặc định `1000` VND)
- `tiers[]`: các mốc `{ minAmount, diamond }`

Công thức:

```text
diamondAmount = floor(amount / baseAmount * tier.diamond)
```

Chọn `tier` có `minAmount` lớn nhất mà `amount >= minAmount`.

**Ví dụ mặc định:**

| Số tiền (`amount`) | Tỉ lệ | Kim cương nhận (`diamondAmount`) |
|---|---|---|
| 500.000 VND | 1000đ = 38 KC | 19.000 KC |
| 1.000.000 VND | 1000đ = 40 KC | 40.000 KC |

Provider **không** cần tự tính lại; dùng trực tiếp `diamondAmount` trong request.

---

## 6. Luồng retry (Admin)

Khi giao dịch ở trạng thái `failed` và đã có xác nhận thanh toán (`paidAt` hoặc dữ liệu SePay), admin Merchant có thể retry với **ID Litmatch** và **mật khẩu mới**.

Merchant sẽ:

1. Cập nhật `litmatchId`, `password` trên giao dịch.
2. Gọi lại API Provider với body mới (cùng `paymentId`, `orderCode`).
3. Chờ webhook callback như bình thường.

Provider nên xử lý retry như một yêu cầu mới nhưng idempotent theo `paymentId`.

---

## 7. Ví dụ tích hợp (cURL)

### 7.1. Provider nhận yêu cầu (mock)

```bash
curl -X POST "https://provider.example.com/api/recharge" \
  -H "Content-Type: application/json" \
  -H "Authorization: Apikey YOUR_PROVIDER_API_KEY" \
  -d '{
    "paymentId": "665f8f3e0000000000000001",
    "orderCode": "LMXAABC12345",
    "source": "frontend_qr",
    "litmatchId": "123456789",
    "password": "matkhau123",
    "diamondAmount": 40000,
    "amount": 1000000,
    "transferContent": "LMXA 123456789 matkhau123 LMXAABC12345",
    "callbackUrl": "https://merchant.example.com/api/webhooks/diamond-sale"
  }'
```

### 7.2. Provider callback webhook

```bash
curl -X POST "https://merchant.example.com/api/webhooks/diamond-sale" \
  -H "Content-Type: application/json" \
  -H "Authorization: Apikey YOUR_WEBHOOK_API_KEY" \
  -d '{
    "paymentId": "665f8f3e0000000000000001",
    "orderCode": "LMXAABC12345",
    "externalRequestId": "provider-req-001",
    "status": "success",
    "message": "Da nap thanh cong"
  }'
```

---

## 8. Checklist tích hợp

### Provider

- [ ] Triển khai endpoint nhận POST JSON, xác thực header `Authorization: Apikey ...`
- [ ] Trả HTTP 2xx khi chấp nhận yêu cầu, kèm `externalRequestId`
- [ ] Xử lý nạp kim cương bất đồng bộ bằng `litmatchId`, `password`, `diamondAmount`
- [ ] Callback webhook với `status = success` hoặc `failed`
- [ ] Gửi `externalRequestId` cố định, tránh gửi trùng cùng kết quả
- [ ] Hỗ trợ idempotent theo `paymentId` / `orderCode` cho retry

### Merchant (phía Thanh Thái Litmatch)

- [ ] Cấu hình `DIAMOND_SALE_API_URL`, `DIAMOND_SALE_API_KEY`
- [ ] Cấu hình `DIAMOND_SALE_WEBHOOK_API_KEY`, `DIAMOND_SALE_CALLBACK_URL`
- [ ] Cung cấp webhook URL và API key cho Provider
- [ ] Test end-to-end: tạo QR → chuyển khoản → Provider nhận request → callback → kiểm tra admin

---

## 9. Endpoint liên quan (tham khảo, không thuộc phạm vi Provider)

Các endpoint sau thuộc Merchant, Provider **không** cần gọi trực tiếp:

| Endpoint | Mô tả |
|---|---|
| `POST /api/payments/diamond-sale` | Người dùng tạo QR (frontend) |
| `GET /api/payments/status?type=diamond-sale&id={paymentId}` | Người dùng tra cứu trạng thái |
| `POST /api/webhooks/sepay` | SePay báo tiền vào (trigger gọi Provider) |

---

## 10. Liên hệ khi tích hợp

Khi bắt đầu tích hợp, hai bên cần trao đổi:

1. URL API Provider + API key inbound
2. URL webhook Merchant + API key outbound
3. Môi trường test/staging (nếu có)
4. IP whitelist (nếu cần)
5. Timeout và chính sách retry webhook (khuyến nghị: retry tối đa 3 lần, exponential backoff)
