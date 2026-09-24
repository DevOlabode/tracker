# Submission Tracker

A small form (Name / Location / Date) that appends rows to a Google Sheet via a Google Apps Script web app. No login, no backend server — the browser talks directly to Apps Script.

## 1. Install & run the frontend

```
cd frontend
npm install
cp .env.example .env
# edit .env and set VITE_GOOGLE_APPS_SCRIPT_URL (see step 3)
npm run dev
```

Open the printed local URL (usually http://localhost:5173).

## 2. Configure the names

Edit `frontend/src/config/names.js`:

```js
export const NAMES = ['ESTHER', 'PELUMI', 'SUBOMI', 'BRIGHT']
```

Replace with the real list. No other file needs to change.

## 3. Deploy the Google Apps Script

1. Open the target spreadsheet: https://docs.google.com/spreadsheets/d/1RbDdO_57iGSi2LqIjjrIXNnRZglfzjeWFYwus-zrSMo/edit
2. Extensions → Apps Script.
3. Replace the default code with the contents of `apps-script/Code.gs`.
4. (Optional) Edit the `SPREADSHEET_ID` / `SHEET_GID` constants at the top of the file if you're pointing at a different sheet or tab. `SHEET_GID` is the `#gid=` number in the tab's URL.
5. Deploy → New deployment → type "Web app".
   - Execute as: **Me**
   - Who has access: **Anyone** (required for the frontend to reach it without Google login)
6. Copy the resulting web app URL (ends in `/exec`).

## 4. Point the frontend at the deployment

Put the URL from step 3 into `frontend/.env`:

```
VITE_GOOGLE_APPS_SCRIPT_URL=https://script.google.com/macros/s/XXXXX/exec
```

Restart `npm run dev` after changing `.env`.

## How data flows

1. User fills the form and submits.
2. The frontend POSTs `{ name, location, date }` as JSON to the Apps Script URL.
3. Apps Script parses the body, validates the three fields, and appends a row: `Timestamp | Name | Location | Date` (timestamp is set server-side by Apps Script, not the browser).
4. Apps Script returns `{ success, message }`, which the frontend uses to show a success or error state.

### Why the request uses `Content-Type: text/plain`

Apps Script web apps don't implement a CORS preflight (`OPTIONS`) handler. If the frontend sent `Content-Type: application/json`, the browser would first send a preflight request, which Apps Script can't answer, and the real request would never go out. Sending the JSON string with `Content-Type: text/plain` keeps the request a CORS "simple request" (no preflight), and Apps Script still parses the raw body as JSON server-side. Apps Script web apps automatically respond with permissive CORS headers for these simple requests.

## Testing the complete system

1. Deploy the Apps Script (step 3) and set the URL in `.env` (step 4).
2. Run `npm run dev` and open the form.
3. Submit with a name, location, and date — confirm a success message appears and the form clears.
4. Check the spreadsheet — a new row should appear with a server timestamp.
5. Try submitting with a field missing to confirm client-side validation blocks it.
6. Try an invalid/unreachable `VITE_GOOGLE_APPS_SCRIPT_URL` to confirm the error state shows correctly.
