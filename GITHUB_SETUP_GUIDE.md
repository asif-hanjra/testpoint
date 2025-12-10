# Complete Guide: Pushing to GitHub and Cloning on Windows 10

## Part 1: Pushing Your Code to GitHub (from macOS)

### Step 1: Create a GitHub Repository

1. Go to [github.com](https://github.com) and sign in
2. Click the **"+"** icon in the top right corner
3. Select **"New repository"**
4. Fill in the details:
   - **Repository name:** `testpoint` (or your preferred name)
   - **Description:** (optional) "MCQ Processing and Deduplication System"
   - **Visibility:** Choose Public or Private
   - **DO NOT** initialize with README, .gitignore, or license (we already have these)
5. Click **"Create repository"**

### Step 2: Add All Files to Git

```bash
# Make sure you're in the project directory
cd /Users/mac/testpoint

# Check current status
git status

# Add all files (except those in .gitignore)
git add .

# Verify what will be committed
git status
```

### Step 3: Make Your First Commit

```bash
# Create your first commit
git commit -m "Initial commit: MCQ processing system"

# If this is your first time using git, you may need to set your identity:
git config --global user.name "Your Name"
git config --global user.email "your.email@example.com"
```

### Step 4: Connect to GitHub and Push

After creating the repository on GitHub, you'll see instructions. Use these commands:

```bash
# Add GitHub as remote (replace YOUR_USERNAME with your GitHub username)
git remote add origin https://github.com/YOUR_USERNAME/testpoint.git

# If you already have a remote, you can update it:
# git remote set-url origin https://github.com/YOUR_USERNAME/testpoint.git

# Verify the remote was added
git remote -v

# Push to GitHub (first time)
git branch -M main
git push -u origin main
```

**Note:** If you're using SSH instead of HTTPS:
```bash
git remote add origin git@github.com:YOUR_USERNAME/testpoint.git
```

### Step 5: Authentication

When you push, GitHub will ask for authentication:
- **For HTTPS:** You'll need a Personal Access Token (not your password)
  - Go to GitHub Settings → Developer settings → Personal access tokens → Tokens (classic)
  - Generate a new token with `repo` permissions
  - Use this token as your password when pushing

- **For SSH:** Make sure your SSH key is added to your GitHub account

---

## Part 2: Cloning on Windows 10

### Step 1: Install Required Software

1. **Git for Windows:**
   - Download from: https://git-scm.com/download/win
   - Install with default settings
   - Choose "Git from the command line and also from 3rd-party software"

2. **Node.js:**
   - Download from: https://nodejs.org/
   - Choose the LTS version
   - Install with default settings
   - This includes npm

3. **Python:**
   - Download from: https://www.python.org/downloads/
   - Choose Python 3.8 or higher
   - **Important:** Check "Add Python to PATH" during installation

### Step 2: Clone the Repository

**Option A: Using Command Prompt**
```cmd
# Open Command Prompt (Win + R, type "cmd", press Enter)
# Navigate to where you want the project
cd C:\Users\YourUsername\Documents

# Clone the repository (replace YOUR_USERNAME with your GitHub username)
git clone https://github.com/YOUR_USERNAME/testpoint.git

# Navigate into the project
cd testpoint
```

**Option B: Using PowerShell**
```powershell
# Open PowerShell
# Navigate to where you want the project
cd C:\Users\YourUsername\Documents

# Clone the repository
git clone https://github.com/YOUR_USERNAME/testpoint.git

# Navigate into the project
cd testpoint
```

**Option C: Using GitHub Desktop (GUI)**
1. Download GitHub Desktop from: https://desktop.github.com/
2. Sign in with your GitHub account
3. Click "File" → "Clone repository"
4. Select your repository and choose a local path
5. Click "Clone"

### Step 3: Set Up the Project on Windows

**Backend Setup:**
```cmd
# Navigate to backend directory
cd backend

# Create virtual environment
python -m venv venv

# Activate virtual environment
venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt
```

**Frontend Setup:**
```cmd
# Navigate to frontend directory (from project root)
cd frontend

# Install dependencies
npm install
```

**Create .env File:**
```cmd
# Go back to project root
cd ..

# Create .env file (you can use notepad or any text editor)
notepad .env
```

Add this content to `.env`:
```
OPENAI_API_KEY=your_openai_api_key_here
```

### Step 4: Run the Application

**Start Backend:**
```cmd
cd backend
venv\Scripts\activate
python main.py
```

**Start Frontend (in a new terminal):**
```cmd
cd frontend
npm run dev
```

---

## Troubleshooting

### On macOS (Pushing):

1. **"Permission denied (publickey)"**
   - Set up SSH keys or use HTTPS with Personal Access Token

2. **"Repository not found"**
   - Check repository name and username
   - Verify you have access to the repository

3. **Large files taking too long**
   - Consider using Git LFS for large files
   - Or exclude large data directories in .gitignore

### On Windows 10 (Cloning):

1. **"git is not recognized"**
   - Restart Command Prompt/PowerShell after installing Git
   - Verify Git is in PATH: `git --version`

2. **"python is not recognized"**
   - Reinstall Python and check "Add to PATH"
   - Restart terminal after installation

3. **"npm is not recognized"**
   - Restart terminal after installing Node.js
   - Verify: `node --version` and `npm --version`

4. **Virtual environment activation fails**
   - Make sure you're in the backend directory
   - Try: `python -m venv venv` again
   - On some systems: `venv\Scripts\activate.bat`

5. **Line ending warnings**
   - Git handles this automatically, but you can configure:
   ```cmd
   git config --global core.autocrlf true
   ```

---

## Quick Reference Commands

### macOS (Pushing):
```bash
git add .
git commit -m "Your commit message"
git push origin main
```

### Windows 10 (Pulling Updates):
```cmd
git pull origin main
```

### Windows 10 (Making Changes and Pushing):
```cmd
git add .
git commit -m "Your commit message"
git push origin main
```

---

## Important Notes

1. **Never commit sensitive data:**
   - `.env` files are already in `.gitignore`
   - API keys should never be in the repository

2. **Large files:**
   - The `classified_all_db/` and `openai_responses/` directories are large
   - Consider if you need to commit these or if they can be regenerated
   - You can uncomment lines in `.gitignore` to exclude them

3. **Keep repositories in sync:**
   - Always `git pull` before starting work
   - Commit and push regularly

4. **Branching (optional):**
   - Consider using branches for features: `git checkout -b feature-name`
   - Merge to main when ready

---

## Need Help?

- Git documentation: https://git-scm.com/doc
- GitHub Help: https://docs.github.com
- Stack Overflow: https://stackoverflow.com/questions/tagged/git

