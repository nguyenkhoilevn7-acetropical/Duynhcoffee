# AI menu Việt–Anh (Gemini)

## Kết nối một lần, không bật thanh toán

1. Vào https://aistudio.google.com/api-keys bằng tài khoản Google của chủ quán.
2. Tạo khóa Gemini API trong **dự án Free tier, chưa liên kết Cloud Billing**. Không bật trả phí, không nâng cấp tier. Gói Google AI Pro cá nhân không xác định tier của API.
3. Trong dịch vụ Render hiện có → Environment, thêm `GEMINI_API_KEY` với khóa vừa tạo. Chỉ nhập khóa tại Render, không gửi vào chat, GitHub, menu hoặc Settings công khai.
4. Save, rebuild/redeploy dịch vụ hiện tại. Giữ nguyên build/start command, GitHub connection và các biến môi trường khác.
5. Đăng nhập quản trị; sửa hoặc thêm món với tên và ảnh. Chờ trạng thái tạo xong mô tả Việt–Anh, kiểm tra nội dung rồi bấm Lưu.

Mặc định dùng Gemini Flash (`gemini-flash-latest`, tên model trong hướng dẫn hiện tại của AI Studio), có Free tier theo bảng giá Google tại ngày triển khai. Khi model Flash trả HTTP 503, thử một lần bằng `gemini-3.5-flash-lite` (cũng có Free tier), trong cùng thời hạn 45 giây. Không dùng dịch vụ tìm kiếm hay tạo ảnh có phí, không tự chuyển sang model/nhà cung cấp trả phí, không có mã kích hoạt billing. **Việc API có được miễn phí phụ thuộc dự án gắn với khóa**: nếu dùng khóa của dự án đã bật billing, Google có thể tính tiền. Luôn chọn dự án chưa bật billing.

Hạn mức xem tại AI Studio. Backend giới hạn 5 lượt/phút, gộp yêu cầu trùng, lưu tối đa 100 kết quả tạm; bản dịch đã Lưu theo cùng menu vào cơ chế đồng bộ/Drive hiện có. Khách xem menu không gọi Gemini. Hết hạn mức báo lỗi, không tự nâng cấp.

Tên, ảnh món và mô tả gửi tới Google. Theo chính sách Free tier, Google có thể dùng dữ liệu để cải thiện sản phẩm. Chỉ dùng ảnh món công khai, không đưa thông tin khách hàng vào ảnh/mô tả.

## Kiểm tra

- Endpoint `/api/menu-ai/status` yêu cầu token quản trị, chỉ trả configured và tên model, không trả khóa.
- `/api/menu-ai/generate` yêu cầu token quản trị, không tự ghi hoặc xuất bản menu.
- Đổi tên Việt xóa ngay bản Anh cũ và tạo lại. Đổi ảnh/mô tả Việt cũng tạo lại; phản hồi của bản nhập cũ bị bỏ qua.
- AI không suy đoán thành phần ẩn; ảnh dùng để nhận diện cách trình bày, thành phần chỉ nêu khi tên hoặc mô tả chủ quán xác nhận.
- Khi AI chưa kết nối/hết quota, nội dung hiện tại được giữ và có nút lưu thủ công. Chưa cấu hình khóa thì không coi là đã kiểm chứng AI trực tiếp.
