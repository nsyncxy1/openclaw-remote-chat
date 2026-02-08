#!/bin/bash

echo "📦 Building OpenClaw Remote Chat Extension..."

# Install dependencies
echo "Installing dependencies..."
npm install --include=dev

# Compile TypeScript
echo "Compiling TypeScript..."
npm run compile

# Check if vsce is installed
if ! command -v vsce &> /dev/null; then
    echo "Installing @vscode/vsce..."
    npm install -g @vscode/vsce
fi

# Package extension
echo "Packaging extension..."
vsce package

echo "✅ Done! Extension packaged as .vsix file"
echo ""
echo "To install:"
echo "1. Open VS Code"
echo "2. Press F1 and type 'Extensions: Install from VSIX...'"
echo "3. Select the .vsix file"
echo ""
echo "Or run: code --install-extension openclaw-remote-chat-*.vsix"
