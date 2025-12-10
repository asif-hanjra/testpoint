// Local storage utilities for session persistence

export interface SessionState {
  subject: string;
  currentGroupIndex: number;
  completedGroups: number[];
  checkedFiles: { [filename: string]: boolean };
  similarityLevelIndex?: number;
  similarityRangeStart?: number;
  similarityRangeEnd?: number;
  maxGroupsPerPage?: number; // Deprecated, kept for backward compatibility
  targetGroupsPerPage?: number; // Target groups per page (approximate, not strict)
  pageCompleted?: boolean;
  pageHistory?: Array<{ start: number; end: number }>;
  // OPTIMIZED: Add file statuses and removal history for faster access
  fileStatuses?: { [filename: string]: 'saved' | 'removed' | 'unknown' };
  removalHistory?: { [filename: string]: any };
  // OPTIMIZED: Store MCQ metadata (year info) for auto-selection
  mcqMetadata?: { [filename: string]: { hasYear: boolean; fileNum: number } };
  lastUpdated: number;
}

const STORAGE_KEY = 'mcq_deduplication_session';

export const storage = {
  // Save session state
  saveSession: (state: SessionState) => {
    try {
      const data = {
        ...state,
        lastUpdated: Date.now()
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      return true;
    } catch (error) {
      console.error('Failed to save session:', error);
      return false;
    }
  },

  // Load session state
  loadSession: (subject: string): SessionState | null => {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      if (!data) return null;

      const session = JSON.parse(data) as SessionState;
      
      // Return only if it's for the same subject
      if (session.subject === subject) {
        return session;
      }
      return null;
    } catch (error) {
      console.error('Failed to load session:', error);
      return null;
    }
  },

  // Clear session
  clearSession: (subject?: string) => {
    try {
      if (subject) {
        // Clear session for specific subject
        const data = localStorage.getItem(STORAGE_KEY);
        if (data) {
          const session = JSON.parse(data) as SessionState;
          if (session.subject === subject) {
            localStorage.removeItem(STORAGE_KEY);
          }
        }
      } else {
        // Clear all sessions
        localStorage.removeItem(STORAGE_KEY);
      }
      return true;
    } catch (error) {
      console.error('Failed to clear session:', error);
      return false;
    }
  },

  // Update checked files
  updateCheckedFiles: (subject: string, filename: string, checked: boolean) => {
    const session = storage.loadSession(subject);
    if (session) {
      session.checkedFiles[filename] = checked;
      storage.saveSession(session);
    }
  },

  // Mark group as completed
  markGroupCompleted: (subject: string, groupIndex: number) => {
    const session = storage.loadSession(subject);
    if (session) {
      if (!session.completedGroups.includes(groupIndex)) {
        session.completedGroups.push(groupIndex);
      }
      session.currentGroupIndex = groupIndex + 1;
      storage.saveSession(session);
    }
  },

  // OPTIMIZED: Update file statuses (batch update)
  updateFileStatuses: (subject: string, statuses: { [filename: string]: 'saved' | 'removed' | 'unknown' }) => {
    let session = storage.loadSession(subject);
    
    // CREATE session if it doesn't exist
    if (!session) {
      session = {
        subject,
        currentGroupIndex: 0,
        completedGroups: [],
        checkedFiles: {},
        fileStatuses: {},
        lastUpdated: Date.now()
      };
    }
    
    session.fileStatuses = { ...session.fileStatuses, ...statuses };
    storage.saveSession(session);
  },

  // OPTIMIZED: Update removal history
  updateRemovalHistory: (subject: string, history: { [filename: string]: any }) => {
    let session = storage.loadSession(subject);
    
    // CREATE session if it doesn't exist
    if (!session) {
      session = {
        subject,
        currentGroupIndex: 0,
        completedGroups: [],
        checkedFiles: {},
        removalHistory: {},
        lastUpdated: Date.now()
      };
    }
    
    session.removalHistory = { ...session.removalHistory, ...history };
    storage.saveSession(session);
  },

  // OPTIMIZED: Get file status from localStorage (instant access)
  getFileStatus: (subject: string, filename: string): 'saved' | 'removed' | 'unknown' => {
    const session = storage.loadSession(subject);
    return session?.fileStatuses?.[filename] || 'unknown';
  },

  // OPTIMIZED: Update MCQ metadata (year info, file number)
  updateMCQMetadata: (subject: string, metadata: { [filename: string]: { hasYear: boolean; fileNum: number } }) => {
    let session = storage.loadSession(subject);
    
    // CREATE session if it doesn't exist (FIX: was losing metadata on first load)
    if (!session) {
      session = {
        subject,
        currentGroupIndex: 0,
        completedGroups: [],
        checkedFiles: {},
        mcqMetadata: {},
        lastUpdated: Date.now()
      };
    }
    
    session.mcqMetadata = { ...session.mcqMetadata, ...metadata };
    storage.saveSession(session);
  }
};

