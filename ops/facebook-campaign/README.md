# Facebook Group Campaign — resume kit

แคมเปญห้องเช่าสุราษฎร์ฯ (สุกี้ตี๋น้อย) · บัญชี **Plus Dairy** · เป้า 200 กลุ่ม

## ทำไมต้องรันบนเครื่อง PC เท่านั้น

การโพสต์ใช้ **Chrome MCP extension** (`mcp__claude-in-chrome__*`) ซึ่งเป็น browser extension
ที่คุยกับ Chrome ผ่าน local IPC — Claude Code ต้องรันอยู่บน **เครื่องเดียวกับ Chrome**

Remote session (claude.ai/code, GitHub Action, scheduled trigger) รันบน cloud container
คนละเครื่อง จึงติดทั้ง 3 อย่างพร้อมกัน และไม่มีทางแก้จากฝั่ง cloud:

| ต้องมี | บน cloud |
|---|---|
| Chrome MCP extension | ❌ ไม่มี tool |
| Facebook login session (cookies) | ❌ ไม่มี |
| โฟลเดอร์รูป `C:\Users\gamee\Desktop\รูปห้องพัก\` | ❌ คนละ filesystem |

> **Scheduled trigger ก็ใช้ไม่ได้ด้วยเหตุผลเดียวกัน** — trigger ยิงเข้า cloud session เสมอ
> ถ้าอยากตั้งเวลา ให้ใช้ Windows Task Scheduler บนเครื่อง PC เรียก `claude` แทน

## วิธีรัน

```powershell
cd C:\Users\gamee\Desktop\รูปห้องพัก
claude
```

แล้วพิมพ์:

```
/post-facebook
resume จาก post-facebook-3-checkpoint.json — PER-GROUP mode, ต่อจากกลุ่ม 1419822776573721
```

## ไฟล์ในชุดนี้

| ไฟล์ | ใช้ทำอะไร |
|---|---|
| `captions_20ver_new.txt` | 20 variants — **ทุกอันมีเบอร์ `098-806-6689` ครบแล้ว** (verified 20/20) |
| `post-facebook-3-checkpoint.json` | resume state — วางไว้ที่ `C:\Users\gamee\Desktop\รูปห้องพัก\` |

## สถานะแคมเปญ

- ✅ โพสต์แล้ว **25** กลุ่ม
- ⏭️ ข้าม **5** กลุ่ม (ไม่มีช่อง `เขียนอะไรสักหน่อย`)
- 🔜 ค้าง **2** กลุ่ม — `1419822776573721`, `702780739866029`
- 🎯 ต้องหากลุ่มเพิ่มอีก ~173 กลุ่ม (บัญชีเป็นสมาชิก 600+ กลุ่ม)

หากลุ่มเพิ่มจาก `https://www.facebook.com/groups/?category=joined` แล้วกรองด้วย
skip filter ใน `SKILL.md §5` (ตัดกลุ่มนอกพื้นที่ / กลุ่มหางาน / กลุ่มแบนโฆษณา)

## กติกาที่ห้ามพลาด

- เบอร์ `098-806-6689` **LOCKED** — ทุกโพสต์ ทุก variant (runner จะ abort ถ้าไม่มี)
- แนบรูป **ก่อน** ใส่ข้อความเสมอ (React re-render ลบข้อความทิ้ง)
- เว้น **30–60 วินาทีแบบสุ่ม** ระหว่างโพสต์
- เจอ warning / limit dialog / checkpoint ของ Facebook → **หยุดทั้งรัน** แล้วรายงาน ห้าม retry
- **ห้ามใช้** ปุ่ม "โพสต์ไปยังหลายกลุ่ม" ในแคมเปญนี้ (โดน rate limit)
