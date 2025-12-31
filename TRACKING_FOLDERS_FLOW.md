# Tracking Folders Usage Flow

## 📁 Three Tracking Folders

1. **`removed-track/{subject}.json`** - User-removed MCQs (should be excluded from SBERT)
2. **`saved-track/{subject}.json`** - Auto-saved non-duplicate MCQs (from SBERT)
3. **`final-track/{subject}.json`** - DEPRECATED (redirects to saved-track)

---

## 🔄 Complete Flow Diagram

### **FLOW 1: Initial SBERT Processing** (`/api/process/{subject}`)

```
User clicks "Resume with Running SBERT" or "Start Again"
    ↓
[READ] saved-track/{subject}.json
    → Exclude these files from processing
    ↓
Load MCQ files from classified_all_db/{subject}/
    ↓
Exclude files in saved-track
    ↓
Run SBERT on remaining files
    ↓
Identify non-duplicate files (not in any similarity group)
    ↓
[WRITE] saved-track/{subject}.json
    → Add non-duplicate files (auto-saved)
    → Merge with existing entries
```

**When changed:**
- ✅ **saved-track**: WRITTEN (non-duplicates added)
- ❌ **removed-track**: NOT CHANGED
- ❌ **final-track**: NOT USED

---

### **FLOW 2: Preparation for SBERT** (`/api/prepare-and-process/{subject}`)

```
User clicks "Resume with Running SBERT"
    ↓
[READ] removed-track/{subject}.json
    → Get list of removed files
    ↓
[READ] saved-track/{subject}.json
    → Get list of finalized files
    ↓
Count statistics:
    - Total files in classified_all_db-original/{subject}/
    - Removed files (from removed-track)
    - Finalized files (from saved-track)
    - Files to process = Total - Removed - Finalized
    ↓
Copy files from classified_all_db-original/{subject}/
    → EXCLUDE files in removed-track
    → EXCLUDE files in saved-track
    → Copy only remaining files to classified_all_db/{subject}/
    ↓
Run SBERT on copied files
    ↓
[WRITE] saved-track/{subject}.json
    → Add non-duplicate files
```

**When changed:**
- ✅ **saved-track**: WRITTEN (non-duplicates added)
- ❌ **removed-track**: READ ONLY (used to exclude files)
- ❌ **final-track**: NOT USED

---

### **FLOW 3: Submit Group** (`/api/submit-group`)

```
User reviews similarity groups and checks/unchecks files
    ↓
For each file in group:
    ↓
    If CHECKED (user wants to keep):
        ↓
        Current status = "unknown"?
            → [WRITE] final-track/{subject}.json (add file)
            → [READ] removed-track/{subject}.json
            → [WRITE] removed-track/{subject}.json (remove file if present)
        ↓
        Current status = "removed"?
            → [WRITE] final-track/{subject}.json (add file)
            → [READ] removed-track/{subject}.json
            → [WRITE] removed-track/{subject}.json (remove file)
        ↓
        Current status = "saved"?
            → No change (already saved)
    ↓
    If UNCHECKED (user wants to remove):
        ↓
        Current status = "saved"?
            → [WRITE] removed-track/{subject}.json (add file)
            → [WRITE] final-track/{subject}.json (remove file)
        ↓
        Current status = "removed"?
            → No change (already removed)
        ↓
        Current status = "unknown"?
            → [WRITE] removed-track/{subject}.json (add file)
```

**When changed:**
- ✅ **removed-track**: WRITTEN (files added/removed based on user choices)
- ✅ **final-track**: WRITTEN (files added/removed based on user choices)
- ❌ **saved-track**: NOT CHANGED

**Note:** `final-track` functions redirect to `saved-track`, so actually:
- ✅ **removed-track**: WRITTEN
- ✅ **saved-track**: WRITTEN (via final-track functions)
- ❌ **final-track**: NOT USED (deprecated)

---

### **FLOW 4: Toggle MCQ** (`/api/toggle-mcq`)

```
User toggles individual MCQ checkbox
    ↓
If toggling TO REMOVED (unchecked):
    ↓
    [WRITE] removed-track/{subject}.json (add file)
    [WRITE] final-track/{subject}.json (remove file)
    ↓
If toggling TO SAVED (checked):
    ↓
    [WRITE] final-track/{subject}.json (add file)
    [READ] removed-track/{subject}.json
    [WRITE] removed-track/{subject}.json (remove file)
```

**When changed:**
- ✅ **removed-track**: WRITTEN (file added or removed)
- ✅ **final-track**: WRITTEN (file added or removed, redirects to saved-track)
- ❌ **saved-track**: WRITTEN (via final-track redirect)

---

### **FLOW 5: Get File Status** (`get_file_status()`)

```
Called when displaying MCQ cards
    ↓
[READ] removed-track/{subject}.json
    → Check if file is in removed list
    ↓
[READ] saved-track/{subject}.json
    → Check if file is in saved list
    ↓
Return status:
    - "removed" if in removed-track
    - "saved" if in saved-track
    - "unknown" otherwise
```

**When changed:**
- ❌ **removed-track**: READ ONLY
- ❌ **saved-track**: READ ONLY
- ❌ **final-track**: NOT USED

---

### **FLOW 6: Get Preparation Stats** (`/api/preparation-stats/{subject}`)

```
User clicks "Resume with Running SBERT" or "Start Again"
    ↓
[READ] removed-track/{subject}.json
    → Count removed files
    ↓
[READ] saved-track/{subject}.json
    → Count finalized files
    ↓
Count total files in classified_all_db-original/{subject}/
    ↓
Calculate:
    - Total MCQs = count of all files
    - Finalized MCQs = count in saved-track
    - Removed MCQs = count in removed-track
    - Sending to SBERT = Total - Finalized - Removed
```

**When changed:**
- ❌ **removed-track**: READ ONLY
- ❌ **saved-track**: READ ONLY
- ❌ **final-track**: NOT USED

---

### **FLOW 7: Clear Session** (`/api/clear-session/{subject}`)

```
User clicks "Start Again"
    ↓
[READ] removed-track/{subject}.json (to count)
    ↓
[WRITE] removed-track/{subject}.json
    → Clear file (write empty array [])
    ↓
[WRITE] saved-track/{subject}.json
    → Clear file (write empty array [])
```

**When changed:**
- ✅ **removed-track**: WRITTEN (cleared to empty)
- ✅ **saved-track**: WRITTEN (cleared to empty)
- ❌ **final-track**: NOT USED

---

## 📊 Summary Table

| Action | removed-track | saved-track | final-track |
|--------|---------------|-------------|-------------|
| **SBERT Processing** | READ (exclude) | WRITE (add non-duplicates) | NOT USED |
| **Prepare for SBERT** | READ (exclude) | READ (exclude) | NOT USED |
| **Submit Group** | WRITE (add/remove) | WRITE (via final-track) | DEPRECATED |
| **Toggle MCQ** | WRITE (add/remove) | WRITE (via final-track) | DEPRECATED |
| **Get File Status** | READ | READ | NOT USED |
| **Get Stats** | READ | READ | NOT USED |
| **Clear Session** | WRITE (clear) | WRITE (clear) | NOT USED |

---

## 🎯 Key Points

1. **removed-track**: 
   - Used to EXCLUDE files from SBERT processing
   - Updated when user marks files as removed
   - READ during preparation to filter out removed files

2. **saved-track**:
   - Stores non-duplicate files (auto-saved by SBERT)
   - Also stores manually kept files (via deprecated final-track functions)
   - READ during processing to exclude already-processed files

3. **final-track**:
   - DEPRECATED - functions redirect to saved-track
   - Not actively used in current code
   - Empty for urdu subject

---

## ⚠️ Current Issue

The code **IS** using `removed-track/{subject}.json` correctly, but:
- `removed-track/urdu.json` has 10,545 entries
- Statistics show 0 removed MCQs

**Possible causes:**
1. Backend not restarted after code changes
2. Cached data in memory
3. Different code path being executed

The 10,545 MCQs in `removed-track/urdu.json` **SHOULD** be excluded from SBERT because `prepare_subject_for_sbert()` reads from `removed-track`.


