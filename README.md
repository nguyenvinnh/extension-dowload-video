# Video Downloader Pro 

Extension tải video nâng cao dành cho Chrome/Chromium, xây dựng trên nền tảng **Manifest V3** sử dụng giao diện **Side Panel**.

---

## 1. Những điều extension CÓ THỂ LÀM DƯỢC

* **Phát hiện & Bắt luồng đa kênh:** Tự động phát hiện video HLS (`.m3u8`) và Direct (`.mp4`, `.webm`) thông qua Network Headers, DOM Scanner và can thiệp XHR/Fetch ở `MAIN` world. Lọc bỏ file rác (<50KB).
* **Vượt rào cản Token & Header:** Giữ nguyên query token (chống lỗi HS256) khi chuyển đổi URL segment. Tự động thêm/chỉnh sửa `Referer` và `Origin` khớp với trang gốc để tránh lỗi HTTP 403.
* **Giải mã & Rebuild MP4 chuẩn:** 
  * Tự động giải mã stream mã hóa `AES-128`.
  * Chuẩn hóa cấu trúc fMP4 (rebase decode time, renumber sequence, fix duration/timescale) giúp tương thích tốt với QuickTime, VLC, Safari...
  * Chuyển đổi MPEG-TS sang MP4 hoặc cho phép xuất file `.ts` gốc.
* **Cắt Clip (Timeline Clipper):** Tích hợp trình xem trước (16:9), hỗ trợ chọn điểm bắt đầu/kết thúc để cắt video theo từng đoạn (`mm:ss`, `hh:mm:ss`) và tải về riêng biệt.

---

## ⚠️ 2. Hạn chế & Những điều CHƯA LÀM ĐƯỢC

* **Không hỗ trợ DRM & Định dạng nâng cao:** Bó tay trước các chuẩn DRM (Widevine, FairPlay, PlayReady), video mã hóa `SAMPLE-AES`, chuẩn DASH (`.mpd`), Smooth Streaming hoặc các trang tách riêng luồng Audio/Video.
* **Chưa có UI chọn chất lượng:** Luôn tự động chọn chất lượng cao nhất từ Master Playlist (không cho chọn 720p/1080p).
* **Giới hạn RAM & Hiệu năng:** Nối file trực tiếp trên RAM nên dễ gây tràn bộ nhớ (OOM/Crash) với video dung lượng >2GB. Cắt clip theo segment boundary nên chưa chuẩn xác tới từng khung hình (frame-accurate).
* **Trải nghiệm & Bảo vệ yếu:** 
  * Không bắt được video dùng MSE dạng stream `blob:`.
  * Rule network phủ quá rộng dễ gây xung đột với extension khác.
  * Chưa hỗ trợ tạm dừng/tiếp tục (Pause/Resume), tải phụ đề hay giới hạn tốc độ.

---

## 🛡️ 3. Tuyên bố Miễn trừ Trách nhiệm (Disclaimer)

* **Mục đích sử dụng:** Dự án này được phát triển hoàn toàn vì mục đích **nghiên cứu kỹ thuật, học tập** về kiến trúc Manifest V3 Extension và xử lý luồng dữ liệu media.
* **Miễn trừ trách nhiệm về hành vi:** Tác giả **không chịu bất kỳ trách nhiệm nào** nếu dự án này bị sử dụng vào các mục đích xấu, vi phạm pháp luật, xâm phạm bản quyền hoặc phát tán trái phép các nội dung được bảo hộ.
* **Miễn trừ trách nhiệm về rủi ro thử nghiệm:** Dự án hiện đang trong **giai đoạn thử nghiệm (Experimental/Beta)**. Tác giả **miễn trừ mọi trách nhiệm** đối với bất kỳ sự cố, mất mát dữ liệu, xung đột phần mềm hoặc thiệt hại hệ thống nào phát sinh trong quá trình cài đặt và trải nghiệm sản phẩm. Người dùng tự chịu toàn bộ rủi ro khi vận hành.
