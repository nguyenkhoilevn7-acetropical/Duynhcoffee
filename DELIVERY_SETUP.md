# Delivery status connection

Store workflow: `new` → `prep` → `shipping` → `done`.

The kitchen button records handover to the driver (`shipping`). It does not complete the customer delivery. Only the server's authenticated carrier status query can set `done`. Existing historic completed orders are retained.

## Enable a carrier on Render

Add credentials in the existing service's Environment settings. Never put credentials in HTML, GitHub, menu/config files or chat.

Lalamove production:

- `LALAMOVE_API_KEY`
- `LALAMOVE_API_SECRET`
- Requests use production host `https://rest.lalamove.com`, API v3, market `VN`, and a new HMAC-SHA256 signature for each GET.

Ahamove production:

- `AHAMOVE_ACCESS_TOKEN`: token of the account that created the shipment, or an authorized parent account, from Ahamove's partner API.
- Requests use `https://partner-api.ahamove.com/v3`.
- When this token expires it must be updated. This integration does not issue or refresh Ahamove account tokens; an expired token leaves the order pending and displays a sync error, never a false completion.

Having environment variables present is reported as *configured*, not proof that the account is connected. A successful shipment lookup validates the actual connection.

## Link an existing shipment

1. Sign in to Admin. An older admin session may ask for sign-in again to obtain a server-verified token.
2. Create the shipment in the carrier app/partner system.
3. In the order's delivery section choose the carrier and enter its real order ID. The server checks the ID against the carrier API before saving it.
4. Click **Giao cho shipper** when the store actually hands over the drinks. The order appears under **Đang Giao Hàng** and customer tracking activates step 3.
5. When the driver's delivery is confirmed by the carrier, the server completes the order and updates the admin and customer views through existing realtime synchronization.

This version links and reads existing carrier shipments. It does not create paid delivery bookings, fabricate tracking IDs or simulate drivers.

## Webhook configuration

Configure the appropriate callback in the carrier partner portal or with its API/support team:

- Ahamove: `https://mom-bd4h.onrender.com/api/delivery/webhooks/ahamove`
- Lalamove: `https://mom-bd4h.onrender.com/api/delivery/webhooks/lalamove`

The callback's claimed delivery status is never trusted. Its shipment ID triggers an independent authenticated GET to the provider; only that verified response updates an already-linked store order. Unknown shipment IDs are ignored. Repeated notifications are coalesced and throttled for 15 seconds. A one-minute background poll of up to five active shipments per cycle provides recovery when callbacks are missed. The admin **Kiểm tra với hãng** button can also request a refresh.

Ahamove: an overall `COMPLETED` trip may include failed deliveries. Every destination `path[i]` (`i > 0`) must be `COMPLETED`; failed or returned stops do not complete the customer order. Lalamove: `PICKED_UP` indicates transit and `COMPLETED` indicates delivery, provided a destination does not report failed proof of delivery. Failed shipments stay out of the completed tab for the store to resolve.

Carrier credentials and webhook setup must be verified with an actual account and shipment before claiming the live integration is active. All automated tests mock carrier APIs and do not book or charge for deliveries.

Official references:

- https://developers.lalamove.com/
- https://developers.ahamove.com/docs/introduction
- https://developers.ahamove.com/docs/order-status-flow
- https://developers.ahamove.com/docs/webhook
