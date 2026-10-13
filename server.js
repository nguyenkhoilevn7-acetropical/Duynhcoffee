"""
Backend Server for Đuỷnh Tea & Coffee (Python/Flask)
Handles bilingual translations, real-time order sync, and POS management.
"""
from http.server import HTTPServer, BaseHTTPRequestHandler
import json
import os

PORT = int(os.environ.get('PORT', 8080))

TRANSLATIONS = {
    "vi": {
        "brand_title": "ĐUỶNH TEA & COFFEE",
        "brand_sub": "NGON ĐẾN GIỌT CUỐI CÙNG",
        "nav_track": "Tra Cứu",
        "nav_cart": "Giỏ",
        "cat_all": "Tất cả",
        "cat_tea": "Trà Trái Cây",
        "cat_coffee": "Cà Phê",
        "cat_cake": "Bánh Ngọt",
        "cat_special": "Đặc Biệt",
        "btn_add": "+ Thêm",
        "checkout_title": "Thanh Toán Đơn Hàng",
        "checkout_name_label": "Tên khách hàng:",
        "checkout_phone_label": "Số điện thoại:",
        "checkout_addr_label": "Địa chỉ nhận hàng (Bán kính 15km):",
        "admin_header_title": "Quản Trị Hệ Thống Đuỷnh Tea & Coffee",
        "tab_new": "Đơn Mới",
        "tab_prep": "Đang Pha Chế",
        "tab_done": "Đã Hoàn Tất",
        "tab_cancelled": "Đã Hủy"
    },
    "en": {
        "brand_title": "DUYNH TEA & COFFEE",
        "brand_sub": "DELICIOUS TO THE VERY LAST DROP",
        "nav_track": "Track Order",
        "nav_cart": "Cart",
        "cat_all": "All Menu",
        "cat_tea": "Fruit Tea",
        "cat_coffee": "Coffee",
        "cat_cake": "Pastries & Cakes",
        "cat_special": "Signatures",
        "btn_add": "+ Add",
        "checkout_title": "Order Checkout",
        "checkout_name_label": "Customer Name:",
        "checkout_phone_label": "Phone Number:",
        "checkout_addr_label": "Delivery Address (Within 15km):",
        "admin_header_title": "Duynh Tea & Coffee Management System",
        "tab_new": "New Orders",
        "tab_prep": "In Kitchen",
        "tab_done": "Completed",
        "tab_cancelled": "Cancelled"
    }
}

class BackendHandler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_GET(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.end_headers()

        if self.path.startswith('/api/translations'):
            lang = 'en' if 'lang=en' in self.path else 'vi'
            data = {"status": "success", "lang": lang, "translations": TRANSLATIONS[lang]}
            self.wfile.write(json.dumps(data, ensure_ascii=False).encode('utf-8'))
        else:
            self.wfile.write(json.dumps({"status": "running", "service": "Duynh POS Backend"}).encode('utf-8'))

def run():
    server = HTTPServer(('0.0.0.0', PORT), BackendHandler)
    print(f"🚀 Duynh Tea & Coffee Backend API running on port {PORT}")
    server.serve_forever()

if __name__ == '__main__':
    run()
