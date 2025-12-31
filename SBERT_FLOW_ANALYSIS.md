# Deep SBERT Flow Analysis

## 🔍 Problem: More than 1,777 MCQs going to SBERT

Let me trace through the complete flow to find where the issue is.

---

## 📁 Two Different Endpoints

### **Endpoint 1: `/api/process/{subject}`** (Direct SBERT)
- Called directly from frontend
- Loads files from `classified_all_db/{subject}/` (working folder)
- Does NOT prepare/copy files first

### **Endpoint 2: `/api/prepare-and-process/{subject}`** (Prepare + SBERT)
- Called when user clicks "Resume with Running SBERT"
- First calls `prepare_subject_for_sbert()` to copy files
- Then calls `process_subject()` to run SBERT

---

## 🔄 Flow Analysis

### **Flow 1: Direct `/api/process/{subject}`**

```
1. process_subject(subject) called
   ↓
2. Load excluded files:
   - removed_files = load_removed_tracking(subject)  // 10,545
   - saved_files = load_saved_tracking(subject)      // 2,447
   ↓
3. Clear final-track (user decisions reset)
   ↓
4. Load MCQ files:
   all_mcqs = load_mcq_files(subject)
   → Reads from: classified_all_db/{subject}/
   → Current count: 14,769 files (ALL files in working folder)
   ↓
5. Filter excluded files:
   mcqs = {f: data for f, data in all_mcqs.items() 
           if f not in (removed_files | saved_files)}
   → Excludes: 10,545 (removed) + 2,447 (saved) = 12,992
   → Remaining: 14,769 - 12,992 = 1,777 files ✅
   ↓
6. Process with SBERT: 1,777 files
```

**Issue Found:** 
- `load_mcq_files()` reads from `classified_all_db/{subject}/` (working folder)
- This folder currently has ALL 14,769 files
- But it should only have files that need processing!

---

### **Flow 2: `/api/prepare-and-process/{subject}`**

```
1. prepare_and_process(subject) called
   ↓
2. Clear session, cache, groups
   ↓
3. Clear final-track
   ↓
4. prepare_subject_for_sbert(subject):
   a. Clear working folder: classified_all_db/{subject}/
   b. Load excluded files:
      - removed_files = 10,545
      - saved_files = 2,447
   c. Copy from original to working:
      - Source: classified_all_db-original/{subject}/ (14,769 files)
      - Exclude: 10,545 (removed) + 2,447 (saved) = 12,992
      - Copy: 14,769 - 12,992 = 1,777 files ✅
      - Destination: classified_all_db/{subject}/
   ↓
5. process_subject(subject) called:
   a. Load excluded files (same as above)
   b. Load MCQ files from classified_all_db/{subject}/
      → Now has: 1,777 files (correct!)
   c. Filter excluded files:
      → Excludes: 10,545 + 2,447 = 12,992
      → But working folder only has 1,777 files
      → Remaining: 1,777 files ✅
   ↓
6. Process with SBERT: 1,777 files
```

**This flow is correct!**

---

## 🐛 THE BUG IDENTIFIED

### **Problem:**

When `/api/process/{subject}` is called **directly** (not through prepare-and-process):

1. `load_mcq_files()` reads from `classified_all_db/{subject}/` 
2. This folder has **ALL 14,769 files** (from previous runs or initial setup)
3. The exclusion logic filters out removed (10,545) and saved (2,447)
4. **BUT** the working folder shouldn't have all files in the first place!

### **Root Cause:**

The working folder `classified_all_db/{subject}/` is not being cleared/reset before direct SBERT processing. It contains all files from previous operations.

---

## 🔧 Solution

### **Option 1: Always prepare before processing**

Ensure `process_subject()` is only called after `prepare_subject_for_sbert()` has been called, which:
- Clears the working folder
- Copies only the files that need processing

### **Option 2: Clear working folder in `process_subject()`**

Add logic to `process_subject()` to:
- Check if working folder has files
- If it does, either:
  a. Clear it and prepare fresh, OR
  b. Use `prepare_subject_for_sbert()` first

### **Option 3: Always use original folder for counting**

Change `load_mcq_files()` to read from `classified_all_db-original/{subject}/` instead of `classified_all_db/{subject}/`, then apply exclusions.

---

## 📊 Current State Analysis

**Working Folder (`classified_all_db/urdu/`):**
- Has: 14,769 files (ALL files)
- Should have: Only files to process (1,777)

**Original Folder (`classified_all_db-original/urdu/`):**
- Has: 14,769 files (master copy)

**When `process_subject()` is called directly:**
- Loads: 14,769 files from working folder
- Excludes: 12,992 files (removed + saved)
- Processes: 1,777 files ✅ (correct count, but wrong source)

**BUT if working folder has extra files or wrong files, the count will be wrong!**

---

## 🎯 Recommended Fix

**Add preparation check in `process_subject()`:**

```python
@app.post("/api/process/{subject}")
async def process_subject(subject: str):
    # Check if working folder exists and has files
    working_path = file_manager.classified_path / subject
    original_path = file_manager.project_root / "classified_all_db-original" / subject
    
    # If working folder has files, verify they match what should be processed
    # OR always prepare fresh from original
    if working_path.exists() and any(working_path.glob("*.json")):
        # Option: Clear and prepare fresh
        # OR: Verify files match expected count
        pass
    
    # Continue with existing logic...
```

**OR better: Always prepare before processing in `process_subject()`:**

```python
@app.post("/api/process/{subject}")
async def process_subject(subject: str):
    # Always prepare fresh from original folder
    print(f"[MAIN] Preparing subject {subject} for SBERT...")
    copied_count, skipped_count = file_manager.prepare_subject_for_sbert(subject)
    
    # Now load from prepared working folder
    all_mcqs = file_manager.load_mcq_files(subject)
    # ... rest of logic
```

---

## ✅ Verification Steps

1. Check how many files are in `classified_all_db/urdu/`:
   ```bash
   find classified_all_db/urdu -name "*.json" | wc -l
   ```

2. Check how many files should be processed:
   - Total: 14,769
   - Removed: 10,545
   - Saved: 2,447
   - Should process: 1,777

3. Check if working folder has correct files:
   - If it has 14,769 → BUG (should have 1,777)
   - If it has 1,777 → Correct

4. Check which endpoint is being called:
   - `/api/process/{subject}` → Direct (might have bug)
   - `/api/prepare-and-process/{subject}` → With preparation (should be correct)


