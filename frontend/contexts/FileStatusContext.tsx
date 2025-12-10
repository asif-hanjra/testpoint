import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { api } from '../lib/api';
import { storage } from '../lib/storage';

// File status information
export interface FileStatus {
  status: 'saved' | 'removed' | 'unknown';
  checked: boolean;
  hasYear: boolean;
  fileNum: number;
  removalInfo?: any;
  mcqData?: any;
  keptFileData?: any;
}

// Context value interface
interface FileStatusContextValue {
  // File status store
  fileStatuses: { [filename: string]: FileStatus };
  
  // Loading states
  loadingStatuses: boolean;
  loadingMCQData: boolean;
  
  // Actions
  loadFileStatuses: (subject: string, filenames: string[]) => Promise<void>;
  loadMCQData: (subject: string, filenames: string[]) => Promise<void>;
  setFileStatus: (filename: string, status: Partial<FileStatus>) => void;
  setFileChecked: (filename: string, checked: boolean) => void;
  getFileStatus: (filename: string) => FileStatus | undefined;
  getFileChecked: (filename: string) => boolean;
  
  // Helper functions
  getFileIndicators: (filename: string) => {
    statusIcon: string;
    statusColor: string;
    pastPaperBadge: string | null;
    borderStyle: string;
    backgroundColor: string;
    checked: boolean;
  };
  determineCheckedState: (filename: string, checkAllMode: boolean) => boolean;
}

// Create context
const FileStatusContext = createContext<FileStatusContextValue | undefined>(undefined);

// Provider component
interface FileStatusProviderProps {
  children: ReactNode;
  subject: string;
}

export const FileStatusProvider: React.FC<FileStatusProviderProps> = ({ children, subject }) => {
  const [fileStatuses, setFileStatuses] = useState<{ [filename: string]: FileStatus }>({});
  const [loadingStatuses, setLoadingStatuses] = useState(false);
  const [loadingMCQData, setLoadingMCQData] = useState(false);

  // Load file statuses from backend (batch API call)
  const loadFileStatuses = useCallback(async (subjectName: string, filenames: string[]) => {
    if (filenames.length === 0) return;
    
    setLoadingStatuses(true);
    try {
      const response = await api.batchFileStatuses(subjectName, filenames);
      
      const newStatuses: { [filename: string]: FileStatus } = {};
      
      for (const [filename, data] of Object.entries(response.statuses)) {
        const fileData = data as any;
        const fileNum = parseInt(filename.replace(/\D/g, '')) || 999999;
        
        // Get checked state from localStorage (user preference)
        const session = storage.loadSession(subjectName);
        const cachedChecked = session?.checkedFiles?.[filename];
        
        newStatuses[filename] = {
          status: fileData.status === 'saved' ? 'saved' : 
                 fileData.status === 'removed' ? 'removed' : 'unknown',
          checked: cachedChecked !== undefined ? cachedChecked : 
                   fileData.status === 'saved' ? true : 
                   fileData.status === 'removed' ? false : false,
          hasYear: fileData.has_year || false,
          fileNum: fileNum,
          removalInfo: fileData.removal_info || undefined,
          keptFileData: fileData.kept_file_data || undefined
        };
      }
      
      setFileStatuses(prev => ({ ...prev, ...newStatuses }));
      
      // Save metadata to localStorage (for auto-selection)
      const mcqMetadata: { [filename: string]: { hasYear: boolean; fileNum: number } } = {};
      for (const [filename, status] of Object.entries(newStatuses)) {
        mcqMetadata[filename] = {
          hasYear: status.hasYear,
          fileNum: status.fileNum
        };
      }
      storage.updateMCQMetadata(subjectName, mcqMetadata);
      
    } catch (error) {
      console.error('Failed to load file statuses:', error);
    } finally {
      setLoadingStatuses(false);
    }
  }, []);

  // Load MCQ data from backend (batch API call)
  const loadMCQData = useCallback(async (subjectName: string, filenames: string[]) => {
    if (filenames.length === 0) return;
    
    setLoadingMCQData(true);
    try {
      const response = await api.batchMCQData(subjectName, filenames);
      
      setFileStatuses(prev => {
        const updated = { ...prev };
        for (const [filename, fileData] of Object.entries(response.mcq_data)) {
          const data = fileData as any;
          if (updated[filename]) {
            updated[filename] = {
              ...updated[filename],
              mcqData: data.data,
              removalInfo: data.removal_info || updated[filename].removalInfo,
              keptFileData: data.kept_file_data || updated[filename].keptFileData
            };
          }
        }
        return updated;
      });
    } catch (error) {
      console.error('Failed to load MCQ data:', error);
    } finally {
      setLoadingMCQData(false);
    }
  }, []);

  // Update file status
  const setFileStatus = useCallback((filename: string, status: Partial<FileStatus>) => {
    setFileStatuses(prev => ({
      ...prev,
      [filename]: {
        ...prev[filename],
        ...status
      } as FileStatus
    }));
  }, []);

  // Set file checked state
  const setFileChecked = useCallback((filename: string, checked: boolean) => {
    setFileStatuses(prev => {
      if (!prev[filename]) {
        return prev;
      }
      return {
        ...prev,
        [filename]: {
          ...prev[filename],
          checked
        }
      };
    });
    
    // Also update localStorage (user preference)
    storage.updateCheckedFiles(subject, filename, checked);
  }, [subject]);

  // Get file status
  const getFileStatus = useCallback((filename: string): FileStatus | undefined => {
    return fileStatuses[filename];
  }, [fileStatuses]);

  // Get file checked state
  const getFileChecked = useCallback((filename: string): boolean => {
    return fileStatuses[filename]?.checked ?? false;
  }, [fileStatuses]);

  // Get file indicators (icons, colors, badges)
  const getFileIndicators = useCallback((filename: string) => {
    const file = fileStatuses[filename];
    if (!file) {
      return {
        statusIcon: '○',
        statusColor: 'gray',
        pastPaperBadge: null,
        borderStyle: 'border-solid',
        backgroundColor: 'bg-orange-50',
        checked: false
      };
    }

    return {
      statusIcon: file.status === 'saved' ? '✓' : 
                  file.status === 'removed' ? '✗' : '○',
      statusColor: file.status === 'saved' ? 'green' : 
                   file.status === 'removed' ? 'red' : 'gray',
      pastPaperBadge: file.hasYear ? 'PP' : null,
      borderStyle: file.hasYear ? 'border-dotted' : 'border-solid',
      backgroundColor: file.hasYear ? 'bg-green-50' : 'bg-orange-50',
      checked: file.checked
    };
  }, [fileStatuses]);

  // Determine checked state based on rules
  const determineCheckedState = useCallback((filename: string, checkAllMode: boolean): boolean => {
    const file = fileStatuses[filename];
    if (!file) return false;

    // Rule 1: Saved files always checked
    if (file.status === 'saved') return true;
    
    // Rule 2: Removed files always unchecked
    if (file.status === 'removed') return false;
    
    // Rule 3: Check All Mode - check all unknown files
    if (checkAllMode) return true;
    
    // Rule 4: Use current checked state (from user preference or auto-selection)
    return file.checked;
  }, [fileStatuses]);

  const value: FileStatusContextValue = {
    fileStatuses,
    loadingStatuses,
    loadingMCQData,
    loadFileStatuses,
    loadMCQData,
    setFileStatus,
    setFileChecked,
    getFileStatus,
    getFileChecked,
    getFileIndicators,
    determineCheckedState
  };

  return (
    <FileStatusContext.Provider value={value}>
      {children}
    </FileStatusContext.Provider>
  );
};

// Hook to use context
export const useFileStatus = (): FileStatusContextValue => {
  const context = useContext(FileStatusContext);
  if (!context) {
    throw new Error('useFileStatus must be used within FileStatusProvider');
  }
  return context;
};

