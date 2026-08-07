# 🏥 HealthSync

> A secure, privacy-first, consent-governed digital healthcare interoperability platform enabling patients, hospitals, and insurance providers to access and manage medical records with complete control.

HealthSync solves the problem of fragmented healthcare records by aggregating patient data across hospitals, diagnostic centers, and paper files into a single, unified digital health identity. Patients retain full ownership over their data, granting temporary, scoped access to doctors and insurers via QR codes and OTP verification.

---

## ✨ Core Features & Implemented Modules

### 📄 1. Unified Medical Vault & Interactive Timeline
* **Cross-Hospital Aggregation:** Centralizes prescriptions, lab reports, radiology imaging, discharge summaries, and vaccination certificates across all healthcare facilities.
* **Chronological Health Timeline:** Month-by-month visual timeline (`TimelineView.jsx`) with live record counts, category filters, date-range selectors, and keyword search.
* **Data Integrity:** Differentiates between hospital-issued records (read-only and tamper-proof) and self-reported patient uploads.

### 💊 2. Medication Cabinet & Safety Guard
* **Active Cabinet & History Tracking:** Dedicated medication cabinet (`MedicationCabinetView.jsx`) separating currently active medications from discontinued/past prescription history.
* **Drug Interaction & Allergy Alerts:** Automatically cross-references active prescriptions to detect drug-drug interactions and patient allergies in real-time.
* **Status Controls:** One-click toggling between *Active* and *Completed/Discontinued* prescription statuses.

### ⏰ 3. Follow-up Loop Closure Safety Net *(Incidental Findings)*
* **Incidental Recommendation Tracking:** Automatically parses radiology and discharge prose for future clinical promises (*"Repeat chest CT in 6 months"*).
* **Confidence Gating State Machine:**
  * **$\ge$ 0.80 Confidence:** Automatically logged as active `open` obligation.
  * **0.45 – 0.79 Confidence:** Logged as `pending_confirm` asking the patient to confirm.
  * **< 0.45 Confidence:** Discarded to prevent false alarm fatigue.
* **Automated Escalation Scheduler:** Background cron job (`followupScheduler.js`) executing multi-tier alerts (T-30, T-7, due date, T+1, T+30 overdue).
* **Auto-Closure Engine:** Detects incoming lab or imaging records that fulfill open obligations and marks them `completed`.

### 📷 4. Multi-Format OCR & Document Digitization Pipeline
* **Format Support:** Supports PDF (vector text layers & scanned images), PNG, JPG, WebP, and HEIC files (up to 25 pages / 60 MB per scan).
* **Image Preprocessing & Rasterization:** Image despeckling, contrast enhancement, auto-rotation via `sharp`, and multi-page PDF page rasterization via `mupdf`.
* **Offline OCR Pool:** Tesseract.js worker pool using offline trained data (`@tesseract.js-data/eng`) with CPU concurrency queuing and idle worker auto-teardown.

### 🔒 5. Consent-Based Access & Audit System
* **Patient-Driven Sharing:** Grant temporary access to doctors, hospitals, or insurance adjusters via **QR code** or **OTP verification**.
* **Granular Permission Checkboxes:** Selectively toggle permission scopes (`medicalHistory`, `prescriptions`, `reports`, `allergies`, `bloodGroup`).
* **Instant Revocation & Audit Logs:** Patients can revoke provider access at any time. Immutable audit logs (`AuditLog.js`) record every access event, timestamp, and provider identity.

### 🛡️ 6. Insurance & Claims Interoperability
* **Policy Management:** Patients link health insurance policies directly to their vault.
* **Consent-Backed Claims:** File claims with attached medical proof and diagnostic records.
* **Claim Lifecycle Tracking:** Real-time status tracking (`Submitted` $\rightarrow$ `Under Review` $\rightarrow$ `Info Requested` $\rightarrow$ `Approved` / `Rejected`).
* **Multi-Party Live Chat:** Built-in real-time messaging thread (`ClaimDetailDrawer.jsx`) between patient, hospital billing, and insurance adjusters.

### 📢 7. Health Advisories & Real-Time Alerts
* **Regional & Public Alerts:** Targeted health advisories and WHO disease outbreak news broadcast directly to patient dashboards.
* **WebSockets:** Real-time live notifications and message badges powered by Socket.IO.

### 🔐 8. Enterprise Authentication & Security Foundation
* **Dual-Token Authentication:** JWT Access Tokens & Refresh Tokens with automatic Refresh Token Rotation and secure HTTP-only cookies.
* **Account Lockout & Rate Limiting:** Account lockout after consecutive failed login attempts, authentication rate limiters, and `bcrypt` password hashing.
* **Security Headers & Sanitation:** Protected by `Helmet`, `HPP`, MongoDB injection protection, XSS sanitization, and `express-validator`.

---

## 🛠 Tech Stack

### Backend
* **Runtime:** Node.js, Express.js (v5)
* **Database:** MongoDB, Mongoose ORM
* **Real-time:** Socket.IO
* **OCR & Image Processing:** Tesseract.js, Sharp, MuPDF, PDF-Parse
* **Security:** Helmet, Express Rate Limit, Express Validator, HPP, Express XSS Sanitizer, bcryptjs, JSONWebToken
* **Email & Utilities:** Nodemailer, Winston Logger, Compression, Cookie Parser

### Frontend
* **Framework:** React 18, Vite
* **Styling:** TailwindCSS, Lucide React Icons
* **Real-time Client:** Socket.IO Client

---

## 📂 Project Structure

```
HealthSync/
├── Backend/
│   ├── scripts/                # Database seeders (seedAdmin.js, seedInsurance.js)
│   ├── src/
│   │   ├── config/             # Security, upload, & report configurations
│   │   ├── constants/          # Follow-up & Record Type constants
│   │   ├── controllers/        # Express controllers (auth, record, consent, insurance, etc.)
│   │   ├── jobs/               # Background cron jobs (followupScheduler.js)
│   │   ├── middleware/         # Auth, RBAC, Rate limiters, Validation
│   │   ├── models/             # Mongoose schemas (User, MedicalRecord, Claim, FollowUp, etc.)
│   │   ├── routes/             # API routes (patient, hospital, insurance, dev, advisory)
│   │   ├── services/           # Service layer (ocr, followup, record, consent, insurance, extractors)
│   │   ├── utils/              # ApiError, ApiResponse, Logger, AsyncHandler
│   │   ├── app.js              # Express app setup & security middleware
│   │   ├── server.js           # HTTP & Socket.IO server initialization
│   │   └── socket.js           # Socket.IO connection & event handlers
│   └── tests/                  # Jest test suites (auth, ocr, followup, insurance, batchScan)
├── Frontend/
│   ├── src/
│   │   ├── components/         # UI components (TimelineView, MedicationCabinetView, ConsentsView, etc.)
│   │   ├── context/            # AuthContext
│   │   ├── lib/                # API client helpers, Socket client, Formatters
│   │   ├── pages/              # Dashboards (Patient, Hospital, Insurance, Admin, Login, Signup)
│   │   ├── App.jsx             # Main router
│   │   └── main.jsx            # Entry point
```

---

## ⚙️ Getting Started

### 1. Clone the repository
```bash
git clone https://github.com/AYUSH-P-SINGH/HealthSync.git
cd HealthSync
```

### 2. Install Backend & Frontend Dependencies

```bash
# Install Backend dependencies
cd Backend
npm install

# Install Frontend dependencies
cd ../Frontend
npm install
```

### 3. Configure Environment Variables

Create a `.env` file in `Backend/`:

```env
PORT=5000
MONGO_URI=mongodb://localhost:27017/healthsync

ACCESS_TOKEN_SECRET=your_access_token_secret
REFRESH_TOKEN_SECRET=your_refresh_token_secret

ACCESS_TOKEN_EXPIRY=15m
REFRESH_TOKEN_EXPIRY=7d

CLIENT_URL=http://localhost:5173

EMAIL_HOST=smtp.mailtrap.io
EMAIL_PORT=2525
EMAIL_USER=your_email_user
EMAIL_PASS=your_email_pass

OCR_MAX_CONCURRENT=2
OCR_MIN_CONFIDENCE=55
```

Create a `.env` file in `Frontend/`:

```env
VITE_API_URL=http://localhost:5000/api
```

### 4. Run Development Servers

```bash
# Start Backend server (from Backend folder)
npm run dev

# Start Frontend development server (from Frontend folder)
npm run dev
```

---

## 🗺️ Roadmap & Status

* [x] **Authentication & Security Foundation** — Dual JWT, token rotation, account lockout, rate-limiting
* [x] **Unified Medical Record Vault** — Multi-category record storage, OCR, self-reported vs. hospital-issued records
* [x] **Interactive Health Timeline** — Chronological month-by-month history with filter facets and search
* [x] **Medication Cabinet & Safety Guard** — Active cabinet, history tracking, real-time drug interaction & allergy alerts
* [x] **Follow-up Loop Closure Safety Net** — Incidental recommendation extraction, confidence gating, auto-closure engine
* [x] **Consent-Based Access Control** — OTP & QR code access, granular permission checkboxes, instant revocation
* [x] **Doctor & Hospital Dashboard** — Linked patient lookup, QR/OTP verification, clinical record issuance
* [x] **Insurance Integration & Claims** — Policy linking, claim lifecycle management, real-time multi-party claim chat
* [x] **Health Advisories & Public Alerts** — Targeted health broadcasts, WHO disease outbreak alerts
* [x] **Real-time WebSockets** — Socket.IO notifications, status badges, and claim chat threads

---

## 📄 License

This project is licensed under the MIT License.
