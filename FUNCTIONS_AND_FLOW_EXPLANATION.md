# Functions and Flow Explanation

## 1. ✅ Updated: `get_file_status()` - Now Only Checks `final-track`

**File:** `backend/file_manager.py`

**Updated Behavior:**
- ✅ Checks `removed-track` → returns "removed"
- ✅ Checks `final-track` → returns "saved" (user manually kept)
- ❌ Does NOT check `saved-track` anymore
- Returns "unknown" if not in either

**Priority:**
1. `removed-track` → "removed"
2. `final-track` → "saved"
3. Else → "unknown"

**Why:** File status is based on user decisions (final-track), not SBERT auto-saves (saved-track).

---

## 2. Purpose of Functions

### **`get_preparation_stats(subject)`**

**Purpose:** Get statistics BEFORE running SBERT (for display in confirmation dialog)

**What it does:**
1. Counts total files in `classified_all_db-original/{subject}/`
2. Counts removed files from `removed-track/{subject}.json`
3. Counts saved files from `saved-track/{subject}.json` (SBERT auto-saved)
4. **Note:** `final-track` is NOT counted (will be cleared when SBERT runs)
5. Calculates: `files_to_process = total - saved - removed`

**Returns:**
```json
{
  "total_files": 14769,
  "finalized_files": 2447,  // Only saved-track (SBERT auto-saved)
  "removed_files": 10545,
  "files_to_process": 1777  // Will go to SBERT
}
```

**When used:**
- When user clicks "Resume with Running SBERT" or "Start Again"
- Shows confirmation dialog with statistics
- Helps user understand how many files will be processed

---

### **`get_statistics(subject)`**

**Purpose:** Get general statistics for a subject (for summary/overview pages)

**What it does:**
1. Counts finalized files from:
   - `final-track/{subject}.json` (user manually kept)
   - `saved-track/{subject}.json` (SBERT auto-saved)
2. Counts removed files from `removed-track/{subject}.json`
3. Calculates total count

**Returns:**
```json
{
  "final_count": 2447,      // final-track + saved-track
  "removed_count": 10545,
  "total_count": 12992      // finalized + removed
}
```

**When used:**
- Summary pages
- Overview displays
- General statistics

**Difference from `get_preparation_stats()`:**
- `get_preparation_stats()` → counts from original folder, shows what will be processed
- `get_statistics()` → counts from tracking files only, shows current state

---

## 3. Submit Group Logic - Checked/Unchecked Basis

### **How Files Are Checked/Unchecked:**

Files in a similarity group are checked/unchecked based on:
1. **User's manual decision** - User reviews the group and decides which files to keep
2. **Current file status** - System checks if file is already saved/removed/unknown
3. **User's checkbox selection** - User checks/unchecks files in the UI

### **Where Files Go on Submit:**

#### **If File is CHECKED (User wants to keep):**

| Current Status | Action | Goes To |
|---------------|--------|---------|
| `unknown` | Add to final-track | `final-track/{subject}.json` |
| `removed` | Remove from removed-track, Add to final-track | `final-track/{subject}.json` |
| `saved` | No change (already in final-track) | Stays in `final-track/{subject}.json` |

**Result:** Checked files → `final-track/{subject}.json`

---

#### **If File is UNCHECKED (User wants to remove):**

| Current Status | Action | Goes To |
|---------------|--------|---------|
| `saved` | Remove from final-track, Add to removed-track | `removed-track/{subject}.json` |
| `removed` | No change (already in removed-track) | Stays in `removed-track/{subject}.json` |
| `unknown` | Add to removed-track | `removed-track/{subject}.json` |

**Result:** Unchecked files → `removed-track/{subject}.json`

---

### **Example Submit Group Flow:**

**Group has 3 files:** `file1.json`, `file2.json`, `file3.json`

**User checks:** `file1.json`, `file2.json`  
**User unchecks:** `file3.json`

**Before Submit:**
- `file1.json`: status = "unknown"
- `file2.json`: status = "removed"
- `file3.json`: status = "saved"

**After Submit:**
- `file1.json`: ✅ Added to `final-track` (was unknown, now checked)
- `file2.json`: ✅ Removed from `removed-track`, Added to `final-track` (was removed, now checked)
- `file3.json`: ✅ Removed from `final-track`, Added to `removed-track` (was saved, now unchecked)

---

## 4. How Many MCQs Will Go to SBERT? (Example)

### **Example Scenario:**

**Subject:** `urdu`

**Initial State:**
- Total files in `classified_all_db-original/urdu/`: **14,769**
- Files in `removed-track/urdu.json`: **10,545**
- Files in `final-track/urdu.json`: **500** (user manually kept from previous session)
- Files in `saved-track/urdu.json`: **2,447** (from previous SBERT run)

---

### **Calculation:**

```
Total MCQs = 14,769

Saved MCQs = saved-track (SBERT auto-saved)
            = 2,447

Removed MCQs = removed-track
              = 10,545

Sending to SBERT = Total - Saved - Removed
                 = 14,769 - 2,447 - 10,545
                 = 1,777 MCQs
```

**Note:** `final-track` files are **NOT excluded** - they are **cleared when SBERT runs**

---

### **What Happens:**

1. **Before SBERT:**
   - System reads `removed-track/urdu.json` → Excludes 10,545 files
   - System reads `saved-track/urdu.json` → Excludes 2,447 files
   - System **clears** `final-track/urdu.json` → Deletes 500 files (user decisions reset)
   - **Total excluded:** 10,545 + 2,447 = 12,992 files
   - **Files to process:** 14,769 - 12,992 = **1,777 files**

2. **SBERT Processing:**
   - Processes 1,777 files (includes the 500 files that were in final-track)
   - Finds similar pairs (groups)
   - Identifies non-duplicates (files not in any group)

3. **After SBERT:**
   - Non-duplicates → Added to `saved-track/urdu.json`
   - Example: If 500 files are non-duplicates
   - `saved-track/urdu.json` now has: 2,447 + 500 = **2,947 files**
   - `final-track/urdu.json` is **empty** (cleared when SBERT ran)

---

### **Next Time User Runs SBERT:**

**New State:**
- Total files: **14,769**
- `removed-track/urdu.json`: **10,545**
- `final-track/urdu.json`: **0** (cleared when SBERT ran)
- `saved-track/urdu.json`: **2,947** (increased from 2,447)

**New Calculation:**
```
Sending to SBERT = Total - Saved - Removed
                 = 14,769 - 2,947 - 10,545
                 = 1,277 MCQs
```

---

### **After User Submits Some Groups (Before Next SBERT Run):**

**User submits groups and checks 500 files:**
- `final-track/urdu.json`: **500** (user manually kept)
- `saved-track/urdu.json`: **2,947** (SBERT auto-saved)
- `removed-track/urdu.json`: **10,545** (user removed)

**When SBERT Runs Again:**
- `final-track/urdu.json` will be **cleared** (500 files deleted)
- Calculation:
```
Sending to SBERT = Total - Saved - Removed
                 = 14,769 - 2,947 - 10,545
                 = 1,277 MCQs
```

**Note:** The 500 files in `final-track` are **included** in the 1,277 files sent to SBERT (they're not excluded, but final-track is cleared)

---

## 📊 Summary Table

| Action | Files Affected | Destination |
|--------|---------------|-------------|
| **User checks file** | Checked files | `final-track/{subject}.json` |
| **User unchecks file** | Unchecked files | `removed-track/{subject}.json` |
| **SBERT finds non-duplicates** | Non-duplicate files | `saved-track/{subject}.json` |
| **SBERT processing** | Excludes: removed-track + saved-track | Processes remaining files |
| **SBERT runs** | Clears `final-track/{subject}.json` | Deletes all user decisions |

---

## 🎯 Key Points

1. **File Status:** Only checks `final-track` (user decisions), not `saved-track` (SBERT auto-saves)

2. **Preparation Stats:** Shows what will be sent to SBERT (total - finalized - removed)

3. **Statistics:** Shows current state (finalized + removed counts)

4. **Submit Group:** 
   - Checked → `final-track`
   - Unchecked → `removed-track`
   - Based on user's checkbox selection

5. **SBERT Processing:**
   - Excludes all three folders
   - Only processes files not in any folder
   - Adds non-duplicates to `saved-track`

