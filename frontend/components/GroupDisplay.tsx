import React, { useState, useEffect } from 'react';
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

  useEffect(() => {
    // Initialize checked state from Context or initialCheckedFiles
    const initChecked: { [key: string]: boolean } = {};
    
    group.files.forEach(filename => {
      if (initialCheckedFiles && filename in initialCheckedFiles) {
        // Page-level selection (from autoSelections / user toggles) wins
        initChecked[filename] = initialCheckedFiles[filename];
      } else {
        // Use Context to get checked state
        initChecked[filename] = fileStatusContext.getFileChecked(filename);
      }
    });
    
    setCheckedFiles(initChecked);
  }, [group, subject, initialCheckedFiles, fileStatusContext]);

  // Update Context and localStorage when toggling
  const handleToggle = (filename: string, checked: boolean) => {
    setCheckedFiles(prev => ({ ...prev, [filename]: checked }));
    fileStatusContext.setFileChecked(filename, checked);

    // Call external toggle handler if provided
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

