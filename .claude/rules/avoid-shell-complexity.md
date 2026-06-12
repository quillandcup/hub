## avoid-shell-complexity

Minimize shell complexity in tool calls to avoid unnecessary permission prompts. Permission allowlists use glob patterns where `*` may not match complex shell constructs.

**Prefer dedicated tools over Bash:**

| Instead of | Use |
|------------|-----|
| `cat`, `head`, `tail` | Read tool |
| `find`, `ls` | Glob tool |
| `grep`, `rg` | Grep tool |
| `echo "..." > file`, heredocs | Write tool |

**When Bash is necessary, keep commands simple:**

| Avoid | Use instead | Why |
|-------|-------------|-----|
| `$()` or backtick substitution | Pipes, `xargs` | `$()` triggers a separate permission prompt |
| `count=$(cmd); echo $count` | `echo -n "label: "; cmd` | Pipe output directly |
| `var=$(cmd1); cmd2 "$var"` | `cmd1 \| xargs cmd2` | Let the shell pipe data through |
| Embedded newlines | Single-line commands | Glob `*` may not match newlines |
| `< file.sql` stdin redirects | Inline SQL or `--flagfile` | Redirect operators trigger prompts |
| Complex for/while loops | Multiple sequential tool calls | Each simple call matches allowlists cleanly |
| `cat <<EOF > file` | Write tool | Heredocs are multi-line + redirect |
| `# comments with quotes` | No inline comments, or quote-free comments | Quotes in `#` comments desync quote tracking |

