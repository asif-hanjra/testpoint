import React, { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { storage } from '../lib/storage';

interface KeptMCQCardProps {
  subject: string;
  filename: string;
  removedFilename: string;
  expanded?: boolean;
  onExpandToggle?: (expanded: boolean) => void;
  mcqData?: any;  // OPTIMIZED: Optional prop to avoid API call if data provided
  checked?: boolean;  // Whether this kept file is currently checked (saved)
  onToggle?: (filename: string, checked: boolean) => void;  // Toggle handler to move file between saved/removed
  status?: 'saved' | 'removed' | 'unknown';  // Current status of the kept file
   appearanceTotal?: number;  // n: total appearances of this filename on page (main + KEPT)
}

export const KeptMCQCard: React.FC<KeptMCQCardProps> = ({ 
  subject, 
  filename,
  removedFilename,
  expanded: externalExpanded,
  onExpandToggle,
  mcqData: providedMcqData,  // OPTIMIZED: Use provided data if available
  checked: initialChecked = true,  // Default to checked (saved) since it's a kept file
  onToggle,
  status: initialStatus = 'saved',  // Default to saved since it's a kept file
  appearanceTotal
}) => {
  const [internalExpanded, setInternalExpanded] = useState(false);
  const expanded = externalExpanded !== undefined ? externalExpanded : internalExpanded;
  const [mcqData, setMcqData] = useState<any>(providedMcqData || null);
  const [loading, setLoading] = useState(false);
  
  // Get current checked state from localStorage (not local state)
  // This ensures the checkbox reflects the pending change, not the actual file status
  // Kept files should always default to checked (true) if not explicitly set
  const getCurrentCheckedState = () => {
    const session = storage.loadSession(subject);
    const cachedCheckedFiles = session?.checkedFiles || {};
    // CRITICAL: Only read the value for THIS specific filename
    // If there's a pending change in localStorage, use that; otherwise default to true (checked)
    return cachedCheckedFiles[filename] !== undefined 
      ? cachedCheckedFiles[filename] 
      : true;  // Default to checked for kept files
  };
  
  // Get current status from localStorage (actual file status, not pending)
  const getCurrentStatus = () => {
    const session = storage.loadSession(subject);
    const cachedStatuses = session?.fileStatuses || {};
    // Use actual file status, not pending changes
    return (cachedStatuses[filename] === 'removed' ? 'removed' : 
            cachedStatuses[filename] === 'saved' ? 'saved' : 
            initialStatus) as 'saved' | 'removed' | 'unknown';
  };
  
  const [checkedState, setCheckedState] = useState(() => getCurrentCheckedState());
  const [statusState, setStatusState] = useState(() => getCurrentStatus());
  
  // Update state when localStorage changes (for checkbox responsiveness)
  // NOTE: We use polling because localStorage changes in the same window don't trigger 'storage' events
  useEffect(() => {
    // CRITICAL: Capture filename in closure to ensure we're always checking the right file
    const currentFilename = filename;
    
    let lastCheckedValue = getCurrentCheckedState();
    let lastStatusValue = getCurrentStatus();
    
    const updateState = () => {
      // CRITICAL: Re-read from localStorage using the captured filename
      // This ensures each component instance only reads its own value
      const session = storage.loadSession(subject);
      const cachedCheckedFiles = session?.checkedFiles || {};
      const cachedStatuses = session?.fileStatuses || {};
      
      const newChecked = cachedCheckedFiles[currentFilename] !== undefined 
        ? cachedCheckedFiles[currentFilename] 
        : true;
      
      const newStatus = (cachedStatuses[currentFilename] === 'removed' ? 'removed' : 
                        cachedStatuses[currentFilename] === 'saved' ? 'saved' : 
                        initialStatus) as 'saved' | 'removed' | 'unknown';
      
      // Only update if the value actually changed for THIS specific filename
      // This prevents unnecessary re-renders and ensures each component only responds to its own changes
      if (lastCheckedValue !== newChecked) {
        setCheckedState(newChecked);
        lastCheckedValue = newChecked;
      }
      
      if (lastStatusValue !== newStatus) {
        setStatusState(newStatus);
        lastStatusValue = newStatus;
      }
    };
    
    // Update immediately
    updateState();
    
    // Also listen for storage events (if another tab/window changes it)
    window.addEventListener('storage', updateState);
    
    // Poll localStorage periodically to catch changes from same window
    // Use a longer interval to avoid performance issues
    const interval = setInterval(updateState, 200);
    
    return () => {
      window.removeEventListener('storage', updateState);
      clearInterval(interval);
    };
  }, [subject, filename, initialStatus]); // Include filename to recreate effect when it changes
  
  const checked = checkedState;
  const status = statusState;

  useEffect(() => {
    // OPTIMIZED: Only load if data not provided
    if (!providedMcqData) {
      loadMCQData();
    }
  }, [subject, filename, providedMcqData]);

  // Update mcqData when providedMcqData changes
  useEffect(() => {
    if (providedMcqData) {
      setMcqData(providedMcqData);
    }
  }, [providedMcqData]);

  const loadMCQData = async () => {
    setLoading(true);
    try {
      const response = await api.getMCQData(subject, filename);
      setMcqData(response.data);
    } catch (error) {
      console.error('Failed to load kept MCQ data:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading || !mcqData) {
    return (
      <div className="border-2 border-purple-300 border-dashed rounded-lg p-4 bg-purple-50 shadow-sm">
        <div className="animate-pulse">Loading kept file...</div>
      </div>
    );
  }

  const mcq = mcqData.mcq?.[0] || {};
  const statement = mcq.statement || mcqData.statement || '';
  const options = mcq.options || {};
  const correctOption = mcq.correct_option || '';
  const oneLiner = mcq.one_liner || '';
  // Check for year key at both top level and inside mcq array
  const hasYear = ('year' in mcqData && mcqData.year != null) || (mcq && 'year' in mcq && mcq.year != null);

  const bgColor = hasYear ? 'bg-green-50' : 'bg-orange-50';
  const borderColor = hasYear ? 'border-green-300' : 'border-orange-300';
  const borderStyle = hasYear ? 'border-dashed' : 'border-solid';

  // Handler for expanding/collapsing card
  const handleCardClick = () => {
    const newExpanded = !expanded;
    if (onExpandToggle) {
      onExpandToggle(newExpanded);
    } else {
      setInternalExpanded(newExpanded);
    }
  };

  return (
    <div 
      className={`border-2 ${borderColor} ${borderStyle} rounded-lg p-4 ${bgColor} shadow-sm relative cursor-pointer`}
      onClick={handleCardClick}
    >
      {/* PP badge: shows if MCQ has "year" key */}
      {hasYear && (
        <div className="absolute -top-3 -left-3 bg-blue-500 text-white rounded-full w-8 h-8 flex items-center justify-center text-xs font-bold shadow-lg border-2 border-white z-10">
          PP
        </div>
      )}
      
      {/* Count badge (KEPT card): nx = total appearances of this filename on current page */}
      {appearanceTotal && appearanceTotal > 1 && (
        <div className="absolute -top-3 -right-3 bg-red-500 text-white rounded-full w-8 h-8 flex items-center justify-center text-xs font-bold shadow-lg border-2 border-white z-10">
          {appearanceTotal}x
        </div>
      )}
      
      {/* Filename box at top center with status indicator */}
      <div className="flex justify-center mb-3">
        <div className="bg-white border-2 border-purple-400 rounded-lg px-4 py-2 shadow-md flex items-center gap-2">
          {/* Status indicator (tick/cross/no mark) */}
          {statusState === 'saved' && (
            <span className="text-green-600 font-bold text-lg">✓</span>
          )}
          {statusState === 'removed' && (
            <span className="text-red-600 font-bold text-lg">✗</span>
          )}
          {statusState === 'unknown' && (
            <span className="text-gray-400 font-bold text-lg">○</span>
          )}
          {/* Filename - highlighted */}
          <span className="text-gray-800 font-bold text-base">{filename}</span>
        </div>
      </div>
      
      {/* Header with label */}
      <div className="flex items-start gap-3 mb-3">
        {/* Checkbox to toggle kept file between saved/removed */}
        {onToggle && (
          <input
            type="checkbox"
            checked={checkedState}
            onChange={(e) => {
              e.stopPropagation(); // Prevent card click when clicking checkbox
              const newChecked = e.target.checked;
              
              // CRITICAL: Capture filename in closure to ensure we update the correct file
              const currentFilename = filename;
              
              // Update local state immediately for UI responsiveness
              setCheckedState(newChecked);
              
              // CRITICAL: Update localStorage directly here using the captured filename
              // This ensures each KeptMCQCard instance updates only its own file
              storage.updateCheckedFiles(subject, currentFilename, newChecked);
              
              // Call onToggle if provided (this is handleKeptFileToggle from MCQCard)
              // handleKeptFileToggle will only update localStorage, not parent state
              if (onToggle) {
                // Ensure we're passing the correct filename (this component's filename, not removedFilename)
                onToggle(currentFilename, newChecked);
              }
            }}
            className="mt-1 w-5 h-5 cursor-pointer"
            title={checkedState ? "Uncheck to move this file to removed folder" : "Check to move this file back to saved folder"}
          />
        )}
        <div className="flex-1">
          {/* Label indicating this was kept */}
          <div className="mb-2 p-2 bg-purple-100 border border-purple-300 rounded text-xs">
            <div className="flex items-center gap-2">
              <span className="text-purple-700 font-bold">✓ KEPT</span>
              <span className="text-gray-600">when</span>
              <span className="text-red-600 font-semibold">{removedFilename}</span>
              <span className="text-gray-600">was removed</span>
            </div>
          </div>
          
          {/* Statement */}
          <div className="text-gray-800 font-medium">
            {statement}
          </div>
        </div>

        {/* Expand/collapse button */}
        <button
          onClick={(e) => {
            e.stopPropagation(); // Prevent card click when clicking button
            handleCardClick();
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
          {hasYear && (
            <div className="text-xs text-gray-600">
              Year: {mcqData.year}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

