# DuynhCoffee Backup — bản chờ phê duyệt triển khai

Chưa kết nối Google Drive và chưa kiểm thử với tài khoản thật. Không commit file OAuth JSON, client secret, refresh token hay khóa quản trị.

## Phạm vi

Backup gồm menu, banner/cài đặt quán và khuyến mãi. Không gồm orders, ảnh hóa đơn, password/adminAccount, secret, token hoặc API key. Mỗi lần upload tạo một file JSON mới, có SHA-256. Không tự xóa phiên bản cũ; chủ quán quản lý dung lượng và phiên bản trong Drive. Các thông tin nhận thanh toán trong config có trong backup; file không được tự động chia sẻ.

Giữ nguyên `node server.js`, `npm install`, Node >=18, `render.yaml` và kết nối GitHub → Render. Không thêm dependency.

## Trước khi triển khai

1. Xuất menu/banner/config đang dùng bằng nút backup sẵn có; kiểm tra bản xuất. Giữ riêng trên thiết bị vì bản xuất cũ có thể chứa thông tin quản trị.
2. Chủ quán duyệt nội dung privacy.html và terms.html, email liên hệ và phạm vi backup.
3. Phê duyệt push riêng: push main có thể tự kích hoạt Render. Các file mới phải đi cùng server.js; không chỉ cập nhật index.html.
4. Rollout lần đầu khi chưa đặt biến OAuth/token, nên Drive chưa hoạt động. Việc redeploy vẫn có thể làm mất dữ liệu trên disk tạm: sau rollout nhập lại bản xuất nếu cần và kiểm tra trước khi tạo backup Drive đầu tiên. Không giả định dữ liệu runtime cũ nằm trên GitHub.

## Google Cloud

Dự án Momcoffee, API Drive Enabled, OAuth Web application, chỉ scope `https://www.googleapis.com/auth/drive.file`.

Sau khi các trang chính sách thực sự lên website:

- Home: https://mom-bd4h.onrender.com/
- Privacy: https://mom-bd4h.onrender.com/privacy.html
- Terms: https://mom-bd4h.onrender.com/terms.html
- Redirect URI: https://mom-bd4h.onrender.com/api/backup/google/callback

Hoàn tất Branding/Audience theo yêu cầu Google. Chủ quán xác nhận việc chuyển OAuth app sang Production; bước này khác triển khai website. Chế độ External/Testing có refresh token thường hết hạn sau 7 ngày với scope Drive, nên không dùng để hứa backup lâu dài. Nếu Google yêu cầu xác minh bổ sung, dừng và xử lý đúng thông báo; không dùng URL chính sách giả.

## Biến môi trường Render (chủ quán nhập riêng)

- `GOOGLE_CLIENT_ID`: client ID đã tạo.
- `GOOGLE_CLIENT_SECRET`: secret từ file OAuth JSON.
- `GOOGLE_REDIRECT_URI`: URI callback bên trên.
- `BACKUP_ADMIN_KEY`: khóa ngẫu nhiên riêng ít nhất 32 ký tự (khuyến nghị 32 byte ngẫu nhiên dạng hex), không dùng mật khẩu quán.
- `GOOGLE_DRIVE_REFRESH_TOKEN`: chỉ có sau bước cấp quyền dưới đây.

Lưu biến môi trường có thể khởi động/redeploy dịch vụ; làm khi chủ quán đã duyệt và đã có bản xuất thủ công. Không tạo khóa mẫu cố định, không gửi secret trong chat.

## Cấp quyền và kích hoạt

1. Mở `/backup.html`, nhập BACKUP_ADMIN_KEY; kiểm tra OAuth đã cấu hình.
2. Nhấn Kết nối Google Drive, xác nhận, chọn tài khoản đúng tại Google, xem scope rồi tự cấp quyền.
3. Callback kiểm tra state dùng một lần, hạn 10 phút và cookie ràng buộc trình duyệt. Trang hiển thị refresh token một lần để chủ quán sao chép vào biến Render. Token không được lưu vào file cục bộ hay log. Đóng trang sau khi lưu.
4. Trước khi thêm refresh token, xuất lại dữ liệu đang dùng. Việc lưu biến Render có thể redeploy; nếu Drive chưa có bản đầu tiên, nhập lại bản xuất và nhấn Sao lưu ngay. Kiểm tra lastSuccess và file trên Drive.
5. Khi token đã được lưu trong Render, backend dùng token đó sau restart. Mỗi thay đổi được gom 1,5 giây để upload; khi lỗi giữ pending và thử lại sau 30 giây. Có thể mất những thay đổi chưa upload nếu server chết đột ngột; kiểm tra trạng thái và xuất thủ công trước redeploy.

## Khôi phục

Startup đọc Drive trước khi tạo dữ liệu mặc định. Nếu Drive đã cấu hình mà truy cập lỗi hoặc tất cả backup không hợp lệ, server dừng thay vì khởi tạo rồi upload dữ liệu mặc định. Có thể thử bản cũ khi checksum/JSON bản mới bị lỗi. Menu rỗng và banner rỗng hợp lệ được giữ.

Khôi phục thủ công yêu cầu khóa và xác nhận RESTORE. Server tạo một safety backup của dữ liệu hiện tại trước khi thay; nếu safety backup lỗi thì dừng. Sau phục hồi cập nhật caches và phát FULL_SYNC tới các phiên mở. Nếu xảy ra lỗi disk giữa nhiều file, yêu cầu thất bại; restart với Drive sẽ phục hồi lại. Đây không phải transaction nhiều file trên disk.

## Kiểm tra

`node --check server.js`
`node --check drive-backup.js`
`node --test test/*.test.js`

Tests dùng Google API mô phỏng và server cục bộ, không cấp quyền, không upload lên Drive thật. Sau triển khai cần chủ quán test đầu cuối: sửa menu/cài đặt → lastSuccess → restart → dữ liệu giữ nguyên; thử phục hồi; thu hồi quyền và kiểm tra báo lỗi.

## Vấn đề ngoài phạm vi hiện còn

Endpoint `/api/verify-receipt` trong mã hiện tại chấp nhận hóa đơn vô điều kiện; bản này chưa sửa AI. Các API quản trị/sync cũ chưa có xác thực server đầy đủ. Khóa BACKUP_ADMIN_KEY chỉ bảo vệ các API backup mới, không thay thế hệ thống đăng nhập toàn bộ website. Các mục này phải được xử lý riêng để bảo đảm quy tắc thanh toán và an toàn quản trị.
