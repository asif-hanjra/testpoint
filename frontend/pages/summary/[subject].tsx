import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { api } from '../../lib/api';
import { storage } from '../../lib/storage';

interface Summary {
  total_processed: number;
  non_duplicates: number;
  files_in_groups: number;
  final_saved: number;
  final_removed: number;
  total_files: number;
}

export default function SummaryPage() {
  const router = useRouter();
  const { subject } = router.query;
  
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (subject && typeof subject === 'string') {
      loadSummary(subject);
    }
  }, [subject]);

  const loadSummary = async (subjectName: string) => {
    try {
      setLoading(true);
      const data = await api.getSummary(subjectName);
      setSummary(data);
      setError('');
    } catch (err) {
      console.error('Failed to load summary:', err);
      setError('Failed to load summary');
    } finally {
      setLoading(false);
    }
  };

  const handleReturnHome = async () => {
    if (typeof subject === 'string') {
      // Clear session
      storage.clearSession();
      await api.clearSession(subject);
    }
    
    router.push('/');
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
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-800 mb-2">
            Review Complete!
          </h1>
          <p className="text-xl text-gray-600 capitalize">
            {subject.replace(/-/g, ' ')}
          </p>
        </div>

        {/* Content */}
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          {loading && (
            <div className="text-center py-12">
              <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
              <p className="mt-4 text-gray-600">Loading summary...</p>
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <p className="text-red-700">{error}</p>
            </div>
          )}

          {!loading && !error && summary && (
            <div>
              <div className="text-center mb-8">
                <div className="text-7xl mb-4">🎉</div>
                <h2 className="text-3xl font-bold text-gray-800 mb-2">
                  All Done!
                </h2>
                <p className="text-gray-600">
                  Your MCQ database has been processed and organized.
                </p>
              </div>

              {/* Statistics */}
              <div className="space-y-6">
                {/* Total Processed */}
                <div className="bg-blue-50 border-2 border-blue-200 rounded-lg p-6">
                  <h3 className="text-lg font-semibold text-gray-700 mb-4">
                    Processing Overview
                  </h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm text-gray-600">Total MCQs Processed</p>
                      <p className="text-3xl font-bold text-blue-600">
                        {summary.total_processed}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600">Non-Duplicates</p>
                      <p className="text-3xl font-bold text-green-600">
                        {summary.non_duplicates}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Groups Stats */}
                <div className="bg-purple-50 border-2 border-purple-200 rounded-lg p-6">
                  <h3 className="text-lg font-semibold text-gray-700 mb-4">
                    Duplicate Groups
                  </h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm text-gray-600">MCQs in Groups</p>
                      <p className="text-3xl font-bold text-purple-600">
                        {summary.files_in_groups}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600">Groups Reviewed</p>
                      <p className="text-3xl font-bold text-purple-600">
                        {summary.files_in_groups > 0 ? '✓' : '-'}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Final Results */}
                <div className="bg-green-50 border-2 border-green-200 rounded-lg p-6">
                  <h3 className="text-lg font-semibold text-gray-700 mb-4">
                    Final Results
                  </h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm text-gray-600">✓ Saved to final-db</p>
                      <p className="text-3xl font-bold text-green-600">
                        {summary.final_saved}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600">✗ Removed (duplicates)</p>
                      <p className="text-3xl font-bold text-red-600">
                        {summary.final_removed}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Verification */}
                <div className="bg-gray-50 border-2 border-gray-200 rounded-lg p-4">
                  <p className="text-sm text-gray-600 text-center">
                    Verification: {summary.final_saved} + {summary.final_removed} = {summary.total_files}
                    {summary.total_files === summary.total_processed && (
                      <span className="ml-2 text-green-600 font-semibold">✓ All files accounted for</span>
                    )}
                  </p>
                </div>
              </div>

              {/* File locations */}
              <div className="mt-8 bg-blue-50 rounded-lg p-6">
                <h3 className="font-semibold text-gray-800 mb-3">
                  📁 File Locations
                </h3>
                <div className="space-y-2 text-sm">
                  <div>
                    <span className="text-gray-600">Saved MCQs:</span>
                    <code className="ml-2 bg-white px-2 py-1 rounded text-xs">
                      /Users/mac/testpoint/final-db/{subject}/
                    </code>
                  </div>
                  <div>
                    <span className="text-gray-600">Removed duplicates:</span>
                    <code className="ml-2 bg-white px-2 py-1 rounded text-xs">
                      /Users/mac/testpoint/removed_duplicates_db/{subject}/
                    </code>
                  </div>
                </div>
              </div>

              {/* Action button */}
              <div className="mt-8 text-center">
                <button
                  onClick={handleReturnHome}
                  className="px-12 py-4 bg-blue-600 hover:bg-blue-700 text-white text-xl font-semibold rounded-lg shadow-lg transition-all"
                >
                  Return to Home
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


