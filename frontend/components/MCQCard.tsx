import React, { useState, useEffect, useRef } from 'react';
import { api } from '../lib/api';
import { storage } from '../lib/storage';
import { KeptMCQCard } from './KeptMCQCard';
import { useFileStatus } from '../contexts/FileStatusContext';

interface MCQCardProps {
  subject: string;
  filename: string;
  checked: boolean;
  status: 'saved' | 'removed' | 'unknown';
  onToggle: (filename: string, checked: boolean) => void;
  expanded?: boolean;
  onExpandToggle?: (expanded: boolean) => void;
  mcqData?: any;  // OPTIMIZED: Optional prop to avoid API call if data provided
  removalInfo?: any;  // OPTIMIZED: Optional removal info
  keptFileData?: any;  // OPTIMIZED: Optional kept file data
  hasConflict?: boolean;  // File has conflicting checked states across groups
  appearanceTotal?: number;  // n: total appearances of this filename on page (main + KEPT)
  appearanceTotals?: { [filename: string]: number }; // n for KEPT cards
}

export const MCQCard: React.FC<MCQCardProps> = ({ 
  subject, 
  filename, 
  checked, 
  status,
  onToggle,
  expanded: externalExpanded,
  onExpandToggle,
  mcqData: providedMcqData,
  removalInfo: providedRemovalInfo,
  keptFileData: providedKeptFileData,
  hasConflict = false,
  appearanceTotal,
  appearanceTotals
}) => {
  const [internalExpanded, setInternalExpanded] = useState(false);
  const expanded = externalExpanded !== undefined ? externalExpanded : internalExpanded;
  const [mcqData, setMcqData] = useState<any>(providedMcqData || null);
  const [loading, setLoading] = useState(false);
  const [removalInfo, setRemovalInfo] = useState<any>(providedRemovalInfo || null);
  const fileStatusContext = useFileStatus();
  const [keptMCQData, setKeptMCQData] = useState<any>(null);
  const [showKeptMCQ, setShowKeptMCQ] = useState(false);
  const [removedAgainstThis, setRemovedAgainstThis] = useState<string | null>(null); // File that was removed when this file was kept
  const hasReceivedPropsRef = useRef(false); // Track if we've received props from parent

  // Update state when props change (from batch loading)
  useEffect(() => {
    if (providedMcqData) {
      setMcqData(providedMcqData);
      setLoading(false); // Stop loading if data provided
      hasReceivedPropsRef.current = true; // Mark that parent provided data
    }
    if (providedRemovalInfo) {
      setRemovalInfo(providedRemovalInfo);
    }
    // Set keptMCQData if provided (for both removed and saved files)
    if (providedKeptFileData) {
      setKeptMCQData(providedKeptFileData);
    }
  }, [providedMcqData, providedRemovalInfo, providedKeptFileData]);
  
  // Find which file was removed against this saved file
  // Search removal_history for entries where this file is in kept_files
  useEffect(() => {
    if (status === 'saved') {
      const session = storage.loadSession(subject);
      const removalHistory = session?.removalHistory || {};
      
      // Find the removed file that has this file in its kept_files
      for (const [removedFilename, history] of Object.entries(removalHistory)) {
        const keptFiles = (history as any)?.kept_files || [];
        if (keptFiles.includes(filename)) {
          setRemovedAgainstThis(removedFilename);
          break; // Found it, no need to continue
        }
      }
    } else {
      // Clear if status is not saved
      setRemovedAgainstThis(null);
    }
  }, [subject, filename, status]);

  // OPTIMIZED: Only load if data not provided by parent (batch loading)
  // Parent component (GroupDisplay) should provide data via batch loading
  // This is a fallback ONLY if parent doesn't provide data
  useEffect(() => {
    // If parent provides data (even if null), batch load completed - don't make API call
    // null means batch load completed but file not found (handled in render)
    // undefined means batch load hasn't completed yet (wait)
    if (providedMcqData !== undefined) {
      return; // Parent handled it via batch loading
    }
    
    // Only make API call if parent hasn't provided data yet (undefined)
    // AND we don't already have data loaded
    if (!mcqData && !loading) {
      // Small delay to allow batch loading to complete (if parent is batch loading)
      const timer = setTimeout(() => {
        // Double-check that parent still didn't provide data
        // If providedMcqData is still undefined after delay, parent isn't batch loading
        if (providedMcqData === undefined && !mcqData && !loading) {
          loadMCQData();
        }
      }, 300); // Wait 300ms for batch load to complete
      
      return () => clearTimeout(timer);
    }
  }, [subject, filename]); // Intentionally NOT including providedMcqData to avoid race conditions

  const loadMCQData = async () => {
    setLoading(true);
    try {
      // OPTIMIZED: Only load MCQ content (statement, options, etc.)
      // Status is already passed as prop from localStorage
      const response = await api.getMCQData(subject, filename);
      setMcqData(response.data);
      
      // OPTIMIZED: Get removal history from API response (includes kept_file_data)
      const removalInfo = response.removal_info;
      
      if (removalInfo) {
        setRemovalInfo(removalInfo);
        
        // OPTIMIZED: Use kept_file_data from API response (no second API call needed)
        if (response.kept_file_data && removalInfo.kept_files && removalInfo.kept_files.length > 0) {
          setKeptMCQData({
            filename: removalInfo.kept_files[0],
            data: response.kept_file_data
          });
        }
      }
    } catch (error) {
      console.error('Failed to load MCQ data:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading || !mcqData) {
    return (
      <div className="border rounded-lg p-4 bg-gray-100">
        <div className="animate-pulse">Loading...</div>
      </div>
    );
  }

  const mcq = mcqData.mcq?.[0] || {};
  const statement = mcq.statement || mcqData.statement || '';
  const options = mcq.options || {};
  const correctOption = mcq.correct_option || '';
  const oneLiner = mcq.one_liner || '';
  
  // Use Context to get file indicators (simplified)
  const indicators = fileStatusContext.getFileIndicators(filename);
  const bgColor = indicators.backgroundColor;
  const borderColor = indicators.statusColor === 'green' ? 'border-green-300' : 
                      indicators.statusColor === 'red' ? 'border-red-300' : 'border-orange-300';
  const borderStyle = indicators.borderStyle;

  // Handler for toggling checkbox when clicking anywhere on card
  const handleCardClick = () => {
    // Toggle checkbox when clicking anywhere on the card
    onToggle(filename, !checked);
  };

  // Handler for expanding/collapsing card (separate from checkbox toggle)
  const handleExpandClick = () => {
    const newExpanded = !expanded;
    if (onExpandToggle) {
      onExpandToggle(newExpanded);
    } else {
      setInternalExpanded(newExpanded);
    }
  };

  // Main MCQ card content
  const mainCard = (
    <div 
      className={`border-2 ${borderColor} ${borderStyle} rounded-lg p-4 ${bgColor} shadow-sm relative cursor-pointer`}
      data-conflict={hasConflict ? 'true' : 'false'}
      onClick={handleCardClick}
    >
      {/* PP badge: shows if MCQ has "year" key */}
      {indicators.pastPaperBadge && (
        <div className="absolute -top-3 -left-3 bg-blue-500 text-white rounded-full w-8 h-8 flex items-center justify-center text-xs font-bold shadow-lg border-2 border-white z-10">
          {indicators.pastPaperBadge}
        </div>
      )}
      
      {/* Count badge (main card): nx = total appearances of this filename on current page */}
      {appearanceTotal && appearanceTotal > 1 && (
        <div className="absolute -top-3 -right-3 bg-red-500 text-white rounded-full w-8 h-8 flex items-center justify-center text-xs font-bold shadow-lg border-2 border-white z-10">
          {appearanceTotal}x
        </div>
      )}
      
      {/* Filename box at top center with status indicator */}
      <div className="flex justify-center mb-3">
        <div className="bg-white border-2 border-gray-400 rounded-lg px-4 py-2 shadow-md flex items-center gap-2">
          {/* Status indicator (tick/cross/no mark) */}
          <span className={`text-${indicators.statusColor}-600 font-bold text-lg`}>
            {indicators.statusIcon}
          </span>
          {/* Filename - highlighted */}
          <span className="text-gray-800 font-bold text-base">{filename}</span>
        </div>
      </div>
      
      {/* Header with checkbox and status */}
      <div className="flex items-start gap-3 mb-3">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => onToggle(filename, e.target.checked)}
            onClick={(e) => e.stopPropagation()} // Prevent card click when clicking checkbox
            className="mt-1 w-5 h-5 cursor-pointer"
          />
        <div className="flex-1">
          {/* Show which file was removed against this saved file */}
          {status === 'saved' && removedAgainstThis && (
            <div className="mb-2 p-2 bg-green-100 border border-green-300 rounded text-xs">
              <div className="flex items-center gap-2">
                <span className="text-green-700 font-bold">✓ SAVED</span>
                <span className="text-gray-600">when</span>
                <span className="text-red-600 font-semibold">{removedAgainstThis}</span>
                <span className="text-gray-600">was removed</span>
              </div>
            </div>
          )}
          
          {/* Show minimal message for saved files without removal context */}
          {status === 'saved' && !removedAgainstThis && (
            <div className="mb-2 p-2 bg-green-100 border border-green-300 rounded text-xs">
              <span className="text-green-700 font-bold">✓ SAVED</span>
            </div>
          )}
          
          {/* Statement */}
          <div className="text-gray-800 font-medium">
            {statement}
          </div>
        </div>

        {/* Expand/collapse button */}
        <button
          onClick={(e) => {
            e.stopPropagation(); // Prevent card click (checkbox toggle) when clicking button
            handleExpandClick();
          }}
          className="text-blue-600 hover:text-blue-800 font-bold text-xl"
        >
          {expanded ? '−' : '+'}
        </button>
      </div>

      {/* Expandable content */}
      {expanded && (
        <div className="mt-4 pt-4 border-t border-gray-300 space-y-3">
          {/* Options */}
          {Object.keys(options).length > 0 && (
            <div>
              <h4 className="font-semibold mb-2">Options:</h4>
              <div className="space-y-1">
                {Object.entries(options).map(([key, value]) => (
                  <div 
                    key={key} 
                    className={correctOption === key ? 'font-bold text-green-700' : 'text-gray-700'}
                  >
                    {key}) {value as string}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Year if exists */}
          {indicators.pastPaperBadge && (
            <div className="text-xs text-gray-600">
              Year: {mcqData.year || mcq?.year}
            </div>
          )}

          {/* Show previously removed MCQ option (for saved files with removal history) */}
          {status === 'saved' && removalInfo && removalInfo.kept_files && removalInfo.kept_files.length > 0 && (
            <div className="mt-4 pt-4 border-t border-gray-300">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowKeptMCQ(!showKeptMCQ);
                }}
                className="text-sm text-blue-600 hover:text-blue-800 font-semibold underline"
              >
                {showKeptMCQ ? 'Hide' : 'View'} previously removed MCQ
              </button>
              {showKeptMCQ && keptMCQData && removalInfo?.kept_files?.length > 0 && (
                <div className="mt-3" key={`kept-view-${filename}-${removalInfo.kept_files[0]}`}>
                  <KeptMCQCard
                    key={`kept-card-view-${filename}-${removalInfo.kept_files[0]}`}
                    subject={subject}
                    filename={removalInfo.kept_files[0]}
                    removedFilename={filename}
                    expanded={false}
                    mcqData={keptMCQData.data || keptMCQData}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );

  // If file is removed and has kept file, show both cards side by side (span 2 columns in grid)
  // This is the old behavior for removed files
  if (status === 'removed' && removalInfo && keptMCQData && removalInfo.kept_files?.length > 0) {
    // Handle both formats: {filename, data} from API or just data from props
    const keptData = keptMCQData.data || keptMCQData;
    const keptFilename = keptMCQData.filename || removalInfo.kept_files[0];
    
    // Badge values for KEPT card: nx based on global page appearance data
    const totalsMap = appearanceTotals || {};
    const keptTotal = totalsMap[keptFilename] || 0;
    
    // Get status of kept file from Context
    const keptFileStatusObj = fileStatusContext.getFileStatus(keptFilename);
    const keptFileStatus = keptFileStatusObj?.status || 'saved';
    const keptFileChecked = fileStatusContext.getFileChecked(keptFilename);
    
    // Create a separate toggle handler for kept files.
    // This updates localStorage and also delegates to the main onToggle handler
    // so that ALL appearances of this filename on the current page stay in sync.
    const handleKeptFileToggle = (toggleFilename: string, checked: boolean) => {
      // CRITICAL: Verify we're updating the correct kept file (defensive check)
      if (toggleFilename !== keptFilename) {
        // This should never happen, but return silently if it does
        return;
      }
      
      // Update Context
      fileStatusContext.setFileChecked(keptFilename, checked);
      
      // Also notify parent toggle handler so all instances of this filename
      // on the current page get the same checked state.
      if (onToggle) {
        onToggle(keptFilename, checked);
      }
    };
    
    return (
      <div className="col-span-2 grid grid-cols-2 gap-4">
        {/* Removed MCQ Card - Left Side */}
        <div>
          {mainCard}
        </div>
        
        {/* Kept MCQ Card - Right Side */}
        <div key={`kept-${filename}-${keptFilename}`}>
          <KeptMCQCard
            key={`kept-card-${filename}-${keptFilename}`}
            subject={subject}
            filename={keptFilename}
            removedFilename={filename}
            expanded={expanded}
            onExpandToggle={onExpandToggle}
            mcqData={keptData}
            checked={keptFileChecked}
            onToggle={handleKeptFileToggle}
            status={keptFileStatus}
            appearanceTotal={keptTotal}
          />
        </div>
      </div>
    );
  }

  // Otherwise, just show the main card
  return mainCard;
};

