import React, { useState, useEffect, useRef } from 'react';
import { MCQCard } from './MCQCard';
import { api } from '../lib/api';
import { storage } from '../lib/storage';
import { useFileStatus } from '../contexts/FileStatusContext';

interface Group {
  files: string[];
  max_similarity?: number;
  similarity?: number;  // For backward compatibility
  similarities?: Array<{
    file1: string;
    file2: string;
    score: number;
  }>;
}

interface GroupDisplayProps {
  subject: string;
  group: Group;
  groupIndex: number;
  totalGroups: number;
  onSubmit: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  completedGroups?: number[];
  onGoToNextIncomplete?: () => void;
  initialCheckedFiles?: { [key: string]: boolean };
  onFileToggle?: (filename: string, checked: boolean) => void;
  conflictingFiles?: Set<string>;  // Files with conflicts (checked in one group, unchecked in another)
  fileAppearanceCounts?: { [filename: string]: { total: number; checked: number } };  // File appearance and checked counts
  fileAppearanceOrder?: { [filename: string]: { [groupIndex: number]: number } };  // Order of main file appearances per group
  fileAppearanceTotals?: { [filename: string]: number };  // Total appearances (main + KEPT) per filename on current page
  keptAppearanceOrder?: { [removedFilename: string]: { [keptFilename: string]: number } };  // Appearance index for KEPT cards
  globalExpandState?: boolean;  // Global expand/collapse state controlled by parent
}

export const GroupDisplay: React.FC<GroupDisplayProps> = ({
  subject,
  group,
  groupIndex,
  totalGroups,
  onSubmit,
  onPrevious,
  onNext,
  completedGroups = [],
  onGoToNextIncomplete,
  initialCheckedFiles,
  onFileToggle,
  conflictingFiles = new Set(),
  fileAppearanceCounts = {},
  fileAppearanceOrder = {},
  fileAppearanceTotals = {},
  keptAppearanceOrder = {},
  globalExpandState = true,  // Default to expanded, controlled by parent
}) => {
  const fileStatusContext = useFileStatus();
  const isCompleted = completedGroups.includes(groupIndex);
  const [checkedFiles, setCheckedFiles] = useState<{ [key: string]: boolean }>({});
  const [submitting, setSubmitting] = useState(false);
  // Use globalExpandState from parent instead of local state
  const groupExpanded = globalExpandState;

  // Track previous group files to detect group changes
  const prevGroupFilesRef = useRef<string>('');
  const prevInitialCheckedFilesRef = useRef<{ [key: string]: boolean } | undefined>(undefined);
  const userModifiedFilesRef = useRef<Set<string>>(new Set());
  const isInitialMountRef = useRef(true);
  // Track the value user set to prevent race conditions
  const lastUserActionRef = useRef<{ [filename: string]: boolean }>({});
  
  // EFFECT 1: Initialize state on mount and group change only (NOT on initialCheckedFiles change)
  // This prevents resetting state when user clicks checkbox
  useEffect(() => {
    const currentGroupFiles = group.files.join(',');
    const groupChanged = prevGroupFilesRef.current !== currentGroupFiles;
    
    // Reset user modifications when group changes (new group = fresh start)
    if (groupChanged) {
      userModifiedFilesRef.current.clear();
      lastUserActionRef.current = {};
      prevGroupFilesRef.current = currentGroupFiles;
    }
    
    // Initialize checked state from initialCheckedFiles or Context
    // Only sync on mount or group change - NOT on initialCheckedFiles prop changes
    const initChecked: { [key: string]: boolean } = {};
    
    group.files.forEach(filename => {
      // If user has manually modified this file, preserve their choice (unless group changed)
      if (userModifiedFilesRef.current.has(filename) && !groupChanged && !isInitialMountRef.current) {
        // Preserve user's choice - local state is source of truth
        initChecked[filename] = checkedFiles[filename] ?? fileStatusContext.getFileChecked(filename);
        return;
      }
      
      // On initial mount or group change, apply initialCheckedFiles if available
      if (initialCheckedFiles && filename in initialCheckedFiles) {
        initChecked[filename] = initialCheckedFiles[filename];
      } else {
        // Use Context to get checked state
        initChecked[filename] = fileStatusContext.getFileChecked(filename);
      }
    });
    
    // Always update on mount or group change
    setCheckedFiles(initChecked);
    isInitialMountRef.current = false;
    // Note: fileStatusContext is read-only here (fallback value), not a trigger
    // We don't want Effect 1 to run when Context changes - Effect 2 handles syncs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group.files.join(','), subject]); // Removed fileStatusContext - only mount/group change trigger
  
  // EFFECT 2: Handle external changes (auto-select or cross-group sync)
  // Per-file sync: Only sync files user hasn't modified in THIS group
  // This enables: User checks file X in Group A → all instances of X sync across groups
  useEffect(() => {
    // Skip on initial mount (handled by EFFECT 1)
    if (isInitialMountRef.current) {
      // Initialize prevInitialCheckedFilesRef on mount
      prevInitialCheckedFilesRef.current = initialCheckedFiles;
      return;
    }
    
    const prevInitial = prevInitialCheckedFilesRef.current;
    const currentInitial = initialCheckedFiles;
    
    // Check if initialCheckedFiles actually changed (value comparison, not reference)
    // Handle undefined cases properly
    const prevIsUndefined = prevInitial === undefined;
    const currentIsUndefined = currentInitial === undefined;
    
    let initialChanged = false;
    
    if (prevIsUndefined && currentIsUndefined) {
      // Both undefined - no change
      initialChanged = false;
    } else if (prevIsUndefined !== currentIsUndefined) {
      // One undefined, one not - changed
      initialChanged = true;
    } else if (prevInitial && currentInitial) {
      // Both defined - compare values
      const prevKeys = Object.keys(prevInitial);
      const currentKeys = Object.keys(currentInitial);
      
      // Check if keys changed
      if (prevKeys.length !== currentKeys.length) {
        initialChanged = true;
      } else {
        // Check if any file value changed
        initialChanged = currentKeys.some(f => (prevInitial[f] ?? false) !== (currentInitial[f] ?? false));
      }
    }
    
    // Always update ref to current value (even if no change detected)
    // This ensures we don't miss rapid successive changes
    prevInitialCheckedFilesRef.current = initialCheckedFiles;
    
    if (!initialChanged) {
      return;
    }
    
    // Update files that user hasn't modified in THIS group
    // This enables cross-group sync: if user modified file X in Group A,
    // Group B will sync file X because Group B's userModifiedFilesRef doesn't have X
    // Use functional update to ensure we work with latest state
    setCheckedFiles(prevChecked => {
      const updated: { [key: string]: boolean } = { ...prevChecked };
      let hasChanges = false;
      
      group.files.forEach(filename => {
        // Skip if user modified this file in THIS group
        if (userModifiedFilesRef.current.has(filename)) {
          // Double-check: if the new value matches what user just set, definitely preserve it
          const lastAction = lastUserActionRef.current[filename];
          if (lastAction !== undefined && initialCheckedFiles && filename in initialCheckedFiles) {
            const newValue = initialCheckedFiles[filename];
            if (newValue === lastAction) {
              // This change came from user's action - preserve it
              return;
            }
          }
          // User modified this file - preserve their choice
          return;
        }
        
        // User hasn't modified this file in THIS group - sync it
        // This enables:
        // 1. Auto-selection for untouched files
        // 2. Cross-group sync when user modifies file in another group
        if (initialCheckedFiles && filename in initialCheckedFiles) {
          const newValue = initialCheckedFiles[filename];
          // Use explicit boolean comparison to handle undefined cases
          const currentValue = prevChecked[filename] ?? false;
          const newValueBool = newValue ?? false;
          
          // Only sync if values are actually different
          if (newValueBool !== currentValue) {
            updated[filename] = newValueBool;
            hasChanges = true;
          }
        } else if (initialCheckedFiles === undefined && prevChecked[filename] !== undefined) {
          // If initialCheckedFiles becomes undefined, don't reset - preserve current state
          // This prevents reverting when prop temporarily becomes undefined
        }
      });
      
      // Only return new object if there are changes (prevents unnecessary re-renders)
      return hasChanges ? updated : prevChecked;
    });
    
    // Note: fileStatusContext is not used in this effect, so no need to react to it
    // All external syncs come through initialCheckedFiles prop changes
  }, [initialCheckedFiles, group.files.join(',')]);

  // Update Context and localStorage when toggling
  const handleToggle = (filename: string, checked: boolean) => {
    // Mark this file as user-modified to preserve user's choice
    userModifiedFilesRef.current.add(filename);
    // Track the value user just set (for race condition protection)
    lastUserActionRef.current[filename] = checked;
    
    // Update local state immediately (source of truth)
    setCheckedFiles(prev => ({ ...prev, [filename]: checked }));
    
    // Update Context
    fileStatusContext.setFileChecked(filename, checked);

    // Call external toggle handler to sync with parent
    // This updates autoSelections for ALL groups containing this filename
    // Effect 2 in other groups will sync it (because they don't have this file in their userModifiedFilesRef)
    // Effect 2 in THIS group will preserve it (because userModifiedFilesRef.has(filename) = true)
    if (onFileToggle) {
      onFileToggle(filename, checked);
    }
  };

  const handleSubmit = async () => {
    const checkedList = group.files.filter(f => checkedFiles[f]);
    const uncheckedList = group.files.filter(f => !checkedFiles[f]);

    setSubmitting(true);
    try {
      await api.submitGroup(subject, groupIndex, checkedList);
      
      // Mark group as completed
      storage.markGroupCompleted(subject, groupIndex);
      
      // Call parent callback (parent will show toast)
      onSubmit();
    } catch (error) {
      console.error('Failed to submit group:', error);
      alert('Error submitting group');
    } finally {
      setSubmitting(false);
    }
  };

  // Removed toggleAll and handleExpandToggle - now controlled by parent via globalExpandState
  // Individual cards can still toggle themselves, but we don't sync it back to parent
  const handleExpandToggle = (expanded: boolean) => {
    // Individual card toggles are allowed, but we don't update parent state
    // The global toggle at the top controls all groups
  };

  // Sort files by similarity score (highest first)
  // For pairwise groups (2 files), all files have the same similarity score
  // For connected components, we can use max_similarity or just keep original order
  const sortedFiles = [...group.files].sort((a, b) => {
    // If similarities array exists, use it (old format)
    if (group.similarities && group.similarities.length > 0) {
      const getMaxScore = (file: string) => {
        const scores = group.similarities!
          .filter(s => s.file1 === file || s.file2 === file)
          .map(s => s.score);
        return scores.length > 0 ? Math.max(...scores) : 0;
      };
      return getMaxScore(b) - getMaxScore(a);
    }
    
    // Otherwise, for pairwise groups, all files have the same similarity
    // Just keep original order (or sort alphabetically)
    return 0;
  });

  const checkedCount = Object.values(checkedFiles).filter(Boolean).length;
  const uncheckedCount = group.files.length - checkedCount;

  return (
    <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
      {/* Header */}
      <div className="mb-6">
        <div className="flex justify-between items-center mb-4">
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-bold">
              Group {groupIndex + 1} of {totalGroups}
            </h2>
            {isCompleted && (
              <span className="bg-green-500 text-white text-sm px-3 py-1 rounded-full">
                ✓ Completed
              </span>
            )}
            {/* Max Similarity - moved to top left */}
            <div className="text-sm text-gray-600">
              Max Similarity: <span className="font-semibold">{(group.max_similarity * 100).toFixed(1)}%</span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            {onGoToNextIncomplete && (
              <button
                onClick={onGoToNextIncomplete}
                className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-sm"
              >
                Go to Next Incomplete →
              </button>
            )}
            {/* Save/Remove counts - moved to top right */}
            <div className="text-sm text-gray-600">
              <span className="font-semibold text-green-600">{checkedCount} to save</span>
              {' / '}
              <span className="font-semibold text-red-600">{uncheckedCount} to remove</span>
            </div>
          </div>
        </div>
      </div>

      {/* MCQ Cards Grid */}
      {fileStatusContext.loadingStatuses || fileStatusContext.loadingMCQData ? (
        <div className="flex justify-center items-center py-12">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-gray-600">
              {fileStatusContext.loadingStatuses ? 'Loading file statuses...' : 'Loading MCQ data...'}
            </p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
          {sortedFiles.map(filename => {
            const fileStatus = fileStatusContext.getFileStatus(filename);
            // New badge logic (main cards):
            // - appearanceTotal: how many times this filename appears on the current page (main + KEPT)
            const appearanceTotal = fileAppearanceTotals[filename] || 0;
            
            return (
              <MCQCard
                key={filename}
                subject={subject}
                filename={filename}
                checked={checkedFiles[filename] ?? fileStatusContext.getFileChecked(filename)}
                status={fileStatus?.status || 'unknown'}
                onToggle={handleToggle}
                expanded={groupExpanded}
                onExpandToggle={handleExpandToggle}
                appearanceTotal={appearanceTotal}
                appearanceTotals={fileAppearanceTotals}
                mcqData={fileStatus?.mcqData}
                removalInfo={fileStatus?.removalInfo}
                keptFileData={fileStatus?.keptFileData}
                hasConflict={conflictingFiles.has(filename)}
              />
            );
          })}
        </div>
      )}

      {/* Navigation buttons - Hidden in Mode 3 (pairwise) */}
      {false && (
        <div className="flex justify-between items-center pt-4 border-t">
          <button
            onClick={onPrevious}
            disabled={!onPrevious}
            className="px-6 py-2 bg-gray-300 hover:bg-gray-400 disabled:bg-gray-200 disabled:cursor-not-allowed rounded-lg"
          >
            Previous
          </button>

          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="px-8 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-semibold rounded-lg"
          >
            {submitting ? 'Submitting...' : 'Submit Group'}
          </button>

          <button
            onClick={onNext}
            disabled={!onNext}
            className="px-6 py-2 bg-gray-300 hover:bg-gray-400 disabled:bg-gray-200 disabled:cursor-not-allowed rounded-lg"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
};

