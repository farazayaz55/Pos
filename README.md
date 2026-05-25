# Restaurant POS MVP

A production-quality Restaurant POS built with **React + TypeScript + Vite + Tailwind + Zustand**, backed by **Firebase** (Realtime Database, Authentication, Storage, Cloud Functions).

## Features

- **Super Admin** can create, edit, view, and delete restaurant companies.
- **Admin (per company)** manages menu (categories, items, modifier groups), takes cash orders, applies discounts, prints receipts, and views order history.
- **Real-time** menu sync (admin changes appear instantly across POS and public display).
- **Public Product Display** page at `/display/:companyId` for customer-facing screens.
- Secure role separation via custom claims and database rules.

---

## Tech Stack

| Layer        | Tech                                                           |
| ------------ | -------------------------------------------------------------- |
| App          | Vite, React 18, TypeScript                                     |
| Styling      | Tailwind CSS                                                   |
| State        | Zustand (auth, company context, cart)                          |
| Forms        | React Hook Form + Zod                                          |
| Backend      | Firebase RTDB, Auth, Storage, Functions (Node 20, Admin SDK)   |
| Routing      | React Router v6                                                |

---

## 1. Firebase project setup

1. Create a new Firebase project at [console.firebase.google.com](https://console.firebase.google.com).
2. Enable:
   - **Authentication** -> sign-in method **Email/Password**.
   - **Realtime Database** (start in locked mode; rules are deployed from this repo).
   - **Storage** (start in locked mode; rules are deployed from this repo).
   - **Cloud Functions** (requires Blaze plan).
3. In your Firebase project settings -> **Web app**, register a web app and copy the config values.

## 2. Environment variables

Copy the example file and fill in your Firebase values:

```bash
cp .env.example .env
```

Required keys:

```
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_DATABASE_URL=https://<project-id>-default-rtdb.firebaseio.com
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
VITE_FIREBASE_FUNCTIONS_REGION=us-central1
```

Also update `.firebaserc` with your project id:

```json
{ "projects": { "default": "your-firebase-project-id" } }
```

## 3. Install dependencies

```bash
npm install
cd functions && npm install && cd ..
```

## 4. Deploy security rules and Functions

```bash
npm install -g firebase-tools
firebase login
firebase deploy --only database,storage,functions
```

This deploys:

- `database.rules.json` -> RTDB security rules.
- `storage.rules` -> Cloud Storage rules.
- `functions/src/index.ts` -> Cloud Functions (`createCompanyAdmin`, `deleteCompany`, `updateCompanyAdmin`, `setSuperAdminClaim`).

## 5. Bootstrap the first Super Admin (one-time)

There is no public sign-up. Create the very first super admin manually:

1. **Firebase Console -> Authentication -> Add user**: enter the super admin's email and password.
2. Note the new user's **UID** (visible in the Authentication list).
3. **Firebase Console -> Realtime Database -> Data**, add this node:

   ```
   users/
     <THE_UID>/
       email: "super@example.com"
       name:  "Super Admin"
       role:  "super_admin"
       createdAt: <unix-ms-number>
   ```

4. Open the deployed app at `/login` and sign in with those credentials.
   On first sign-in the client will automatically call `setSuperAdminClaim` to attach the
   `role: "super_admin"` custom claim to the token. After that, the user has full Super
   Admin access. Subsequent super admins can be created through the same RTDB seed.

> The custom claim is essential because the database security rules check `auth.token.role`.

## 6. Run locally

```bash
npm run dev
```

Then visit:

- `http://localhost:5173/login` - sign-in
- `http://localhost:5173/super-admin/companies` - Super Admin home
- `http://localhost:5173/admin/pos` - Admin POS (when signed in as an admin)
- `http://localhost:5173/display/<companyId>` - public product display (no auth)

### 6a. Run against the Firebase Emulator Suite (optional)

You can develop without touching production Firebase. Set this in `.env`:

```
VITE_USE_EMULATOR=true
```

Then start the emulators and the dev server in two terminals:

```bash
npm run emulators            # or: npm run emulators:functions
npm run dev
```

A yellow **EMULATOR** badge appears bottom-left on every screen. Inspect data
in the Emulator UI at <http://127.0.0.1:4000>. The default ports are:

| Service   | Port |
| --------- | ---- |
| Auth      | 9099 |
| Database  | 9000 |
| Storage   | 9199 |
| Functions | 5001 |
| UI        | 4000 |

You can override any of them via `VITE_EMULATOR_*_PORT` env vars (must match
`firebase.json`). The Database and Storage emulators require Java on PATH.

## 7. Build and deploy hosting (optional)

```bash
npm run build
firebase deploy --only hosting
```

---

## How it works

### Roles

- **Super Admin** - manages companies. Created manually in Firebase Console (see step 5).
- **Admin** - one per company. Created via the **Cloud Function** `createCompanyAdmin` when
  a super admin saves a new company form. The function creates the Firebase Auth user,
  assigns `role: "admin"` and `companyId: ...` as custom claims, and writes the RTDB nodes.

### "View Company" (Super Admin context-switch)

Clicking **View** on a company card stores the chosen `companyId` in `companyContextStore`
and redirects to `/admin/pos`. The admin layout shows a yellow banner with an **Exit** button.

### POS order flow

1. Browse menu (realtime; unavailable items are disabled).
2. Tap item -> if it has modifier groups a modal opens to choose, set quantity, and note.
3. Cart shows running subtotal; you can apply a discount (flat or percent) - the
   discount is audit-trailed with `appliedBy`, `type`, `amount`, and `at` on the order.
4. **Place Order** -> Checkout modal -> enter cash -> change is computed -> submit.
5. The order is saved with a sequenced `orderNumber` (RTDB transaction on `counters/<id>/orderSeq`)
   and `status: "completed"`, `paymentStatus: "paid"`, `paymentMethod: "cash"`.
6. App navigates to `/admin/receipt/:orderId` which renders a 58/80mm-style receipt and
   auto-calls `window.print()`.

### Public display page

`/display/:companyId` subscribes to `/menu/<companyId>` in RTDB. No authentication required
(read access is allowed in `database.rules.json`). Admin updates appear instantly.

---

## Project structure

```
src/
  lib/firebase.ts                 # Firebase init (Auth/RTDB/Storage/Functions)
  stores/
    authStore.ts                  # Auth + role hydration
    companyContextStore.ts        # Active company for admin area (super admin can switch)
    cartStore.ts                  # POS cart, totals, discount
  services/                       # Thin RTDB / Storage / Functions wrappers
    companies.ts
    menu.ts
    orders.ts
    users.ts
    functionsApi.ts
  hooks/                          # Realtime subscription hooks
  components/
    common/                       # LoadingScreen, ConfirmDialog
    pos/                          # CartPanel, ItemModifierModal
  pages/
    auth/LoginPage.tsx
    super-admin/                  # Companies CRUD + form
    admin/
      AdminLayout.tsx             # Sidebar + impersonation banner
      menu/                       # Categories, Items, Modifiers
      pos/                        # POS, Checkout modal, Receipt
      orders/OrderHistoryPage.tsx
    display/DisplayPage.tsx       # Public realtime menu
  utils/                          # currency, orderCalc, idGen, cn
  App.tsx, main.tsx, index.css
functions/
  src/index.ts                    # createCompanyAdmin, deleteCompany,
                                  # updateCompanyAdmin, setSuperAdminClaim
database.rules.json
storage.rules
firebase.json
```

---

## Roadmap (out of scope for v1)

- Kitchen Display System (KDS) screens
- QR / online payments (Stripe, etc.)
- Additional roles (cashier / waiter / manager)
- Kiosk mode and self-ordering
- Multi-language menus
- Reporting / analytics dashboards

Architecture is already designed for these: roles, order status, and payment method are
typed enums, and all data is partitioned by `companyId`.

---

## License

MIT

---

For a deep dive into how every part of the app is implemented (architecture,
each store, each page, security rules, Cloud Functions, realtime flow, etc.)
see [`PROJECT_OVERVIEW.md`](PROJECT_OVERVIEW.md).
