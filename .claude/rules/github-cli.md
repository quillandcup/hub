## github-cli

# GitHub CLI

CLI for GitHub operations.

**Docs:** https://cli.github.com/manual/

## Usage Guidelines

**ALWAYS use `gh` CLI for GitHub operations instead of WebFetch or web scraping.**

The `gh` CLI uses authenticated GitHub sessions and works with both public and private repositories. WebFetch makes unauthenticated HTTP requests and will fail with 404 errors on private repositories.

## Common Commands

### Pull Requests
```bash
# View PR details (preferred over WebFetch)
gh pr view <number> --json title,body,author,state,number,headRefName,baseRefName,url,createdAt,mergedAt,closedAt,commits,files,labels,reviews

# Create a PR
gh pr create --title "..." --body "..."

# List PRs
gh pr list --state open --limit 10

# Check PR status/checks
gh pr checks <number>

# Merge a PR
gh pr merge <number>
```

### Issues
```bash
# View issue details
gh issue view <number> --json title,body,author,state,labels,comments

# Create an issue
gh issue create --title "..." --body "..."

# List issues
gh issue list --state open --limit 10
```

### Repositories
```bash
# View repository info
gh repo view <owner/repo> --json name,description,isPrivate,visibility

# Clone a repository
gh repo clone <owner/repo>
```

### Other Operations
```bash
# View workflow runs
gh run list --limit 10

# Get workflow run details
gh run view <run-id>

# Trigger a workflow
gh workflow run <workflow-name>
```

## Authentication

The `gh` CLI uses OAuth authentication. Users should authenticate with:
```bash
gh auth login
```

Check authentication status:
```bash
gh auth status
```
