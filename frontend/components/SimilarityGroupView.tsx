import React, { useState, useEffect, useCallback, useImperativeHandle, forwardRef, useRef } from 'react';
import { GroupDisplay } from './GroupDisplay';
import { api } from '../lib/api';
import { storage } from '../lib/storage';
import { FileStatusProvider, useFileStatus } from '../contexts/FileStatusContext';

interface Group {
  files: string[];
  max_similarity: number;
  similarities: Array<{
    file1: string;
    file2: string;
    score: number;
  }>;
}

interface SimilarityGroupViewProps {
  subject: string;
  groups: Group[];
  completedGroups: number[];
  onGroupsSubmitted: () => void;
  initialLevelIndex?: number;
  onLevelIndexChange?: (index: number) => void;
  onLevelsLoaded?: (totalLevels: number) => void;
}

export interface SimilarityGroupViewHandle {
  jumpToMin: () => void;
  jumpToMax: () => void;
}

// Auto-scroll speed in pixels per second (modify this value to change scroll speed)
const AUTO_SCROLL_SPEED = 300;

// Inner component that uses Context
const SimilarityGroupViewInner = forwardRef<SimilarityGroupViewHandle, SimilarityGroupViewProps>(({
  subject,
  groups,
  completedGroups,
  onGroupsSubmitted,
  initialLevelIndex = 0,
  onLevelIndexChange,
  onLevelsLoaded
}, ref) => {
  const fileStatusContext = useFileStatus();
  const [similarityLevels, setSimilarityLevels] = useState<number[]>([]);
  const [currentLevelIndex, setCurrentLevelIndex] = useState(initialLevelIndex);
  const [currentGroupInLevel, setCurrentGroupInLevel] = useState(0);
  const [groupsBySimilarity, setGroupsBySimilarity] = useState<{ [key: number]: number[] }>({});
  const [autoSelections, setAutoSelections] = useState<{ [groupIndex: number]: { [filename: string]: boolean } }>({});
  const [submitting, setSubmitting] = useState(false);
  const [loadingNextPage, setLoadingNextPage] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [successStats, setSuccessStats] = useState<{ 
    movedToRemoved: number; 
    addedToSaved: number;
    addedToRemoved: number;
    savedCount: number;
    removedCount: number;
  } | null>(null);
  const [nextPageInfo, setNextPageInfo] = useState<{
    nextRange: { start: number; end: number } | null;
    hasNextPage: boolean;
    loading: boolean;
  } | null>(null);
  const [conflictingFiles, setConflictingFiles] = useState<Set<string>>(new Set());
  const [fileAppearanceCounts, setFileAppearanceCounts] = useState<{ [filename: string]: { total: number; checked: number } }>({});
  const [fileAppearanceOrder, setFileAppearanceOrder] = useState<{ [filename: string]: { [groupIndex: number]: number } }>({});
  // New: total appearances (main + KEPT) per filename on current page
  const [fileAppearanceTotals, setFileAppearanceTotals] = useState<{ [filename: string]: number }>({});
  // New: appearance index for KEPT cards (removedFilename -> keptFilename -> index)
  const [keptAppearanceOrder, setKeptAppearanceOrder] = useState<{ [removedFilename: string]: { [keptFilename: string]: number } }>({});
  const [checkAllMode, setCheckAllMode] = useState<boolean>(false); // Toggle for check all mode
  
  // Track user-modified files at SimilarityGroupView level (for saved/removed file sync)
  // When user manually changes a file, we respect their choice even for saved/removed files
  const userModifiedFilesRef = useRef<Set<string>>(new Set());
  
  // Auto-scroll state
  const [autoScrollEnabled, setAutoScrollEnabled] = useState<boolean>(false); // Button ON/OFF state
  const [autoScrollActive, setAutoScrollActive] = useState<boolean>(false); // Currently scrolling
  const autoScrollAnimationRef = useRef<number | null>(null);
  const lastScrollTimeRef = useRef<number>(0);
  const autoScrollActiveRef = useRef<boolean>(false); // Add ref to track active state

  // Keep ref in sync with state
  useEffect(() => {
    autoScrollActiveRef.current = autoScrollActive;
  }, [autoScrollActive]);
  
  // Range-based pagination state
  // Load saved range from localStorage synchronously to avoid showing default values on refresh
  const loadSavedRange = () => {
    const session = storage.loadSession(subject);
    if (session?.similarityRangeStart !== undefined && session?.similarityRangeEnd !== undefined) {
      return {
        start: session.similarityRangeStart,
        end: session.similarityRangeEnd,
        isManual: session.isManualRange ?? false,
        targetGroups: session.targetGroupsPerPage ?? 100,
        hasSaved: true
      };
    }
    return {
      start: 100.0,
      end: 99.9,
      isManual: false,
      targetGroups: 100,
      hasSaved: false
    };
  };
  
  const savedRange = loadSavedRange();
  const [similarityRangeStart, setSimilarityRangeStart] = useState<number>(savedRange.start);
  const [similarityRangeEnd, setSimilarityRangeEnd] = useState<number>(savedRange.end);
  const [targetGroupsPerPage, setTargetGroupsPerPage] = useState<number>(savedRange.targetGroups);
  const [pageCompleted, setPageCompleted] = useState<boolean>(false);
  const [pageHistory, setPageHistory] = useState<Array<{ start: number; end: number }>>([]);
  const [isManualRange, setIsManualRange] = useState<boolean>(savedRange.isManual); // Track if range was manually adjusted
  const rangeInitialized = useRef<boolean>(false);
  const hasRestoredRangeRef = useRef<boolean>(savedRange.hasSaved); // Track if we restored a saved range (prevents recalculation)
  // Guard refs to prevent infinite loops
  const loadingStatusesRef = useRef<boolean>(false);
  const loadingMCQDataRef = useRef<boolean>(false);
  const lastLoadedRangeRef = useRef<{ start: number; end: number } | null>(null);
  const currentRangeStartRef = useRef<number>(100.0); // Track current range start for targetGroupsPerPage changes

  useEffect(() => {
    initializeGroups();
  }, [groups]);

  // Restore saved level index after similarity levels are set
  useEffect(() => {
    if (similarityLevels.length > 0 && initialLevelIndex > 0 && initialLevelIndex < similarityLevels.length) {
      setCurrentLevelIndex(initialLevelIndex);
    }
  }, [similarityLevels, initialLevelIndex]);

  // OPTIMIZED: Frontend auto-select with year priority (using Context)
  const autoSelectBestMCQ = useCallback((files: string[], metadata: { [filename: string]: { hasYear: boolean; fileNum: number } }, useCheckAllMode: boolean = false): { [filename: string]: boolean } => {
    const selections: { [filename: string]: boolean } = {};
    
    if (files.length === 0) return selections;
    
    // Check All Mode: Check everything except removed files
    if (useCheckAllMode) {
      for (const filename of files) {
        const fileStatus = fileStatusContext.getFileStatus(filename);
        const status = fileStatus?.status || 'unknown';
        // Check all files EXCEPT removed ones
        selections[filename] = status !== 'removed';
      }
      return selections;
    }
    
    // Normal Mode: Apply preference-based selection rules
    // Separate files by status
    const savedFiles: string[] = [];
    const removedFiles: string[] = [];
    const unknownFiles: Array<{filename: string, hasYear: boolean, fileNum: number}> = [];
    
    for (const filename of files) {
      const fileStatus = fileStatusContext.getFileStatus(filename);
      const status = fileStatus?.status || 'unknown';
      const cached = metadata[filename];
      
      if (status === 'saved') {
        // Rule 1: Already saved → must be selected
        savedFiles.push(filename);
        selections[filename] = true;
      } else if (status === 'removed') {
        // Rule 2: Already removed → must be unselected
        removedFiles.push(filename);
        selections[filename] = false;
      } else {
        // Rule 3: Unknown → will apply priority later
        let hasYear = false;
        let fileNum = 999999;
        
        if (cached) {
          hasYear = cached.hasYear;
          fileNum = cached.fileNum;
        } else {
          // Fallback: extract from filename
          fileNum = parseInt(filename.replace(/\D/g, '')) || 999999;
        }
        
        unknownFiles.push({ filename, hasYear, fileNum });
        // Initialize as unchecked, will select highest priority one
        selections[filename] = false;
      }
    }
    
    // Rule 3: For unknown files, select only the highest priority one
    if (unknownFiles.length > 0) {
      // Sort unknown files by priority: hasYear first, then smallest fileNum
      unknownFiles.sort((a, b) => {
        // Priority 1: hasYear
        if (a.hasYear !== b.hasYear) {
          return a.hasYear ? -1 : 1; // hasYear = true comes first
        }
        // Priority 2: smallest fileNum
        return a.fileNum - b.fileNum;
      });
      
      // Select only the highest priority unknown file
      const selectedUnknown = unknownFiles[0].filename;
      selections[selectedUnknown] = true;
    }
    
    return selections;
  }, [subject, fileStatusContext]);

  // Recalculate selections when checkAllMode changes
  // IMPORTANT: Preserve existing autoSelections (user modifications) - only apply auto-selections for missing values
  // FIX: Always override for saved/removed files (status-based rules), only preserve for unknown files
  useEffect(() => {
    if (!initializing && groups.length > 0) {
      const session = storage.loadSession(subject);
      const metadata = session?.mcqMetadata || {};
      
      setAutoSelections(prev => {
        const updated: { [groupIndex: number]: { [filename: string]: boolean } } = { ...prev };
        
        for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
          const groupFiles = groups[groupIndex].files;
          
          // Preserve existing selections (user modifications), but always override for saved/removed files
          const existingSelections = updated[groupIndex] || {};
          const merged: { [filename: string]: boolean } = { ...existingSelections };
          
          // First, check which files are user-modified and skip auto-selection for them
          const userModifiedInGroup = groupFiles.filter(f => userModifiedFilesRef.current.has(f));
          
          // Only run auto-selection for files that are NOT user-modified
          const filesForAutoSelect = groupFiles.filter(f => !userModifiedFilesRef.current.has(f));
          
          if (filesForAutoSelect.length > 0) {
            const groupSelections = autoSelectBestMCQ(filesForAutoSelect, metadata, checkAllMode);
            
            // Apply auto-selections only for non-user-modified files
            for (const filename of filesForAutoSelect) {
              const fileStatus = fileStatusContext.getFileStatus(filename);
              const status = fileStatus?.status || 'unknown';
              const newSelection = groupSelections[filename] ?? false;
              
              // Always override for saved/removed files (status-based rules must be enforced)
              // These files are not user-modified, so apply rules
              if (status === 'saved' || status === 'removed') {
                merged[filename] = newSelection;
              } else if (!(filename in merged)) {
                // Only preserve for unknown files if not already set
                merged[filename] = newSelection;
              }
            }
          }
          
          // For user-modified files, preserve their existing value (don't run auto-selection on them)
          // Keep existing value - don't override
          
          updated[groupIndex] = merged;
        }
        
        return updated;
      });
    }
  }, [checkAllMode, groups, subject, autoSelectBestMCQ, initializing, fileStatusContext]);

  const initializeGroups = async () => {
    setInitializing(true);
    
    // Clear user modifications when groups are reinitialized (new subject or groups changed)
    // This ensures fresh start for new groups, but preserves modifications within same session
    userModifiedFilesRef.current.clear();
    
    // Group by similarity levels (rounded to 0.1%)
    const grouped: { [key: number]: number[] } = {};
    
    groups.forEach((group, index) => {
      // Round to nearest 0.1% (e.g., 99.87% -> 99.9%)
      const roundedSimilarity = Math.round(group.max_similarity * 1000) / 10;
      
      if (!grouped[roundedSimilarity]) {
        grouped[roundedSimilarity] = [];
      }
      grouped[roundedSimilarity].push(index);
    });

    setGroupsBySimilarity(grouped);

    // Get sorted similarity levels (highest first)
    const levels = Object.keys(grouped).map(Number).sort((a, b) => b - a);
    setSimilarityLevels(levels);
    
    // Notify parent about levels loaded
    if (onLevelsLoaded) {
      onLevelsLoaded(levels.length);
    }

    // File statuses are now loaded via Context (no need to set local state)
    
    // Load saved targetGroupsPerPage first (priority)
    const session = storage.loadSession(subject);
    if (session?.targetGroupsPerPage !== undefined) {
      setTargetGroupsPerPage(session.targetGroupsPerPage);
    } else if (session?.maxGroupsPerPage !== undefined) {
      // Backward compatibility: migrate from maxGroupsPerPage
      setTargetGroupsPerPage(session.maxGroupsPerPage);
    }
    
    // Load isManualRange flag (used to determine if range should be recalculated when targetGroupsPerPage changes)
    // Note: Range and isManualRange are already loaded synchronously in initial state, so we just mark that we have a saved range
    if (session?.similarityRangeStart !== undefined && session?.similarityRangeEnd !== undefined) {
      hasRestoredRangeRef.current = true; // Mark that we have a saved range (already loaded in initial state)
    }
    
    // OPTIMIZED: Load metadata for ALL groups before auto-selection
    // Collect all unique filenames from all groups
    const allFilenames = new Set<string>();
    groups.forEach(group => {
      group.files.forEach(f => allFilenames.add(f));
    });
    
    const filenames = Array.from(allFilenames);
    
    // Check if metadata exists in localStorage
    const cachedMetadata = session?.mcqMetadata || {};
    let finalMetadata = { ...cachedMetadata }; // Start with cached metadata
    
    // Check which files need metadata loading
    const missingFiles = filenames.filter(f => !cachedMetadata[f]);
    
    // Load metadata if missing (batch API call for all files)
    // Also reload ALL metadata to ensure it's up-to-date (files might have been updated)
    if (filenames.length > 0) {
      try {
        // Load metadata for ALL files to ensure freshness (not just missing ones)
        const response = await api.batchFileStatuses(subject, filenames);
        const mcqMetadata: { [filename: string]: { hasYear: boolean; fileNum: number } } = {};
        
        for (const [filename, data] of Object.entries(response.statuses)) {
          const fileData = data as any;
          const fileNum = parseInt(filename.replace(/\D/g, '')) || 999999;
          mcqMetadata[filename] = {
            hasYear: fileData.has_year || false,
            fileNum: fileNum
          };
        }
        
        // Use freshly loaded metadata (overwrite cached to ensure accuracy)
        finalMetadata = mcqMetadata;
        
        // Save metadata to localStorage
        storage.updateMCQMetadata(subject, mcqMetadata);
      } catch (error) {
        console.error('Failed to load MCQ metadata:', error);
        // Fallback to cached metadata if API fails
        finalMetadata = cachedMetadata;
      }
    }
    
    // NEW RULES: Auto-select AFTER metadata is fully loaded
    // Rule 1: Saved files → checked | Rule 2: Removed files → unchecked
    // Rule 3: Unknown files → select highest priority (hasYear > smallest fileNum)
    // Use the finalMetadata directly instead of reading from localStorage
    // IMPORTANT: Preserve existing autoSelections (user modifications) - only apply auto-selections for missing values
    // FIX: Always override for saved/removed files (status-based rules), only preserve for unknown files
    setAutoSelections(prev => {
      const updated: { [groupIndex: number]: { [filename: string]: boolean } } = { ...prev };
      
      for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
        const groupFiles = groups[groupIndex].files;
        
        // Preserve existing selections (user modifications), but always override for saved/removed files
        const existingSelections = updated[groupIndex] || {};
        const merged: { [filename: string]: boolean } = { ...existingSelections };
        
        // First, check which files are user-modified and skip auto-selection for them
        const userModifiedInGroup = groupFiles.filter(f => userModifiedFilesRef.current.has(f));
        
        // Only run auto-selection for files that are NOT user-modified
        const filesForAutoSelect = groupFiles.filter(f => !userModifiedFilesRef.current.has(f));
        
        if (filesForAutoSelect.length > 0) {
          // Pass metadata and checkAllMode to autoSelectBestMCQ (uses Context internally)
          const groupSelections = autoSelectBestMCQ(filesForAutoSelect, finalMetadata, checkAllMode);
          
            // Apply auto-selections only for non-user-modified files
            for (const filename of filesForAutoSelect) {
              const fileStatus = fileStatusContext.getFileStatus(filename);
              const status = fileStatus?.status || 'unknown';
              const newSelection = groupSelections[filename] ?? false;
              
              // Always override for saved/removed files (status-based rules must be enforced)
              // These files are not user-modified, so apply rules
              if (status === 'saved' || status === 'removed') {
                merged[filename] = newSelection;
              } else if (!(filename in merged)) {
                // Only preserve for unknown files if not already set
                merged[filename] = newSelection;
              }
            }
          }
          
          // For user-modified files, preserve their existing value (don't run auto-selection on them)
          // Keep existing value - don't override
          
          updated[groupIndex] = merged;
        }
        
        return updated;
    });
    
    setInitializing(false);
  };

  // Calculate groups within similarity range (inclusive boundaries) - limited by maxGroupsPerPage
  const calculateGroupsInRange = useCallback((start: number, end: number, limit?: number): number[] => {
    const groupIndices: number[] = [];
    
    // Use for loop instead of forEach so we can break when limit is reached
    for (let index = 0; index < groups.length; index++) {
      const group = groups[index];
      const roundedSimilarity = Math.round(group.max_similarity * 1000) / 10;
      // Inclusive boundaries: start >= similarity >= end
      if (roundedSimilarity <= start && roundedSimilarity >= end) {
        groupIndices.push(index);
        // Stop if we've reached the limit
        if (limit && groupIndices.length >= limit) {
          break; // Actually break the loop, not just return from callback
        }
      }
    }
    
    return groupIndices;
  }, [groups]);

  // Calculate range starting from a specific start point, expanding until approximately targetGroupsPerPage groups
  const calculateRangeFromTargetGroups = useCallback((startPoint: number, targetGroups: number): { start: number; end: number } => {
    if (similarityLevels.length === 0) {
      return { start: 100.0, end: 99.9 };
    }
    
    // Find the index of the level that matches or is closest to startPoint (from above)
    let startIndex = -1;
    for (let i = 0; i < similarityLevels.length; i++) {
      if (similarityLevels[i] <= startPoint) {
        startIndex = i;
        break;
      }
    }
    
    // If no level found (startPoint is below all levels), use the last level
    if (startIndex === -1) {
      const lastLevel = similarityLevels[similarityLevels.length - 1];
      return { start: lastLevel, end: lastLevel };
    }
    
    const rangeStart = similarityLevels[startIndex];
    let rangeEnd = rangeStart;
    let totalGroups = 0;
    
    // Expand range by adding consecutive levels until we reach approximately targetGroups groups
    // This is not strict - we'll stop when we're close to the target
    for (let i = startIndex; i < similarityLevels.length; i++) {
      const level = similarityLevels[i];
      const groupsInLevel = groupsBySimilarity[level] || [];
      totalGroups += groupsInLevel.length;
      rangeEnd = level;
      
      // Stop when we've reached approximately the target (within 20% or at least targetGroups)
      if (totalGroups >= targetGroups * 0.8 && totalGroups >= targetGroups) {
        break;
      }
      
      // Also stop if we've significantly exceeded the target (more than 50% over)
      if (totalGroups > targetGroups * 1.5) {
        break;
      }
    }
    
    // If we haven't reached a reasonable number of groups, check if we're at the end
    // Only set to minLevel if we're truly at the last page (no more groups available)
    if (totalGroups < targetGroups * 0.5) {
      const minLevel = similarityLevels[similarityLevels.length - 1];
      const allRemainingGroups = calculateGroupsInRange(rangeStart, minLevel).length;
      
      // If there are groups available but less than target, include them all
      // This ensures we show remaining groups even if less than target
      if (allRemainingGroups > 0) {
        rangeEnd = minLevel;
        totalGroups = allRemainingGroups;
      } else {
        // Truly no more groups, return current range
        // Don't change rangeEnd if we're already showing all available groups
      }
    }
    
    return { start: rangeStart, end: rangeEnd };
  }, [similarityLevels, groupsBySimilarity, calculateGroupsInRange]);

  // Calculate next range automatically (expands until >= 100 groups)
  const calculateNextRange = useCallback((currentEnd: number, currentStart?: number): { start: number; end: number } => {
    if (similarityLevels.length === 0) {
      return { start: 100.0, end: 99.9 };
    }
    
    // Determine if we've shown all groups at currentEnd level
    // If currentStart equals currentEnd, we've shown all groups at that level
    // Otherwise, we might have more groups at currentEnd level
    const allGroupsShownAtEnd = currentStart !== undefined && Math.abs(currentStart - currentEnd) < 0.01;
    
    let nextStartIndex = -1;
    if (allGroupsShownAtEnd) {
      // We've shown all groups at currentEnd level, so start from next level below
      for (let i = 0; i < similarityLevels.length; i++) {
        if (similarityLevels[i] < currentEnd) {
          nextStartIndex = i;
          break;
        }
      }
    } else {
      // We might have more groups at currentEnd level, so start from currentEnd to ensure continuity
      for (let i = 0; i < similarityLevels.length; i++) {
        if (similarityLevels[i] <= currentEnd) {
          nextStartIndex = i;
          break;
        }
      }
    }
    
    // If no level found, we're at the end
    if (nextStartIndex === -1) {
      return { start: similarityLevels[similarityLevels.length - 1], end: similarityLevels[similarityLevels.length - 1] };
    }
    
    const nextStart = similarityLevels[nextStartIndex];
    let nextEnd = nextStart;
    let totalGroups = 0;
    
      // Expand range by adding consecutive levels until approximately targetGroupsPerPage groups
      for (let i = nextStartIndex; i < similarityLevels.length; i++) {
        const level = similarityLevels[i];
        const groupsInLevel = groupsBySimilarity[level] || [];
        totalGroups += groupsInLevel.length;
        nextEnd = level;
        
        // Stop when we've reached approximately the target (within 20% or at least targetGroups)
        if (totalGroups >= targetGroupsPerPage * 0.8 && totalGroups >= targetGroupsPerPage) {
          break;
        }
        
        // Also stop if we've significantly exceeded the target (more than 50% over)
        if (totalGroups > targetGroupsPerPage * 1.5) {
          break;
        }
      }
    
    // If we haven't reached a reasonable number of groups, include all remaining levels (last page)
    if (totalGroups < targetGroupsPerPage * 0.5) {
      nextEnd = similarityLevels[similarityLevels.length - 1];
      // Recalculate total groups for the full range
      totalGroups = calculateGroupsInRange(nextStart, nextEnd).length;
    }
    
    return { start: nextStart, end: nextEnd };
  }, [similarityLevels, groupsBySimilarity, targetGroupsPerPage, calculateGroupsInRange]);

  // Get groups for current page (within current range)
  // Always show ALL groups in the selected range, no matter the count
  const getGroupsForCurrentPage = useCallback((): number[] => {
    // Always show all groups in range (no limit)
    return calculateGroupsInRange(similarityRangeStart, similarityRangeEnd);
  }, [similarityRangeStart, similarityRangeEnd, calculateGroupsInRange]);

  // Reorder groups to keep file appearances together
  // When a file appears in multiple groups, those groups should be consecutive
  const reorderGroupsByFileAppearances = useCallback((groupIndices: number[]): number[] => {
    if (groupIndices.length === 0) return groupIndices;
    
    // Build a map: filename -> list of group indices containing it (in original order)
    const fileToGroups: { [filename: string]: number[] } = {};
    
    for (const groupIndex of groupIndices) {
      const group = groups[groupIndex];
      if (!group) continue;
      
      for (const filename of group.files) {
        if (!fileToGroups[filename]) {
          fileToGroups[filename] = [];
        }
        if (!fileToGroups[filename].includes(groupIndex)) {
          fileToGroups[filename].push(groupIndex);
        }
      }
    }
    
    // Find files that appear in multiple groups
    const multiAppearanceFiles = Object.keys(fileToGroups).filter(
      filename => fileToGroups[filename].length > 1
    );
    
    // If no files appear multiple times, return original order
    if (multiAppearanceFiles.length === 0) {
      return groupIndices;
    }
    
    // Create a set to track which groups have been placed
    const placedGroups = new Set<number>();
    const reordered: number[] = [];
    
    // Helper function to add a group and mark it as placed
    const addGroup = (groupIndex: number) => {
      if (!placedGroups.has(groupIndex)) {
        reordered.push(groupIndex);
        placedGroups.add(groupIndex);
      }
    };
    
    // Process groups in original order
    for (const groupIndex of groupIndices) {
      // If already placed, skip
      if (placedGroups.has(groupIndex)) {
        continue;
      }
      
      const group = groups[groupIndex];
      if (!group) {
        addGroup(groupIndex);
        continue;
      }
      
      // Check if this group contains any file that appears multiple times
      const multiAppearanceFilesInGroup = group.files.filter(
        filename => fileToGroups[filename] && fileToGroups[filename].length > 1
      );
      
      if (multiAppearanceFilesInGroup.length > 0) {
        // Add this group first (it's the first appearance of these files)
        addGroup(groupIndex);
        
        // Collect all related groups (groups containing any of these multi-appearance files)
        const relatedGroupsSet = new Set<number>();
        
        for (const filename of multiAppearanceFilesInGroup) {
          // Get all other groups containing this file (excluding current group)
          for (const relatedGroupIndex of fileToGroups[filename]) {
            if (relatedGroupIndex !== groupIndex && !placedGroups.has(relatedGroupIndex)) {
              relatedGroupsSet.add(relatedGroupIndex);
            }
          }
        }
        
        // Convert to array and sort by original position to maintain similarity ordering
        const relatedGroups = Array.from(relatedGroupsSet).sort((a, b) => {
          const posA = groupIndices.indexOf(a);
          const posB = groupIndices.indexOf(b);
          return posA - posB;
        });
        
        // Add related groups immediately after current group
        // This ensures all appearances of files in this group come together
        for (const relatedGroupIndex of relatedGroups) {
          addGroup(relatedGroupIndex);
        }
      } else {
        // No multi-appearance files, add normally
        addGroup(groupIndex);
      }
    }
    
    // Add any remaining groups that weren't placed (safety check)
    for (const groupIndex of groupIndices) {
      if (!placedGroups.has(groupIndex)) {
        reordered.push(groupIndex);
      }
    }
    
    return reordered;
  }, [groups]);

  // Get reordered groups for current page (with file appearances grouped together)
  const getReorderedGroupsForPage = useCallback((): number[] => {
    const groupsInPage = getGroupsForCurrentPage();
    return reorderGroupsByFileAppearances(groupsInPage);
  }, [getGroupsForCurrentPage, reorderGroupsByFileAppearances]);

  // Initialize first page range on mount
  // ALWAYS restore saved range if available, regardless of manual/auto flag
  // This preserves user's position even after page refresh
  // NOTE: Range is already loaded synchronously in initial state, this just verifies it's still valid
  // NOTE: targetGroupsPerPage is NOT in deps - we only want to restore once, not recalculate when it changes
  useEffect(() => {
    if (similarityLevels.length > 0 && groupsBySimilarity && Object.keys(groupsBySimilarity).length > 0 && !rangeInitialized.current) {
      const session = storage.loadSession(subject);
      
      // If we have a saved range (already loaded in initial state), verify it's still valid and mark as initialized
      if (hasRestoredRangeRef.current && session?.similarityRangeStart !== undefined && session?.similarityRangeEnd !== undefined) {
        // Verify the current state matches the saved range (it should, since we loaded it synchronously)
        // If for some reason it doesn't match, restore it
        const currentStart = similarityRangeStart;
        const currentEnd = similarityRangeEnd;
        if (Math.abs(currentStart - session.similarityRangeStart) > 0.001 || 
            Math.abs(currentEnd - session.similarityRangeEnd) > 0.001) {
          setSimilarityRangeStart(session.similarityRangeStart);
          setSimilarityRangeEnd(session.similarityRangeEnd);
          setIsManualRange(session.isManualRange ?? false);
        }
        rangeInitialized.current = true;
        return;
      }
      
      // No saved range - mark that we didn't restore (allows recalculation if needed)
      hasRestoredRangeRef.current = false;
      
      // Only if no saved range exists, calculate new range based on targetGroupsPerPage
      // Use current targetGroupsPerPage value (already loaded from session in initializeGroups)
      const maxLevel = similarityLevels[0]; // Highest similarity
      const calculatedRange = calculateRangeFromTargetGroups(maxLevel, targetGroupsPerPage);
      
      setSimilarityRangeStart(calculatedRange.start);
      setSimilarityRangeEnd(calculatedRange.end);
      setIsManualRange(false); // Mark as auto-calculated (not manual)
      rangeInitialized.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [similarityLevels, groupsBySimilarity, calculateRangeFromTargetGroups, subject]); // Range values checked inside, not in deps to avoid loops

  // Recalculate range when targetGroupsPerPage changes (if range is auto-calculated, not manual)
  // This handles cases where targetGroupsPerPage is changed after initial load
  // IMPORTANT: Only recalculate if user explicitly changes targetGroupsPerPage, NOT on initial load
  // CRITICAL: NEVER recalculate if a saved range exists (preserve user's position on refresh)
  const prevTargetGroupsPerPageRef = useRef<number | undefined>(undefined);
  
  useEffect(() => {
    if (similarityLevels.length > 0 && groupsBySimilarity && Object.keys(groupsBySimilarity).length > 0 && rangeInitialized.current) {
      // ALWAYS check if saved range exists FIRST - if it does, NEVER recalculate (preserve user position)
      // This check must happen BEFORE any other logic to prevent overwriting restored range
      const session = storage.loadSession(subject);
      const savedStart = session?.similarityRangeStart;
      const savedEnd = session?.similarityRangeEnd;
      const hasSavedRange = savedStart !== undefined && savedEnd !== undefined;
      
      // If we have a saved range, NEVER recalculate - preserve it at all costs
      if (hasSavedRange) {
        hasRestoredRangeRef.current = true;
        
        // Double-check: if current range doesn't match saved range, restore it
        // This handles cases where recalculation might have already happened
        if (Math.abs(similarityRangeStart - savedStart) > 0.001 || Math.abs(similarityRangeEnd - savedEnd) > 0.001) {
          console.log('Restoring saved range from recalculation useEffect:', savedStart, savedEnd);
          setSimilarityRangeStart(savedStart);
          setSimilarityRangeEnd(savedEnd);
        }
        
        // Update ref to track previous value (but don't recalculate)
        prevTargetGroupsPerPageRef.current = targetGroupsPerPage;
        return; // Exit early - never recalculate if saved range exists
      }
      
      // Only recalculate if:
      // 1. No saved range exists
      // 2. Range is NOT manually adjusted
      // 3. targetGroupsPerPage actually changed (not just initial load)
      const targetChanged = prevTargetGroupsPerPageRef.current !== undefined && 
                           prevTargetGroupsPerPageRef.current !== targetGroupsPerPage;
      
      if (!isManualRange && targetChanged) {
        const maxLevel = similarityLevels[0]; // Highest similarity
        const calculatedRange = calculateRangeFromTargetGroups(maxLevel, targetGroupsPerPage);
        
        setSimilarityRangeStart(calculatedRange.start);
        setSimilarityRangeEnd(calculatedRange.end);
        // Keep isManualRange as false (auto-calculated)
      }
      
      // Update ref to track previous value
      prevTargetGroupsPerPageRef.current = targetGroupsPerPage;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetGroupsPerPage, similarityLevels, groupsBySimilarity, calculateRangeFromTargetGroups, isManualRange, subject]);

  // Update ref whenever similarityRangeStart changes
  useEffect(() => {
    currentRangeStartRef.current = similarityRangeStart;
  }, [similarityRangeStart]);


  const currentLevel = similarityLevels[currentLevelIndex];
  const groupsInCurrentPage = getGroupsForCurrentPage();
  const totalGroupsInPage = groupsInCurrentPage.length;

      // Use Context to load file statuses for current range
  // Always load ALL groups in range (no limit)
  const loadFileStatusesForRange = useCallback(async (start: number, end: number) => {
    // Guard: Prevent duplicate calls for same range
    if (lastLoadedRangeRef.current?.start === start && lastLoadedRangeRef.current?.end === end) {
      return;
    }
    
    // Guard: Prevent concurrent calls
    if (loadingStatusesRef.current) {
      return;
    }
    
    loadingStatusesRef.current = true;
    
    try {
      // Always load all groups in range (no limit)
      const groupsInRange = calculateGroupsInRange(start, end);
      const allFilenames = new Set<string>();
      
      // Collect all unique filenames in this range
      for (const groupIndex of groupsInRange) {
        groups[groupIndex].files.forEach(f => allFilenames.add(f));
      }
      
      const filenames = Array.from(allFilenames);
      if (filenames.length === 0) {
        loadingStatusesRef.current = false;
        return;
      }
      
      // Use Context method - don't include fileStatusContext in deps to avoid infinite loop
      await fileStatusContext.loadFileStatuses(subject, filenames);
      
      // Update last loaded range
      lastLoadedRangeRef.current = { start, end };
    } finally {
      loadingStatusesRef.current = false;
    }
  }, [groups, subject, calculateGroupsInRange]); // Removed fileStatusContext from deps

  // Use Context to load MCQ data for current range
  // Always load ALL groups in range (no limit)
  const loadMCQDataForRange = useCallback(async (start: number, end: number) => {
    // Guard: Prevent concurrent calls
    if (loadingMCQDataRef.current) {
      return;
    }
    
    loadingMCQDataRef.current = true;
    
    try {
      // Always load all groups in range (no limit)
      const groupsInRange = calculateGroupsInRange(start, end);
      const allFilenames = new Set<string>();
      
      // Collect all unique filenames in this range
      for (const groupIndex of groupsInRange) {
        if (groups[groupIndex]?.files) {
          groups[groupIndex].files.forEach(f => allFilenames.add(f));
        }
      }
      
      const filenames = Array.from(allFilenames);
      if (filenames.length === 0) {
        console.warn(`No filenames to load MCQ data for range ${start}% - ${end}%`);
        loadingMCQDataRef.current = false;
        return;
      }
      
      // Use Context method - don't include fileStatusContext in deps to avoid infinite loop
      await fileStatusContext.loadMCQData(subject, filenames);
    } finally {
      loadingMCQDataRef.current = false;
    }
  }, [groups, subject, calculateGroupsInRange]); // Removed fileStatusContext from deps

  // Load statuses when range changes (always fetch from backend - single source of truth)
  useEffect(() => {
    if (similarityLevels.length > 0 && groupsBySimilarity && Object.keys(groupsBySimilarity).length > 0) {
      const groupsInRange = getGroupsForCurrentPage();
      if (groupsInRange.length > 0) {
        // Always load from backend (single source of truth)
        loadFileStatusesForRange(similarityRangeStart, similarityRangeEnd);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [similarityRangeStart, similarityRangeEnd, similarityLevels.length]); // Simplified deps to prevent infinite loop

  // STRATEGY 2: MCQ data is now loaded together with statuses in loadFileStatuses
  // No need for separate loading phase - data comes in combined API call
  // Keep this effect for backward compatibility but it will be a no-op if data already loaded
  useEffect(() => {
    if (similarityLevels.length > 0 && groupsBySimilarity && Object.keys(groupsBySimilarity).length > 0) {
      const groupsInRange = getGroupsForCurrentPage();
      
      if (groupsInRange.length === 0) return;
      
      // STRATEGY 2: MCQ data is already loaded with statuses, but check if we need to load it separately
      // This is a fallback for cases where statuses were loaded but MCQ data wasn't
      // The combined endpoint should handle both, so this may not be needed
      const timer = setTimeout(() => {
        // Only load if statuses are done and MCQ data might be missing
        if (!fileStatusContext.loadingStatuses) {
          loadMCQDataForRange(similarityRangeStart, similarityRangeEnd);
        }
      }, 100);
      
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [similarityRangeStart, similarityRangeEnd, similarityLevels.length]); // Simplified deps to prevent infinite loop

  // Reset page completed status when range changes
  useEffect(() => {
    setPageCompleted(false);
    // Reset last loaded range when range changes
    lastLoadedRangeRef.current = null;
  }, [similarityRangeStart, similarityRangeEnd]);

  // Save similarity range, targetGroupsPerPage, and isManualRange to localStorage whenever they change
  // ALWAYS save to preserve state across page refreshes
  useEffect(() => {
    if (similarityRangeStart !== undefined && similarityRangeEnd !== undefined) {
      let session = storage.loadSession(subject);
      
      // Create session if it doesn't exist (ensures range is always saved)
      if (!session) {
        session = {
          subject,
          currentGroupIndex: 0,
          completedGroups: [],
          checkedFiles: {},
          lastUpdated: Date.now()
        };
      }
      
      session.similarityRangeStart = similarityRangeStart;
      session.similarityRangeEnd = similarityRangeEnd;
      session.targetGroupsPerPage = targetGroupsPerPage;
      session.isManualRange = isManualRange; // Save whether range was manually adjusted
      storage.saveSession(session);
    }
  }, [similarityRangeStart, similarityRangeEnd, targetGroupsPerPage, isManualRange, subject]);

  // Detect conflicts and appearance counts for current page
  // Use reordered groups so appearance order matches display order
  useEffect(() => {
    const groupsInPage = getReorderedGroupsForPage();
    if (groupsInPage.length === 0) return;
    
    const fileStates: { [filename: string]: Set<boolean> } = {};
    const appearanceCounts: { [filename: string]: { total: number; checked: number } } = {};
    const appearanceOrder: { [filename: string]: { [groupIndex: number]: number } } = {};
    
    // First pass: Count total appearances (including KEPT cards on removed files)
    const totalAppearances: { [filename: string]: number } = {};
    for (const groupIndex of groupsInPage) {
      const group = groups[groupIndex];
      for (const filename of group.files) {
        totalAppearances[filename] = (totalAppearances[filename] || 0) + 1;
        // If this file has a kept counterpart (purple KEPT card), count that appearance too
        const fileStatus = fileStatusContext.getFileStatus(filename);
        const removalInfo = fileStatus?.removalInfo;
        const keptFiles = removalInfo?.kept_files || [];
        if (keptFiles.length > 0 && fileStatus?.keptFileData) {
          const keptFilename = keptFiles[0];
          totalAppearances[keptFilename] = (totalAppearances[keptFilename] || 0) + 1;
        }
      }
    }
    
    // Track cumulative counts for appearance index (main + KEPT)
    const fileCumulativeCount: { [filename: string]: number } = {};
    // Per-removed-file appearance order for its KEPT counterpart
    const keptOrderLocal: { [removedFilename: string]: { [keptFilename: string]: number } } = {};
    const session = storage.loadSession(subject);
    const localStorageChecked = session?.checkedFiles || {};
    
    // Second pass: Check all groups in current page
    for (const groupIndex of groupsInPage) {
      const group = groups[groupIndex];
      if (!group) continue;
      
      const selections = autoSelections[groupIndex] || {};
      
      for (const filename of group.files) {
        let isChecked: boolean;
        if (selections && filename in selections) {
          isChecked = selections[filename];
        } else {
          // Use Context to get checked state
          isChecked = fileStatusContext.getFileChecked(filename);
        }
        
        // Track states for conflict detection
        if (!fileStates[filename]) {
          fileStates[filename] = new Set();
        }
        fileStates[filename].add(isChecked);
        
        // Track appearance counts
        if (!appearanceCounts[filename]) {
          appearanceCounts[filename] = { total: 0, checked: 0 };
        }
        appearanceCounts[filename].total++;
        if (isChecked) {
          appearanceCounts[filename].checked++;
        }
        
        // Track cumulative order for MAIN cards:
        // New rule: count every appearance on the page, regardless of checked state.
        if (!(filename in fileCumulativeCount)) {
          fileCumulativeCount[filename] = 0;
        }
        fileCumulativeCount[filename] = fileCumulativeCount[filename] + 1;
        const currentCount = fileCumulativeCount[filename];
        if (!appearanceOrder[filename]) {
          appearanceOrder[filename] = {};
        }
        appearanceOrder[filename][groupIndex] = currentCount;

        // Track cumulative order for KEPT cards (purple cards) if present
        const fileStatus = fileStatusContext.getFileStatus(filename);
        const removalInfo = fileStatus?.removalInfo;
        const keptFiles = removalInfo?.kept_files || [];
        if (keptFiles.length > 0 && fileStatus?.keptFileData) {
          // Count KEPT card appearance
          const keptFilename = keptFiles[0];
          if (!(keptFilename in fileCumulativeCount)) {
            fileCumulativeCount[keptFilename] = 0;
          }
          fileCumulativeCount[keptFilename] = fileCumulativeCount[keptFilename] + 1;
          const keptCount = fileCumulativeCount[keptFilename];

          if (!keptOrderLocal[filename]) {
            keptOrderLocal[filename] = {};
          }
          keptOrderLocal[filename][keptFilename] = keptCount;
        }
      }
    }
    
    // Find files with conflicting states
    const conflicts = new Set<string>();
    for (const [filename, states] of Object.entries(fileStates)) {
      if (states.has(true) && states.has(false)) {
        conflicts.add(filename);
      }
    }
    
    setConflictingFiles(conflicts);
    setFileAppearanceCounts(appearanceCounts);
    setFileAppearanceOrder(appearanceOrder);
    setFileAppearanceTotals(totalAppearances);
    setKeptAppearanceOrder(keptOrderLocal);
  }, [similarityRangeStart, similarityRangeEnd, groups, autoSelections, subject, getReorderedGroupsForPage, fileStatusContext]);

  // Calculate live counts for current page
  // Only count files that will actually CHANGE status (accounting for multiple appearances)
  const calculateLiveCounts = () => {
    const groupsInPage = getGroupsForCurrentPage();
    
    // Track final state of each file after all groups are processed
    // Key: filename, Value: final checked state (true/false)
    // IMPORTANT: If file is checked in ANY group, final state is saved (matches submit logic)
    const fileFinalStates: { [filename: string]: boolean } = {};
    
    // First pass: Determine final state of each file
    // If file is checked in ANY group, final state is saved (true)
    for (const groupIndex of groupsInPage) {
      const group = groups[groupIndex];
      const selections = autoSelections[groupIndex] || {};
      
      for (const filename of group.files) {
        const isChecked = selections[filename] ?? false;
        // If file is checked in ANY group, final state is saved (true)
        // Once set to true, it stays true (checked in at least one group)
        if (isChecked) {
          fileFinalStates[filename] = true;
        } else if (!(filename in fileFinalStates)) {
          // Only set to false if not already true (not checked in any group)
          fileFinalStates[filename] = false;
        }
      }
    }
    
    // Second pass: Count unique files that will change status
    const filesToSave = new Set<string>();
    const filesToRemove = new Set<string>();
    
    for (const filename of Object.keys(fileFinalStates)) {
      const finalState = fileFinalStates[filename];
      // Use Context to get current status
      const fileStatus = fileStatusContext.getFileStatus(filename);
      const currentStatus = fileStatus?.status || 'unknown';
      
      if (finalState && currentStatus === 'removed') {
        // Will move from removed to saved
        filesToSave.add(filename);
      } else if (!finalState && currentStatus === 'saved') {
        // Will move from saved to removed
        filesToRemove.add(filename);
      }
    }
    
    return { 
      willMoveToSaved: filesToSave.size, 
      willMoveToRemoved: filesToRemove.size 
    };
  };

  const { willMoveToSaved, willMoveToRemoved } = calculateLiveCounts();

  // Check if all groups in current page have auto selections applied
  const allGroupsHaveAutoSelections = useCallback((): boolean => {
    const groupsInPage = getGroupsForCurrentPage();
    if (groupsInPage.length === 0) return false;
    
    // Check if every group in current page has autoSelections entry
    for (const groupIndex of groupsInPage) {
      if (!autoSelections[groupIndex] || Object.keys(autoSelections[groupIndex]).length === 0) {
        return false;
      }
      
      // Also verify that all files in the group have selections
      const group = groups[groupIndex];
      if (group) {
        for (const filename of group.files) {
          if (!(filename in autoSelections[groupIndex])) {
            return false;
          }
        }
      }
    }
    
    return true;
  }, [getGroupsForCurrentPage, autoSelections, groups]);

  const groupsReadyForSubmit = allGroupsHaveAutoSelections();

  // Check if there's a next page
  // Fixed: Check ALL groups in the range, not just limited ones
  const hasNextPage = useCallback(() => {
    if (similarityLevels.length === 0 || groups.length === 0) {
      return false;
    }
    const minLevel = similarityLevels[similarityLevels.length - 1];
    
    // Simple check: if end is greater than minLevel, there's definitely a next page
    if (similarityRangeEnd > minLevel) {
      return true;
    }
    
    // If we're at minLevel, check if there are more groups available
    // Get ALL groups in current range (no limit) to check properly
    const allGroupsInCurrentRange = calculateGroupsInRange(similarityRangeStart, similarityRangeEnd);
    const currentPageGroupIndices = new Set(allGroupsInCurrentRange);
    
    // Check if there are any groups NOT in current range with similarity less than current range end
    for (let i = 0; i < groups.length; i++) {
      if (!currentPageGroupIndices.has(i)) {
        const group = groups[i];
        const roundedSimilarity = Math.round(group.max_similarity * 1000) / 10;
        // If there's a group with similarity less than current range end, there's a next page
        if (roundedSimilarity < similarityRangeEnd) {
          return true;
        }
      }
    }
    
    return false;
  }, [similarityLevels, groups, similarityRangeStart, similarityRangeEnd, calculateGroupsInRange]);

  // Check if there's a previous page
  const hasPreviousPage = () => {
    return pageHistory.length > 0;
  };

  const goToNextPage = () => {
    if (!hasNextPage()) {
      console.warn('goToNextPage: hasNextPage() returned false');
      return;
    }
    
    console.log('goToNextPage: Starting navigation');
    console.log('Current range:', similarityRangeStart, '-', similarityRangeEnd);
    
    // Save current page to history
    setPageHistory(prev => [...prev, { start: similarityRangeStart, end: similarityRangeEnd }]);
    
    // Calculate next range: start from currentEnd and expand until approximately targetGroupsPerPage groups
    // This ensures continuity (no gaps) while bringing approximately the target number of groups
    const minLevel = similarityLevels.length > 0 ? similarityLevels[similarityLevels.length - 1] : 85.0;
    
    // Determine next start point
    let nextStart = similarityRangeEnd;
    
    // If current range start equals end (e.g., 100 - 100), we've shown all groups at that level
    // Start from the next level down
    if (Math.abs(similarityRangeStart - similarityRangeEnd) < 0.01) {
      // Find the next similarity level below current end
      for (let i = 0; i < similarityLevels.length; i++) {
        if (similarityLevels[i] < similarityRangeEnd) {
          nextStart = similarityLevels[i];
          console.log('Range start == end, using next level:', nextStart);
          break;
        }
      }
    }
    
    // If current end is at minLevel, find the next lower similarity level that has groups
    if (Math.abs(similarityRangeEnd - minLevel) < 0.01) {
      // Find the lowest similarity level that has groups with similarity less than current end
      let nextAvailableLevel = minLevel;
      for (let i = 0; i < groups.length; i++) {
        const group = groups[i];
        const roundedSimilarity = Math.round(group.max_similarity * 1000) / 10;
        if (roundedSimilarity < similarityRangeEnd && roundedSimilarity < nextAvailableLevel) {
          nextAvailableLevel = roundedSimilarity;
        }
      }
      
      // If we found a lower level, use it; otherwise we're truly at the end
      if (nextAvailableLevel < minLevel) {
        nextStart = nextAvailableLevel;
        console.log('At minLevel, found next available:', nextStart);
      } else {
        // No more groups available
        console.log('No more groups available');
        return;
      }
    }
    
    console.log('Calculating next range from:', nextStart, 'with target:', targetGroupsPerPage);
    
    // Calculate range from nextStart that brings approximately targetGroupsPerPage groups
    const nextRange = calculateRangeFromTargetGroups(nextStart, targetGroupsPerPage);
    console.log('Calculated next range:', nextRange);
    
    // Ensure we don't go below minLevel
    if (nextRange.end < minLevel) {
      nextRange.end = minLevel;
    }
    
    console.log('Setting new range:', nextRange.start, '-', nextRange.end);
    
    // Update the range - this will trigger re-render and show new groups
    setSimilarityRangeStart(nextRange.start);
    setSimilarityRangeEnd(nextRange.end);
    setIsManualRange(false); // Mark as auto-calculated (not manual)
    setPageCompleted(false);
    
    console.log('Range updated, should trigger re-render');
  };

  const goToPreviousPage = () => {
    if (!hasPreviousPage()) return;
    
    // Get previous range from history
    const previousPage = pageHistory[pageHistory.length - 1];
    setPageHistory(prev => prev.slice(0, -1));
    setSimilarityRangeStart(previousPage.start);
    setSimilarityRangeEnd(previousPage.end);
    setPageCompleted(false);
  };

  const jumpToMin = () => {
    if (similarityLevels.length > 0) {
      const minLevel = similarityLevels[similarityLevels.length - 1];
      // Calculate range starting from min level with target groups
      const range = calculateRangeFromTargetGroups(minLevel, targetGroupsPerPage);
      setPageHistory([]);
      setSimilarityRangeStart(range.start);
      setSimilarityRangeEnd(range.end);
      setPageCompleted(false);
    }
  };

  const jumpToMax = () => {
    if (similarityLevels.length > 0) {
      const maxLevel = similarityLevels[0]; // Highest similarity
      // Calculate range starting from max level with target groups
      const range = calculateRangeFromTargetGroups(maxLevel, targetGroupsPerPage);
      setPageHistory([]);
      setSimilarityRangeStart(range.start);
      setSimilarityRangeEnd(range.end);
      setPageCompleted(false);
    }
  };

  // Expose methods via ref
  useImperativeHandle(ref, () => ({
    jumpToMin,
    jumpToMax
  }));

  // Auto-scroll animation logic
  useEffect(() => {
    if (!autoScrollEnabled || !autoScrollActive) {
      // Stop scrolling if disabled or paused
      if (autoScrollAnimationRef.current !== null) {
        cancelAnimationFrame(autoScrollAnimationRef.current);
        autoScrollAnimationRef.current = null;
      }
      return;
    }

    const scroll = () => {
      const now = performance.now();
      const deltaTime = now - lastScrollTimeRef.current;
      
      // Convert pixels per second to pixels per frame
      // Assuming ~60fps, each frame is ~16.67ms
      const pixelsPerFrame = (AUTO_SCROLL_SPEED / 1000) * deltaTime;
      
      // Check if we've reached the bottom (with small threshold)
      const threshold = 10; // pixels
      const isAtBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - threshold;
      
      if (isAtBottom) {
        // Reached bottom, stop auto-scroll
        setAutoScrollActive(false);
        if (autoScrollAnimationRef.current !== null) {
          cancelAnimationFrame(autoScrollAnimationRef.current);
          autoScrollAnimationRef.current = null;
        }
        return;
      }
      
      // Scroll down
      window.scrollBy(0, pixelsPerFrame);
      lastScrollTimeRef.current = now;
      
      // Continue animation
      autoScrollAnimationRef.current = requestAnimationFrame(scroll);
    };
    
    // Initialize and start scrolling
    lastScrollTimeRef.current = performance.now();
    autoScrollAnimationRef.current = requestAnimationFrame(scroll);
    
    // Cleanup function
    return () => {
      if (autoScrollAnimationRef.current !== null) {
        cancelAnimationFrame(autoScrollAnimationRef.current);
        autoScrollAnimationRef.current = null;
      }
    };
  }, [autoScrollEnabled, autoScrollActive]);

  // Space key handler (only active when auto-scroll is enabled)
  // When auto-scroll is enabled, space key always toggles scroll: start if stopped, stop if active
  useEffect(() => {
    if (!autoScrollEnabled) {
      return; // Don't listen to space key when auto-scroll button is OFF
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle space key
      if (e.code === 'Space' || e.key === ' ') {
        const target = e.target as HTMLElement;
        
        // Skip only text inputs and textareas (allow checkboxes to be intercepted)
        const isTextInput = 
          (target.tagName === 'INPUT' && 
           (target as HTMLInputElement).type !== 'checkbox' && 
           (target as HTMLInputElement).type !== 'radio') ||
          target.tagName === 'TEXTAREA' || 
          target.isContentEditable ||
          target.getAttribute('contenteditable') === 'true';
        
        if (isTextInput) {
          return; // Don't interfere with text inputs or editable content
        }
        
        // ALWAYS prevent default and stop propagation when auto-scroll is enabled
        // This ensures space key controls auto-scroll, not checkboxes or other elements
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        
        // If checkbox is focused, blur it
        if (target.tagName === 'INPUT' && (target as HTMLInputElement).type === 'checkbox') {
          (target as HTMLInputElement).blur();
        }
        
        // Toggle auto-scroll: if stopped, start it; if active, stop it
        setAutoScrollActive(prev => !prev);
      }
    };

    // Use capture phase to catch the event before other handlers
    window.addEventListener('keydown', handleKeyDown, true);
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [autoScrollEnabled]);

  // Global per-filename toggle on current page:
  // When user checks/unchecks one instance of a filename, apply the same
  // checked state to all its appearances (in all groups) on THIS page only.
  const handleFileToggleAll = useCallback((filename: string, checked: boolean) => {
    // Mark this file as user-modified so auto-selection respects user's choice
    // This allows saved/removed files to sync when user manually changes them
    userModifiedFilesRef.current.add(filename);
    
    setAutoSelections(prev => {
      const updated: { [groupIndex: number]: { [filename: string]: boolean } } = { ...prev };
      const groupsInPage = getGroupsForCurrentPage();

      for (const groupIndex of groupsInPage) {
        const group = groups[groupIndex];
        if (!group || !group.files.includes(filename)) continue;

        const prevGroupSelections = updated[groupIndex] || prev[groupIndex] || {};
        updated[groupIndex] = {
          ...prevGroupSelections,
          [filename]: checked
        };
      }

      return updated;
    });

    // Persist per-filename preference
    storage.updateCheckedFiles(subject, filename, checked);

    // Stop auto-scroll when user interacts with MCQ boxes
    if (autoScrollActive) {
      setAutoScrollActive(false);
    }
    
    // Blur any focused checkbox immediately to prevent space key from toggling it
    // Use requestAnimationFrame to ensure this happens after React's event handling
    requestAnimationFrame(() => {
      if (document.activeElement && 
          document.activeElement.tagName === 'INPUT' && 
          (document.activeElement as HTMLInputElement).type === 'checkbox') {
        (document.activeElement as HTMLElement).blur();
      }
    });
    
    // Note: File status will be updated on submit, not on toggle
  }, [subject, autoScrollActive, getGroupsForCurrentPage, groups]);

  // Backwards-compatible handler used by GroupDisplay: simply delegate
  const handleGroupToggle = useCallback((groupIndex: number, filename: string, checked: boolean) => {
    handleFileToggleAll(filename, checked);
  }, [handleFileToggleAll]);

  const handleSubmitSingleGroup = async (groupIndex: number) => {
    try {
      const checkedFiles = Object.entries(autoSelections[groupIndex] || {})
        .filter(([_, checked]) => checked)
        .map(([filename]) => filename);
      
      await api.submitGroup(subject, groupIndex, checkedFiles);
      
      // Update Context after submit
      const group = groups[groupIndex];
      for (const filename of group.files) {
        const isChecked = checkedFiles.includes(filename);
        fileStatusContext.setFileStatus(filename, {
          status: isChecked ? 'saved' : 'removed',
          checked: isChecked
        });
        fileStatusContext.setFileChecked(filename, isChecked);
      }
      
      // Notify parent
      onGroupsSubmitted();
    } catch (error) {
      console.error('Failed to submit group:', error);
      alert('Error submitting group');
    }
  };

  const handleSubmitAllInPage = async () => {
    // Show confirmation modal first
    setShowConfirmModal(true);
  };

  const handleConfirmSubmitAll = async () => {
    setShowConfirmModal(false);
    setSubmitting(true);
    
    try {
      // Get counts BEFORE submission
      let savedCountBefore = 0;
      let removedCountBefore = 0;
      try {
        const summaryBefore = await api.getSummary(subject);
        savedCountBefore = summaryBefore.final_saved || 0;
        removedCountBefore = summaryBefore.final_removed || 0;
        console.log(`Before submission - Saved: ${savedCountBefore}, Removed: ${removedCountBefore}`);
      } catch (error) {
        console.error('Failed to get summary before:', error);
      }
      
      const groupsInPage = getGroupsForCurrentPage();
      
      // Calculate final state for each file: if checked in ANY group = saved
      // This ensures files checked even once remain saved, even if unchecked in other groups
      const fileFinalStates: { [filename: string]: boolean } = {};
      
      // First pass: Determine final state for each file
      // Initialize all files to false first, then set to true if checked in any group
      for (const groupIndex of groupsInPage) {
        const group = groups[groupIndex];
        for (const filename of group.files) {
          if (!(filename in fileFinalStates)) {
            fileFinalStates[filename] = false;
          }
        }
      }
      
      // Second pass: Set to true if checked in ANY group
      for (const groupIndex of groupsInPage) {
        const group = groups[groupIndex];
        const selections = autoSelections[groupIndex] || {};
        
        for (const filename of group.files) {
          const isChecked = selections[filename] ?? false;
          // If file is checked in ANY group, final state is saved (true)
          if (isChecked) {
            fileFinalStates[filename] = true;
          }
          // If unchecked, keep as false (already initialized above)
        }
      }
      
      let totalMovedToRemoved = 0; // Files moved FROM saved TO removed in this submission
      let totalUncheckedFromSaved = 0; // All files unchecked that were in saved folder
      let totalNewlyAddedToSaved = 0; // Files newly added to saved_db (from unknown or removed)
      let totalGroupsSubmitted = 0;
      
      // Determine batch size based on total number of groups
      const totalGroups = groupsInPage.length;
      const batchSize = totalGroups > 505 ? 30 : 5;
      
      console.log(`Submitting ${totalGroups} groups with batch size of ${batchSize}`);
      
      // Helper function to process a single group
      const processGroup = async (groupIndex: number) => {
        const group = groups[groupIndex];
        
        // Build checkedFiles list based on final state, not just this group's selection
        // If file's final state is saved (checked in any group), include it in checkedFiles
        const checkedFiles: string[] = [];
        for (const filename of group.files) {
          const finalState = fileFinalStates[filename];
          // Only include file if finalState is explicitly true
          // If finalState is false or undefined, file will be removed (not in checkedFiles)
          if (finalState === true) {
            // File should be saved (checked in at least one group)
            checkedFiles.push(filename);
          }
          // If finalState is false or undefined, don't add to checkedFiles (will be removed)
        }
        
        const response = await api.submitGroup(subject, groupIndex, checkedFiles);
        
        // Update Context after each group submit based on final state
        for (const filename of group.files) {
          const finalState = fileFinalStates[filename];
          fileStatusContext.setFileStatus(filename, {
            status: finalState === true ? 'saved' : 'removed',
            checked: finalState
          });
          fileStatusContext.setFileChecked(filename, finalState);
        }
        
        console.log(`Group ${groupIndex} submitted:`, {
          moved_to_removed: response.moved_to_removed,
          unchecked_from_saved: response.unchecked_from_saved,
          newly_added_to_saved: response.newly_added_to_saved,
          saved_count: response.saved_count,
          removed_count: response.removed_count
        });
        
        return response;
      };
      
      // Process groups in batches
      for (let i = 0; i < groupsInPage.length; i += batchSize) {
        const batch = groupsInPage.slice(i, i + batchSize);
        const batchNumber = Math.floor(i / batchSize) + 1;
        const totalBatches = Math.ceil(groupsInPage.length / batchSize);
        
        console.log(`Processing batch ${batchNumber}/${totalBatches} (${batch.length} groups)`);
        
        // Process all groups in the current batch in parallel
        const batchPromises = batch.map(groupIndex => processGroup(groupIndex));
        const batchResponses = await Promise.all(batchPromises);
        
        // Accumulate statistics from all responses in this batch
        for (const response of batchResponses) {
          totalGroupsSubmitted++;
          
          if (response.moved_to_removed) {
            totalMovedToRemoved += response.moved_to_removed;
          }
          if (response.unchecked_from_saved) {
            totalUncheckedFromSaved += response.unchecked_from_saved;
          }
          if (response.newly_added_to_saved) {
            totalNewlyAddedToSaved += response.newly_added_to_saved;
          }
        }
        
        console.log(`Batch ${batchNumber}/${totalBatches} completed. Total groups submitted so far: ${totalGroupsSubmitted}`);
      }
      
      console.log(`Total - Moved to removed: ${totalMovedToRemoved}, Unchecked from saved: ${totalUncheckedFromSaved}, Newly added to saved: ${totalNewlyAddedToSaved}, Groups: ${totalGroupsSubmitted}`);
      
      // Get current folder counts AFTER submission
      let savedCountAfter = 0;
      let removedCountAfter = 0;
      try {
        const summaryAfter = await api.getSummary(subject);
        savedCountAfter = summaryAfter.final_saved || 0;
        removedCountAfter = summaryAfter.final_removed || 0;
        console.log(`After submission - Saved: ${savedCountAfter}, Removed: ${removedCountAfter}`);
      } catch (error) {
        console.error('Failed to get summary after:', error);
      }
      
      // Calculate actual changes
      const actualRemovedFromSaved = savedCountBefore - savedCountAfter; // How many were removed from saved
      const actualAddedToRemoved = removedCountAfter - removedCountBefore; // How many were added to removed
      
      console.log(`Actual changes - Removed from saved: ${actualRemovedFromSaved}, Added to removed: ${actualAddedToRemoved}`);
      
      // Show success modal with statistics (always show if groups were submitted)
      if (totalGroupsSubmitted > 0) {
        // Use actual changes if available, otherwise use tracked values
        // Use moved_to_removed instead of unchecked_from_saved because unchecked_from_saved
        // incorrectly includes files that were already in REMOVED (never in SAVED)
        const removedFromSaved = actualRemovedFromSaved > 0 ? actualRemovedFromSaved : totalMovedToRemoved;
        const addedToSaved = totalNewlyAddedToSaved; // Files newly added to saved_db
        const addedToRemoved = actualAddedToRemoved > 0 ? actualAddedToRemoved : totalMovedToRemoved;
        
        console.log('Setting success modal with stats:', {
          removedFromSaved,
          addedToSaved,
          addedToRemoved,
          savedCountAfter,
          removedCountAfter
        });
        
        setSuccessStats({
          movedToRemoved: removedFromSaved,
          addedToSaved: addedToSaved,
          addedToRemoved: addedToRemoved,
          savedCount: savedCountAfter,
          removedCount: removedCountAfter
        });
        
        // Calculate next page: start from currentEnd and expand until approximately targetGroupsPerPage groups
        // Always calculate next range, even if there are no more groups (to show what it would be)
        let nextRange: { start: number; end: number } | null = null;
        let hasNext = false;
        
        const minLevel = similarityLevels.length > 0 ? similarityLevels[similarityLevels.length - 1] : 85.0;
        
        // Always calculate next range (even if hasNextPage is false)
        // Start exactly where current range ends (continuous, no gaps)
        let nextStart = similarityRangeEnd;
        
        // If current end is at minLevel, find the next lower similarity level that has groups
        if (Math.abs(similarityRangeEnd - minLevel) < 0.01) {
          // Find the lowest similarity level that has groups with similarity less than current end
          let nextAvailableLevel = minLevel;
          for (let i = 0; i < groups.length; i++) {
            const group = groups[i];
            const roundedSimilarity = Math.round(group.max_similarity * 1000) / 10;
            if (roundedSimilarity < similarityRangeEnd && roundedSimilarity < nextAvailableLevel) {
              nextAvailableLevel = roundedSimilarity;
            }
          }
          
          // If we found a lower level, use it; otherwise calculate theoretical next range
          if (nextAvailableLevel < minLevel) {
            nextStart = nextAvailableLevel;
          }
          // If no lower level found, still calculate theoretical next range starting from minLevel
        }
        
        // Calculate next range (always, even if no more groups)
        const calculatedNext = calculateRangeFromTargetGroups(nextStart, targetGroupsPerPage);
        
        // Check if there are actually more groups available
        hasNext = hasNextPage();
        
        // Always set nextRange (even if hasNext is false, to show what it would be)
        nextRange = calculatedNext;
        
        // Set next page info and start loading in background
        setNextPageInfo({
          nextRange,
          hasNextPage: hasNext,
          loading: false
        });
        
        setShowSuccessModal(true);
        console.log('Modal should be visible now');
      }
      
      // Mark page as completed
      setPageCompleted(true);
      
      // Track removed files after successful submission
      try {
        await api.trackRemoved(subject);
        console.log('Removed files tracked successfully');
      } catch (error) {
        console.error('Failed to track removed files:', error);
        // Don't fail the whole operation if tracking fails
      }
      
      // Notify parent
      onGroupsSubmitted();
      
      // Range is already saved to localStorage via useEffect (lines 677-688)
      
      // Stop loading only after success modal is shown
      setSubmitting(false);
    } catch (error) {
      console.error('Failed to submit groups:', error);
      alert('Error submitting groups');
      setSubmitting(false);
    }
  };

  if (initializing) {
    return (
      <div className="flex justify-center items-center py-24">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600 text-lg">Initializing similarity groups...</p>
          <p className="text-gray-500 text-sm mt-2">Loading groups and auto-selecting best MCQs</p>
        </div>
      </div>
    );
  }

  // Use reordered groups for display (file appearances grouped together)
  const groupsInPage = getReorderedGroupsForPage();
  
  return (
    <div className="relative">
      {/* Loading Overlay - Shows during submission or next page loading */}
      {(submitting || loadingNextPage) && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[110]">
          <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md mx-4">
            <div className="text-center">
              <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-blue-600 mx-auto mb-4"></div>
              <h2 className="text-2xl font-bold text-gray-800 mb-2">
                {submitting ? 'Submitting Groups...' : 'Loading Next Page...'}
              </h2>
              <p className="text-gray-600">
                {submitting ? 'Please wait while groups are being processed' : 'Preparing next page for review'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal */}
      {showConfirmModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[100]">
          <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md mx-4">
            <div className="text-center">
              <h2 className="text-2xl font-bold text-gray-800 mb-6">
                Confirm Submission
              </h2>
              <div className="flex gap-3 mt-8">
                <button
                  onClick={() => setShowConfirmModal(false)}
                  className="flex-1 px-6 py-3 bg-gray-300 hover:bg-gray-400 text-gray-800 font-semibold rounded-lg transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmSubmitAll}
                  disabled={submitting}
                  className="flex-1 px-6 py-3 bg-green-600 hover:bg-green-700 disabled:bg-green-400 text-white font-semibold rounded-lg transition-all"
                >
                  {submitting ? 'Submitting...' : 'Confirm'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Success Modal */}
      {showSuccessModal && successStats && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[100]">
          <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md mx-4">
            <div className="text-center">
              <div className="text-6xl mb-4">✓</div>
              <h2 className="text-2xl font-bold text-gray-800 mb-4">
                Successfully Submitted!
              </h2>
              <div className="space-y-4 mb-6">
                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                  <div className="space-y-2">
                    <p className="text-gray-800">
                      <span className="font-bold text-red-600 text-lg">{successStats.movedToRemoved}</span> MCQs removed from <span className="font-semibold">SAVED</span>
                    </p>
                    <p className="text-gray-800">
                      <span className="font-bold text-green-600 text-lg">{successStats.addedToSaved}</span> MCQs added to <span className="font-semibold">SAVED</span>
                    </p>
                  </div>
                  <p className="text-sm text-gray-600 mt-1">
                    ({successStats.savedCount} MCQs present)
                  </p>
                </div>
                
                <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
                  <p className="text-gray-800">
                    <span className="font-bold text-orange-600 text-lg">{successStats.addedToRemoved}</span> MCQs added to <span className="font-semibold">REMOVED</span>
                  </p>
                  <p className="text-sm text-gray-600 mt-1">
                    ({successStats.removedCount} MCQs present)
                  </p>
                </div>
              </div>
              {/* Next page info */}
              {nextPageInfo && (
                <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                  {nextPageInfo.hasNextPage && nextPageInfo.nextRange ? (
                    <p className="text-sm text-gray-700">
                      Next page ready: {nextPageInfo.nextRange.start.toFixed(2)}% - {nextPageInfo.nextRange.end.toFixed(2)}%
                    </p>
                  ) : nextPageInfo.nextRange ? (
                    <div className="space-y-1">
                      <p className="text-sm text-gray-700 font-semibold">
                        ✓ All pages completed! No more groups to review.
                      </p>
                      <p className="text-sm text-gray-600">
                        Next similarity range would be: {nextPageInfo.nextRange.start.toFixed(2)}% - {nextPageInfo.nextRange.end.toFixed(2)}%
                      </p>
                    </div>
                  ) : (
                    <p className="text-sm text-gray-700 font-semibold">
                      ✓ All pages completed! No more groups to review.
                    </p>
                  )}
                </div>
              )}
              
              <button
                onClick={async () => {
                  setShowSuccessModal(false);
                  setSuccessStats(null);
                  
                  // Auto-advance to next page if available
                  if (nextPageInfo?.hasNextPage && nextPageInfo.nextRange) {
                    // Start loading next page immediately
                    setLoadingNextPage(true);
                    
                    // Save current page to history
                    setPageHistory(prev => [...prev, { start: similarityRangeStart, end: similarityRangeEnd }]);
                    
                    // Navigate to next page
                    setSimilarityRangeStart(nextPageInfo.nextRange.start);
                    setSimilarityRangeEnd(nextPageInfo.nextRange.end);
                    setPageCompleted(false);
                    
                    // Range will be saved to localStorage automatically via useEffect
                    // Wait for groups to load - check periodically until groups are available
                    const checkGroupsLoaded = setInterval(() => {
                      const groupsInNewPage = getGroupsForCurrentPage();
                      // Stop loading when groups are loaded or if no more pages
                      if (groupsInNewPage.length > 0 || !hasNextPage()) {
                        clearInterval(checkGroupsLoaded);
                        setLoadingNextPage(false);
                      }
                    }, 100);
                    
                    // Safety timeout - stop loading after 5 seconds max
                    setTimeout(() => {
                      clearInterval(checkGroupsLoaded);
                      setLoadingNextPage(false);
                    }, 5000);
                  } else {
                    // No next page, just close modal
                    setNextPageInfo(null);
                  }
                }}
                disabled={loadingNextPage}
                className="w-full px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-semibold rounded-lg transition-all"
              >
                {loadingNextPage ? 'Loading Next Page...' : (nextPageInfo?.hasNextPage ? 'OK - Go to Next Page' : 'OK')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating Submit All Button - Always visible */}
      <div className="fixed top-8 right-8 z-50">
        <button
          onClick={handleSubmitAllInPage}
          disabled={submitting || fileStatusContext.loadingStatuses || pageCompleted || initializing || !groupsReadyForSubmit}
          className="px-6 py-3 bg-green-600 hover:bg-green-700 disabled:bg-green-400 text-white font-bold rounded-full shadow-2xl transform hover:scale-105 transition-all min-w-[280px]"
        >
          {submitting ? (
            <span className="text-base">Submitting...</span>
          ) : initializing ? (
            <span className="text-base">Initializing...</span>
          ) : fileStatusContext.loadingStatuses ? (
            <span className="text-base">Loading...</span>
          ) : !groupsReadyForSubmit ? (
            <span className="text-base">Applying auto selections...</span>
          ) : pageCompleted ? (
            <span className="text-base">✓ Page Completed</span>
          ) : (
            <div className="flex flex-col items-center gap-1.5">
              <div className="text-base font-bold">Submit All ({totalGroupsInPage} groups)</div>
              <div className="text-xs font-normal flex items-center gap-2.5">
                {willMoveToSaved > 0 && (
                  <span className="flex items-center gap-1">
                    <span className="text-green-100">Saving</span>
                    <span className="bg-green-800 px-2 py-0.5 rounded font-bold text-white">{willMoveToSaved}</span>
                    <span className="text-green-100">MCQs</span>
                  </span>
                )}
                {willMoveToSaved > 0 && willMoveToRemoved > 0 && (
                  <span className="text-green-300">•</span>
                )}
                {willMoveToRemoved > 0 && (
                  <span className="flex items-center gap-1">
                    <span className="text-red-100">Removing</span>
                    <span className="bg-red-800 px-2 py-0.5 rounded font-bold text-white">{willMoveToRemoved}</span>
                    <span className="text-red-100">MCQs</span>
                  </span>
                )}
                {willMoveToSaved === 0 && willMoveToRemoved === 0 && (
                  <span className="text-gray-300 text-xs">No changes</span>
                )}
              </div>
            </div>
          )}
        </button>
      </div>

      {/* Similarity Range Header - Scrollable */}
      <div className="bg-white rounded-lg shadow-lg p-4 mb-2 border-b-4 border-blue-600">
        <div className="flex justify-between items-center mb-3">
          <div>
            <h2 className="text-3xl font-bold text-blue-600">
              Similarity: {similarityRangeStart.toFixed(2)}% - {similarityRangeEnd.toFixed(2)}%
            </h2>
            <p className="text-sm text-gray-600 mt-1">
              {totalGroupsInPage} / {groups.length} group{groups.length !== 1 ? 's' : ''} on this page
              {pageCompleted && (
                <span className="ml-2 px-2 py-1 bg-green-100 text-green-800 rounded font-semibold">
                  ✓ Page Completed
                </span>
              )}
            </p>
            {fileStatusContext.loadingStatuses && (
              <p className="text-sm text-gray-500 mt-1">Loading file statuses...</p>
            )}
          </div>
          
          <div className="flex items-center gap-3">
            {/* Check All Mode Toggle */}
            <div className="flex items-center gap-2 mr-4">
              <label className="text-sm font-semibold text-gray-700">Check All:</label>
              <button
                onClick={() => setCheckAllMode(!checkAllMode)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  checkAllMode ? 'bg-blue-600' : 'bg-gray-300'
                }`}
                title={checkAllMode ? 'Check all except removed files' : 'Use preference-based selection'}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    checkAllMode ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
              <span className="text-xs text-gray-500">
                {checkAllMode ? 'ON' : 'OFF'}
              </span>
            </div>
            
            {/* Auto-scroll Toggle */}
            <div className="flex items-center gap-2 mr-4">
              <label className="text-sm font-semibold text-gray-700">Auto Scroll:</label>
              <button
                onClick={() => {
                  const newEnabled = !autoScrollEnabled;
                  setAutoScrollEnabled(newEnabled);
                  if (newEnabled) {
                    // When enabling, start auto-scroll
                    setAutoScrollActive(true);
                  } else {
                    // When disabling, stop auto-scroll
                    setAutoScrollActive(false);
                  }
                }}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  autoScrollEnabled ? 'bg-green-600' : 'bg-gray-300'
                }`}
                title={autoScrollEnabled ? 'Auto-scroll enabled (press Space to pause/resume)' : 'Enable auto-scroll'}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    autoScrollEnabled ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
              <span className="text-xs text-gray-500">
                {autoScrollEnabled ? (autoScrollActive ? 'ON' : 'PAUSED') : 'OFF'}
              </span>
            </div>
          </div>
        </div>
        
        {/* Range Controls */}
        {similarityLevels.length > 0 && (
          <div className="mt-4 mb-4">
            {/* Similarity Range Sliders */}
            <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
              <div className="mb-3">
                <span className="text-sm text-gray-600">
                  Adjust similarity range manually
                </span>
              </div>
          <div className="mt-4">
            <div className="flex items-center gap-2 mb-2">
              <label className="text-sm font-semibold text-gray-700 min-w-[100px]">
                Start: {similarityRangeStart.toFixed(2)}%
              </label>
              {/* Fine-tune buttons (0.01) */}
              <button
                onClick={() => {
                  const newStart = Math.max(similarityRangeEnd, similarityRangeStart - 0.01);
                  setSimilarityRangeStart(newStart);
                  setIsManualRange(true); // Mark as manually adjusted
                  setPageHistory([]);
                  setPageCompleted(false);
                }}
                disabled={similarityRangeStart <= similarityRangeEnd}
                className="px-2 py-1 bg-gray-100 hover:bg-gray-200 disabled:bg-gray-50 disabled:cursor-not-allowed rounded text-gray-600 text-xs font-bold"
                title="Decrease by 0.01%"
              >
                −−
              </button>
              {/* Coarse button (0.1) */}
              <button
                onClick={() => {
                  const newStart = Math.max(similarityRangeEnd, similarityRangeStart - 0.1);
                  setSimilarityRangeStart(newStart);
                  setIsManualRange(true); // Mark as manually adjusted
                  setPageHistory([]);
                  setPageCompleted(false);
                }}
                disabled={similarityRangeStart <= similarityRangeEnd}
                className="px-3 py-1 bg-gray-200 hover:bg-gray-300 disabled:bg-gray-100 disabled:cursor-not-allowed rounded-lg font-bold text-gray-700 text-lg"
                title="Decrease by 0.1%"
              >
                −
              </button>
              <div className="flex-1 relative">
                <input
                  type="range"
                  min={similarityRangeEnd}
                  max={similarityLevels[0]}
                  step={0.01}
                  value={similarityRangeStart}
                  onChange={(e) => {
                    const newStart = parseFloat(e.target.value);
                    setSimilarityRangeStart(newStart);
                    setIsManualRange(true); // Mark as manually adjusted
                    setPageHistory([]);
                    setPageCompleted(false);
                  }}
                  className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                />
              </div>
              {/* Coarse button (0.1) */}
              <button
                onClick={() => {
                  const newStart = Math.min(similarityLevels[0], similarityRangeStart + 0.1);
                  setSimilarityRangeStart(newStart);
                  setIsManualRange(true); // Mark as manually adjusted
                  setPageHistory([]);
                  setPageCompleted(false);
                }}
                disabled={similarityRangeStart >= similarityLevels[0]}
                className="px-3 py-1 bg-gray-200 hover:bg-gray-300 disabled:bg-gray-100 disabled:cursor-not-allowed rounded-lg font-bold text-gray-700 text-lg"
                title="Increase by 0.1%"
              >
                +
              </button>
              {/* Fine-tune buttons (0.01) */}
              <button
                onClick={() => {
                  const newStart = Math.min(similarityLevels[0], similarityRangeStart + 0.01);
                  setSimilarityRangeStart(newStart);
                  setIsManualRange(true); // Mark as manually adjusted
                  setPageHistory([]);
                  setPageCompleted(false);
                }}
                disabled={similarityRangeStart >= similarityLevels[0]}
                className="px-2 py-1 bg-gray-100 hover:bg-gray-200 disabled:bg-gray-50 disabled:cursor-not-allowed rounded text-gray-600 text-xs font-bold"
                title="Increase by 0.01%"
              >
                ++
              </button>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm font-semibold text-gray-700 min-w-[100px]">
                End: {similarityRangeEnd.toFixed(2)}%
              </label>
              {/* Fine-tune buttons (0.01) */}
              <button
                onClick={() => {
                  const newEnd = Math.max(similarityLevels[similarityLevels.length - 1], similarityRangeEnd - 0.01);
                  setSimilarityRangeEnd(newEnd);
                  setIsManualRange(true); // Mark as manually adjusted
                  setPageHistory([]);
                  setPageCompleted(false);
                }}
                disabled={similarityRangeEnd <= similarityLevels[similarityLevels.length - 1]}
                className="px-2 py-1 bg-gray-100 hover:bg-gray-200 disabled:bg-gray-50 disabled:cursor-not-allowed rounded text-gray-600 text-xs font-bold"
                title="Decrease by 0.01%"
              >
                −−
              </button>
              {/* Coarse button (0.1) */}
              <button
                onClick={() => {
                  const newEnd = Math.max(similarityLevels[similarityLevels.length - 1], similarityRangeEnd - 0.1);
                  setSimilarityRangeEnd(newEnd);
                  setIsManualRange(true); // Mark as manually adjusted
                  setPageHistory([]);
                  setPageCompleted(false);
                }}
                disabled={similarityRangeEnd <= similarityLevels[similarityLevels.length - 1]}
                className="px-3 py-1 bg-gray-200 hover:bg-gray-300 disabled:bg-gray-100 disabled:cursor-not-allowed rounded-lg font-bold text-gray-700 text-lg"
                title="Decrease by 0.1%"
              >
                −
              </button>
              <div className="flex-1 relative">
                <input
                  type="range"
                  min={similarityLevels[similarityLevels.length - 1]}
                  max={similarityRangeStart}
                  step={0.01}
                  value={similarityRangeEnd}
                  onChange={(e) => {
                    const newEnd = parseFloat(e.target.value);
                    setSimilarityRangeEnd(newEnd);
                    setIsManualRange(true); // Mark as manually adjusted
                    setPageHistory([]);
                    setPageCompleted(false);
                  }}
                  className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                />
              </div>
              {/* Coarse button (0.1) */}
              <button
                onClick={() => {
                  const newEnd = Math.min(similarityRangeStart, similarityRangeEnd + 0.1);
                  setSimilarityRangeEnd(newEnd);
                  setIsManualRange(true); // Mark as manually adjusted
                  setPageHistory([]);
                  setPageCompleted(false);
                }}
                disabled={similarityRangeEnd >= similarityRangeStart}
                className="px-3 py-1 bg-gray-200 hover:bg-gray-300 disabled:bg-gray-100 disabled:cursor-not-allowed rounded-lg font-bold text-gray-700 text-lg"
                title="Increase by 0.1%"
              >
                +
              </button>
              {/* Fine-tune buttons (0.01) */}
              <button
                onClick={() => {
                  const newEnd = Math.min(similarityRangeStart, similarityRangeEnd + 0.01);
                  setSimilarityRangeEnd(newEnd);
                  setIsManualRange(true); // Mark as manually adjusted
                  setPageHistory([]);
                  setPageCompleted(false);
                }}
                disabled={similarityRangeEnd >= similarityRangeStart}
                className="px-2 py-1 bg-gray-100 hover:bg-gray-200 disabled:bg-gray-50 disabled:cursor-not-allowed rounded text-gray-600 text-xs font-bold"
                title="Increase by 0.01%"
              >
                ++
              </button>
            </div>
          </div>
            </div>
          </div>
        )}
      </div>

      {/* Groups container - No individual scroll, page scrolls */}
      <div className="space-y-6 pr-4 pb-8">
        {/* Show loading overlay if MCQ data is loading */}
        {fileStatusContext.loadingMCQData && (
          <div className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 shadow-xl">
              <div className="flex items-center gap-4">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                <div>
                  <p className="text-lg font-semibold text-gray-800">Loading MCQ data...</p>
                  <p className="text-sm text-gray-600">
                    Loading data for {totalGroupsInPage} group{totalGroupsInPage !== 1 ? 's' : ''}...
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
        
        {groupsInPage.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-600 text-lg">No groups available in this range</p>
            <p className="text-gray-500 text-sm mt-2">Adjust the similarity range sliders above to find groups</p>
          </div>
        ) : (
          groupsInPage.map((groupIndex, idx) => {
          const group = groups[groupIndex];
          return (
            <div key={groupIndex} id={`group-${groupIndex}`}>
              <GroupDisplay
                subject={subject}
                group={group}
                groupIndex={groupIndex}
                totalGroups={groups.length}
                completedGroups={completedGroups}
                onSubmit={() => handleSubmitSingleGroup(groupIndex)}
                initialCheckedFiles={autoSelections[groupIndex]}
                onFileToggle={(filename, checked) => handleGroupToggle(groupIndex, filename, checked)}
                conflictingFiles={conflictingFiles}
                fileAppearanceCounts={fileAppearanceCounts}
                fileAppearanceOrder={fileAppearanceOrder}
                fileAppearanceTotals={fileAppearanceTotals}
                keptAppearanceOrder={keptAppearanceOrder}
              />
            </div>
          );
          })
        )}
      </div>
    </div>
  );
});

SimilarityGroupViewInner.displayName = 'SimilarityGroupViewInner';

// Outer component that provides Context
export const SimilarityGroupView = forwardRef<SimilarityGroupViewHandle, SimilarityGroupViewProps>((props, ref) => {
  return (
    <FileStatusProvider subject={props.subject}>
      <SimilarityGroupViewInner {...props} ref={ref} />
    </FileStatusProvider>
  );
});

SimilarityGroupView.displayName = 'SimilarityGroupView';


