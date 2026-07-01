## worktree-setup

After creating a worktree with EnterWorktree, copy `.env.local` from the repo root so the production build (which the pre-commit hook runs) can connect to Supabase:

```bash
cp /Users/cody/git/quillandcup/hub/.env.local .
```

Without it, `next build` fails with "Your project's URL and API key are required" and the commit is blocked.
