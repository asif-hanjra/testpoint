# Windows 10 Setup Instructions - Step by Step

## Step 1: Install Required Software

### Install Git
1. Go to: https://git-scm.com/download/win
2. Download and run the installer
3. **Important:** During installation, choose "Git from the command line and also from 3rd-party software"
4. Click "Next" through all steps (default options are fine)
5. Restart your computer after installation

### Install Node.js
1. Go to: https://nodejs.org/
2. Download the **LTS version** (recommended)
3. Run the installer
4. Click "Next" through all steps (default options are fine)
5. Restart your computer after installation

### Install Python
1. Go to: https://www.python.org/downloads/
2. Download Python 3.8 or higher
3. Run the installer
4. **IMPORTANT:** Check the box "Add Python to PATH" at the bottom
5. Click "Install Now"
6. Restart your computer after installation

---

## Step 2: Open Command Prompt

1. Press `Windows Key + R`
2. Type: `cmd`
3. Press `Enter`
4. A black window (Command Prompt) will open

---

## Step 3: Navigate to Desktop

In the Command Prompt window, type this and press Enter:

```
cd Desktop
```

---

## Step 4: Clone the Repository

Type this command and press Enter:

```
git clone https://github.com/asif-hanjra/testpoint.git
```

Wait for it to finish downloading (this may take a few minutes).

---

## Step 5: Go Into the Project Folder

Type this and press Enter:

```
cd testpoint
```

---

## Step 6: Set Up Backend (Python)

### Step 6a: Go to Backend Folder
Type this and press Enter:

```
cd backend
```

### Step 6b: Create Virtual Environment
Type this and press Enter:

```
python -m venv venv
```

Wait for it to finish (takes a few seconds).

### Step 6c: Activate Virtual Environment
Type this and press Enter:

```
venv\Scripts\activate
```

**You should see `(venv)` appear at the beginning of your command line.**

### Step 6d: Install Python Packages
Type this and press Enter:

```
pip install -r requirements.txt
```

Wait for it to finish (this may take 5-10 minutes).

---

## Step 7: Set Up Frontend (Node.js)

### Step 7a: Go Back to Project Root
Type this and press Enter:

```
cd ..
```

### Step 7b: Go to Frontend Folder
Type this and press Enter:

```
cd frontend
```

### Step 7c: Install Node Packages
Type this and press Enter:

```
npm install
```

Wait for it to finish (this may take 5-10 minutes).

---

## Step 8: Create .env File

### Step 8a: Go Back to Project Root
Type this and press Enter:

```
cd ..
```

### Step 8b: Create .env File
Type this and press Enter:

```
notepad .env
```

### Step 8c: In Notepad, Type This:
```
OPENAI_API_KEY=your_openai_api_key_here
```

**Replace `your_openai_api_key_here` with your actual OpenAI API key.**

### Step 8d: Save and Close
- Press `Ctrl + S` to save
- Close Notepad

---

## Step 9: Run the Application

You need **TWO** Command Prompt windows open:

### Window 1: Backend Server

1. Open a **NEW** Command Prompt (Windows Key + R, type `cmd`, press Enter)
2. Type these commands one by one:

```
cd Desktop\testpoint\backend
venv\Scripts\activate
python main.py
```

**Leave this window open!** You should see the server starting.

### Window 2: Frontend Server

1. Open **ANOTHER** Command Prompt window
2. Type these commands one by one:

```
cd Desktop\testpoint\frontend
npm run dev
```

**Leave this window open too!** You should see the frontend starting.

---

## Step 10: Open in Browser

Once both servers are running, open your web browser and go to:

```
http://localhost:3009
```

---

## Troubleshooting

### "git is not recognized"
- Restart your computer after installing Git
- Make sure you installed Git properly

### "python is not recognized"
- Make sure you checked "Add Python to PATH" during installation
- Restart your computer
- Try `python3` instead of `python`

### "npm is not recognized"
- Restart your computer after installing Node.js
- Make sure Node.js installed correctly

### "venv\Scripts\activate" doesn't work
- Make sure you're in the `backend` folder
- Try: `.\venv\Scripts\activate`

### Port already in use
- Close any other applications using port 3009 or 8000
- Or change the port in the configuration files

### Can't find .env file
- Make sure you're in the `testpoint` folder (not `backend` or `frontend`)
- The file might be hidden - in File Explorer, go to View → Show → Hidden items

---

## Quick Reference Commands

**To start backend:**
```
cd Desktop\testpoint\backend
venv\Scripts\activate
python main.py
```

**To start frontend:**
```
cd Desktop\testpoint\frontend
npm run dev
```

**To stop servers:**
- Press `Ctrl + C` in each Command Prompt window

---

## Need Help?

If something doesn't work:
1. Make sure all software is installed
2. Restart your computer
3. Try the commands again
4. Check the error message and search online for solutions

