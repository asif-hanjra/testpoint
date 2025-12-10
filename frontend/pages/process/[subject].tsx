import React, { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/router';
import { ProgressIndicator } from '../../components/ProgressIndicator';
import { SimilarityGroupView, SimilarityGroupViewHandle } from '../../components/SimilarityGroupView';
import { Toast } from '../../components/Toast';
import { api } from '../../lib/api';
import { storage } from '../../lib/storage';

interface Group {
  files: string[];
  max_similarity: number;
  similarities: Array<{
    file1: string;
    file2: string;
    score: number;
  }>;
}

export default function ProcessSubject() {
  const router = useRouter();
  const { subject } = router.query;
  
  const [stage, setStage] = useState<'processing' | 'review' | 'complete'>('processing');
  const [progress, setProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState('Initializing...');
  const [error, setError] = useState('');
  
  const [totalFiles, setTotalFiles] = useState(0);
  const [nonDuplicateCount, setNonDuplicateCount] = useState(0);
  const [similarCount, setSimilarCount] = useState(0);
  const [groupCount, setGroupCount] = useState(0);
  const [similarityBins, setSimilarityBins] = useState<{ range: string; count: number }[]>([]);
  
  const [groups, setGroups] = useState<Group[]>([]);
  const [groupsPairwise, setGroupsPairwise] = useState<Group[]>([]);
  const [similarityLevelIndex, setSimilarityLevelIndex] = useState(0);
  const [completedGroups, setCompletedGroups] = useState<number[]>([]);
  const [startFromMin, setStartFromMin] = useState(false);
  const similarityGroupViewRef = useRef<SimilarityGroupViewHandle | null>(null);
  const [showSummaryModal, setShowSummaryModal] = useState(false);
  
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  
  useEffect(() => {
    if (subject && typeof subject === 'string') {
      checkAndResume(subject);
    }
  }, [subject]);

  const checkAndResume = async (subjectName: string) => {
    try {
      // Check if restart is requested
      const urlParams = new URLSearchParams(window.location.search);
      const restart = urlParams.get('restart');
      
      if (restart === 'true') {
        // Clear URL parameter and start fresh
        window.history.replaceState({}, '', `/process/${subjectName}`);
        startProcessing(subjectName);
        return;
      }
      
      // Check if session exists
      const sessionCheck = await api.checkSession(subjectName);
      
      if (sessionCheck.exists) {
        const session = sessionCheck.session;
        
        // If files are saved, go directly to review
        if (session.files_saved) {
          const groupsData = await api.getGroups(subjectName);
          const pairwise = groupsData.groups_pairwise || groupsData.groups || [];
          setGroupsPairwise(pairwise);
          setGroups(pairwise);
          setTotalFiles(groupsData.total_files);
          setNonDuplicateCount(groupsData.non_duplicate_count);
          setSimilarCount(groupsData.total_files - groupsData.non_duplicate_count);
          setGroupCount(pairwise.length);
          setCompletedGroups(groupsData.completed_groups || []);
          
          // Load saved similarity level index from localStorage
          const savedSession = storage.loadSession(subjectName);
          if (savedSession && savedSession.similarityLevelIndex !== undefined) {
            setSimilarityLevelIndex(savedSession.similarityLevelIndex);
          }
          
          // Go directly to review (SimilarityGroupView handles navigation internally)
          setStage('review');
          return;
        } else {
          // Processing complete but files not saved yet - auto-proceed to review
          setTotalFiles(session.total_files);
          setNonDuplicateCount(session.non_duplicate_count);
          setSimilarCount(session.total_files - session.non_duplicate_count);
          // Get groups and proceed directly to review
          const groupsData = await api.getGroups(subjectName);
          const pairwise = groupsData.groups_pairwise || groupsData.groups || [];
          setGroupsPairwise(pairwise);
          setGroups(pairwise);
          setGroupCount(pairwise.length);
          setCompletedGroups(groupsData.completed_groups || []);
          
          // Load saved similarity level index from localStorage
          const savedSession = storage.loadSession(subjectName);
          if (savedSession?.similarityLevelIndex !== undefined) {
            setSimilarityLevelIndex(savedSession.similarityLevelIndex);
          }
          
          setStage('review');
          return;
        }
      }
      
      // No session, start fresh
      startProcessing(subjectName);
    } catch (error) {
      console.error('Error checking session:', error);
      // On error, start fresh
      startProcessing(subjectName);
    }
  };

  // Handle browser navigation/close during processing
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (stage === 'processing') {
        e.preventDefault();
        e.returnValue = 'Processing in progress. Are you sure you want to leave?';
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [stage]);

  const startProcessing = async (subjectName: string) => {
    setStage('processing');
    setProgress(0);
    setStatusMessage('Starting processing...');
    setError('');
    
    // Fake progress bar: goes to 99% in 10 seconds, then waits for completion
    const progressInterval = setInterval(() => {
      setProgress(prev => {
        if (prev < 99) {
          return Math.min(prev + 10, 99);
        }
        return prev;
      });
    }, 1000);
    
    try {
      const result = await api.processSubject(subjectName);
      
      clearInterval(progressInterval);
      setProgress(100);
      setStatusMessage('Processing complete!');
      
      setTotalFiles(result.total_files);
      setNonDuplicateCount(result.non_duplicate_count);
      setSimilarCount(result.similar_count);
      setGroupCount(result.group_count);
      setSimilarityBins(result.similarity_bins || []);
      
      // Load groups and proceed to review
      setTimeout(async () => {
        try {
          const groupsData = await api.getGroups(subjectName);
          const pairwise = groupsData.groups_pairwise || groupsData.groups || [];
          setGroupsPairwise(pairwise);
          setGroups(pairwise);
          setShowSummaryModal(true);
          setStage('review');
        } catch (error) {
          setError('Failed to load groups');
          // Still proceed to review even if groups load fails
          setStage('review');
        }
      }, 500);
      
    } catch (error: any) {
      clearInterval(progressInterval);
      const errorMessage = error.response?.data?.detail || error.response?.data?.message || error.message || 'Processing failed';
      setError(errorMessage);
      setStatusMessage(`Error: ${errorMessage}`);
    }
  };


  const showToastMessage = (message: string) => {
    setToastMessage(message);
    setShowToast(true);
  };


  const handleSimilarityGroupsSubmitted = async () => {
    // Show toast
    showToastMessage('All groups saved!');
    
    // Reload completed groups
    try {
      if (typeof subject === 'string') {
        const groupsData = await api.getGroups(subject);
        setCompletedGroups(groupsData.completed_groups || []);
      }
    } catch (error) {
      console.error('Failed to reload groups:', error);
    }
  };

  if (!subject || typeof subject !== 'string') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 py-12 px-4">
      {/* Toast Notification */}
      <Toast 
        message={toastMessage} 
        show={showToast} 
        onClose={() => setShowToast(false)} 
      />
      
      {/* Back to Home - Top Left */}
      <button
        onClick={() => router.push('/')}
        className="fixed top-4 left-4 text-blue-600 hover:text-blue-800 underline z-50"
      >
        ← Home
      </button>
      
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        {stage === 'review' && groups.length > 0 && (
          <div className="flex items-center justify-center gap-4 mb-8">
            <h1 className="text-4xl font-bold text-gray-800 capitalize">
              {subject.replace(/-/g, ' ')}
            </h1>
            <button
              onClick={() => {
                if (similarityGroupViewRef.current) {
                  if (startFromMin) {
                    // Currently at min, jump to max
                    similarityGroupViewRef.current.jumpToMax();
                    setStartFromMin(false);
                  } else {
                    // Currently at max, jump to min
                    similarityGroupViewRef.current.jumpToMin();
                    setStartFromMin(true);
                  }
                }
              }}
              className={`px-4 py-2 rounded-lg font-semibold transition-all ${
                startFromMin
                  ? 'bg-green-600 text-white hover:bg-green-700'
                  : 'bg-blue-600 text-white hover:bg-blue-700'
              }`}
              title={startFromMin ? 'Currently at Min (85.0) - Click to jump to Max (100.0)' : 'Currently at Max (100.0) - Click to jump to Min (85.0)'}
            >
              {startFromMin ? 'Min (85.0)' : 'Max (100.0)'}
            </button>
          </div>
        )}
        {stage !== 'review' && (
          <div className="text-center mb-8">
            <h1 className="text-4xl font-bold text-gray-800 mb-2 capitalize">
              {subject.replace(/-/g, ' ')}
            </h1>
          </div>
        )}

        {/* Processing Stage */}
        {stage === 'processing' && (
          <div className="bg-white rounded-2xl shadow-2xl p-8">
            <h2 className="text-2xl font-bold text-gray-800 mb-8 text-center">
              Processing MCQs with SBERT
            </h2>
            
            <ProgressIndicator progress={progress} message={statusMessage} />
            
            {error && (
              <div className="mt-6 bg-red-50 border border-red-200 rounded-lg p-4">
                <p className="text-red-700">{error}</p>
              </div>
            )}
          </div>
        )}


        {/* Review Stage */}
        {stage === 'review' && groups.length > 0 && (
          <SimilarityGroupView
            ref={similarityGroupViewRef}
            subject={subject}
            groups={groupsPairwise}
            completedGroups={completedGroups}
            onGroupsSubmitted={handleSimilarityGroupsSubmitted}
            initialLevelIndex={similarityLevelIndex}
            onLevelIndexChange={(index) => {
              setSimilarityLevelIndex(index);
              // Save to localStorage
              if (typeof subject === 'string') {
                const savedSession = storage.loadSession(subject);
                if (savedSession) {
                  savedSession.similarityLevelIndex = index;
                  storage.saveSession(savedSession);
                }
              }
            }}
            onLevelsLoaded={(totalLevels) => {
              // Update toggle state based on initial level index
              // If index is 0, we're at max; if index is last, we're at min
              if (totalLevels > 0) {
                setStartFromMin(similarityLevelIndex === totalLevels - 1);
              }
            }}
          />
        )}
        {showSummaryModal && (
          <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
            <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-3xl w-full mx-4">
              <h2 className="text-2xl font-bold text-gray-800 mb-4">Processing Summary</h2>
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div className="p-4 bg-blue-50 rounded-lg">
                  <p className="text-sm text-gray-600">Total MCQs</p>
                  <p className="text-2xl font-bold text-gray-900">{totalFiles}</p>
                </div>
                <div className="p-4 bg-green-50 rounded-lg">
                  <p className="text-sm text-gray-600">Non-duplicates</p>
                  <p className="text-2xl font-bold text-gray-900">{nonDuplicateCount}</p>
                </div>
                <div className="p-4 bg-orange-50 rounded-lg">
                  <p className="text-sm text-gray-600">Similar (in groups)</p>
                  <p className="text-2xl font-bold text-gray-900">{similarCount}</p>
                </div>
                <div className="p-4 bg-purple-50 rounded-lg">
                  <p className="text-sm text-gray-600">Groups Found</p>
                  <p className="text-2xl font-bold text-gray-900">{groupCount}</p>
                </div>
              </div>
              <div className="max-h-96 overflow-y-auto border rounded-lg p-4 mb-6">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-lg font-semibold text-gray-800">Groups by Similarity Range</h3>
                  <p className="text-sm text-gray-500">
                    Total: <span className="font-bold text-gray-900">{groupCount.toLocaleString()}</span> groups
                  </p>
                </div>
                <div className="space-y-2">
                  {similarityBins
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
                  {similarityBins.filter(bin => bin.count > 0).length === 0 && (
                    <p className="text-gray-500 text-center py-4">No groups found in similarity ranges</p>
                  )}
                </div>
                {similarityBins.filter(bin => bin.count > 0).length > 0 && (
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
              <div className="flex justify-end">
                <button
                  onClick={() => setShowSummaryModal(false)}
                  className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg shadow"
                >
                  Proceed to Similarity Review
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

