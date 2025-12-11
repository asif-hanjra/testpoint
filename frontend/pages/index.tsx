import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { api } from '../lib/api';
import { storage } from '../lib/storage';

interface Subject {
  name: string;
  enabled: boolean;
  file_count: number;
}

export default function Home() {
  const router = useRouter();
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [subjectSessions, setSubjectSessions] = useState<{ [key: string]: boolean }>({});
  const [subjectRemovedTrack, setSubjectRemovedTrack] = useState<{ [key: string]: boolean }>({});
  const [selectedSubject, setSelectedSubject] = useState<string | null>(null);
  const [confirmationAction, setConfirmationAction] = useState<'resume' | 'start_again' | 'resume_sbert' | null>(null);
  const [processing, setProcessing] = useState(false);
  const [preparationStats, setPreparationStats] = useState<{total_files: number, removed_files: number, files_to_process: number} | null>(null);
  const [sbertResult, setSbertResult] = useState<{
    non_duplicates: number;
    total_files: number;
    similar_count?: number;
    group_count?: number;
    similarity_bins?: { range: string; count: number }[];
  } | null>(null);

  useEffect(() => {
    loadSubjects();
  }, []);

  const loadSubjects = async () => {
    try {
      setLoading(true);
      const data = await api.getSubjects();
      setSubjects(data.subjects || []);
      
      // Check which subjects have existing sessions or removed-track JSON
      const sessions: { [key: string]: boolean } = {};
      const removedTrack: { [key: string]: boolean } = {};
      for (const subject of data.subjects || []) {
        if (subject.enabled) {
          try {
            const sessionCheck = await api.checkSession(subject.name);
            sessions[subject.name] = sessionCheck.exists || false;
            removedTrack[subject.name] = sessionCheck.has_removed_track || false;
          } catch {
            sessions[subject.name] = false;
            removedTrack[subject.name] = false;
          }
        }
      }
      setSubjectSessions(sessions);
      setSubjectRemovedTrack(removedTrack);
      setError('');
    } catch (err) {
      console.error('Failed to load subjects:', err);
      setError('Failed to load subjects. Make sure the backend is running.');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectSubject = (subject: Subject) => {
    if (!subject.enabled) return;
    
    // Check if session exists OR removed-track JSON exists
    if (subjectSessions[subject.name] || subjectRemovedTrack[subject.name]) {
      // Show resume/start again dialog
      setSelectedSubject(subject.name);
    } else {
      // No session and no removed-track, go directly
      router.push(`/process/${subject.name}`);
    }
  };

  const handleResume = () => {
    if (selectedSubject) {
      setConfirmationAction('resume');
    }
  };

  const handleStartAgain = () => {
    if (selectedSubject) {
      setConfirmationAction('start_again');
    }
  };

  const handleResumeWithSBERT = async () => {
    if (selectedSubject) {
      try {
        // Fetch preparation stats before showing confirmation
        const stats = await api.getPreparationStats(selectedSubject);
        setPreparationStats(stats);
        setConfirmationAction('resume_sbert');
      } catch (error) {
        console.error('Failed to get preparation stats:', error);
        // Still show confirmation even if stats fail
        setConfirmationAction('resume_sbert');
      }
    }
  };

  const handleCancelDialog = () => {
    setSelectedSubject(null);
    setConfirmationAction(null);
  };

  const handleConfirmAction = async () => {
    if (!selectedSubject || !confirmationAction) return;

    if (confirmationAction === 'resume') {
      router.push(`/process/${selectedSubject}`);
      setSelectedSubject(null);
      setConfirmationAction(null);
    } else if (confirmationAction === 'start_again') {
      try {
        setProcessing(true);
        // Clear backend session, cache, and all files
        await api.clearSession(selectedSubject);
        
        // Clear frontend localStorage for this subject
        storage.clearSession(selectedSubject);
        
        // Navigate to process page with restart flag
        router.push(`/process/${selectedSubject}?restart=true`);
        setSelectedSubject(null);
        setConfirmationAction(null);
      } catch (error) {
        console.error('Failed to clear session:', error);
        alert('Failed to clear session. Please try again.');
      } finally {
        setProcessing(false);
      }
    } else if (confirmationAction === 'resume_sbert') {
      try {
        setProcessing(true);
        
        // Clear frontend localStorage for this subject (same as Start Again)
        storage.clearSession(selectedSubject);
        
        // Prepare and process with SBERT (non-removed files only)
        const result = await api.prepareAndProcess(selectedSubject);
        
        // Store full result to show in completion modal with group statistics
        setSbertResult({
          non_duplicates: result.auto_saved || result.auto_saved_count || 0,
          total_files: result.total_files || 0,
          similar_count: result.similar_count || 0,
          group_count: result.group_count || 0,
          similarity_bins: result.similarity_bins || []
        });
        setProcessing(false);
        // Don't navigate yet - wait for user to click OK on result modal
      } catch (error: any) {
        console.error('Failed to prepare and process:', error);
        alert(error.response?.data?.detail || error.message || 'Failed to prepare and process. Please try again.');
        setProcessing(false);
      }
    }
  };

  const handleCancelConfirmation = () => {
    setConfirmationAction(null);
  };

  const getConfirmationMessage = () => {
    switch (confirmationAction) {
      case 'resume':
        return 'Resume your existing session?';
      case 'start_again':
        return 'This will clear all progress and start fresh. Continue?';
      case 'resume_sbert':
        if (preparationStats) {
          return `This will run SBERT on non-removed files only.\n\nTotal files: ${preparationStats.total_files}\nRemoved files: ${preparationStats.removed_files}\nFiles SBERT will process: ${preparationStats.files_to_process}\n\nContinue?`;
        }
        return 'This will run SBERT again on non-removed files only. Continue?';
      default:
        return '';
    }
  };

  const handleSbertResultOK = () => {
    if (selectedSubject) {
      router.push(`/process/${selectedSubject}`);
      setSelectedSubject(null);
      setConfirmationAction(null);
      setPreparationStats(null);
      setSbertResult(null);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 py-12 px-4">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-5xl font-bold text-gray-800 mb-4">
            MCQ Deduplication System
          </h1>
          <p className="text-xl text-gray-600">
            Detect and remove duplicate questions using SBERT
          </p>
        </div>

        {/* Content */}
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <h2 className="text-2xl font-bold text-gray-800 mb-6">
            Select a Subject
          </h2>

          {loading && (
            <div className="text-center py-12">
              <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
              <p className="mt-4 text-gray-600">Loading subjects...</p>
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
              <p className="text-red-700">{error}</p>
              <button
                onClick={loadSubjects}
                className="mt-2 text-sm text-red-600 hover:text-red-800 underline"
              >
                Retry
              </button>
            </div>
          )}

          {!loading && !error && subjects.length === 0 && (
            <div className="text-center py-12 text-gray-500">
              No subjects found. Make sure the classified_all_db folder contains subject folders.
            </div>
          )}

          {!loading && subjects.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {subjects.map((subject) => (
                <button
                  key={subject.name}
                  onClick={() => handleSelectSubject(subject)}
                  disabled={!subject.enabled}
                  className={`p-6 rounded-xl border-2 text-left transition-all relative ${
                    subject.enabled
                      ? 'border-blue-300 hover:border-blue-500 hover:shadow-lg bg-white cursor-pointer'
                      : 'border-gray-200 bg-gray-50 cursor-not-allowed opacity-50'
                  }`}
                >
                  {/* Session exists or removed-track exists badge */}
                  {subject.enabled && (subjectSessions[subject.name] || subjectRemovedTrack[subject.name]) && (
                    <div className="absolute top-2 right-2 bg-green-500 text-white text-xs px-2 py-1 rounded-full">
                      In Progress
                    </div>
                  )}
                  
                  <h3 className="text-xl font-semibold text-gray-800 mb-2 capitalize">
                    {subject.name.replace(/-/g, ' ')}
                  </h3>
                  <p className="text-sm text-gray-600">
                    {subject.enabled
                      ? `${subject.file_count} MCQ files`
                      : 'No files available'}
                  </p>
                  {subject.enabled && (
                    <div className="mt-4 text-blue-600 font-medium">
                      {(subjectSessions[subject.name] || subjectRemovedTrack[subject.name]) ? 'Resume / Restart →' : 'Start Processing →'}
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}

          {/* Resume/Start Again Dialog */}
          {selectedSubject && !confirmationAction && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
              <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md mx-4">
                <h2 className="text-2xl font-bold text-gray-800 mb-4 capitalize">
                  {selectedSubject.replace(/-/g, ' ')}
                </h2>
                <p className="text-gray-600 mb-6">
                  You have an existing session for this subject. Would you like to resume or start from scratch?
                </p>
                
                <div className="space-y-3">
                  <button
                    onClick={handleResume}
                    className="w-full px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-all"
                  >
                    📂 Resume from where I left
                  </button>
                  
                  <button
                    onClick={handleStartAgain}
                    className="w-full px-6 py-3 bg-orange-600 hover:bg-orange-700 text-white font-semibold rounded-lg transition-all"
                  >
                    🔄 Start Again (Run SBERT)
                  </button>
                  
                  <button
                    onClick={handleResumeWithSBERT}
                    className="w-full px-6 py-3 bg-purple-600 hover:bg-purple-700 text-white font-semibold rounded-lg transition-all"
                  >
                    🔄 Resume with Running SBERT
                  </button>
                  
                  <button
                    onClick={handleCancelDialog}
                    className="w-full px-6 py-3 bg-gray-300 hover:bg-gray-400 text-gray-800 font-semibold rounded-lg transition-all"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Confirmation Dialog */}
          {confirmationAction && selectedSubject && !sbertResult && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60]">
              <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md mx-4">
                <h2 className="text-2xl font-bold text-gray-800 mb-4 capitalize">
                  {selectedSubject.replace(/-/g, ' ')}
                </h2>
                <div className="text-gray-600 mb-6">
                  {confirmationAction === 'resume_sbert' && preparationStats ? (
                    <div className="space-y-2">
                      <p>This will run SBERT on non-removed files only.</p>
                      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-1">
                        <p className="font-semibold">File Statistics:</p>
                        <p>Total files: <span className="font-bold">{preparationStats.total_files}</span></p>
                        <p>Removed files: <span className="font-bold text-red-600">{preparationStats.removed_files}</span></p>
                        <p>Files SBERT will process: <span className="font-bold text-green-600">{preparationStats.files_to_process}</span></p>
                      </div>
                      <p className="mt-2">Continue?</p>
                    </div>
                  ) : (
                    <p>{getConfirmationMessage()}</p>
                  )}
                </div>
                
                <div className="space-y-3">
                  <button
                    onClick={handleConfirmAction}
                    disabled={processing}
                    className={`w-full px-6 py-3 text-white font-semibold rounded-lg transition-all ${
                      processing
                        ? 'bg-gray-400 cursor-not-allowed'
                        : confirmationAction === 'resume'
                        ? 'bg-blue-600 hover:bg-blue-700'
                        : confirmationAction === 'start_again'
                        ? 'bg-orange-600 hover:bg-orange-700'
                        : 'bg-purple-600 hover:bg-purple-700'
                    }`}
                  >
                    {processing ? 'Processing...' : 'Confirm'}
                  </button>
                  
                  <button
                    onClick={handleCancelConfirmation}
                    disabled={processing}
                    className="w-full px-6 py-3 bg-gray-300 hover:bg-gray-400 text-gray-800 font-semibold rounded-lg transition-all disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* SBERT Completion Result Dialog with Group Statistics */}
          {sbertResult && selectedSubject && (
            <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-[60]">
              <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-3xl w-full mx-4 max-h-[90vh] overflow-y-auto">
                <h2 className="text-2xl font-bold text-gray-800 mb-4">Processing Summary</h2>
                <div className="grid grid-cols-2 gap-4 mb-6">
                  <div className="p-4 bg-blue-50 rounded-lg">
                    <p className="text-sm text-gray-600">Total MCQs</p>
                    <p className="text-2xl font-bold text-gray-900">{sbertResult.total_files}</p>
                  </div>
                  <div className="p-4 bg-green-50 rounded-lg">
                    <p className="text-sm text-gray-600">Non-duplicates</p>
                    <p className="text-2xl font-bold text-gray-900">{sbertResult.non_duplicates}</p>
                  </div>
                  <div className="p-4 bg-orange-50 rounded-lg">
                    <p className="text-sm text-gray-600">Similar (in groups)</p>
                    <p className="text-2xl font-bold text-gray-900">{sbertResult.similar_count || 0}</p>
                  </div>
                  <div className="p-4 bg-purple-50 rounded-lg">
                    <p className="text-sm text-gray-600">Groups Found</p>
                    <p className="text-2xl font-bold text-gray-900">{sbertResult.group_count || 0}</p>
                  </div>
                </div>
                {sbertResult.similarity_bins && sbertResult.similarity_bins.length > 0 && (
                  <div className="max-h-96 overflow-y-auto border rounded-lg p-4 mb-6">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-lg font-semibold text-gray-800">Groups by Similarity Range</h3>
                      <p className="text-sm text-gray-500">
                        Total: <span className="font-bold text-gray-900">{(sbertResult.group_count || 0).toLocaleString()}</span> groups
                      </p>
                    </div>
                    <div className="space-y-2">
                      {sbertResult.similarity_bins
                        .filter(bin => bin.count > 0) // Only show ranges with groups
                        .sort((a, b) => {
                          // Sort by upper bound descending (100-99 first, then 99-98, etc.)
                          const aUpper = parseInt(a.range.split('-')[0]);
                          const bUpper = parseInt(b.range.split('-')[0]);
                          return bUpper - aUpper;
                        })
                        .map((bin) => {
                          // Parse range format "100-99" to "100.0% - 99.0%"
                          const [upper, lower] = bin.range.split('-').map(Number);
                          const rangeDisplay = `${upper}.0% - ${lower}.0%`;
                          const groupCount = sbertResult.group_count || 0;
                          const percentage = groupCount > 0 ? ((bin.count / groupCount) * 100).toFixed(1) : '0';
                          
                          // Color coding based on similarity level
                          let barColor = 'bg-blue-600';
                          if (upper >= 99) barColor = 'bg-red-600'; // Very high similarity (red)
                          else if (upper >= 95) barColor = 'bg-orange-600'; // High similarity (orange)
                          else if (upper >= 90) barColor = 'bg-yellow-600'; // Medium-high similarity (yellow)
                          else barColor = 'bg-green-600'; // Lower similarity (green)
                          
                          return (
                            <div 
                              key={bin.range} 
                              className="flex items-center justify-between p-3 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg border border-blue-200 hover:shadow-md transition-shadow"
                            >
                              <div className="flex items-center gap-3 flex-1">
                                <div className="w-36 min-w-[140px]">
                                  <p className="text-sm font-semibold text-gray-700">{rangeDisplay}</p>
                                </div>
                                <div className="flex-1 max-w-md">
                                  <div className="flex items-center gap-2">
                                    <div className="flex-1 bg-gray-200 rounded-full h-5 overflow-hidden">
                                      <div 
                                        className={`${barColor} h-full rounded-full transition-all`}
                                        style={{ width: `${percentage}%` }}
                                        title={`${bin.count} groups (${percentage}% of total)`}
                                      />
                                    </div>
                                    <span className="text-xs text-gray-600 w-14 text-right font-medium">{percentage}%</span>
                                  </div>
                                </div>
                              </div>
                              <div className="text-right ml-4 min-w-[80px]">
                                <p className="text-xl font-bold text-gray-900">{bin.count.toLocaleString()}</p>
                                <p className="text-xs text-gray-500">group{bin.count !== 1 ? 's' : ''}</p>
                              </div>
                            </div>
                          );
                        })}
                      {sbertResult.similarity_bins.filter(bin => bin.count > 0).length === 0 && (
                        <p className="text-gray-500 text-center py-4">No groups found in similarity ranges</p>
                      )}
                    </div>
                    {sbertResult.similarity_bins.filter(bin => bin.count > 0).length > 0 && (
                      <div className="mt-4 pt-4 border-t border-gray-200">
                        <div className="flex items-center justify-center gap-4 text-xs text-gray-600">
                          <div className="flex items-center gap-1">
                            <div className="w-3 h-3 bg-red-600 rounded"></div>
                            <span>≥99%</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <div className="w-3 h-3 bg-orange-600 rounded"></div>
                            <span>95-98%</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <div className="w-3 h-3 bg-yellow-600 rounded"></div>
                            <span>90-94%</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <div className="w-3 h-3 bg-green-600 rounded"></div>
                            <span>&lt;90%</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
                <div className="flex justify-end">
                  <button
                    onClick={handleSbertResultOK}
                    className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg shadow"
                  >
                    Proceed to Similarity Review
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer info */}
        <div className="mt-8 text-center text-sm text-gray-600">
          <p>Using SBERT model: paraphrase-multilingual-MiniLM-L12-v2</p>
          <p className="mt-1">Similarity threshold: 0.85 (configurable in .env)</p>
        </div>
      </div>
    </div>
  );
}

