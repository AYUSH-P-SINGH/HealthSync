# 🏥 HealthSync

> A secure, privacy-first digital healthcare platform that enables patients to manage, share, and access their medical records with complete control.

HealthSync aims to solve the problem of fragmented healthcare records by providing a centralized, consent-based platform where patients, hospitals, and insurance providers can securely access medical information. The platform emphasizes data privacy, secure authentication, and seamless healthcare interoperability.

---

## ✨ Vision

Medical records are often scattered across hospitals, clinics, diagnostic centers, and paper files. HealthVault brings them together into a single secure digital identity where patients retain complete ownership of their health data.

---

## 🚀 Planned Features

* 📄 Unified digital medical records
* 📷 OCR-based report digitization
* 🏥 Consent-based hospital access (QR/OTP)
* 🩺 Patient medical timeline
* 💊 Medicine information assistant
* ⏰ Medicine reminders
* 🛡️ Insurance integration
* 🔒 End-to-end secure authentication
* 📊 Audit logging and activity history
* 🔍 Searchable medical history

---

## 🔐 Authentication & Security

The current implementation focuses on building a production-ready authentication system designed for healthcare applications.

### Authentication

* JWT Access Tokens
* JWT Refresh Tokens
* Refresh Token Rotation
* Secure Refresh Token Storage
* User Registration
* User Login
* Logout
* Current User Endpoint
* Email Verification
* Forgot Password
* Password Reset
* Password Change

### Security Features

* bcrypt Password Hashing
* Account Lockout Protection
* Authentication Rate Limiting
* Request Validation
* Secure HTTP-only Cookies
* Helmet Security Headers
* MongoDB Injection Protection
* HTTP Parameter Pollution Protection
* Centralized Error Handling
* Audit Logging
* Environment Validation
* Centralized Security Configuration

---

## 🛠 Tech Stack

### Backend

* Node.js
* Express.js
* MongoDB
* Mongoose

### Authentication

* JWT (Access + Refresh Tokens)
* bcrypt
* Cookie Parser

### Security

* Helmet
* Express Rate Limit
* Express Validator
* HPP
* Morgan
* Compression

### Email

* Nodemailer

---

## 📂 Current Project Scope

This repository currently contains the authentication foundation only.

Future modules will include:

* Patient Management
* Hospital Portal
* Medical Record Management
* OCR Processing
* AI Medicine Assistant
* Insurance Integration
* Consent Management
* Notifications
* Analytics Dashboard

---


## ⚙️ Getting Started

### Clone the repository

```bash
git clone https://github.com/<username>/healthvault.git
cd HealthSync
```

### Install dependencies

```bash
npm install
```

### Configure environment variables

Create a `.env` file.

```env
PORT=
MONGO_URI=

ACCESS_TOKEN_SECRET=
REFRESH_TOKEN_SECRET=

ACCESS_TOKEN_EXPIRY=15m
REFRESH_TOKEN_EXPIRY=7d

CLIENT_URL=

EMAIL_HOST=
EMAIL_PORT=
EMAIL_USER=
EMAIL_PASS=
```

### Run the server

```bash
npm run dev
```

---

## 🗺️ Roadmap

* [x] Authentication & Security Foundation
* [x] **Follow-up Loop Closure** — tracks recommendations reports make about the future
* [ ] Patient Profile Management
* [ ] Medical Record Upload
* [ ] OCR & Document Digitization
* [ ] Medical Timeline
* [ ] Consent-Based Access
* [ ] Doctor & Hospital Dashboard
* [ ] Insurance Integration
* [ ] Medicine Information Assistant
* [ ] Medicine Reminder System
* [ ] Analytics & Reporting

---

## 🤝 Contributing

Contributions, suggestions, and issue reports are welcome. Feel free to fork the repository, create a feature branch, and submit a pull request.

---

## 📄 License

This project is licensed under the MIT License.
