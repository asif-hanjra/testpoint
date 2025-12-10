import axios from 'axios';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export const api = {
  // Get subjects
  getSubjects: async () => {
    const response = await axios.get(`${API_BASE_URL}/api/subjects`);
    return response.data;
  },

  // Process subject with SBERT
  processSubject: async (subject: string) => {
    try {
      const response = await axios.post(`${API_BASE_URL}/api/process/${subject}`, {}, {
        timeout: 1800000 // 30 minutes timeout for long processing
      });
      return response.data;
    } catch (error: any) {
      if (error.response) {
        throw new Error(error.response.data?.detail || error.response.data?.message || 'Processing failed');
      } else if (error.request) {
        throw new Error('Backend server is not responding. Please make sure the backend is running.');
      } else {
        throw error;
      }
    }
  },

  // Save all files
  saveAllFiles: async (subject: string) => {
    const response = await axios.post(`${API_BASE_URL}/api/save-all`, { subject });
    return response.data;
  },

  // Get groups
  getGroups: async (subject: string) => {
    const response = await axios.get(`${API_BASE_URL}/api/groups/${subject}`);
    return response.data;
  },

  // Toggle MCQ
  toggleMCQ: async (subject: string, filename: string, checked: boolean) => {
    const response = await axios.post(`${API_BASE_URL}/api/toggle-mcq`, {
      subject,
      filename,
      checked
    });
    return response.data;
  },

  // Submit group
  submitGroup: async (subject: string, groupIndex: number, checkedFiles: string[]) => {
    const response = await axios.post(`${API_BASE_URL}/api/submit-group`, {
      subject,
      group_index: groupIndex,
      checked_files: checkedFiles
    });
    return response.data;
  },

  // Get MCQ data
  getMCQData: async (subject: string, filename: string) => {
    const response = await axios.get(`${API_BASE_URL}/api/mcq/${subject}/${filename}`);
    return response.data;
  },

  // OPTIMIZED: Batch file statuses (single API call for multiple files)
  batchFileStatuses: async (subject: string, filenames: string[]) => {
    const response = await axios.post(`${API_BASE_URL}/api/batch-file-statuses`, {
      subject,
      filenames
    });
    return response.data;
  },

  // OPTIMIZED: Batch MCQ data (single API call for multiple files)
  batchMCQData: async (subject: string, filenames: string[]) => {
    const response = await axios.post(`${API_BASE_URL}/api/batch-mcq-data`, {
      subject,
      filenames
    });
    return response.data;
  },

  // Get summary
  getSummary: async (subject: string) => {
    const response = await axios.get(`${API_BASE_URL}/api/summary/${subject}`);
    return response.data;
  },

  // Stop processing
  stopProcessing: async (subject: string) => {
    const response = await axios.post(`${API_BASE_URL}/api/stop/${subject}`);
    return response.data;
  },

  // Check session
  checkSession: async (subject: string) => {
    const response = await axios.get(`${API_BASE_URL}/api/session/${subject}`);
    return response.data;
  },

  // Auto-select best MCQ
  autoSelectBest: async (subject: string, files: string[]) => {
    const response = await axios.post(`${API_BASE_URL}/api/auto-select-best`, {
      subject,
      files
    });
    return response.data;
  },

  // Clear session
  clearSession: async (subject: string) => {
    const response = await axios.delete(`${API_BASE_URL}/api/session/${subject}`);
    return response.data;
  },

  // Track removed files
  trackRemoved: async (subject: string) => {
    const response = await axios.post(`${API_BASE_URL}/api/track-removed/${subject}`);
    return response.data;
  },

  // Prepare and process with SBERT (resume mode)
  prepareAndProcess: async (subject: string) => {
    const response = await axios.post(`${API_BASE_URL}/api/prepare-and-process/${subject}?resume_sbert=true`, {}, {
      timeout: 1800000 // 30 minutes timeout for long processing
    });
    return response.data;
  },

  // Get preparation statistics
  getPreparationStats: async (subject: string) => {
    const response = await axios.get(`${API_BASE_URL}/api/preparation-stats/${subject}`);
    return response.data;
  }
};


