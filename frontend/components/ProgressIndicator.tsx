import React from 'react';

interface ProgressIndicatorProps {
  progress: number;
  message?: string;
}

export const ProgressIndicator: React.FC<ProgressIndicatorProps> = ({ 
  progress, 
  message 
}) => {
  return (
    <div className="w-full max-w-2xl mx-auto">
      {message && (
        <div className="text-center mb-4 text-lg text-gray-700">
          {message}
        </div>
      )}
      
      <div className="w-full bg-gray-200 rounded-full h-8 overflow-hidden shadow-inner">
        <div 
          className="bg-gradient-to-r from-blue-500 to-blue-600 h-8 rounded-full transition-all duration-300 flex items-center justify-center text-white font-semibold"
          style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
        >
          {progress > 10 && `${progress}%`}
        </div>
      </div>
      
      {progress < 100 && (
        <div className="text-center mt-3 text-sm text-gray-600">
          Processing... Please keep this page open.
        </div>
      )}
    </div>
  );
};



