# Priority Fix Summary: Target Groups Per Page vs Similarity Range

## Problem Fixed
On page load/refresh, the similarity range was being prioritized over Target Groups Per Page setting. The range should be recalculated based on Target Groups Per Page unless the user manually adjusted it using sliders.

## Solution
Implemented priority logic that:
1. **On page load/refresh:** Prioritizes Target Groups Per Page - recalculates range based on target
2. **When slider changes:** Prioritizes the range - uses the slider value and marks as manual
3. **When Target Groups Per Page changes:** Recalculates range if it's auto-calculated (not manual)

## Changes Made

### 1. Save `isManualRange` to localStorage
**Location:** `SimilarityGroupView.tsx:742-754`

**Change:**
- Now saves `isManualRange` flag to localStorage
- Tracks whether range was manually adjusted (slider) or auto-calculated

```typescript
session.isManualRange = isManualRange; // Save whether range was manually adjusted
```

### 2. Load Priority Logic in `initializeGroups()`
**Location:** `SimilarityGroupView.tsx:235-250`

**Change:**
- Loads `targetGroupsPerPage` first (priority)
- Loads `isManualRange` to determine behavior
- Only loads saved range if it was manually adjusted
- If auto-calculated, range will be recalculated in useEffect

```typescript
// Load saved targetGroupsPerPage first (priority)
const session = storage.loadSession(subject);
if (session?.targetGroupsPerPage !== undefined) {
  setTargetGroupsPerPage(session.targetGroupsPerPage);
}

// Load isManualRange to determine if range should be recalculated
const savedIsManualRange = session?.isManualRange ?? false;
setIsManualRange(savedIsManualRange);

// Only load saved range if it was manually adjusted
if (savedIsManualRange && session?.similarityRangeStart !== undefined && session?.similarityRangeEnd !== undefined) {
  setSimilarityRangeStart(session.similarityRangeStart);
  setSimilarityRangeEnd(session.similarityRangeEnd);
}
```

### 3. Enhanced Range Initialization
**Location:** `SimilarityGroupView.tsx:601-628`

**Change:**
- Checks if range was manually adjusted
- If manual: Uses saved range
- If auto-calculated: Recalculates based on `targetGroupsPerPage` (priority)

```typescript
// If range was manually adjusted (slider was used), use saved range
if (savedIsManualRange && session?.similarityRangeStart !== undefined && session?.similarityRangeEnd !== undefined) {
  setSimilarityRangeStart(session.similarityRangeStart);
  setSimilarityRangeEnd(session.similarityRangeEnd);
  setIsManualRange(true);
  return;
}

// Otherwise, prioritize targetGroupsPerPage: recalculate range based on targetGroupsPerPage
const maxLevel = similarityLevels[0];
const calculatedRange = calculateRangeFromTargetGroups(maxLevel, targetGroupsPerPage);
setSimilarityRangeStart(calculatedRange.start);
setSimilarityRangeEnd(calculatedRange.end);
setIsManualRange(false);
```

### 4. Auto-Recalculate on Target Groups Per Page Change
**Location:** `SimilarityGroupView.tsx:630-644`

**Change:**
- New useEffect that watches `targetGroupsPerPage`
- If range is auto-calculated (not manual), recalculates range when target changes
- Ensures range stays in sync with targetGroupsPerPage

```typescript
// Recalculate range when targetGroupsPerPage changes (if range is auto-calculated, not manual)
useEffect(() => {
  if (similarityLevels.length > 0 && groupsBySimilarity && Object.keys(groupsBySimilarity).length > 0 && rangeInitialized.current) {
    // Only recalculate if range is NOT manually adjusted
    if (!isManualRange) {
      const maxLevel = similarityLevels[0];
      const calculatedRange = calculateRangeFromTargetGroups(maxLevel, targetGroupsPerPage);
      setSimilarityRangeStart(calculatedRange.start);
      setSimilarityRangeEnd(calculatedRange.end);
    }
  }
}, [targetGroupsPerPage, similarityLevels, groupsBySimilarity, calculateRangeFromTargetGroups, isManualRange]);
```

## Behavior After Fix

### ✅ On Page Load/Refresh
1. Loads `targetGroupsPerPage` from localStorage (e.g., 300)
2. Checks if range was manually adjusted
3. **If manual:** Uses saved range (respects slider changes)
4. **If auto-calculated:** Recalculates range based on `targetGroupsPerPage` (priority)

### ✅ When Slider Changes
1. User adjusts similarity range slider
2. `isManualRange` is set to `true`
3. Range is saved to localStorage
4. On refresh, saved range is used (not recalculated)

### ✅ When Target Groups Per Page Changes
1. User changes Target Groups Per Page (100/200/300)
2. If range is auto-calculated: Range is recalculated based on new target
3. If range is manual: Range stays the same (respects manual adjustment)
4. `isManualRange` is set to `false` (becomes auto-calculated)

## Priority Rules

1. **Page Load/Refresh:**
   - Priority 1: Target Groups Per Page (recalculate range)
   - Priority 2: Manual range (if slider was used)

2. **Slider Change:**
   - Priority: Range value (use slider value, mark as manual)

3. **Target Groups Per Page Change:**
   - Priority: Recalculate range (if auto-calculated)

## Files Modified
- `frontend/components/SimilarityGroupView.tsx`

## Testing Scenarios

### Scenario 1: Fresh Load
1. Set Target Groups Per Page to 300
2. Refresh page
3. ✅ Range should be recalculated based on 300 groups

### Scenario 2: Manual Range Adjustment
1. Adjust similarity range slider
2. Refresh page
3. ✅ Saved range should be used (not recalculated)

### Scenario 3: Change Target After Manual Adjustment
1. Adjust similarity range slider (manual)
2. Change Target Groups Per Page to 200
3. ✅ Range should stay the same (respects manual adjustment)

### Scenario 4: Change Target After Auto-Calculated
1. Don't adjust slider (auto-calculated)
2. Change Target Groups Per Page to 200
3. ✅ Range should be recalculated based on 200 groups

