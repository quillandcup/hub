#!/bin/bash

# Install git hooks for the project
# Run this script after cloning the repository

echo "📦 Installing git hooks..."

# Pre-commit hook
cat > .git/hooks/pre-commit << 'EOF'
#!/bin/sh

# Pre-commit hook to run production build
# This catches TypeScript errors before committing

echo "🔍 Running production build before commit..."
npm run build

if [ $? -ne 0 ]; then
  echo ""
  echo "❌ Build failed! Fix TypeScript errors before committing."
  echo "   To skip this check, use: git commit --no-verify"
  exit 1
fi

echo "✅ Build successful! Proceeding with commit..."
exit 0
EOF

chmod +x .git/hooks/pre-commit

echo "✅ Git hooks installed successfully!"
echo ""
echo "Installed hooks:"
echo "  - pre-commit: Runs 'npm run build' before committing"
echo ""
echo "To skip hooks temporarily, use: git commit --no-verify"
