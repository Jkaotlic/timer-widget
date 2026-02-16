#!/bin/bash
set -e

echo "Cleaning up..."
rm -rf node_modules package-lock.json dist
echo "Removing extended attributes..."
xattr -cr . 2>/dev/null || true
echo "Installing dependencies..."
npm install --force
echo "Done!"
