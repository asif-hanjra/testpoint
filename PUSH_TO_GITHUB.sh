#!/bin/bash

# Script to push code to GitHub
# Replace YOUR_USERNAME with your GitHub username
# Replace testpoint with your repository name if different

echo "=========================================="
echo "Pushing to GitHub"
echo "=========================================="
echo ""
echo "Step 1: Make sure you've created a repository on GitHub.com"
echo "        Go to: https://github.com/new"
echo ""
read -p "Enter your GitHub username: " GITHUB_USER
read -p "Enter your repository name (default: testpoint): " REPO_NAME
REPO_NAME=${REPO_NAME:-testpoint}

echo ""
echo "Adding remote repository..."
git remote add origin https://github.com/${GITHUB_USER}/${REPO_NAME}.git 2>/dev/null || git remote set-url origin https://github.com/${GITHUB_USER}/${REPO_NAME}.git

echo ""
echo "Current remotes:"
git remote -v

echo ""
echo "Pushing to GitHub..."
echo "You may be prompted for your GitHub credentials."
echo "Use a Personal Access Token (not your password) if using HTTPS"
echo ""
git push -u origin main

echo ""
echo "=========================================="
echo "Done! Your code is now on GitHub."
echo "=========================================="
echo ""
echo "Repository URL: https://github.com/${GITHUB_USER}/${REPO_NAME}"

