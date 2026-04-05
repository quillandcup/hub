# Google Calendar Setup with Service Account

## Why Service Account?

- **No OAuth flow** - Just a JSON key file
- **No token expiry** - Credentials don't expire
- **Perfect for automation** - Server-to-server access
- **Simple setup** - Share calendar with service account email

## Step-by-Step Setup

### 1. Create Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click project dropdown → "NEW PROJECT"
3. Name: "Quill & Cup Admin" 
4. Click "CREATE"

### 2. Enable Google Calendar API

1. Select your project
2. Left sidebar → "APIs & Services" → "Library"
3. Search "Google Calendar API"
4. Click it → "ENABLE"

### 3. Create Service Account

1. Left sidebar → "APIs & Services" → "Credentials"
2. Click "CREATE CREDENTIALS" → "Service account"
3. Service account details:
   - **Name**: quill-cup-calendar-sync
   - **ID**: (auto-filled)
   - **Description**: Read access to Quill & Cup prickle calendar
4. Click "CREATE AND CONTINUE"
5. Skip "Grant this service account access to project" (click CONTINUE)
6. Skip "Grant users access" (click DONE)

### 4. Create Service Account Key

1. Click on the service account you just created
2. Go to "KEYS" tab
3. Click "ADD KEY" → "Create new key"
4. Select "JSON"
5. Click "CREATE"
6. **IMPORTANT**: Save this JSON file securely - you can't download it again!

### 5. Share Calendar with Service Account

1. Open the JSON key file
2. Copy the `client_email` value (looks like: `quill-cup-calendar-sync@project-id.iam.gserviceaccount.com`)
3. Go to [Google Calendar](https://calendar.google.com/)
4. Find "Quill & Cup Prickles" calendar in the left sidebar
5. Click the three dots → "Settings and sharing"
6. Scroll to "Share with specific people"
7. Click "Add people"
8. Paste the service account email
9. Permission: "See all event details"
10. Click "Send"

### 6. Add to .env.local

1. Open the downloaded JSON key file
2. Copy the entire JSON content (it's one long line)
3. Add to `.env.local`:

```bash
# Google Calendar API (Service Account)
GOOGLE_SERVICE_ACCOUNT_KEY={"type":"service_account","project_id":"...paste entire JSON here..."}

# Quill & Cup Prickle Calendar ID
GOOGLE_CALENDAR_ID=dd6745e544f1a8a93f0f7fd6d3fc633ab9c864e1090603a793c69d101f695e6e@group.calendar.google.com
```

**Note**: The JSON should be on ONE line (no newlines). If your editor auto-formats it, make sure to remove newlines.

### 7. Test It

1. Restart your dev server: `npm run dev`
2. Go to `http://localhost:3000/dashboard/import`
3. Scroll to "Import Prickles from Google Calendar"
4. Click "Sync Now"
5. Should see: "Sync Complete!" with event counts

## Production Setup

For Vercel/production:

1. Go to project settings → Environment Variables
2. Add `GOOGLE_SERVICE_ACCOUNT_KEY` with the full JSON (one line)
3. Add `GOOGLE_CALENDAR_ID` with the calendar ID
4. Redeploy

**Security Note**: The service account key is sensitive! Never commit it to git. It's already in `.gitignore` via `.env.local`.

## Troubleshooting

**"GOOGLE_SERVICE_ACCOUNT_KEY not configured"**
- Make sure the env var is set and is valid JSON
- Check for newlines - should be ONE line
- Restart dev server after changing .env.local

**"Calendar not found" or "403 Forbidden"**
- Make sure you shared the calendar with the service account email
- Permission must be "See all event details" (not just "See only free/busy")
- Wait a minute after sharing - can take time to propagate

**"No events found"**
- Check the date range
- Make sure events have specific times (not all-day events)
- Verify the calendar ID is correct
