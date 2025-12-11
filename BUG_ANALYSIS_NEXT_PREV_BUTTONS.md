# Bug Analysis: Next/Prev Page Buttons with Limits 200 & 300

## Problem
Next/Prev page buttons work with limit 100, but **DON'T WORK** with limits 200 or 300.

## Root Cause Analysis

### 1. How `hasNextPage()` Works
**Location:** `SimilarityGroupView.tsx:942-946`

```typescript
const hasNextPage = () => {
  if (similarityLevels.length === 0) return false;
  const minLevel = similarityLevels[similarityLevels.length - 1];
  return similarityRangeEnd > minLevel;  // ⚠️ KEY CHECK
};
```

**Logic:** Returns `true` only if current range end is **greater than** minimum level.

### 2. How `goToNextPage()` Works
**Location:** `SimilarityGroupView.tsx:953-978`

```typescript
const goToNextPage = () => {
  if (!hasNextPage()) return;  // ⚠️ Stops here if hasNextPage() is false
  
  // Calculate next range
  const nextStart = similarityRangeEnd;
  const nextRange = calculateRangeFromTargetGroups(nextStart, targetGroupsPerPage);
  
  // ⚠️ BUG: This can set end to minLevel
  if (nextRange.end < minLevel) {
    nextRange.end = minLevel;  // Sets to minLevel!
  }
  
  setSimilarityRangeStart(nextRange.start);
  setSimilarityRangeEnd(nextRange.end);
  // ...
};
```

### 3. The Bug in `calculateRangeFromTargetGroups`
**Location:** `SimilarityGroupView.tsx:340-391`

```typescript
const calculateRangeFromTargetGroups = useCallback((startPoint: number, targetGroups: number): { start: number; end: number } => {
  // ... expands range until targetGroups reached ...
  
  // ⚠️ BUG: If not enough groups, sets end to minLevel
  if (totalGroups < targetGroups * 0.5) {
    rangeEnd = similarityLevels[similarityLevels.length - 1];  // This is minLevel!
    // Recalculate total groups for the full range
    totalGroups = calculateGroupsInRange(rangeStart, rangeEnd).length;
  }
  
  return { start: rangeStart, end: rangeEnd };
}, [similarityLevels, groupsBySimilarity, calculateGroupsInRange]);
```

**Problem:** When limit is 200 or 300:
- If remaining groups < 50% of target (e.g., < 100 groups when target is 200)
- It sets `rangeEnd = minLevel` (e.g., 85.0%)
- Then `hasNextPage()` returns `false` because `similarityRangeEnd > minLevel` is false (they're equal)
- Next page button becomes disabled

### 4. Why Limit 100 Works
With limit 100:
- Smaller target = easier to reach
- Less likely to hit the "not enough groups" condition
- Range doesn't reach minLevel as quickly

With limits 200/300:
- Larger target = harder to reach
- More likely to hit "not enough groups" condition
- Range reaches minLevel faster, disabling next button

### 5. Additional Issue: Limit Mismatch

**Location:** `SimilarityGroupView.tsx:463-468`

```typescript
const getGroupsForCurrentPage = useCallback((): number[] => {
  const limit = isManualRange ? undefined : targetGroupsPerPage;
  return calculateGroupsInRange(similarityRangeStart, similarityRangeEnd, limit);
}, [similarityRangeStart, similarityRangeEnd, targetGroupsPerPage, isManualRange, calculateGroupsInRange]);
```

**Problem:** 
- `calculateRangeFromTargetGroups` calculates range based on `targetGroupsPerPage`
- But `getGroupsForCurrentPage` applies limit again in `calculateGroupsInRange`
- This creates a **double-limiting** issue:
  - Range might be calculated for 300 groups
  - But only 300 groups are shown (because of limit in `calculateGroupsInRange`)
  - If there are actually 350 groups in that range, 50 are hidden
  - Next page calculation doesn't account for these hidden groups

## Behavior Summary

### Limit 100:
✅ **Works** - Small target, rarely hits minLevel, next button stays enabled

### Limit 200:
❌ **Broken** - Medium target, sometimes hits minLevel, next button gets disabled prematurely

### Limit 300:
❌ **Broken** - Large target, frequently hits minLevel, next button gets disabled prematurely

## After Submit All - How Next Limit is Fetched

**Location:** `SimilarityGroupView.tsx:1354-1374`

```typescript
// After submit all succeeds:
if (hasNextPage()) {
  const minLevel = similarityLevels.length > 0 ? similarityLevels[similarityLevels.length - 1] : 85.0;
  const nextStart = similarityRangeEnd;
  const calculatedNext = calculateRangeFromTargetGroups(nextStart, targetGroupsPerPage);
  
  // ⚠️ SAME BUG: If calculatedNext.end equals minLevel, hasNext becomes false
  if (calculatedNext.end >= minLevel) {
    nextRange = calculatedNext;
    hasNext = true;
  }
}
```

**Behavior:**
1. Uses current `targetGroupsPerPage` value (100, 200, or 300)
2. Calculates next range starting from `similarityRangeEnd`
3. **Same bug applies** - if range reaches minLevel, `hasNext` becomes false
4. Modal shows "No more groups" even though there might be more

## The Fix Needed

1. **Fix `hasNextPage()` logic:**
   - Should check if there are actually more groups available, not just if end > minLevel
   - Should account for groups that might be hidden by the limit

2. **Fix `calculateRangeFromTargetGroups`:**
   - Should not set end to minLevel unless truly at the end
   - Should respect the limit when calculating ranges

3. **Fix limit application:**
   - Either apply limit in range calculation OR in display, not both
   - Currently doing both causes mismatch

4. **Better next page detection:**
   - Check if there are more groups beyond current range
   - Don't rely solely on similarity level comparison

