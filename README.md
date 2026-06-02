# Thanh Thái Litmatch

Ứng dụng Next.js để tạo QR chuyển khoản/nạp thẻ, lưu giao dịch vào MongoDB, nhận webhook SePay/PAY1S và tự động nạp kim cương hoặc sao qua Litmatch agent.

## Luồng Chính

Chuyển khoản:

1. Người dùng xác minh ID Litmatch, chọn kim cương hoặc sao, chọn số tiền và tạo QR.
2. Server tính số thực nhận theo `bankRate` trong MongoDB, sinh nội dung chuyển khoản `LM...`, lưu `bank_payments.status = incomplete`.
3. SePay gọi `/api/webhooks/sepay`; server xác thực `Authorization: Apikey <token>`, match mã chuyển khoản và số tiền.
4. Giao dịch chuyển sang `paid`, server xác minh lại ID Litmatch và gọi Litmatch agent `transfer_accounts`.
5. Thành công thì `completed`; lỗi xác minh hoặc lỗi API thì `recharge_failed`.

QR chuyển khoản trọn đời:

1. Người dùng bấm `QR trọn đời`, chọn kim cương hoặc sao, nhập và xác minh ID Litmatch.
2. Server sinh một mã chuyển khoản mới, lưu vào `lifetime_bank_qrs` và trả VietQR không có số tiền cố định.
3. Người dùng có thể lưu QR/mã này và dùng lại nhiều lần. Nếu tạo lại cùng ID, hệ thống vẫn sinh mã mới; mã cũ vẫn hoạt động.
4. Khi SePay báo tiền vào, server match mã trọn đời, tạo một bản ghi `bank_payments.mode = lifetime` cho từng webhook, lấy số tiền thực chuyển và tính phần nhận bằng `bankRate` hiện tại.
5. Giao dịch được nạp Litmatch như chuyển khoản thường. Webhook trùng `sepay.id` không nạp lại.

Nạp thẻ:

1. Người dùng xác minh ID Litmatch, chọn `VIETTEL`, `MOBIFONE` hoặc `VINAPHONE`, chọn mệnh giá và nhập mã/seri thẻ.
2. Server tính số thực nhận theo `cardRate` trong MongoDB, tạo `request_id`, lưu `card_payments.status = processing`.
3. Server gửi thẻ sang PAY1S/DOITHE1S với `sign = md5(partner_key + code + serial)`.
4. PAY1S gọi `/api/webhooks/pay1s`; server xác minh `callback_sign` cùng công thức MD5.
5. Callback `status = 1` tự nạp Litmatch. Callback `status = 2` không tự nạp, chuyển `recharge_failed` để kiểm tra thủ công. Callback lỗi khác cũng chuyển `recharge_failed`.

## Cài Đặt

```bash
npm install
```

Tạo `.env` từ `.env.example` và cấu hình tối thiểu:

```env
DATABASE_URL=mongodb+srv://user:password@cluster.example.net/litmatch_top_up?retryWrites=true&w=majority
DATABASE_NAME=litmatch_top_up
NEXT_PUBLIC_SITE_URL=https://your-domain.com

TOTP_SECRET=your_base32_secret_here
TOTP_ISSUER=Litmatch
TOTP_LABEL=your_account_label

LIT_AGENT_PHONE=your_agent_phone
LIT_AGENT_ZONE=84
LIT_AGENT_BASE_URL=https://agent.litatom.com

SEPAY_WEBHOOK_API_KEY=your_sepay_webhook_api_key

PAY1S_PARTNER_ID=your_partner_id
PAY1S_PARTNER_KEY=your_partner_key
PAY1S_BASE_URL=https://doithe1s.vn/chargingws/v2

ADMIN_USERNAME=admin
ADMIN_PASSWORD=change_me
ADMIN_SESSION_SECRET=replace_with_a_long_random_secret
```

Tỉ giá không lấy từ env. Khi DB chưa có cấu hình mới, hệ thống dùng mặc định:

- Chuyển khoản: `1000 VND = 270 sao, 27 kim cương`.
- Nạp thẻ: `1000 VND = 220 sao, 22 kim cương`.

VietQR cũng không lấy từ env. Cấu hình ngân hàng, số tài khoản, chủ tài khoản và template QR được lưu trong MongoDB qua admin.

Chạy dev:

```bash
npm run dev
```

Build production:

```bash
npm run build
npm run start
```

## Admin

Mở:

```text
http://localhost:3000/admin/login
```

Lần đăng nhập đầu tiên seed `adminCredentials` vào collection `app_settings` từ `ADMIN_USERNAME` và `ADMIN_PASSWORD`.

Đổi/reset mật khẩu admin:

```bash
npm run reset-admin-password
```

Hoặc truyền trực tiếp:

```bash
npm run reset-admin-password -- --username admin --password "new-password"
```

Admin có các màn:

- Cấu hình hệ thống: VietQR, tỉ lệ chuyển khoản, tỉ lệ nạp thẻ.
- Giao dịch chuyển khoản: lọc trạng thái, ID Litmatch, nội dung chuyển khoản, ngày cập nhật, phân biệt QR cố định/QR trọn đời, phân trang 20 giao dịch/trang.
- Giao dịch nạp thẻ: lọc trạng thái, ID Litmatch, ngày cập nhật, thông tin PAY1S/callback, trạng thái nạp Litmatch, phân trang 20 giao dịch/trang.

Các trạng thái giao dịch:

- `incomplete`: đã tạo giao dịch, chưa thanh toán/chưa gửi xử lý.
- `processing`: thẻ đã gửi sang PAY1S, đang chờ callback.
- `paid`: đã nhận tiền hoặc thẻ đúng, đang xử lý nạp.
- `completed`: đã nạp Litmatch thành công.
- `recharge_failed`: đã nhận kết quả nhưng xác minh ID, provider hoặc API nạp Litmatch lỗi.

## Webhook

### SePay

Webhook URL:

```text
https://your-domain.com/api/webhooks/sepay
```

Cấu hình trên SePay:

- Method: `POST`
- Content-Type: `application/json`
- Header: `Authorization: Apikey <SEPAY_WEBHOOK_API_KEY>`
- Prefix/mã thanh toán: dùng prefix giống `PAYMENT_CODE_PREFIX`, mặc định `LM`

Ứng dụng match theo `payload.code` trước. Nếu `code` trống, hệ thống tìm mã `LM...` trong `payload.content`.

Với QR chuyển khoản trọn đời, webhook không cần khớp số tiền đã khai báo trước. Hệ thống dùng `payload.transferAmount` để tính số kim cương/sao theo tỉ giá chuyển khoản đang lưu trong MongoDB tại thời điểm nhận webhook.

Phản hồi webhook:

- Thành công (`200`): `ignored`, `recharge_completed`, `already_paid`, `duplicate` (đã xử lý trước đó).
- Lỗi nghiệp vụ (`422`): `unmatched`, `amount_mismatch` — SePay có thể gửi lại thủ công; webhook trước đó ở các trạng thái này sẽ được xử lý lại khi gửi lại cùng `id`.
- Lỗi nạp Litmatch (`500`): `recharge_failed` — có thể gửi lại để thử nạp lại nếu giao dịch ngân hàng đã được ghi nhận.
- Payload/API key không hợp lệ: `400` / `401`.

Ví dụ lỗi:

```json
{
  "success": false,
  "status": "unmatched",
  "sepayId": 60561246,
  "message": "Không tìm thấy giao dịch chuyển khoản tương ứng."
}
```

### PAY1S/DOITHE1S

Callback URL:

```text
https://your-domain.com/api/webhooks/pay1s
```

PAY1S gửi JSON callback. Server xác minh:

```text
callback_sign == md5(PAY1S_PARTNER_KEY + code + serial)
```

Webhook hợp lệ luôn trả:

```json
{ "success": true }
```

Sai chữ ký PAY1S trả `401`. SePay sai API key cũng trả `401`.

## Ghi Chú Vận Hành

- `DATABASE_URL`, `SEPAY_WEBHOOK_API_KEY`, `PAY1S_*`, `TOTP_*`, `LIT_AGENT_*` và `ADMIN_SESSION_SECRET` chỉ cấu hình trong env.
- VietQR, tỉ lệ nạp và prefix mã thanh toán được lưu trong MongoDB và chỉnh trong admin.
- Webhook duplicate không nạp lại nhờ unique index trên `sepay.id` và `card_webhook_events.eventKey`.
- QR chuyển khoản trọn đời không hết hạn trong ứng dụng; muốn vô hiệu hóa mã cũ cần bổ sung màn quản trị riêng.
- Callback thẻ `status = 2` được ghi lỗi sai mệnh giá và không tự nạp Litmatch.
