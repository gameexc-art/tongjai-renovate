# คู่มือติดตั้งบอท LINE — NONEAICE (บอทบันทึกใบเสร็จ)

บอทนี้รับรูป **สลิปโอนเงิน / ใบเสร็จ** จาก LINE แล้วอ่านข้อมูล (ยอดเงิน, ผู้รับ, วันที่, เลขอ้างอิง)
ด้วย AI (Claude vision) ตอบกลับเป็นการ์ด **“ใบเสร็จ”** สวย ๆ แล้วให้เลือกประเภทค่าใช้จ่าย
และบันทึกลงบัญชีให้อัตโนมัติ

ทำงานเป็น **Vercel Function** อยู่ในโปรเจกต์เดียวกับเว็บ `tongjai-renovate` —
หน้าเว็บเดิม (index.html) ยังทำงานปกติทุกอย่าง ไม่ต้องแก้อะไรเพิ่ม

> Webhook URL ของบอท: `https://tongjai-renovate.vercel.app/api/line-webhook`

---

## ภาพรวมขั้นตอน (ทำครั้งเดียว)

1. สร้าง LINE Official Account + Messaging API channel
2. คัดลอก **Channel access token** และ **Channel secret**
3. ขอ **Anthropic API key** (สำหรับอ่านสลิปด้วย AI)
4. (ไม่บังคับ) สร้าง **Vercel KV** ถ้าต้องการเก็บประวัติให้แดชบอร์ดอ่าน
5. ใส่ค่าทั้งหมดเป็น **Environment Variables** ใน Vercel
6. ตั้งค่า **Webhook URL** ใน LINE และเปิด “Use webhook”, ปิด “Auto-reply”
7. ทดสอบด้วยการส่งสลิปเข้าไปในแชท

---

## ขั้นที่ 1 — สร้าง LINE Official Account + Messaging API channel

1. ไปที่ <https://developers.line.biz/console/> แล้วล็อกอินด้วยบัญชี LINE
2. สร้าง **Provider** ใหม่ (เช่น ชื่อร้าน/บริษัทของคุณ) ถ้ายังไม่มี
3. ในโปรไวเดอร์นั้น กด **Create a new channel** → เลือก **Messaging API**
4. กรอกชื่อ (เช่น `NONEAICE`), หมวดหมู่, ภาษา ฯลฯ แล้วสร้าง channel
   - ระบบจะสร้าง **LINE Official Account** ให้อัตโนมัติพร้อมกัน

> ถ้าคุณมี LINE OA อยู่แล้ว ให้เข้าไปที่ <https://manager.line.biz/> →
> เลือก OA → **Settings → Messaging API → Enable** แล้วผูกกับ provider เพื่อให้ได้ channel แบบ Messaging API

---

## ขั้นที่ 2 — เอา Channel access token และ Channel secret

อยู่ในหน้า channel ที่เพิ่งสร้าง:

1. แท็บ **Basic settings** → เลื่อนหา **Channel secret** → กด copy
   เก็บไว้เป็นค่า `LINE_CHANNEL_SECRET`
2. แท็บ **Messaging API** → หัวข้อ **Channel access token (long-lived)** →
   กด **Issue** เพื่อสร้าง token → กด copy
   เก็บไว้เป็นค่า `LINE_CHANNEL_ACCESS_TOKEN`

> ⚠️ token/secret เป็นความลับ อย่าวางในโค้ดหรือแชร์ที่สาธารณะ — ใส่ใน Vercel env เท่านั้น

ในแท็บ **Messaging API** ให้ตั้งค่าฝั่ง LINE ด้วย:

- **Use webhook** → เปิด (ON)
- **Auto-reply messages** → ปิด (OFF)  *(ไม่งั้น LINE จะตอบข้อความอัตโนมัติทับบอท)*
- **Greeting messages** → จะเปิดหรือปิดก็ได้

---

## ขั้นที่ 3 — ขอ Anthropic API key (สำหรับ AI อ่านสลิป)

1. ไปที่ <https://console.anthropic.com/> แล้วสมัคร/ล็อกอิน
2. เมนู **API Keys** → **Create Key** → copy คีย์ที่ได้
   เก็บไว้เป็นค่า `ANTHROPIC_API_KEY`
3. ต้องมีเครดิต/วิธีชำระเงินในบัญชี Anthropic ด้วย (การอ่านสลิป 1 รูปด้วยรุ่น Haiku ราคาถูกมาก)

> ค่าเริ่มต้นใช้รุ่น `claude-haiku-4-5-20251001` (เร็ว/ถูก) ถ้าต้องการความแม่นยำสูงขึ้น
> ตั้ง env เพิ่ม `PARSE_MODEL=claude-sonnet-4-6` ได้โดยไม่ต้องแก้โค้ด

---

## ขั้นที่ 4 — (ไม่บังคับ) สร้าง Vercel KV เพื่อเก็บประวัติ

บอท **ทำงานได้เลยโดยไม่ต้องมี KV** — ขั้นตอนเลือกบุคคล/บริษัท และค่าของ/ค่าแรง
ใช้ข้อมูลที่ฝังในปุ่มอยู่แล้ว KV ใช้แค่ “เก็บรายการสุดท้าย” ไว้ให้แดชบอร์ดดึงไปแสดงทีหลัง

1. ใน Vercel เปิดโปรเจกต์ `tongjai-renovate` → แท็บ **Storage** → **Create Database** →
   เลือก **KV (Upstash Redis)** → สร้าง แล้ว **Connect** เข้ากับโปรเจกต์นี้
2. Vercel จะเพิ่ม env ให้อัตโนมัติ ได้แก่ `KV_REST_API_URL` และ `KV_REST_API_TOKEN`
   (ถ้าไม่อัตโนมัติ ให้ copy จากหน้า database มาใส่เอง)

> ถ้าไม่สร้าง KV: บอทจะข้ามการบันทึกอย่างนุ่มนวล และ `/api/transactions` จะคืนค่าลิสต์ว่าง `[]`

---

## ขั้นที่ 5 — ใส่ Environment Variables ใน Vercel

ไปที่ Vercel → โปรเจกต์ `tongjai-renovate` → **Settings → Environment Variables**
ใส่ทั้งหมดนี้ (เลือก scope **Production** อย่างน้อย; จะติ๊ก Preview/Development ด้วยก็ได้):

| ชื่อ env | ค่า | บังคับ? |
|---|---|---|
| `LINE_CHANNEL_ACCESS_TOKEN` | จากขั้นที่ 2 | ✅ ใช่ |
| `LINE_CHANNEL_SECRET` | จากขั้นที่ 2 | ✅ ใช่ |
| `ANTHROPIC_API_KEY` | จากขั้นที่ 3 | ✅ ใช่ |
| `DASHBOARD_TOKEN` | รหัสลับที่คุณตั้งเอง (สุ่มยาว ๆ) สำหรับเปิดดู `/api/transactions` | จำเป็นถ้าจะดูประวัติ (ดูขั้นที่ 7) |
| `PARSE_MODEL` | เช่น `claude-sonnet-4-6` | ไม่ (มีค่า default ให้) |
| `DASHBOARD_ORIGIN` | โดเมนแดชบอร์ดที่อนุญาตให้เรียกผ่านเบราว์เซอร์ เช่น `https://tongjai-renovate.vercel.app` | ไม่ (ใส่เฉพาะเวลาให้หน้าเว็บดึงข้าม origin) |
| `KV_REST_API_URL` | จากขั้นที่ 4 | ไม่ (เก็บประวัติ) |
| `KV_REST_API_TOKEN` | จากขั้นที่ 4 | ไม่ (เก็บประวัติ) |

> 🔐 `DASHBOARD_TOKEN`: ตั้งเป็นสตริงสุ่มยาว ๆ (เช่นจาก `openssl rand -hex 32`) เก็บเป็นความลับ
> ใช้เป็นรหัสผ่านสำหรับ endpoint `/api/transactions` — ถ้า **ไม่ได้ตั้ง** endpoint นี้จะ **ปิด** (คืน `503`)
> ไม่เปิดให้ใครดึงข้อมูลบัญชีได้แบบสาธารณะ ส่วน `lineUserId` ของผู้ใช้จะถูก **ตัดออกเสมอ** ไม่ส่งให้แดชบอร์ด

จากนั้น **Redeploy** โปรเจกต์ 1 ครั้งเพื่อให้ env มีผล
(Deployments → จุดสามจุดบน deployment ล่าสุด → **Redeploy**)

---

## ขั้นที่ 6 — ตั้งค่า Webhook URL ใน LINE

กลับไปที่ LINE Developers Console → channel ของคุณ → แท็บ **Messaging API**:

1. ช่อง **Webhook URL** ใส่:
   ```
   https://tongjai-renovate.vercel.app/api/line-webhook
   ```
2. กด **Update** แล้วกด **Verify** — ควรขึ้น **Success**
   (ปุ่ม Verify ส่ง event ว่าง ๆ มา บอทจะตอบ 200 กลับไป)
3. เปิดสวิตช์ **Use webhook** ให้เป็น ON

> ตรวจซ้ำว่า **Auto-reply** ปิดอยู่ (ขั้นที่ 2) ไม่งั้น LINE จะตอบข้อความเองทับบอท

---

## ขั้นที่ 7 — ทดสอบ

1. เพิ่มเพื่อน LINE OA ของคุณ (สแกน QR ในแท็บ Messaging API หรือหน้า LINE OA Manager)
2. ทักเข้าไป — ควรได้คำทักทายต้อนรับ (event `follow`)
3. ส่ง **รูปสลิปโอนเงิน / ใบเสร็จ** เข้าไป
4. รอสักครู่ บอทจะตอบเป็นการ์ด **“ใบเสร็จ”** พร้อมยอดเงิน/ผู้รับ/วันที่/อ้างอิง
   และปุ่ม **👤 บุคคล** / **🏢 บริษัท**
5. กดเลือก → บอทถาม **“เลือกประเภทค่าจ่าย:”** พร้อมปุ่ม
   **📦 ค่าของ (บันทึกเป็นรายจ่าย)** / **💼 ค่าแรง (หัก ณ ที่จ่าย)**
6. กดเลือก → บอทยืนยัน **“✅ บันทึกเป็นใบรับรองแทนแล้วครับ”**
   (ถ้าตั้ง KV ไว้แต่บันทึกไม่สำเร็จ บอทจะบอกว่า **“บันทึกไม่สำเร็จ ลองกดยืนยันอีกครั้งนะครับ”** ให้กดซ้ำได้)
7. (ถ้าตั้ง KV + `DASHBOARD_TOKEN`) ดูรายการที่บันทึกไว้ผ่าน `/api/transactions`
   endpoint นี้ **ต้องแนบรหัส** `DASHBOARD_TOKEN` ในเฮดเดอร์ `Authorization` — เปิดเปล่า ๆ ในเบราว์เซอร์จะได้ `401`
   ```bash
   curl -H "Authorization: Bearer $DASHBOARD_TOKEN" \
     https://tongjai-renovate.vercel.app/api/transactions
   ```
   (ข้อมูลที่คืนจะ **ไม่มี** `lineUserId` ของผู้ใช้ เพราะถูกตัดออกเพื่อความเป็นส่วนตัว)

---

## การแก้ปัญหา (Troubleshooting)

| อาการ | สาเหตุที่พบบ่อย / วิธีแก้ |
|---|---|
| กด **Verify** แล้ว **Fail** | • Webhook URL พิมพ์ผิด (ต้องลงท้าย `/api/line-webhook`) • ยังไม่ได้ deploy โค้ดล่าสุด • `LINE_CHANNEL_SECRET` ผิด/ยังไม่ได้ใส่ → ทำให้ลายเซ็นไม่ผ่าน (401) |
| ส่งสลิปแล้วบอท **เงียบ** | • **Use webhook** ยังไม่เปิด • **Auto-reply** ยังเปิดอยู่ (ปิดด้วย) • ลืม Redeploy หลังใส่ env |
| ตอบว่า **“อ่านสลิปไม่สำเร็จ”** | • `ANTHROPIC_API_KEY` ผิด/หมดเครดิต • รูปเบลอ/มืดเกินไป → ส่งรูปที่ชัดขึ้น |
| การ์ด/ปุ่มขึ้น แต่กดแล้ว **ไม่บันทึก** | • ไม่มี KV = บอททำงานปกติแต่ไม่เก็บประวัติ • ถ้ามี KV แต่ขึ้น **“บันทึกไม่สำเร็จ ลองกดยืนยันอีกครั้ง”** แปลว่าเขียนลง KV พลาด (KV ล่ม/เน็ตหลุด) → กดยืนยันซ้ำได้เลย (ระบบกันบันทึกซ้ำให้แล้ว) • เก็บประวัติต้องตั้ง `KV_REST_API_URL` + `KV_REST_API_TOKEN` แล้ว Redeploy |
| `/api/transactions` คืน `401` | ไม่ได้แนบ/แนบ `DASHBOARD_TOKEN` ผิดในเฮดเดอร์ `Authorization: Bearer …` |
| `/api/transactions` คืน `503` | ยังไม่ได้ตั้ง env `DASHBOARD_TOKEN` (endpoint ปิดไว้จนกว่าจะตั้งรหัส) |
| `/api/transactions` คืน `[]` | ตั้ง `DASHBOARD_TOKEN` ถูกแล้ว แต่ยังไม่ได้ตั้ง KV หรือยังไม่มีรายการที่บันทึกครบขั้นตอน |
| อยากดู log | Vercel → โปรเจกต์ → **Logs** (ฟังก์ชันจะ log แค่ชนิดของ error ไม่เคย log ค่า token/secret) |

> ทิป: reply token ของ LINE ใช้ได้ครั้งเดียวและมีอายุสั้น (~1 นาที) ถ้าการอ่านสลิปช้า
> บอทจะ **push** ข้อความตามไปให้แทนอัตโนมัติ — ผู้ใช้จะยังได้รับการ์ดเสมอ

---

## หมายเหตุด้านความปลอดภัย

- ทุก request จาก LINE ถูกตรวจ **ลายเซ็น `x-line-signature`** ก่อนเสมอ ปลอมไม่ได้
- ค่า token/secret/API key อ่านจาก `process.env` เท่านั้น และ **ไม่เคยถูก log**
- บอทกัน **การส่งซ้ำ (redelivery)** เพื่อไม่ให้บันทึกค่าใช้จ่ายซ้ำ (กันถึงชั้น KV ด้วย `SET NX`)
- endpoint อ่านบัญชี `/api/transactions` **ต้องมีรหัส `DASHBOARD_TOKEN`** ถึงจะดูได้ ไม่เปิดสาธารณะ
  และ **ไม่ส่ง `lineUserId`** (ข้อมูลส่วนบุคคล/ปลายทาง push) ออกไปให้แดชบอร์ดเลย
- ทุกการเรียกเครือข่าย (อ่านสลิป/LINE/KV) มี **timeout** กันค้าง ไม่ให้ฟังก์ชันค้างจนเกินอายุ reply token
