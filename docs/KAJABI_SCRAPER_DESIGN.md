# Kajabi Export Automation (Scraper)

## Approach: Automate Export Downloads (Not Raw Data Scraping)

Instead of scraping all member/subscription data from HTML, we'll automate:
1. Login to Kajabi
2. Navigate to export pages
3. Click "Export All" buttons
4. Download CSVs
5. Upload to our app via existing `/api/import/members` endpoint

**Benefits:**
- Uses Kajabi's official export format (same CSVs we already support)
- More reliable than scraping HTML (which changes frequently)
- Gets all data in proper format with all fields
- Less fragile - only navigation logic, not data parsing

## Tech Stack

### Option 1: Playwright (Recommended)
**Pros:**
- Modern, actively maintained
- Built-in waiting and retry logic
- Great TypeScript support
- Can run headless or with UI (for debugging)
- Works well in GitHub Actions

**Cons:**
- Larger dependency (~200MB with browsers)

### Option 2: Puppeteer
**Pros:**
- Lighter weight
- Good for simple automation

**Cons:**
- Less robust than Playwright
- Chromium only

**Recommendation:** Playwright

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ GitHub Actions (or Vercel Cron)                             │
│  • Runs daily at 1 AM                                       │
│  • Secrets: KAJABI_EMAIL, KAJABI_PASSWORD                   │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ Playwright Script (scripts/kajabi-export.ts)                │
│  1. Launch browser                                          │
│  2. Navigate to app.kajabi.com/login                        │
│  3. Login with credentials                                  │
│  4. Download Contacts export                                │
│  5. Download Subscriptions export                           │
│  6. Save CSVs to temp directory                             │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ Upload Script                                               │
│  • POST /api/import/members with Contacts CSV              │
│  • POST /api/import/members with Subscriptions CSV         │
│  • POST /api/process/members to merge data                 │
└─────────────────────────────────────────────────────────────┘
```

## Implementation Steps

### Phase 1: Local Playwright Script
```typescript
// scripts/kajabi-export.ts
import { chromium } from 'playwright';

async function exportKajabiData() {
  const browser = await chromium.launch({ headless: false }); // Set true for automation
  const page = await browser.newPage();
  
  // 1. Login
  await page.goto('https://app.kajabi.com/login');
  await page.fill('input[type="email"]', process.env.KAJABI_EMAIL!);
  await page.fill('input[type="password"]', process.env.KAJABI_PASSWORD!);
  await page.click('button[type="submit"]');
  await page.waitForNavigation();
  
  // 2. Export Contacts
  await page.goto('https://app.kajabi.com/admin/contacts');
  const contactsDownload = page.waitForEvent('download');
  await page.click('button:has-text("Export")'); // Adjust selector
  const contactsCsv = await contactsDownload;
  await contactsCsv.saveAs('./downloads/contacts.csv');
  
  // 3. Export Subscriptions
  await page.goto('https://app.kajabi.com/admin/sales/subscriptions');
  const subsDownload = page.waitForEvent('download');
  await page.click('button:has-text("Export")'); // Adjust selector
  const subsCsv = await subsDownload;
  await subsCsv.saveAs('./downloads/subscriptions.csv');
  
  await browser.close();
}
```

### Phase 2: Upload to App
```typescript
// scripts/upload-kajabi-data.ts
async function uploadToApp() {
  const contactsCsv = await fs.readFile('./downloads/contacts.csv');
  const subscriptionsCsv = await fs.readFile('./downloads/subscriptions.csv');
  
  // Upload Contacts
  await fetch('https://your-app.vercel.app/api/import/members', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` },
    body: createFormData(contactsCsv),
  });
  
  // Upload Subscriptions
  await fetch('https://your-app.vercel.app/api/import/members', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` },
    body: createFormData(subscriptionsCsv),
  });
  
  // Process members
  await fetch('https://your-app.vercel.app/api/process/members', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` },
  });
}
```

### Phase 3: GitHub Actions Workflow
```yaml
# .github/workflows/kajabi-sync.yml
name: Kajabi Daily Sync

on:
  schedule:
    - cron: '0 1 * * *'  # 1 AM daily
  workflow_dispatch:  # Manual trigger

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - uses: actions/setup-node@v3
        with:
          node-version: '20'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Install Playwright browsers
        run: npx playwright install --with-deps chromium
      
      - name: Export Kajabi data
        env:
          KAJABI_EMAIL: ${{ secrets.KAJABI_EMAIL }}
          KAJABI_PASSWORD: ${{ secrets.KAJABI_PASSWORD }}
        run: npm run kajabi:export
      
      - name: Upload to app
        env:
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
          APP_URL: ${{ secrets.APP_URL }}
        run: npm run kajabi:upload
      
      - name: Notify on failure
        if: failure()
        uses: dawidd6/action-send-mail@v3
        with:
          server_address: smtp.gmail.com
          server_port: 587
          username: ${{ secrets.EMAIL_USERNAME }}
          password: ${{ secrets.EMAIL_PASSWORD }}
          subject: '❌ Kajabi sync failed'
          to: your@email.com
          from: noreply@yourapp.com
          body: 'Kajabi daily sync failed. Check GitHub Actions logs.'
```

## Security Considerations

### Credential Storage
**Never commit credentials!** Store in:
- **Local dev:** `.env.local` (gitignored)
- **GitHub Actions:** Repository Secrets
- **Alternatives:** 1Password CLI, AWS Secrets Manager

### Authentication Methods
1. **Email/Password** (current plan)
   - Store in GitHub Secrets
   - Risk: If Kajabi adds 2FA, this breaks

2. **Session Cookie** (more resilient)
   - Login once manually, extract cookie
   - Store cookie in secret
   - Refresh periodically

## Testing

### Manual Testing
```bash
# 1. Install dependencies
npm install playwright

# 2. Set environment variables
export KAJABI_EMAIL="your@email.com"
export KAJABI_PASSWORD="your-password"

# 3. Run export script (with browser visible for debugging)
npm run kajabi:export

# 4. Check downloads folder for CSVs
ls -lh downloads/
```

### Dry Run Mode
Add flag to download but NOT upload:
```bash
npm run kajabi:export --dry-run
```

## Error Handling

### Common Issues
1. **Login fails** → Kajabi changed login form
2. **Export button not found** → Kajabi changed UI
3. **Download timeout** → Large exports take time
4. **2FA required** → Need to handle 2FA flow

### Monitoring
- Email on failure (GitHub Actions)
- Log to monitoring service (Sentry, LogDNA)
- Slack notification
- Success/failure metrics in Supabase

## Maintenance

### When Kajabi Updates UI
1. Run script with `headless: false` to see what changed
2. Update selectors in script
3. Test manually
4. Push update

### Selector Strategy
Use data attributes when possible:
```typescript
// Bad (fragile)
await page.click('button.btn-primary');

// Better (more specific)
await page.click('button:has-text("Export All")');

// Best (if Kajabi adds them)
await page.click('[data-testid="export-button"]');
```

## Cost Analysis

### GitHub Actions
- **Free tier:** 2000 minutes/month
- **Daily run:** ~5 minutes/day = 150 minutes/month
- **Cost:** FREE (well within limits)

### Alternatives
- **Vercel Cron:** Not ideal for long-running tasks (10s timeout on Hobby)
- **AWS Lambda:** Possible but more complex
- **Railway/Render:** Good options with cron support

## Next Steps

1. [ ] Install Playwright: `npm install -D playwright`
2. [ ] Create `scripts/kajabi-export.ts`
3. [ ] Test login flow manually
4. [ ] Find correct selectors for export buttons
5. [ ] Test download flow
6. [ ] Create upload script
7. [ ] Set up GitHub Actions workflow
8. [ ] Add secrets to GitHub
9. [ ] Test end-to-end
10. [ ] Schedule for daily run

## Fallback Plan

If scraping becomes unreliable:
- Continue manual CSV exports (with bulk export, not page-by-page)
- Set calendar reminder to export weekly
- Still better than current page-by-page approach
