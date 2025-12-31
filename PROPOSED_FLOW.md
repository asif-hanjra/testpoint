# Proposed Flow - Separated Tracking System

## 📁 Three Tracking Folders (New Purpose)

1. **`saved-track/{subject}.json`** - **ONLY** SBERT auto-saved non-duplicates
2. **`final-track/{subject}.json`** - User manually kept files (from group submissions)
3. **`removed-track/{subject}.json`** - User removed files

---

## 🔄 Proposed Flow Diagram

### **FLOW 1: SBERT Processing** (`/api/process/{subject}`)

```
User runs SBERT
    ↓
[READ] saved-track/{subject}.json
    → Exclude already processed non-duplicates
    ↓
[READ] final-track/{subject}.json
    → Exclude manually kept files
    ↓
[READ] removed-track/{subject}.json
    → Exclude removed files
    ↓
Load MCQ files from classified_all_db/{subject}/
    ↓
Exclude files in saved-track, final-track, and removed-track
    ↓
Run SBERT on remaining files
    ↓
Identify non-duplicate files (not in any similarity group)
    ↓
[WRITE] saved-track/{subject}.json
    → Add ONLY non-duplicate files (auto-saved by SBERT)
    → Merge with existing entries
    → DO NOT add manually kept files here
```

**When changed:**
- ✅ **saved-track**: WRITTEN (non-duplicates from SBERT only)
- ❌ **final-track**: READ ONLY (exclude from processing)
- ❌ **removed-track**: READ ONLY (exclude from processing)

---

### **FLOW 2: Preparation for SBERT** (`/api/prepare-and-process/{subject}`)

```
User clicks "Resume with Running SBERT"
    ↓
[READ] removed-track/{subject}.json
    → Get list of removed files
    ↓
[READ] final-track/{subject}.json
    → Get list of manually kept files
    ↓
[READ] saved-track/{subject}.json
    → Get list of auto-saved non-duplicates
    ↓
Count statistics:
    - Total files in classified_all_db-original/{subject}/
    - Removed files (from removed-track)
    - Finalized files (from final-track + saved-track)
    - Files to process = Total - Removed - Finalized
    ↓
Copy files from classified_all_db-original/{subject}/
    → EXCLUDE files in removed-track
    → EXCLUDE files in final-track
    → EXCLUDE files in saved-track
    → Copy only remaining files to classified_all_db/{subject}/
    ↓
Run SBERT on copied files
    ↓
[WRITE] saved-track/{subject}.json
    → Add ONLY non-duplicate files (auto-saved)
    → DO NOT add manually kept files
```

**When changed:**
- ✅ **saved-track**: WRITTEN (non-duplicates from SBERT only)
- ❌ **final-track**: READ ONLY (exclude from processing)
- ❌ **removed-track**: READ ONLY (exclude from processing)

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
            → No change (already in final-track or saved-track)
    ↓
    If UNCHECKED (user wants to remove):
        ↓
        Current status = "saved"?
            → [WRITE] removed-track/{subject}.json (add file)
            → [READ] final-track/{subject}.json
            → [WRITE] final-track/{subject}.json (remove file if present)
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
- ❌ **saved-track**: NOT CHANGED (only SBERT writes here)

**Key Change:** 
- `save_final_tracking()` should write to `final-track/{subject}.json` (NOT redirect to saved-track)
- `remove_from_final_tracking()` should remove from `final-track/{subject}.json` (NOT from saved-track)

---

### **FLOW 4: Toggle MCQ** (`/api/toggle-mcq`)

```
User toggles individual MCQ checkbox
    ↓
If toggling TO REMOVED (unchecked):
    ↓
    [WRITE] removed-track/{subject}.json (add file)
    [READ] final-track/{subject}.json
    [WRITE] final-track/{subject}.json (remove file if present)
    ↓
If toggling TO SAVED (checked):
    ↓
    [WRITE] final-track/{subject}.json (add file)
    [READ] removed-track/{subject}.json
    [WRITE] removed-track/{subject}.json (remove file)
```

**When changed:**
- ✅ **removed-track**: WRITTEN (file added or removed)
- ✅ **final-track**: WRITTEN (file added or removed)
- ❌ **saved-track**: NOT CHANGED

---

### **FLOW 5: Get File Status** (`get_file_status()`) - **CHANGED**

```
Called when displaying MCQ cards
    ↓
[READ] removed-track/{subject}.json
    → Check if file is in removed list
    ↓
[READ] final-track/{subject}.json
    → Check if file is in manually kept list
    ↓
[READ] saved-track/{subject}.json
    → Check if file is in auto-saved non-duplicates
    ↓
Return status:
    - "removed" if in removed-track
    - "saved" if in final-track OR saved-track
    - "unknown" otherwise
```

**When changed:**
- ❌ **removed-track**: READ ONLY
- ❌ **final-track**: READ ONLY (NEW - check here first for saved status)
- ❌ **saved-track**: READ ONLY (check here for saved status if not in final-track)

**Key Change:**
- Priority: `removed-track` > `final-track` > `saved-track` > `unknown`
- Check `final-track` FIRST for "saved" status (user manually kept)
- Then check `saved-track` (SBERT auto-saved)

---

### **FLOW 6: Get Preparation Stats** (`/api/preparation-stats/{subject}`)

```
User clicks "Resume with Running SBERT" or "Start Again"
    ↓
[READ] removed-track/{subject}.json
    → Count removed files
    ↓
[READ] final-track/{subject}.json
    → Count manually kept files
    ↓
[READ] saved-track/{subject}.json
    → Count auto-saved non-duplicates
    ↓
Count total files in classified_all_db-original/{subject}/
    ↓
Calculate:
    - Total MCQs = count of all files
    - Finalized MCQs = count in final-track + count in saved-track
    - Removed MCQs = count in removed-track
    - Sending to SBERT = Total - Finalized - Removed
```

**When changed:**
- ❌ **removed-track**: READ ONLY
- ❌ **final-track**: READ ONLY (count manually kept)
- ❌ **saved-track**: READ ONLY (count auto-saved)

**Key Change:**
- Finalized = `final-track` + `saved-track` (both are "finalized")

---

### **FLOW 7: Clear Session** (`/api/clear-session/{subject}`)

```
User clicks "Start Again"
    ↓
[READ] removed-track/{subject}.json (to count)
[READ] final-track/{subject}.json (to count)
[READ] saved-track/{subject}.json (to count)
    ↓
[WRITE] removed-track/{subject}.json
    → Clear file (write empty array [])
    ↓
[WRITE] final-track/{subject}.json
    → Clear file (write empty array [])
    ↓
[WRITE] saved-track/{subject}.json
    → Clear file (write empty array [])
```

**When changed:**
- ✅ **removed-track**: WRITTEN (cleared to empty)
- ✅ **final-track**: WRITTEN (cleared to empty)
- ✅ **saved-track**: WRITTEN (cleared to empty)

---

## 📊 Summary Table (Proposed)

| Action | removed-track | saved-track | final-track |
|--------|---------------|-------------|-------------|
| **SBERT Processing** | READ (exclude) | WRITE (add non-duplicates ONLY) | READ (exclude) |
| **Prepare for SBERT** | READ (exclude) | READ (exclude) | READ (exclude) |
| **Submit Group** | WRITE (add/remove) | NOT CHANGED | WRITE (add/remove) |
| **Toggle MCQ** | WRITE (add/remove) | NOT CHANGED | WRITE (add/remove) |
| **Get File Status** | READ | READ (secondary) | READ (primary for saved) |
| **Get Stats** | READ | READ (count finalized) | READ (count finalized) |
| **Clear Session** | WRITE (clear) | WRITE (clear) | WRITE (clear) |

---

## 🎯 Key Changes Required

### 1. **`save_final_tracking()`** - Write to final-track (NOT redirect)
```python
# CURRENT (WRONG):
def save_final_tracking(self, subject: str, new_final_files: List[str]) -> List[str]:
    return self.save_saved_tracking(subject, new_final_files)  # Redirects to saved-track

# PROPOSED (CORRECT):
def save_final_tracking(self, subject: str, new_final_files: List[str]) -> List[str]:
    tracking_path = self.project_root / "final-track"
    tracking_file = tracking_path / f"{subject}.json"
    # ... actually write to final-track/{subject}.json
```

### 2. **`load_final_tracking()`** - Read from final-track (NOT redirect)
```python
# CURRENT (WRONG):
def load_final_tracking(self, subject: str) -> List[str]:
    return self.load_saved_tracking(subject)  # Redirects to saved-track

# PROPOSED (CORRECT):
def load_final_tracking(self, subject: str) -> List[str]:
    tracking_file = self.project_root / "final-track" / f"{subject}.json"
    # ... actually read from final-track/{subject}.json
```

### 3. **`remove_from_final_tracking()`** - Remove from final-track (NOT saved-track)
```python
# CURRENT (WRONG):
def remove_from_final_tracking(self, subject: str, files_to_remove: List[str]) -> List[str]:
    tracking_file = self.project_root / "saved-track" / f"{subject}.json"  # Wrong folder

# PROPOSED (CORRECT):
def remove_from_final_tracking(self, subject: str, files_to_remove: List[str]) -> List[str]:
    tracking_file = self.project_root / "final-track" / f"{subject}.json"  # Correct folder
```

### 4. **`get_file_status()`** - Check final-track first (NOT saved-track)
```python
# CURRENT (WRONG):
def get_file_status(self, subject: str, filename: str) -> str:
    removed_files = set(self.load_removed_tracking(subject))
    saved_files = set(self.load_saved_tracking(subject))  # Checks saved-track
    if filename in removed_files:
        return "removed"
    elif filename in saved_files:
        return "saved"
    else:
        return "unknown"

# PROPOSED (CORRECT):
def get_file_status(self, subject: str, filename: str) -> str:
    removed_files = set(self.load_removed_tracking(subject))
    final_files = set(self.load_final_tracking(subject))  # Check final-track first
    saved_files = set(self.load_saved_tracking(subject))   # Check saved-track second
    if filename in removed_files:
        return "removed"
    elif filename in final_files:  # User manually kept
        return "saved"
    elif filename in saved_files:  # SBERT auto-saved
        return "saved"
    else:
        return "unknown"
```

### 5. **`get_preparation_stats()`** - Count from both final-track and saved-track
```python
# PROPOSED:
def get_preparation_stats(self, subject: str) -> Dict:
    removed_files = self.load_removed_tracking(subject)
    final_files = self.load_final_tracking(subject)  # Manually kept
    saved_files = self.load_saved_tracking(subject)  # Auto-saved
    
    removed_count = len(removed_files)
    finalized_count = len(final_files) + len(saved_files)  # Both count as finalized
    
    # ...
```

### 6. **`prepare_subject_for_sbert()`** - Exclude from final-track too
```python
# PROPOSED:
def prepare_subject_for_sbert(self, subject: str) -> Tuple[int, int]:
    removed_files = set(self.load_removed_tracking(subject))
    final_files = set(self.load_final_tracking(subject))  # Exclude manually kept
    saved_files = set(self.load_saved_tracking(subject))   # Exclude auto-saved
    
    for json_file in original_path.glob("*.json"):
        if json_file.name in removed_files:
            skipped_removed_count += 1
            continue
        if json_file.name in final_files:  # Exclude manually kept
            skipped_final_count += 1
            continue
        if json_file.name in saved_files:  # Exclude auto-saved
            skipped_saved_count += 1
            continue
        # ... copy file
```

---

## ✅ Benefits of This Approach

1. **Clear Separation:**
   - `saved-track` = Only SBERT auto-saved non-duplicates
   - `final-track` = Only user manually kept files
   - `removed-track` = Only user removed files

2. **No Confusion:**
   - User actions (submit group, toggle MCQ) → `final-track`
   - SBERT actions (auto-save) → `saved-track`
   - User removals → `removed-track`

3. **Better Tracking:**
   - Can distinguish between SBERT auto-saved vs user manually kept
   - Can see which files were kept by user vs which were non-duplicates

4. **Correct Exclusion:**
   - All three folders properly exclude files from SBERT processing
   - Statistics correctly count finalized files from both sources

---

## ⚠️ Migration Notes

When implementing this:
1. Existing `saved-track` files may contain manually kept files (need to migrate to `final-track`)
2. `final-track` files are currently empty (will be populated after changes)
3. Need to ensure `save_final_tracking()` actually writes to `final-track` folder
4. Need to ensure `load_final_tracking()` actually reads from `final-track` folder


