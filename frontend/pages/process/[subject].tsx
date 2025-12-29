import React, { useEffect, useState, useRef, useMemo } from 'react';
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
  const [backgroundSubmitting, setBackgroundSubmitting] = useState(false);
  const [backgroundProgress, setBackgroundProgress] = useState({ current: 0, total: 0 });
  const [submitRangeStart, setSubmitRangeStart] = useState<number>(100.0);
  const [submitRangeEnd, setSubmitRangeEnd] = useState<number>(99.0);
  
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  
  useEffect(() => {
    if (subject && typeof subject === 'string') {
      checkAndResume(subject);
    }
  }, [subject]);

  // Debug: Log when modal shows and groupCount changes
  useEffect(() => {
    if (showSummaryModal) {
      console.log('[Modal] Summary modal opened, groupCount:', groupCount);
    }
  }, [showSummaryModal, groupCount]);

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
        
        // Load groups and show summary modal (don't auto-proceed to review)
        const groupsData = await api.getGroups(subjectName);
        const pairwise = groupsData.groups_pairwise || groupsData.groups || [];
        setGroupsPairwise(pairwise);
        setGroups(pairwise);
        setTotalFiles(session.total_files);
        setNonDuplicateCount(session.non_duplicate_count);
        setSimilarCount(session.total_files - session.non_duplicate_count);
        setGroupCount(pairwise.length);
        setCompletedGroups(groupsData.completed_groups || []);
        
        // Load saved similarity level index from localStorage
        const savedSession = storage.loadSession(subjectName);
        if (savedSession?.similarityLevelIndex !== undefined) {
          setSimilarityLevelIndex(savedSession.similarityLevelIndex);
        }
        
        // Show summary modal - user must choose to proceed
        // DO NOT set stage to 'review' - wait for user choice
        setShowSummaryModal(true);
        return;
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
      
      // Load groups and show summary modal (DO NOT proceed to review yet)
      setTimeout(async () => {
        try {
          const groupsData = await api.getGroups(subjectName);
          const pairwise = groupsData.groups_pairwise || groupsData.groups || [];
          setGroupsPairwise(pairwise);
          setGroups(pairwise);
          setShowSummaryModal(true);
          // DO NOT set stage to 'review' yet - wait for user to close modal
          // Stage stays as 'processing' until user makes a choice
        } catch (error) {
          setError('Failed to load groups');
          // On error, still show modal if we have data
          if (groupsPairwise.length > 0) {
            setShowSummaryModal(true);
          }
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

  // Auto-select best MCQ based on year priority
  const autoSelectBestMCQ = (files: string[], metadata: { [filename: string]: { hasYear: boolean; fileNum: number } }): { [filename: string]: boolean } => {
    const selections: { [filename: string]: boolean } = {};
    
    if (files.length === 0) return selections;
    if (files.length === 1) {
      selections[files[0]] = true;
      return selections;
    }
    
    // Priority: hasYear > smallest fileNum
    const filesWithYear = files.filter(f => metadata[f]?.hasYear);
    const filesWithoutYear = files.filter(f => !metadata[f]?.hasYear);
    
    if (filesWithYear.length > 0) {
      // Select file with smallest number among files with year
      const sorted = filesWithYear.sort((a, b) => {
        const numA = metadata[a]?.fileNum || 999999;
        const numB = metadata[b]?.fileNum || 999999;
        return numA - numB;
      });
      selections[sorted[0]] = true;
    } else if (filesWithoutYear.length > 0) {
      // Select file with smallest number among files without year
      const sorted = filesWithoutYear.sort((a, b) => {
        const numA = metadata[a]?.fileNum || 999999;
        const numB = metadata[b]?.fileNum || 999999;
        return numA - numB;
      });
      selections[sorted[0]] = true;
    }
    
    return selections;
  };

  // Submit all groups with auto-selection (background submission)
  const handleSubmitAllGroupsWithAutoSelection = async () => {
    if (!subject || typeof subject !== 'string' || groupsPairwise.length === 0) {
      alert('No groups available to submit');
      return;
    }

    setBackgroundSubmitting(true);
    setBackgroundProgress({ current: 0, total: groupsPairwise.length });
    setShowSummaryModal(false); // Close modal when starting

    try {
      // Get counts BEFORE submission
      let savedCountBefore = 0;
      let removedCountBefore = 0;
      try {
        const summaryBefore = await api.getSummary(subject);
        savedCountBefore = summaryBefore.final_saved || 0;
        removedCountBefore = summaryBefore.final_removed || 0;
      } catch (error) {
        console.error('[Background] Failed to get summary before:', error);
      }

      // Filter groups by similarity range
      const filteredGroupIndices: number[] = [];
      for (let groupIndex = 0; groupIndex < groupsPairwise.length; groupIndex++) {
        const group = groupsPairwise[groupIndex];
        const roundedSimilarity = Math.round(group.max_similarity * 1000) / 10;
        // Inclusive boundaries: start >= similarity >= end
        if (roundedSimilarity <= submitRangeStart && roundedSimilarity >= submitRangeEnd) {
          filteredGroupIndices.push(groupIndex);
        }
      }

      if (filteredGroupIndices.length === 0) {
        alert(`No groups found in similarity range ${submitRangeStart}% - ${submitRangeEnd}%`);
        setBackgroundSubmitting(false);
        return;
      }

      console.log(`[Background] Submitting ${filteredGroupIndices.length} groups in range ${submitRangeStart}% - ${submitRangeEnd}%`);

      // Load metadata for auto-selection
      const session = storage.loadSession(subject);
      const metadata = session?.mcqMetadata || {};

      // Calculate final state for each file across filtered groups only
      const fileFinalStates: { [filename: string]: boolean } = {};

      // First pass: Initialize all files to false (only for filtered groups)
      for (const groupIndex of filteredGroupIndices) {
        const group = groupsPairwise[groupIndex];
        for (const filename of group.files) {
          if (!(filename in fileFinalStates)) {
            fileFinalStates[filename] = false;
          }
        }
      }

      // Second pass: Run auto-selection and set to true if checked in any group
      for (const groupIndex of filteredGroupIndices) {
        const group = groupsPairwise[groupIndex];
        const groupSelections = autoSelectBestMCQ(group.files, metadata);
        
        for (const filename of group.files) {
          const isChecked = groupSelections[filename] ?? false;
          if (isChecked) {
            fileFinalStates[filename] = true;
          }
        }
      }

      // Determine batch size
      const totalGroups = filteredGroupIndices.length;
      const batchSize = totalGroups > 505 ? 100 : 10;

      setBackgroundProgress({ current: 0, total: totalGroups });

      let totalGroupsSubmitted = 0;

      // Process filtered groups in batches
      for (let i = 0; i < filteredGroupIndices.length; i += batchSize) {
        const batch = filteredGroupIndices.slice(i, i + batchSize);
        
        // Process all groups in the current batch in parallel
        const batchPromises = batch.map(async (groupIndex) => {
          const group = groupsPairwise[groupIndex];
          
          // Build checkedFiles list based on final state
          const checkedFiles: string[] = [];
          for (const filename of group.files) {
            if (fileFinalStates[filename] === true) {
              checkedFiles.push(filename);
            }
          }
          
          return await api.submitGroup(subject, groupIndex, checkedFiles);
        });

        const batchResponses = await Promise.all(batchPromises);
        totalGroupsSubmitted += batchResponses.length;
        
        // Update progress
        setBackgroundProgress({ current: totalGroupsSubmitted, total: totalGroups });
      }

      // Get counts AFTER submission
      let savedCountAfter = 0;
      let removedCountAfter = 0;
      try {
        const summaryAfter = await api.getSummary(subject);
        savedCountAfter = summaryAfter.final_saved || 0;
        removedCountAfter = summaryAfter.final_removed || 0;
      } catch (error) {
        console.error('[Background] Failed to get summary after:', error);
      }

      // Show success message
      showToastMessage(`Successfully submitted ${totalGroupsSubmitted.toLocaleString()} groups!`);
      
      // Reload completed groups
      try {
        const groupsData = await api.getGroups(subject);
        setCompletedGroups(groupsData.completed_groups || []);
      } catch (error) {
        console.error('Failed to reload groups:', error);
      }

      setBackgroundSubmitting(false);
      
      // Navigate to review page
      setStage('review');
      
    } catch (error) {
      console.error('[Background] Failed to submit groups:', error);
      alert('Error submitting groups: ' + (error instanceof Error ? error.message : 'Unknown error'));
      setBackgroundSubmitting(false);
    }
  };

  // Calculate groups in selected similarity range
  const groupsInSelectedRange = useMemo(() => {
    if (groupsPairwise.length === 0) return 0;
    let count = 0;
    for (const group of groupsPairwise) {
      const roundedSimilarity = Math.round(group.max_similarity * 1000) / 10;
      if (roundedSimilarity <= submitRangeStart && roundedSimilarity >= submitRangeEnd) {
        count++;
      }
    }
    return count;
  }, [groupsPairwise, submitRangeStart, submitRangeEnd]);

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


        {/* Review Stage - Only render when modal is closed */}
        {stage === 'review' && groups.length > 0 && !showSummaryModal && (
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
          <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50 py-8 overflow-y-auto">
            <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full mx-4 my-8 flex flex-col max-h-[90vh] overflow-hidden">
              <div className="p-8 pb-4 flex-shrink-0">
                <h2 className="text-2xl font-bold text-gray-800 mb-4">Processing Summary</h2>
              </div>
              <div className="px-8 overflow-y-auto flex-1">
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
              
              {/* Similarity Range Selector for Submission */}
              {groupCount > 1000 && (
                <div className="mb-6 p-4 bg-purple-50 rounded-lg border-2 border-purple-200">
                  <h3 className="text-lg font-semibold text-gray-800 mb-3">
                    Select Similarity Range to Submit
                  </h3>
                  <div className="grid grid-cols-2 gap-4 mb-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Start (Max Similarity): {submitRangeStart.toFixed(1)}%
                      </label>
                      <input
                        type="range"
                        min="85"
                        max="100"
                        step="0.1"
                        value={submitRangeStart}
                        onChange={(e) => setSubmitRangeStart(parseFloat(e.target.value))}
                        className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                        style={{
                          background: `linear-gradient(to right, #9333ea 0%, #9333ea ${((submitRangeStart - 85) / 15) * 100}%, #e5e7eb ${((submitRangeStart - 85) / 15) * 100}%, #e5e7eb 100%)`
                        }}
                      />
                      <div className="flex justify-between text-xs text-gray-500 mt-1">
                        <span>85%</span>
                        <span>100%</span>
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        End (Min Similarity): {submitRangeEnd.toFixed(1)}%
                      </label>
                      <input
                        type="range"
                        min="85"
                        max="100"
                        step="0.1"
                        value={submitRangeEnd}
                        onChange={(e) => setSubmitRangeEnd(parseFloat(e.target.value))}
                        className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                        style={{
                          background: `linear-gradient(to right, #9333ea 0%, #9333ea ${((submitRangeEnd - 85) / 15) * 100}%, #e5e7eb ${((submitRangeEnd - 85) / 15) * 100}%, #e5e7eb 100%)`
                        }}
                      />
                      <div className="flex justify-between text-xs text-gray-500 mt-1">
                        <span>85%</span>
                        <span>100%</span>
                      </div>
                    </div>
                  </div>
                  <div className="bg-white rounded p-3 border border-purple-300">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-gray-700">
                          <span className="font-semibold">Selected Range:</span>{' '}
                          <span className="text-purple-600 font-bold">
                            {submitRangeStart.toFixed(1)}% - {submitRangeEnd.toFixed(1)}%
                          </span>
                        </p>
                        <p className="text-xs text-gray-500 mt-1">
                          Groups within this similarity range will be submitted
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-2xl font-bold text-purple-600">
                          {groupsInSelectedRange.toLocaleString()}
                        </p>
                        <p className="text-xs text-gray-500">
                          group{groupsInSelectedRange !== 1 ? 's' : ''} in range
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}
              </div>
              
              {/* Fixed Footer with Buttons - Always visible at bottom */}
              <div className="p-8 pt-4 border-t-2 border-gray-300 bg-white rounded-b-2xl flex-shrink-0">
                <div className="flex justify-between items-center gap-4 flex-wrap">
                  {/* Submit All Button - Show when many groups */}
                  {groupCount > 1000 && (
                    <button
                      onClick={() => {
                        console.log('[Modal] Submit button clicked, groupCount:', groupCount, 'groupsInRange:', groupsInSelectedRange);
                        handleSubmitAllGroupsWithAutoSelection();
                      }}
                      disabled={backgroundSubmitting}
                      className="px-6 py-3 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-400 text-white font-bold rounded-lg shadow-xl transition-all flex items-center gap-2 min-w-[300px] text-base"
                      title="Submit groups in selected similarity range with auto-selection"
                    >
                      <svg className="w-6 h-6 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                      <span className="whitespace-nowrap">
                        {backgroundSubmitting 
                          ? `Submitting... (${backgroundProgress.current.toLocaleString()}/${backgroundProgress.total.toLocaleString()})`
                          : `⚡ Submit ${groupsInSelectedRange > 0 ? groupsInSelectedRange.toLocaleString() : groupCount.toLocaleString()} Groups (${submitRangeStart.toFixed(1)}% - ${submitRangeEnd.toFixed(1)}%)`}
                      </span>
                    </button>
                  )}
                  {groupCount <= 1000 && (
                    <div className="text-sm text-gray-500 italic">
                      (Submit button appears when &gt;1000 groups)
                    </div>
                  )}
                  <button
                    onClick={() => {
                      setShowSummaryModal(false);
                      // Only set stage to review after modal is closed
                      setStage('review');
                    }}
                    className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg shadow ml-auto"
                  >
                    Proceed to Similarity Review
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Background Submission Progress Modal */}
        {backgroundSubmitting && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[110]">
            <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-lg mx-4">
              <div className="text-center">
                <div className="mb-6">
                  <svg className="w-20 h-20 mx-auto text-purple-600 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
                <h2 className="text-2xl font-bold text-gray-800 mb-4">
                  Submitting All Groups
                </h2>
                <p className="text-gray-600 mb-6">
                  Processing groups with auto-selection...
                </p>
                
                {/* Progress Bar */}
                <div className="mb-4">
                  <div className="flex justify-between text-sm text-gray-600 mb-2">
                    <span>Progress</span>
                    <span className="font-bold">
                      {backgroundProgress.current.toLocaleString()} / {backgroundProgress.total.toLocaleString()}
                    </span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-4 overflow-hidden">
                    <div 
                      className="bg-purple-600 h-full rounded-full transition-all duration-300"
                      style={{ 
                        width: backgroundProgress.total > 0 
                          ? `${(backgroundProgress.current / backgroundProgress.total) * 100}%` 
                          : '0%' 
                      }}
                    />
                  </div>
                  <p className="text-xs text-gray-500 mt-2">
                    {backgroundProgress.total > 0 
                      ? `${Math.round((backgroundProgress.current / backgroundProgress.total) * 100)}% complete`
                      : 'Initializing...'}
                  </p>
                </div>
                
                <div className="bg-purple-50 rounded-lg p-4 text-sm text-gray-700">
                  <p className="font-semibold mb-1">⚡ Auto-Selection Active</p>
                  <p className="text-xs">
                    Best MCQs are being automatically selected and submitted
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

