# MCQ Processing and Deduplication System

A full-stack application for processing, deduplicating, and managing Multiple Choice Questions (MCQs) using AI-powered similarity detection.

## Project Structure

```
testpoint/
├── backend/          # Python FastAPI backend
├── frontend/         # Next.js React frontend
├── MCQ_DB/          # Source MCQ database files
├── classified_all_db/ # Processed and classified MCQs
├── process_mcqs.js  # Main processing script
└── prompts/         # AI prompts for MCQ generation
```

## Prerequisites

### For macOS/Linux:
- Node.js (v18 or higher)
- Python 3.8 or higher
- npm or yarn

### For Windows 10:
- Node.js (v18 or higher) - Download from [nodejs.org](https://nodejs.org/)
- Python 3.8 or higher - Download from [python.org](https://www.python.org/downloads/)
- Git for Windows - Download from [git-scm.com](https://git-scm.com/download/win)
- npm (comes with Node.js)

## Setup Instructions

### 1. Clone the Repository

**On Windows 10:**
```bash
# Open Command Prompt or PowerShell
# Navigate to where you want to clone the project
cd C:\Users\YourUsername\Documents

# Clone the repository
git clone https://github.com/yourusername/testpoint.git

# Navigate into the project
cd testpoint
```

### 2. Backend Setup

```bash
# Navigate to backend directory
cd backend

# Create a virtual environment (recommended)
# On macOS/Linux:
python3 -m venv venv
source venv/bin/activate

# On Windows 10:
python -m venv venv
venv\Scripts\activate

# Install Python dependencies
pip install -r requirements.txt
```

### 3. Frontend Setup

```bash
# Navigate to frontend directory
cd frontend

# Install Node.js dependencies
npm install
```

### 4. Environment Configuration

Create a `.env` file in the root directory:

```bash
# In the root directory (testpoint/)
OPENAI_API_KEY=your_openai_api_key_here
```

**Important:** Never commit your `.env` file to GitHub! It's already in `.gitignore`.

### 5. Running the Application

**Start Backend:**
```bash
# From backend directory
cd backend
python main.py
# Or use uvicorn directly:
uvicorn main:app --reload --port 8000
```

**Start Frontend:**
```bash
# From frontend directory
cd frontend
npm run dev
```

The application will be available at:
- Frontend: http://localhost:3009
- Backend: http://localhost:8000

## Usage

1. Place your MCQ JSON files in the `MCQ_DB/` directory
2. Run the processing script: `node process_mcqs.js`
3. Access the web interface at http://localhost:3009

## Windows 10 Specific Notes

1. **Path Separators:** Windows uses backslashes (`\`) instead of forward slashes (`/`). Git handles this automatically, but be aware when writing scripts.

2. **Line Endings:** Git will handle line ending conversions automatically if you have `core.autocrlf=true` (default on Windows).

3. **Python Path:** On Windows, use `python` instead of `python3` in most cases.

4. **Activating Virtual Environment:** Use `venv\Scripts\activate` instead of `source venv/bin/activate`.

## Troubleshooting

### Common Issues on Windows 10:

1. **"python is not recognized"**
   - Make sure Python is installed and added to PATH
   - Restart your terminal after installing Python

2. **"npm is not recognized"**
   - Make sure Node.js is installed
   - Restart your terminal after installing Node.js

3. **Permission Errors**
   - Run Command Prompt or PowerShell as Administrator if needed

4. **Port Already in Use**
   - Change the port in `frontend/package.json` or backend configuration

## Contributing

1. Create a new branch for your changes
2. Make your changes
3. Commit and push to your branch
4. Create a Pull Request

## License

[Add your license here]

